using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class JobLeadArtifactResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
}

public class JobLeadArtifactsService
{
    private readonly SettingsService _settings;
    private readonly PortfolioService _portfolio;
    private readonly JobScraperService _jobs;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<JobLeadArtifactsService> _log;

    public JobLeadArtifactsService(SettingsService settings, PortfolioService portfolio, JobScraperService jobs, IHttpClientFactory http, ILogger<JobLeadArtifactsService> log)
    {
        _settings = settings;
        _portfolio = portfolio;
        _jobs = jobs;
        _http = http;
        _log = log;
    }

    public async Task<JobLeadArtifactResult> GenerateEmail(Guid leadId, string? providerOverride = null)
    {
        var lead = await _jobs.GetById(leadId);
        if (lead == null) return Fail("Lead not found.");
        if (string.IsNullOrWhiteSpace(lead.ContactEmail)) return Fail("Enrich the contact before generating an email.");

        var portfolio = await GetPortfolio(lead);
        var context = BuildContext(lead, portfolio);
        var raw = await CallAI(EmailPrompt(), context, providerOverride);
        var (subject, body) = ParseEmail(raw);

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            UPDATE job_leads SET email_subject=@s, email_body=@b, email_generated_at=NOW(), status='email_ready', updated_at=NOW()
            WHERE id=@id", new { id = leadId, s = subject, b = body });
        await _jobs.AddEvent(leadId, "Email generated");

        return new JobLeadArtifactResult { Ok = true, Subject = subject, Body = body };
    }

    public async Task<JobLeadArtifactResult> GenerateFollowUp(Guid leadId, int stage, string? providerOverride = null)
    {
        if (stage != 1 && stage != 2) return Fail("Invalid follow-up stage.");
        var lead = await _jobs.GetById(leadId);
        if (lead == null) return Fail("Lead not found.");
        if (string.IsNullOrWhiteSpace(lead.EmailSubject)) return Fail("Generate the initial outreach email first.");

        var portfolio = await GetPortfolio(lead);
        var context = BuildContext(lead, portfolio);
        context += $"\n\n## INITIAL EMAIL ALREADY SENT\nSubject: {lead.EmailSubject}\nBody:\n{lead.EmailBody}\n";
        if (stage == 2 && !string.IsNullOrWhiteSpace(lead.Fu1Subject))
            context += $"\n\n## FOLLOW-UP 1 ALREADY SENT\nSubject: {lead.Fu1Subject}\nBody:\n{lead.Fu1Body}\n";

        var raw = await CallAI(stage == 1 ? FollowUp1Prompt() : FollowUp2Prompt(), context, providerOverride);
        var (_, body) = ParseEmail(raw);
        var subject = "Re: " + lead.EmailSubject;

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var col = stage == 1 ? ("fu1_subject", "fu1_body") : ("fu2_subject", "fu2_body");
        await c.ExecuteAsync($"UPDATE job_leads SET {col.Item1}=@s, {col.Item2}=@b, updated_at=NOW() WHERE id=@id", new { id = leadId, s = subject, b = body });
        await _jobs.AddEvent(leadId, $"Follow-up {stage} generated");

        return new JobLeadArtifactResult { Ok = true, Subject = subject, Body = body };
    }

    public async Task<(bool ok, string error)> SaveEmail(Guid leadId, string subject, string body)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.ExecuteAsync("UPDATE job_leads SET email_subject=@s, email_body=@b, updated_at=NOW() WHERE id=@id", new { id = leadId, s = subject, b = body });
        return rows > 0 ? (true, "") : (false, "Lead not found.");
    }

    private async Task<List<PortfolioProject>> GetPortfolio(JobLead lead)
    {
        try
        {
            var query = $"{lead.JobTitle} {lead.JobDescription}".Trim();
            if (query.Length > 500) query = query[..500];
            var items = await _portfolio.SearchSimilarSmart(query, string.IsNullOrWhiteSpace(lead.Industry) ? null : lead.Industry, topK: 3);
            if (items.Count > 0) return items;
        }
        catch { /* fall through to ranked fallback */ }

        var all = await _portfolio.GetAll();
        return RankByIndustry(all, lead.Industry, 3);
    }

    private static List<PortfolioProject> RankByIndustry(List<PortfolioProject> all, string? industry, int topK)
    {
        if (!string.IsNullOrWhiteSpace(industry))
        {
            var matched = all.Where(p => string.Equals(p.Industry, industry, StringComparison.OrdinalIgnoreCase)).Take(topK).ToList();
            if (matched.Count > 0) return matched;
        }
        return all.Take(topK).ToList();
    }

    private static string BuildContext(JobLead lead, List<PortfolioProject> portfolio)
    {
        var sb = new StringBuilder();
        sb.AppendLine("## JOB POST");
        sb.AppendLine($"Title: {lead.JobTitle}");
        sb.AppendLine(lead.JobDescription);

        sb.AppendLine("\n## COMPANY");
        sb.AppendLine($"Company: {lead.Company}");
        if (!string.IsNullOrWhiteSpace(lead.Industry)) sb.AppendLine($"Industry: {lead.Industry}");
        if (!string.IsNullOrWhiteSpace(lead.CompanySize)) sb.AppendLine($"Size: {lead.CompanySize}");
        if (!string.IsNullOrWhiteSpace(lead.Country)) sb.AppendLine($"Country: {lead.Country}");

        sb.AppendLine("\n## CONTACT");
        var firstName = (lead.ContactName ?? "").Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        if (!string.IsNullOrWhiteSpace(lead.ContactName)) sb.AppendLine($"Name: {lead.ContactName}");
        if (!string.IsNullOrWhiteSpace(firstName)) sb.AppendLine($"First name (use ONLY this in the greeting): {firstName}");
        if (!string.IsNullOrWhiteSpace(lead.ContactTitle)) sb.AppendLine($"Title: {lead.ContactTitle}");

        sb.AppendLine("\n## MATCHED STACK KEYWORDS");
        sb.AppendLine(lead.MatchedKeywords.Length > 0 ? string.Join(", ", lead.MatchedKeywords) : "(none)");

        if (portfolio.Count > 0)
        {
            sb.AppendLine("\n## RELEVANT PORTFOLIO PROJECTS");
            foreach (var proj in portfolio)
            {
                sb.AppendLine($"\n### {proj.Title}");
                if (!string.IsNullOrWhiteSpace(proj.Industry)) sb.AppendLine($"Industry: {proj.Industry}");
                if (!string.IsNullOrWhiteSpace(proj.Problem)) sb.AppendLine($"Problem: {proj.Problem}");
                if (!string.IsNullOrWhiteSpace(proj.Solution)) sb.AppendLine($"Solution: {proj.Solution}");
                if (!string.IsNullOrWhiteSpace(proj.Outcomes)) sb.AppendLine($"Outcomes: {proj.Outcomes}");
            }
        }

        return sb.ToString();
    }

    private async Task<string> CallAI(string systemPrompt, string context, string? providerOverride)
    {
        var settings = await _settings.GetAll();
        if (!string.IsNullOrWhiteSpace(providerOverride))
        {
            settings = new Dictionary<string, string>(settings) { [SettingKeys.AiProvider] = providerOverride };
        }
        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = context },
        };
        var text = await Llm.LlmClient.ChatAsync(_http, settings, messages, 1200);
        return text.Replace("**", "");
    }

    private static (string subject, string body) ParseEmail(string raw)
    {
        try
        {
            var clean = raw.Trim();
            if (clean.StartsWith("```")) { var i = clean.IndexOf('\n'); clean = clean[(i + 1)..]; }
            if (clean.EndsWith("```")) clean = clean[..clean.LastIndexOf("```")];
            var doc = JsonDocument.Parse(clean.Trim());
            var subject = doc.RootElement.GetProperty("subject").GetString() ?? "";
            var body = doc.RootElement.GetProperty("body").GetString() ?? "";
            return (subject, body);
        }
        catch
        {
            return ("Quick note", raw);
        }
    }

    private static JobLeadArtifactResult Fail(string msg) => new() { Ok = false, Error = msg };

    // ── Prompts ──────────────────────────────────────────────────────────

    private static string EmailPrompt() => @"You are writing a short, personalized cold outreach email on behalf of CSharpTek, a software development consultancy, to the hiring contact at a company that just posted a job listing. The goal is to start a conversation about CSharpTek helping fill this need as a contracted dev team, not to apply for the job as a candidate.

Rules:
- Reference the JOB POST and COMPANY naturally — prove you read it.
- If MATCHED STACK KEYWORDS are present, mention 1-2 of them naturally to show stack fit.
- If a RELEVANT PORTFOLIO PROJECT is present, reference at most one, briefly.
- Address the contact using ONLY their first name from CONTACT.
- 80-120 words. No greeting-line filler like ""I hope this finds you well"". No bullet lists. Plain, direct, human tone.
- End with a soft call to action (a quick call, or just ""worth a chat?"") — not pushy.
- Sign off as ""Best,\nManjika"".

Return ONLY a JSON object: {""subject"": ""..."", ""body"": ""...""} — no markdown, no code fences, no commentary.";

    private static string FollowUp1Prompt() => @"You are writing a brief, friendly follow-up email. An initial outreach email (shown in INITIAL EMAIL ALREADY SENT) was sent and got no reply. Write a short follow-up — 40-70 words — that adds one new piece of value or a different angle, not just ""just checking in"". Reference the job/company naturally. Sign off as ""Best,\nManjika"".

Return ONLY a JSON object: {""subject"": ""..."", ""body"": ""...""} — no markdown, no code fences, no commentary.";

    private static string FollowUp2Prompt() => @"You are writing a final, low-pressure follow-up email. Both the initial email and a first follow-up (shown in context) went unanswered. Write a short, graceful close-the-loop message — 30-50 words — that makes it easy to say no and leaves the door open. Sign off as ""Best,\nManjika"".

Return ONLY a JSON object: {""subject"": ""..."", ""body"": ""...""} — no markdown, no code fences, no commentary.";
}
