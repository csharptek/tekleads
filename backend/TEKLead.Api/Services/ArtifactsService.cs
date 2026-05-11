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

        var clPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var waPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var emPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");

        // Generate sequentially to avoid timeout overload
        string coverLetter, whatsapp, emailSubject, emailBody;
        try
        {
            coverLetter  = await CallAI(aoEndpoint, aoKey, aoDeployment, string.IsNullOrWhiteSpace(clPrompt) ? CoverLetterPrompt() : clPrompt, context);
            whatsapp     = await CallAI(aoEndpoint, aoKey, aoDeployment, string.IsNullOrWhiteSpace(waPrompt) ? WhatsappPrompt() : waPrompt, context);
            var emailRaw = await CallAI(aoEndpoint, aoKey, aoDeployment, string.IsNullOrWhiteSpace(emPrompt) ? EmailPrompt() : emPrompt, context);
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

    public async Task<ArtifactsResult> GenerateCoverLetter(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? CoverLetterPrompt() : savedPrompt);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_cover_letter", result);
        return new ArtifactsResult { Ok = true, CoverLetter = result, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateWhatsapp(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? WhatsappPrompt() : savedPrompt);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_whatsapp", result);
        return new ArtifactsResult { Ok = true, WhatsappMessage = result, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateEmail(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? EmailPrompt() : savedPrompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        await SaveField(proposalId, "artifact_email_subject", subject);
        await SaveField(proposalId, "artifact_email_body", body);
        return new ArtifactsResult { Ok = true, EmailSubject = subject, EmailBody = body, GeneratedAt = DateTime.UtcNow };
    }

    private async Task<(Proposal? proposal, string? aoEndpoint, string? aoKey, string? aoDeployment, List<PortfolioProject> portfolio, Dictionary<string,string> settings, string? error)> GetContext(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null) return (null, null, null, null, new(), new(), "Proposal not found.");

        var settings = await _settings.GetAll();
        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment))
            return (null, null, null, null, new(), new(), "Azure OpenAI not configured in Settings.");

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

        return (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, null);
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

    public static string CoverLetterPrompt() => @"You are writing a cover letter on behalf of Bhanu Gupta, CEO of Csharptek, a senior full-stack developer and AI consultant based in Ranchi, India with 15+ years of experience and 40+ projects delivered.

STRUCTURE — follow this exact order:

1. HOOK (1 sentence)
Mirror the client's exact pain or core requirement. Do NOT start with ""I have reviewed"" or ""I am writing to"". Start with what THEY need, then pivot to why Bhanu is the answer.
Example pattern: ""[Client pain point] — I have shipped exactly this.""

2. AUTHORITY (2-3 lines)
Who Bhanu is. Mention: CEO of Csharptek, 40+ projects, specialization relevant to this job. Keep it tight.

3. RELEVANT BUILDS (portfolio items)
List 3-4 most relevant portfolio projects from the context provided.
Format each as:
• [Project Name]: One sentence on what was built and why it's relevant. [YouTube/link if available]
Do NOT use generic descriptions. Each item must connect directly to a requirement in the job post.

4. STRATEGIC APPROACH (3-4 bullets)
Titled: ""How I Would Approach [Project Name]""
Each bullet = one specific technical decision or execution step Bhanu would take.
Be concrete. Name actual technologies, patterns, or tools from the job post.
This section should make the client think ""he's already thought this through.""

5. QUESTIONS (2-3 questions)
Ask smart, specific questions that show deep reading of the job post.
Questions should reveal a knowledge gap the client hasn't thought about yet.
Format: numbered list.

6. LOGISTICS (short, bullet format)
• Hours: [availability]
• Overlap: [timezone overlap]
• Start: [when available]
• Rate: [hourly rate from proposal]

7. CLOSING CTA (1-2 lines)
Specific ask. Reference something concrete from the job post.
Example: ""Are you free for a 20-minute call this week? I can walk you through the [specific technical approach] I'd use from day one.""

TONE RULES:
- Write in first person as Bhanu
- Confident, not boastful
- No fluff, no filler phrases (""I am excited to..."", ""I believe I would be a great fit..."")
- Every sentence must earn its place
- Length: 400-550 words max
- Do NOT invent portfolio items — only use what is provided in the context

Return only the cover letter text. No preamble.";

    public static string WhatsappPrompt() => @"Write a short WhatsApp outreach message for a freelance software proposal.

Rules:
- Max 5-6 lines
- Casual but professional tone
- Mention their specific project in one sentence
- One relevant portfolio reference with a link
- End with a soft CTA: ""Happy to jump on a quick call — would that work?""
- Do not include any name or signature at the end
- No bullet points, no emojis spam (max 1-2)

Return only the WhatsApp message text.";

    public static string EmailPrompt() => @"Write a cold outreach email for a freelance software proposal.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Email rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: specific, 8-12 words, references their project
- Body: 150-200 words
- Professional tone
- Para 1: show you understand their specific problem
- Para 2: 1-2 relevant portfolio references with outcomes
- Para 3: proposed approach in 2 sentences
- CTA: suggest a 20-min call
- Do not include any name or company signature

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
        text = text.Replace("**", "");
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
