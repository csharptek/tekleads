using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ArtifactsResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string CoverLetter { get; set; } = "";
    public string WhatsappMessage { get; set; } = "";
    public string EmailSubject { get; set; } = "";
    public string EmailBody { get; set; } = "";
    public DateTime GeneratedAt { get; set; }
}

public class ArtifactsService
{
    private readonly SettingsService _settings;
    private readonly PortfolioService _portfolio;
    private readonly ProposalService _proposals;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ArtifactsService> _log;

    public ArtifactsService(
        SettingsService settings,
        PortfolioService portfolio,
        ProposalService proposals,
        IHttpClientFactory http,
        ILogger<ArtifactsService> log)
    {
        _settings = settings;
        _portfolio = portfolio;
        _proposals = proposals;
        _http = http;
        _log = log;
    }

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var migrations = new[]
        {
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_cover_letter TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_whatsapp TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_email_subject TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_email_body TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_generated_at TIMESTAMPTZ",
        };
        foreach (var m in migrations)
        {
            try { await c.ExecuteAsync(m); } catch { }
        }
    }

    public async Task<ArtifactsResult> GetExisting(Guid proposalId)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT artifact_cover_letter, artifact_whatsapp, artifact_email_subject, artifact_email_body, artifact_generated_at FROM proposals WHERE id=@id",
            new { id = proposalId });

        if (row == null || string.IsNullOrEmpty((string?)row.artifact_cover_letter))
            return new ArtifactsResult { Ok = false, Error = "No artifacts generated yet." };

        return new ArtifactsResult
        {
            Ok = true,
            CoverLetter = row.artifact_cover_letter ?? "",
            WhatsappMessage = row.artifact_whatsapp ?? "",
            EmailSubject = row.artifact_email_subject ?? "",
            EmailBody = row.artifact_email_body ?? "",
            GeneratedAt = row.artifact_generated_at ?? DateTime.UtcNow,
        };
    }

    public async Task<ArtifactsResult> Generate(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null)
            return Fail("Proposal not found.");

        var settings = await _settings.GetAll();
        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment))
            return Fail("Azure OpenAI not configured in Settings.");

        // RAG: get relevant portfolio items (embedding may fail if not configured)
        List<PortfolioProject> portfolioItems;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            portfolioItems = await _portfolio.SearchSimilar(query, topK: 3);
        }
        catch
        {
            portfolioItems = new List<PortfolioProject>();
        }
        if (portfolioItems.Count == 0)
        {
            var all = await _portfolio.GetAll();
            portfolioItems = all.Where(p => p.EmbeddingIndexed).Take(3).ToList();
            if (portfolioItems.Count == 0)
                portfolioItems = all.Take(3).ToList();
        }

        var context = BuildContext(proposal, portfolioItems);

        // Generate sequentially to avoid timeout overload
        string coverLetter, whatsapp, emailSubject, emailBody;
        try
        {
            coverLetter  = await CallAI(aoEndpoint, aoKey, aoDeployment, CoverLetterPrompt(), context);
            whatsapp     = await CallAI(aoEndpoint, aoKey, aoDeployment, WhatsappPrompt(), context);
            var emailRaw = await CallAI(aoEndpoint, aoKey, aoDeployment, EmailPrompt(), context);
            (emailSubject, emailBody) = ParseEmail(emailRaw);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Artifacts generation failed for {0}", proposalId);
            return Fail($"AI generation failed: {ex.Message}");
        }

        // Save to proposal record
        var cs = _settings.ConnectionString;
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE proposals SET
                artifact_cover_letter=@cl,
                artifact_whatsapp=@wa,
                artifact_email_subject=@es,
                artifact_email_body=@eb,
                artifact_generated_at=NOW(),
                updated_at=NOW()
            WHERE id=@id",
            new { cl = coverLetter, wa = whatsapp, es = emailSubject, eb = emailBody, id = proposalId });

        return new ArtifactsResult
        {
            Ok = true,
            CoverLetter = coverLetter,
            WhatsappMessage = whatsapp,
            EmailSubject = emailSubject,
            EmailBody = emailBody,
            GeneratedAt = DateTime.UtcNow,
        };
    }

    public async Task<ArtifactsResult> GenerateCoverLetter(Guid proposalId)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, err) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, CoverLetterPrompt(), context);
        await SaveField(proposalId, "artifact_cover_letter", result);
        return new ArtifactsResult { Ok = true, CoverLetter = result, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateWhatsapp(Guid proposalId)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, err) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, WhatsappPrompt(), context);
        await SaveField(proposalId, "artifact_whatsapp", result);
        return new ArtifactsResult { Ok = true, WhatsappMessage = result, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateEmail(Guid proposalId)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, err) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, EmailPrompt(), context);
        var (subject, body) = ParseEmail(raw);
        await SaveField(proposalId, "artifact_email_subject", subject);
        await SaveField(proposalId, "artifact_email_body", body);
        return new ArtifactsResult { Ok = true, EmailSubject = subject, EmailBody = body, GeneratedAt = DateTime.UtcNow };
    }

    private async Task<(Proposal? proposal, string? aoEndpoint, string? aoKey, string? aoDeployment, List<PortfolioProject> portfolio, string? error)> GetContext(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null) return (null, null, null, null, new(), "Proposal not found.");

        var settings = await _settings.GetAll();
        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment))
            return (null, null, null, null, new(), "Azure OpenAI not configured in Settings.");

        List<PortfolioProject> portfolioItems;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            portfolioItems = await _portfolio.SearchSimilar(query, topK: 3);
        }
        catch { portfolioItems = new List<PortfolioProject>(); }

        if (portfolioItems.Count == 0)
        {
            var all = await _portfolio.GetAll();
            portfolioItems = all.Where(p => p.EmbeddingIndexed).Take(3).ToList();
            if (portfolioItems.Count == 0) portfolioItems = all.Take(3).ToList();
        }

        return (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, null);
    }

    private async Task SaveField(Guid proposalId, string column, string value)
    {
        var cs = _settings.ConnectionString;
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await conn.ExecuteAsync(
            $"UPDATE proposals SET {column}=@v, artifact_generated_at=NOW(), updated_at=NOW() WHERE id=@id",
            new { v = value, id = proposalId });
    }

    // ── Prompts ───────────────────────────────────────────────────────────────

    private string CoverLetterPrompt() => @"You are writing a cover letter for a freelance software development proposal on behalf of CSharpTek / Ritesh.

Write a compelling, personalised cover letter using the structure below. Do NOT use generic filler — reference the client's actual job requirements and the portfolio projects provided.

STRUCTURE:
1. Opening: ""I understand what you are building and why it matters."" — then in 1-2 sentences show you actually understand THEIR specific project.
2. Answer each client screening question directly and specifically (if questions are listed).
3. Reference 2-3 portfolio projects by name with concrete outcomes and links.
4. Proposed approach / architecture for their specific problem (2-3 paragraphs).
5. What you would cut from V1 (shows honesty and scoping maturity).
6. 2-3 questions back to the client (shows strategic thinking).
7. Close: ""Happy to get on a call this week. Looking forward to it."" then sign as Ritesh.

Tone: Direct, confident, no fluff. No bullet spam — use prose where possible.
Return only the cover letter text. No preamble.";

    private string WhatsappPrompt() => @"Write a short WhatsApp outreach message for a freelance software proposal.

Rules:
- Max 5-6 lines
- Casual but professional tone
- Mention their specific project in one sentence
- One relevant portfolio reference with a link
- End with a soft CTA: ""Happy to jump on a quick call — would that work?""
- Sign off as Ritesh
- No bullet points, no emojis spam (max 1-2)

Return only the WhatsApp message text.";

    private string EmailPrompt() => @"Write a cold outreach email for a freelance software proposal.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Email rules:
- Subject: specific, 8-12 words, references their project
- Body: 150-200 words
- Professional tone
- Para 1: show you understand their specific problem
- Para 2: 1-2 relevant portfolio references with outcomes
- Para 3: proposed approach in 2 sentences
- CTA: suggest a 20-min call
- Sign: Ritesh | CSharpTek

No generic phrases like ""I came across your post"". Be specific.";

    // ── Helpers ───────────────────────────────────────────────────────────────

    private string BuildContext(Proposal p, List<PortfolioProject> portfolio)
    {
        var sb = new StringBuilder();

        sb.AppendLine("## JOB POST");
        if (!string.IsNullOrWhiteSpace(p.JobPostHeadline))
            sb.AppendLine($"Headline: {p.JobPostHeadline}");
        sb.AppendLine(p.JobPostBody);

        sb.AppendLine("\n## CLIENT INFO");
        if (!string.IsNullOrWhiteSpace(p.ClientName))    sb.AppendLine($"Name: {p.ClientName}");
        if (!string.IsNullOrWhiteSpace(p.ClientCompany)) sb.AppendLine($"Company: {p.ClientCompany}");
        if (!string.IsNullOrWhiteSpace(p.ClientEmail))   sb.AppendLine($"Email: {p.ClientEmail}");

        if (p.ClientQuestions?.Length > 0)
        {
            sb.AppendLine("\n## CLIENT SCREENING QUESTIONS");
            foreach (var q in p.ClientQuestions.Where(q => !string.IsNullOrWhiteSpace(q)))
                sb.AppendLine($"- {q}");
        }

        if (portfolio.Count > 0)
        {
            sb.AppendLine("\n## RELEVANT PORTFOLIO PROJECTS");
            foreach (var proj in portfolio)
            {
                sb.AppendLine($"\n### {proj.Title}");
                if (!string.IsNullOrWhiteSpace(proj.Industry)) sb.AppendLine($"Industry: {proj.Industry}");
                if (!string.IsNullOrWhiteSpace(proj.Problem))  sb.AppendLine($"Problem: {proj.Problem}");
                if (!string.IsNullOrWhiteSpace(proj.Solution)) sb.AppendLine($"Solution: {proj.Solution}");
                if (!string.IsNullOrWhiteSpace(proj.Outcomes)) sb.AppendLine($"Outcomes: {proj.Outcomes}");
                if (!string.IsNullOrWhiteSpace(proj.Links))    sb.AppendLine($"Links: {proj.Links}");
            }
        }

        return sb.ToString();
    }

    private async Task<string> CallAI(string endpoint, string key, string deployment, string systemPrompt, string context)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);
        client.Timeout = TimeSpan.FromSeconds(90);

        var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-02-01";
        var messages = new[]
        {
            new { role = "system", content = systemPrompt },
            new { role = "user",   content = context },
        };
        var body = JsonSerializer.Serialize(new { messages, max_completion_tokens = 1500 });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"OpenAI {(int)resp.StatusCode}: {json}");

        var doc = JsonDocument.Parse(json);
        var text = doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
        _log.LogInformation("CallAI result length: {0}, first 200: {1}", text.Length, text.Length > 200 ? text[..200] : text);
        return text;
    }

    private (string subject, string body) ParseEmail(string raw)
    {
        try
        {
            var clean = raw.Trim();
            if (clean.StartsWith("```")) { var i = clean.IndexOf('\n'); clean = clean[(i + 1)..]; }
            if (clean.EndsWith("```"))   clean = clean[..clean.LastIndexOf("```")];
            var doc = JsonDocument.Parse(clean.Trim());
            var subject = doc.RootElement.GetProperty("subject").GetString() ?? "";
            var body    = doc.RootElement.GetProperty("body").GetString() ?? "";
            return (subject, body);
        }
        catch
        {
            // fallback: treat whole thing as body
            return ("Following up on your project", raw);
        }
    }

    private static ArtifactsResult Fail(string msg) => new() { Ok = false, Error = msg };
}
