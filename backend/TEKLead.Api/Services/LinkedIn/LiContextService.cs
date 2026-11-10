using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using Npgsql;

namespace TEKLead.Api.Services.LinkedIn;

public class LiPersonContext
{
    public Guid LeadId { get; set; }
    public string Name { get; set; } = "";
    public string Title { get; set; } = "";
    public string Company { get; set; } = "";
    public string Industry { get; set; } = "";
    /// <summary>Full structured facts (profile, company, job post, career).</summary>
    public string Raw { get; set; } = "";
    /// <summary>AI brief if built, else empty.</summary>
    public string Brief { get; set; } = "";
    public string Hash { get; set; } = "";
    /// <summary>Text used as PERSON block (brief + key raw facts).</summary>
    public string Block => string.IsNullOrWhiteSpace(Brief)
        ? $"PERSON AND COMPANY CONTEXT (facts from CRM):\n{Raw}"
        : $"PERSON BRIEF:\n{Brief}\n\nFACTS (CRM):\n{Raw}";
}

/// <summary>
/// Builds what the AI knows about a person: saved_leads profile, lead_org_details, employment
/// history, the latest matching job_leads post, and matching portfolio projects (keyword RAG over Postgres).
/// Read-only on existing tables.
/// </summary>
public class LiContextService
{
    private readonly SettingsService _settings;
    private readonly ILogger<LiContextService> _log;

    public LiContextService(SettingsService settings, ILogger<LiContextService> log)
    {
        _settings = settings; _log = log;
    }

    private NpgsqlConnection Conn() => new(_settings.ConnectionString);

    public async Task EnsureSchema()
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS li_person_briefs (
            lead_id UUID PRIMARY KEY,
            brief TEXT NOT NULL DEFAULT '',
            source_hash TEXT NOT NULL DEFAULT '',
            built_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    }

    private static string Clip(string? s, int n)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        s = Regex.Replace(s, @"\s+", " ").Trim();
        return s.Length > n ? s[..n] + "…" : s;
    }

    public async Task<LiPersonContext?> Build(Guid leadId)
    {
        await using var c = Conn();
        await c.OpenAsync();

        var p = await c.QueryFirstOrDefaultAsync<dynamic>(@"SELECT id, name, title, company, industry, location, headline, seniority,
                array_to_string(departments, ', ') AS departments, linkedin_url
            FROM saved_leads WHERE id = @leadId", new { leadId });
        if (p == null) return null;

        var ctx = new LiPersonContext
        {
            LeadId = leadId,
            Name = (string?)p.name ?? "",
            Title = (string?)p.title ?? "",
            Company = (string?)p.company ?? "",
            Industry = (string?)p.industry ?? "",
        };

        var sb = new StringBuilder();
        sb.AppendLine($"Name: {ctx.Name}");
        if (!string.IsNullOrWhiteSpace(ctx.Title)) sb.AppendLine($"Title: {ctx.Title}");
        if (!string.IsNullOrWhiteSpace((string?)p.headline)) sb.AppendLine($"Headline: {Clip((string?)p.headline, 200)}");
        if (!string.IsNullOrWhiteSpace((string?)p.seniority)) sb.AppendLine($"Seniority: {p.seniority}");
        if (!string.IsNullOrWhiteSpace((string?)p.departments)) sb.AppendLine($"Departments: {p.departments}");
        if (!string.IsNullOrWhiteSpace((string?)p.location)) sb.AppendLine($"Location: {p.location}");
        if (!string.IsNullOrWhiteSpace(ctx.Company)) sb.AppendLine($"Company: {ctx.Company}");
        if (!string.IsNullOrWhiteSpace(ctx.Industry)) sb.AppendLine($"Industry: {ctx.Industry}");

        try
        {
            var o = await c.QueryFirstOrDefaultAsync<dynamic>(@"SELECT org_website_url, org_estimated_employees, org_annual_revenue, org_founded_year, org_description
                FROM lead_org_details WHERE lead_id = @leadId", new { leadId });
            if (o != null)
            {
                if (!string.IsNullOrWhiteSpace((string?)o.org_description)) sb.AppendLine($"Company description: {Clip((string?)o.org_description, 700)}");
                if (!string.IsNullOrWhiteSpace((string?)o.org_estimated_employees)) sb.AppendLine($"Employees: {o.org_estimated_employees}");
                if (!string.IsNullOrWhiteSpace((string?)o.org_annual_revenue)) sb.AppendLine($"Annual revenue: {o.org_annual_revenue}");
                if (!string.IsNullOrWhiteSpace((string?)o.org_founded_year)) sb.AppendLine($"Founded: {o.org_founded_year}");
                if (!string.IsNullOrWhiteSpace((string?)o.org_website_url)) sb.AppendLine($"Website: {o.org_website_url}");
            }
        }
        catch (Exception ex) { _log.LogDebug(ex, "LiContext: org details skipped"); }

        try
        {
            var hist = (await c.QueryAsync<dynamic>(@"SELECT job_title, org_name, start_date, end_date, is_current
                FROM lead_employment_history WHERE lead_id = @leadId ORDER BY is_current DESC, start_date DESC NULLS LAST LIMIT 5", new { leadId })).ToList();
            if (hist.Count > 0)
            {
                sb.AppendLine("Career:");
                foreach (var h in hist)
                    sb.AppendLine($"- {h.job_title} at {h.org_name}{((bool)h.is_current ? " (current)" : "")}{(string.IsNullOrWhiteSpace((string?)h.start_date) ? "" : $", from {h.start_date}")}");
            }
        }
        catch (Exception ex) { _log.LogDebug(ex, "LiContext: employment skipped"); }

        if (!string.IsNullOrWhiteSpace(ctx.Company))
        {
            try
            {
                var j = await c.QueryFirstOrDefaultAsync<dynamic>(@"SELECT job_title, job_description, job_url, company_size, country
                    FROM job_leads WHERE lower(trim(company)) = lower(trim(@company))
                    ORDER BY COALESCE(posted_at, scraped_at) DESC LIMIT 1", new { company = ctx.Company });
                if (j != null)
                {
                    sb.AppendLine($"Open job post at their company: {j.job_title}");
                    if (!string.IsNullOrWhiteSpace((string?)j.job_description)) sb.AppendLine($"Job post excerpt: {Clip((string?)j.job_description, 900)}");
                }
            }
            catch (Exception ex) { _log.LogDebug(ex, "LiContext: job post skipped"); }
        }

        ctx.Raw = sb.ToString().Trim();
        ctx.Hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(ctx.Raw)))[..16];

        try
        {
            var b = await c.QueryFirstOrDefaultAsync<(string Brief, string Hash)>(
                "SELECT brief AS \"Brief\", source_hash AS \"Hash\" FROM li_person_briefs WHERE lead_id = @leadId", new { leadId });
            if (!string.IsNullOrWhiteSpace(b.Brief)) ctx.Brief = b.Brief;
        }
        catch { /* brief table optional */ }

        return ctx;
    }

    public async Task SaveBrief(Guid leadId, string brief, string hash)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"INSERT INTO li_person_briefs (lead_id, brief, source_hash, built_at) VALUES (@leadId, @brief, @hash, NOW())
            ON CONFLICT (lead_id) DO UPDATE SET brief = EXCLUDED.brief, source_hash = EXCLUDED.source_hash, built_at = NOW()",
            new { leadId, brief = brief.Trim(), hash });
    }

    private static readonly HashSet<string> Stop = new(StringComparer.OrdinalIgnoreCase)
    {
        "the","and","for","with","from","that","this","are","our","you","your","their","they","into","will","have","has",
        "company","team","teams","solutions","services","software","app","apps","ai","saas","platform","we","a","an","of","to","in","on","at","by","is","it"
    };

    private static HashSet<string> Tokens(string s) =>
        Regex.Matches(s.ToLowerInvariant(), @"[a-z][a-z0-9+#.]{2,}").Select(m => m.Value.Trim('.')).Where(t => !Stop.Contains(t)).ToHashSet();

    /// <summary>Top portfolio projects by keyword overlap with the person's context (RAG over Postgres).</summary>
    public async Task<List<string>> MatchPortfolio(string contextText, int take = 3)
    {
        try
        {
            await using var c = Conn();
            await c.OpenAsync();
            var rows = (await c.QueryAsync<dynamic>(@"SELECT title, industry, array_to_string(tags, ', ') AS tags, problem, solution, tech_stack, outcomes
                FROM portfolio_projects")).ToList();
            if (rows.Count == 0) return new();
            var ctx = Tokens(contextText);
            return rows
                .Select(r =>
                {
                    string title = (string?)r.title ?? "";
                    string industry = (string?)r.industry ?? "";
                    string tags = (string?)r.tags ?? "";
                    string tech = (string?)r.tech_stack ?? "";
                    string problem = (string?)r.problem ?? "";
                    string outcomes = (string?)r.outcomes ?? "";
                    var tk = Tokens($"{title} {industry} {tags} {tech} {problem}");
                    var score = tk.Count(ctx.Contains) + (ctx.Overlaps(Tokens(industry)) ? 3 : 0);
                    var line = $"- {title} ({industry}{(string.IsNullOrWhiteSpace(tags) ? "" : "; " + tags)}): {Clip(problem, 160)} {Clip(outcomes, 160)}".Trim();
                    return (score, line);
                })
                .Where(x => x.score > 0)
                .OrderByDescending(x => x.score)
                .Take(take)
                .Select(x => x.line)
                .ToList();
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "LiContext: portfolio skipped");
            return new();
        }
    }
}
