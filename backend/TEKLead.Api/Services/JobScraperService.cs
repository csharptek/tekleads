using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class JobScraperService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<JobScraperService> _log;

    private static readonly string[] DefaultKeywords =
    {
        "React", "Next.js", ".NET", "C#", "TypeScript", "Node.js",
        "PostgreSQL", "Azure", "Tailwind CSS", "Python", "AWS", "Docker", "JavaScript", "SQL",
    };

    private static readonly string[] ExcludeCompanyKeywords =
    {
        "staffing", "recruiting", "talent", "agency", "consulting",
        "outsource", "placement", "headhunt", "hire", "search firm",
    };

    // Candidate person titles tried in priority order during Apollo enrichment.
    public static readonly string[] ContactTitlePriority =
    {
        "Founder", "Co-founder", "CTO", "VP Engineering", "Head of Engineering", "Engineering Manager", "CEO",
    };

    public JobScraperService(SettingsService settings, IHttpClientFactory http, ILogger<JobScraperService> log)
    {
        _settings = settings;
        _http = http;
        _log = log;
    }

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS job_scraper_runs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                roles TEXT[] NOT NULL DEFAULT '{}',
                country TEXT NOT NULL DEFAULT '',
                company_size TEXT NOT NULL DEFAULT '',
                posted_within_days INT NOT NULL DEFAULT 7,
                status TEXT NOT NULL DEFAULT 'running',
                leads_found INT NOT NULL DEFAULT 0,
                error TEXT,
                log_lines TEXT[] NOT NULL DEFAULT '{}',
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                finished_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS job_leads (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                run_id UUID,
                company TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                company_size TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                job_title TEXT NOT NULL DEFAULT '',
                job_description TEXT NOT NULL DEFAULT '',
                job_url TEXT NOT NULL DEFAULT '',
                poster_name TEXT,
                poster_title TEXT,
                poster_linkedin TEXT,
                status TEXT NOT NULL DEFAULT 'scraped',
                matched_keywords TEXT[] NOT NULL DEFAULT '{}',
                missed_keywords TEXT[] NOT NULL DEFAULT '{}',
                apollo_person_id TEXT,
                contact_name TEXT,
                contact_title TEXT,
                contact_email TEXT,
                contact_phone TEXT,
                contact_linkedin TEXT,
                email_subject TEXT,
                email_body TEXT,
                fu1_subject TEXT,
                fu1_body TEXT,
                fu2_subject TEXT,
                fu2_body TEXT,
                sender_email TEXT,
                scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                enriched_at TIMESTAMPTZ,
                email_generated_at TIMESTAMPTZ,
                sent_at TIMESTAMPTZ,
                fu1_sent_at TIMESTAMPTZ,
                fu2_sent_at TIMESTAMPTZ,
                replied_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_job_leads_status ON job_leads(status);
            CREATE INDEX IF NOT EXISTS idx_job_leads_scraped ON job_leads(scraped_at);
            CREATE INDEX IF NOT EXISTS idx_job_leads_run ON job_leads(run_id);

            ALTER TABLE job_leads ADD COLUMN IF NOT EXISTS poster_name TEXT;
            ALTER TABLE job_leads ADD COLUMN IF NOT EXISTS poster_title TEXT;
            ALTER TABLE job_leads ADD COLUMN IF NOT EXISTS poster_linkedin TEXT;

            CREATE TABLE IF NOT EXISTS job_lead_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_lead_id UUID NOT NULL,
                label TEXT NOT NULL,
                at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_jle_lead ON job_lead_events(job_lead_id, at);
        ");
    }

    // ── Scrape run ───────────────────────────────────────────────────────

    public async Task<Guid> StartRun(List<string> roles, string country, string companySize, int postedWithinDays)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var runId = await c.QuerySingleAsync<Guid>(@"
            INSERT INTO job_scraper_runs (roles, country, company_size, posted_within_days, status)
            VALUES (@roles, @country, @size, @days, 'running') RETURNING id",
            new { roles = roles.ToArray(), country, size = companySize, days = postedWithinDays });

        // Fire and forget — caller polls GetRun(runId) for progress.
        _ = Task.Run(() => Execute(runId, roles, country, companySize, postedWithinDays));

        return runId;
    }

    public async Task<JobScraperRun?> GetRun(Guid runId)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<dynamic>("SELECT * FROM job_scraper_runs WHERE id=@id", new { id = runId });
        return row == null ? null : MapRun(row);
    }

    private async Task AppendLog(Guid runId, string line)
    {
        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            await c.ExecuteAsync("UPDATE job_scraper_runs SET log_lines = array_append(log_lines, @line) WHERE id=@id", new { id = runId, line });
        }
        catch (Exception ex) { _log.LogWarning(ex, "AppendLog failed for run {id}", runId); }
    }

    private async Task Execute(Guid runId, List<string> roles, string country, string companySize, int postedWithinDays)
    {
        var cs = _settings.ConnectionString;
        var leadsCreated = 0;
        try
        {
            var all = await _settings.GetAll();
            var token = all.GetValueOrDefault(SettingKeys.ApifyApiKey, "");
            if (string.IsNullOrWhiteSpace(token))
                throw new Exception("Apify API key not configured in Settings.");

            var keywords = GetKeywordList(all);
            var datePosted = postedWithinDays <= 1 ? "r86400" : postedWithinDays <= 7 ? "r604800" : "r2592000";

            foreach (var role in roles)
            {
                await AppendLog(runId, $"Searching LinkedIn for: {role}");
                List<JsonElement> items;
                try
                {
                    items = await RunApifyActor(token, role, country, datePosted);
                }
                catch (Exception ex)
                {
                    await AppendLog(runId, $"Error searching \"{role}\": {ex.Message}");
                    continue;
                }
                await AppendLog(runId, $"Found {items.Count} raw postings for \"{role}\"");

                foreach (var item in items)
                {
                    try
                    {
                        var companyName = GetStr(item, "companyName") ?? GetStr(item, "company");
                        if (string.IsNullOrWhiteSpace(companyName)) continue;
                        if (ExcludeCompanyKeywords.Any(kw => companyName.ToLowerInvariant().Contains(kw))) continue;

                        var jobTitle = GetStr(item, "title") ?? GetStr(item, "jobTitle") ?? "";
                        var jobUrl = GetStr(item, "link") ?? GetStr(item, "jobUrl") ?? GetStr(item, "url") ?? "";
                        var description = GetStr(item, "descriptionText") ?? GetStr(item, "description") ?? StripHtml(GetStr(item, "descriptionHtml")) ?? "";
                        var industry = GetStr(item, "industries") ?? GetStr(item, "industry") ?? "";
                        var posterName = GetStr(item, "jobPosterName");
                        var posterTitle = GetStr(item, "jobPosterTitle");
                        var posterLinkedin = GetStr(item, "jobPosterProfileUrl");
                        int? employeeCount = item.TryGetProperty("companyEmployeesCount", out var ce) && ce.ValueKind == JsonValueKind.Number && ce.TryGetInt32(out var ceInt)
                            ? ceInt : null;
                        var scrapedCompanySize = employeeCount.HasValue ? $"{employeeCount:N0} employees" : "";
                        var postedAtRaw = GetStr(item, "postedAt");
                        DateTime? postedAt = DateTime.TryParse(postedAtRaw, out var pd) ? pd : null;

                        // Dedupe: skip if this exact job URL was already scraped.
                        if (!string.IsNullOrWhiteSpace(jobUrl))
                        {
                            await using var dc = new NpgsqlConnection(cs);
                            await dc.OpenAsync();
                            var exists = await dc.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM job_leads WHERE job_url=@u)", new { u = jobUrl });
                            if (exists) continue;
                        }

                        var (matched, missed) = MatchKeywords($"{jobTitle} {description}", keywords);

                        await using var ic = new NpgsqlConnection(cs);
                        await ic.OpenAsync();
                        var leadId = await ic.QuerySingleAsync<Guid>(@"
                            INSERT INTO job_leads (run_id, company, industry, company_size, country, job_title, job_description, job_url,
                                                    poster_name, poster_title, poster_linkedin,
                                                    matched_keywords, missed_keywords, scraped_at, saved_at)
                            VALUES (@runId, @company, @industry, @companySize, @country, @title, @desc, @url,
                                    @posterName, @posterTitle, @posterLinkedin,
                                    @matched, @missed, @scrapedAt, NOW())
                            RETURNING id",
                            new
                            {
                                runId, company = companyName, industry, companySize = scrapedCompanySize, country, title = jobTitle, desc = description, url = jobUrl,
                                posterName, posterTitle, posterLinkedin,
                                matched, missed, scrapedAt = postedAt ?? DateTime.UtcNow,
                            });
                        await ic.ExecuteAsync("INSERT INTO job_lead_events (job_lead_id, label) VALUES (@id, 'Scraped from LinkedIn')", new { id = leadId });
                        leadsCreated++;
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "job_leads insert error for run {id}", runId);
                    }
                }
            }

            await AppendLog(runId, $"{leadsCreated} leads added to the table");

            await using var uc = new NpgsqlConnection(cs);
            await uc.OpenAsync();
            await uc.ExecuteAsync("UPDATE job_scraper_runs SET status='completed', leads_found=@n, finished_at=NOW() WHERE id=@id", new { id = runId, n = leadsCreated });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Job scraper run {id} failed", runId);
            await AppendLog(runId, $"Run failed: {ex.Message}");
            await using var fc = new NpgsqlConnection(cs);
            await fc.OpenAsync();
            await fc.ExecuteAsync("UPDATE job_scraper_runs SET status='failed', error=@err, finished_at=NOW() WHERE id=@id", new { id = runId, err = ex.Message });
        }
    }

    /// <summary>
    /// Calls the Apify "curious_coder/linkedin-jobs-scraper" actor synchronously and returns
    /// its dataset items. This actor's ONLY input is `urls`: full LinkedIn public jobs-search
    /// page URLs (confirmed against https://apify.com/curious_coder/linkedin-jobs-scraper/input-schema
    /// after a prior version of this method sent a `searchQueries`-shaped payload the actor
    /// rejected with "Field input.urls is required"). We build that search URL ourselves from
    /// role/location/date-posted rather than accepting one from the person, since the UI only
    /// collects structured filters. Output field names (title/companyName/link/descriptionText/
    /// industries/companyEmployeesCount) are confirmed from the actor's own README sample output.
    /// </summary>
    private async Task<List<JsonElement>> RunApifyActor(string token, string searchQuery, string location, string datePostedCode)
    {
        const string actorId = "curious_coder~linkedin-jobs-scraper";
        var runUrl = $"https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items?token={Uri.EscapeDataString(token)}&timeout=280";

        var searchUrl = "https://www.linkedin.com/jobs/search/"
            + $"?keywords={Uri.EscapeDataString(searchQuery)}"
            + $"&location={Uri.EscapeDataString(location)}"
            + $"&f_TPR={Uri.EscapeDataString(datePostedCode)}";

        var payload = new { urls = new[] { searchUrl } };

        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(290);
        var res = await client.PostAsJsonAsync(runUrl, payload);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new Exception($"Apify {(int)res.StatusCode}: {body[..Math.Min(500, body.Length)]}");

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return new List<JsonElement>();
        return doc.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
    }

    private static string? GetStr(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string? StripHtml(string? html) =>
        string.IsNullOrEmpty(html) ? html : System.Text.RegularExpressions.Regex.Replace(html, "<[^>]+>", " ").Trim();

    // ── Keyword matching ────────────────────────────────────────────────

    private static string[] GetKeywordList(Dictionary<string, string> settings)
    {
        var raw = settings.GetValueOrDefault(SettingKeys.JobScraperKeywords, "");
        if (string.IsNullOrWhiteSpace(raw)) return DefaultKeywords;
        var list = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToArray();
        return list.Length > 0 ? list : DefaultKeywords;
    }

    private static (string[] matched, string[] missed) MatchKeywords(string text, string[] keywords)
    {
        var lower = text.ToLowerInvariant();
        var matched = keywords.Where(k => lower.Contains(k.ToLowerInvariant())).ToArray();
        var missed = keywords.Except(matched).ToArray();
        return (matched, missed);
    }

    // ── List / filter / CRUD ────────────────────────────────────────────

    /// <summary>
    /// company_size is stored as free text ("36,275 employees"). To filter by a range
    /// bucket we strip it down to digits in SQL and compare. Buckets match EMPLOYEE_BUCKETS
    /// on the frontend exactly: 1–9, 10–50, 51–200, 201–1000, 1000+, Unknown.
    /// </summary>
    private static void ApplySizeBucket(List<string> where, DynamicParameters p, string bucket)
    {
        const string sizeExpr = "NULLIF(regexp_replace(company_size, '[^0-9]', '', 'g'), '')::int";
        if (bucket == "Unknown") { where.Add($"{sizeExpr} IS NULL"); return; }

        var (min, max) = bucket switch
        {
            "1–9" => (1, 9),
            "10–50" => (10, 50),
            "51–200" => (51, 200),
            "201–1000" => (201, 1000),
            "1000+" => (1000, (int?)null),
            _ => (0, (int?)null),
        };
        p.Add("sizeMin", min);
        if (max.HasValue) { where.Add($"{sizeExpr} BETWEEN @sizeMin AND @sizeMax"); p.Add("sizeMax", max.Value); }
        else { where.Add($"{sizeExpr} >= @sizeMin"); }
    }

    public async Task<JobLeadListResult> List(
        string? status, string? search, string? keyword, string? industry, string? size, string? country,
        bool needsFollowUp, DateTime? dateFrom, DateTime? dateTo, int page, int perPage)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var where = new List<string>();
        var p = new DynamicParameters();

        if (!string.IsNullOrWhiteSpace(status) && status != "all") { where.Add("status=@status"); p.Add("status", status); }
        if (!string.IsNullOrWhiteSpace(search)) { where.Add("(company ILIKE @search OR job_title ILIKE @search)"); p.Add("search", $"%{search}%"); }
        if (!string.IsNullOrWhiteSpace(keyword)) { where.Add("EXISTS (SELECT 1 FROM unnest(matched_keywords) k WHERE k ILIKE @keyword)"); p.Add("keyword", $"%{keyword}%"); }
        if (!string.IsNullOrWhiteSpace(industry) && industry != "all") { where.Add("industry=@industry"); p.Add("industry", industry); }
        if (!string.IsNullOrWhiteSpace(size) && size != "all") ApplySizeBucket(where, p, size);
        if (!string.IsNullOrWhiteSpace(country) && country != "all") { where.Add("country=@country"); p.Add("country", country); }
        if (needsFollowUp) { where.Add("status='sent' AND replied_at IS NULL"); }
        if (dateFrom.HasValue) { where.Add("scraped_at >= @dateFrom"); p.Add("dateFrom", dateFrom.Value); }
        if (dateTo.HasValue) { where.Add("scraped_at <= @dateTo"); p.Add("dateTo", dateTo.Value); }

        var whereSql = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";

        p.Add("limit", perPage);
        p.Add("offset", (page - 1) * perPage);

        var rows = await c.QueryAsync<dynamic>($"SELECT * FROM job_leads {whereSql} ORDER BY scraped_at DESC LIMIT @limit OFFSET @offset", p);
        var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM job_leads {whereSql}", p);

        return new JobLeadListResult { Leads = rows.Select(MapLead).ToList(), Total = total };
    }

    public async Task<JobLeadStats> GetStats()
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var row = await c.QuerySingleAsync<dynamic>(@"
            SELECT
                COUNT(*) AS scraped,
                COUNT(*) FILTER (WHERE status IN ('enriched','email_ready','scheduled','sent','replied')) AS enriched,
                COUNT(*) FILTER (WHERE status='email_ready') AS email_ready,
                COUNT(*) FILTER (WHERE status IN ('sent','replied')) AS sent,
                COUNT(*) FILTER (WHERE status='replied') AS replied,
                COUNT(*) FILTER (WHERE status='sent' AND replied_at IS NULL) AS needs_follow_up
            FROM job_leads");
        return new JobLeadStats
        {
            Scraped = (int)row.scraped, Enriched = (int)row.enriched, EmailReady = (int)row.email_ready,
            Sent = (int)row.sent, Replied = (int)row.replied, NeedsFollowUp = (int)row.needs_follow_up,
        };
    }

    public async Task<JobLead?> GetById(Guid id)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<dynamic>("SELECT * FROM job_leads WHERE id=@id", new { id });
        if (row == null) return null;
        var lead = MapLead(row);
        var events = await c.QueryAsync<dynamic>("SELECT * FROM job_lead_events WHERE job_lead_id=@id ORDER BY at", new { id });
        lead.Activity = events.Select(e => new JobLeadEvent { Id = e.id, JobLeadId = e.job_lead_id, Label = e.label, At = e.at }).ToList();
        return lead;
    }

    public async Task AddEvent(Guid leadId, string label)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync("INSERT INTO job_lead_events (job_lead_id, label) VALUES (@id, @label)", new { id = leadId, label });
    }

    public async Task Delete(Guid id)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM job_lead_events WHERE job_lead_id=@id", new { id });
        await c.ExecuteAsync("DELETE FROM job_leads WHERE id=@id", new { id });
    }

    public async Task BulkDelete(List<Guid> ids)
    {
        if (ids.Count == 0) return;
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM job_lead_events WHERE job_lead_id = ANY(@ids)", new { ids = ids.ToArray() });
        await c.ExecuteAsync("DELETE FROM job_leads WHERE id = ANY(@ids)", new { ids = ids.ToArray() });
    }

    private static JobScraperRun MapRun(dynamic r) => new()
    {
        Id = r.id, Roles = r.roles ?? Array.Empty<string>(), Country = r.country ?? "", CompanySize = r.company_size ?? "",
        PostedWithinDays = (int)(r.posted_within_days ?? 7), Status = r.status ?? "running", LeadsFound = (int)(r.leads_found ?? 0),
        Error = r.error, LogLines = r.log_lines ?? Array.Empty<string>(), StartedAt = r.started_at, FinishedAt = r.finished_at,
    };

    private static JobLead MapLead(dynamic r) => new()
    {
        Id = r.id, RunId = r.run_id, Company = r.company ?? "", Industry = r.industry ?? "", CompanySize = r.company_size ?? "",
        Country = r.country ?? "", JobTitle = r.job_title ?? "", JobDescription = r.job_description ?? "", JobUrl = r.job_url ?? "",
        PosterName = r.poster_name, PosterTitle = r.poster_title, PosterLinkedin = r.poster_linkedin,
        Status = r.status ?? "scraped", MatchedKeywords = r.matched_keywords ?? Array.Empty<string>(), MissedKeywords = r.missed_keywords ?? Array.Empty<string>(),
        ApolloPersonId = r.apollo_person_id, ContactName = r.contact_name, ContactTitle = r.contact_title, ContactEmail = r.contact_email,
        ContactPhone = r.contact_phone, ContactLinkedin = r.contact_linkedin, EmailSubject = r.email_subject, EmailBody = r.email_body,
        Fu1Subject = r.fu1_subject, Fu1Body = r.fu1_body, Fu2Subject = r.fu2_subject, Fu2Body = r.fu2_body, SenderEmail = r.sender_email,
        ScrapedAt = r.scraped_at, SavedAt = r.saved_at, EnrichedAt = r.enriched_at, EmailGeneratedAt = r.email_generated_at,
        SentAt = r.sent_at, Fu1SentAt = r.fu1_sent_at, Fu2SentAt = r.fu2_sent_at, RepliedAt = r.replied_at,
        CreatedAt = r.created_at, UpdatedAt = r.updated_at,
    };

    // ── Diagnostics ─────────────────────────────────────────────────────

    /// <summary>
    /// Direct DB introspection, independent of any cached/computed state — for verifying
    /// whether scrape runs actually persisted rows, and confirming which database instance
    /// this API process is talking to (host/db name), which is the usual culprit when a
    /// run reports N leads found but a later list call returns 0.
    /// </summary>
    public async Task<JobScraperDiag> Diagnose(Guid? runId)
    {
        var info = new JobScraperDiag { ConnStringSet = !string.IsNullOrEmpty(_settings.ConnectionString) };
        if (!info.ConnStringSet) return info;

        var cs = _settings.ConnectionString;
        try
        {
            var b = new NpgsqlConnectionStringBuilder(cs);
            info.DbHost = b.Host ?? "";
            info.DbName = b.Database ?? "";
        }
        catch { /* host/db stay blank if the conn string can't be parsed */ }

        try
        {
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            info.DbReachable = true;

            info.JobLeadsTableExists = await c.QuerySingleOrDefaultAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='job_leads')");
            if (info.JobLeadsTableExists)
                info.JobLeadsRowCount = await c.QuerySingleOrDefaultAsync<int>("SELECT COUNT(*) FROM job_leads");

            info.JobScraperRunsTableExists = await c.QuerySingleOrDefaultAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='job_scraper_runs')");
            if (info.JobScraperRunsTableExists)
                info.JobScraperRunsRowCount = await c.QuerySingleOrDefaultAsync<int>("SELECT COUNT(*) FROM job_scraper_runs");

            dynamic? runRow = runId.HasValue
                ? await c.QueryFirstOrDefaultAsync<dynamic>("SELECT * FROM job_scraper_runs WHERE id=@id", new { id = runId })
                : await c.QueryFirstOrDefaultAsync<dynamic>("SELECT * FROM job_scraper_runs ORDER BY started_at DESC LIMIT 1");
            if (runRow != null)
            {
                info.RequestedRun = MapRun(runRow);
                info.LeadsForThatRunNow = await c.QuerySingleOrDefaultAsync<int>(
                    "SELECT COUNT(*) FROM job_leads WHERE run_id=@id", new { id = info.RequestedRun.Id });
            }
        }
        catch (Exception ex)
        {
            info.Error = ex.Message;
            _log.LogError(ex, "JobScraper diagnose failed");
        }

        return info;
    }
}

public class JobScraperDiag
{
    public bool ConnStringSet { get; set; }
    public string DbHost { get; set; } = "";
    public string DbName { get; set; } = "";
    public bool DbReachable { get; set; }
    public bool JobLeadsTableExists { get; set; }
    public int JobLeadsRowCount { get; set; }
    public bool JobScraperRunsTableExists { get; set; }
    public int JobScraperRunsRowCount { get; set; }
    public JobScraperRun? RequestedRun { get; set; }
    /// <summary>Rows currently in job_leads whose run_id matches RequestedRun.Id — compare against RequestedRun.LeadsFound.</summary>
    public int LeadsForThatRunNow { get; set; }
    public string? Error { get; set; }
}
