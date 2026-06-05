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
    public string FollowUp1Subject { get; set; } = "";
    public string FollowUp1Body { get; set; } = "";
    public string FollowUp2Subject { get; set; } = "";
    public string FollowUp2Body { get; set; } = "";
    public DateTime GeneratedAt { get; set; }
}

public class ArtifactsService
{
    private readonly SettingsService _settings;
    private readonly PortfolioService _portfolio;
    private readonly ProposalService _proposals;
    private readonly ProposalCompanyContextService _companyCtx;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ArtifactsService> _log;

    public ArtifactsService(
        SettingsService settings,
        PortfolioService portfolio,
        ProposalService proposals,
        ProposalCompanyContextService companyCtx,
        IHttpClientFactory http,
        ILogger<ArtifactsService> log)
    {
        _settings = settings;
        _portfolio = portfolio;
        _proposals = proposals;
        _companyCtx = companyCtx;
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
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_followup1_subject TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_followup1_body TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_followup2_subject TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_followup2_body TEXT",
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
            @"SELECT artifact_cover_letter, artifact_whatsapp, artifact_email_subject, artifact_email_body, artifact_generated_at,
                     artifact_followup1_subject, artifact_followup1_body, artifact_followup2_subject, artifact_followup2_body
              FROM proposals WHERE id=@id",
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
            FollowUp1Subject = row.artifact_followup1_subject ?? "",
            FollowUp1Body = row.artifact_followup1_body ?? "",
            FollowUp2Subject = row.artifact_followup2_subject ?? "",
            FollowUp2Body = row.artifact_followup2_body ?? "",
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

        var companyCtx = await _companyCtx.GetByProposalId(proposal.Id);
        var context = BuildContext(proposal, portfolioItems, companyCtx);

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
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? CoverLetterPrompt() : savedPrompt);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_cover_letter", result);
        return new ArtifactsResult { Ok = true, CoverLetter = result, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateWhatsapp(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? WhatsappPrompt() : savedPrompt);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_whatsapp", result);
        return new ArtifactsResult { Ok = true, WhatsappMessage = result, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateEmail(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? EmailPrompt() : savedPrompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        await SaveField(proposalId, "artifact_email_subject", subject);
        await SaveField(proposalId, "artifact_email_body", body);
        return new ArtifactsResult { Ok = true, EmailSubject = subject, EmailBody = body, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateFollowUp1(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId);
        if (err != null) return Fail(err);

        // Load initial email so FU1 can reference it
        var existing = await GetExisting(proposalId);
        var context = BuildContext(proposal!, portfolioItems, company);
        if (existing.Ok && !string.IsNullOrWhiteSpace(existing.EmailSubject))
        {
            context += $"\n\n## INITIAL EMAIL ALREADY SENT\nSubject: {existing.EmailSubject}\nBody:\n{existing.EmailBody}\n";
        }

        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactFollowUp1Prompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? FollowUp1Prompt() : savedPrompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        // Force subject to match initial email for inbox threading
        var fu1ExistingForSubject = await GetExisting(proposalId);
        if (!string.IsNullOrWhiteSpace(fu1ExistingForSubject.EmailSubject))
            subject = "Re: " + fu1ExistingForSubject.EmailSubject;

        await SaveField(proposalId, "artifact_followup1_subject", subject);
        await SaveField(proposalId, "artifact_followup1_body", body);
        return new ArtifactsResult { Ok = true, FollowUp1Subject = subject, FollowUp1Body = body, GeneratedAt = DateTime.UtcNow };
    }

    public async Task<ArtifactsResult> GenerateFollowUp2(Guid proposalId, string? customPrompt = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId);
        if (err != null) return Fail(err);

        var existing = await GetExisting(proposalId);
        var context = BuildContext(proposal!, portfolioItems, company);
        if (existing.Ok && !string.IsNullOrWhiteSpace(existing.EmailSubject))
        {
            context += $"\n\n## INITIAL EMAIL ALREADY SENT\nSubject: {existing.EmailSubject}\nBody:\n{existing.EmailBody}\n";
        }
        if (existing.Ok && !string.IsNullOrWhiteSpace(existing.FollowUp1Subject))
        {
            context += $"\n\n## FOLLOW-UP 1 ALREADY SENT\nSubject: {existing.FollowUp1Subject}\nBody:\n{existing.FollowUp1Body}\n";
        }

        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactFollowUp2Prompt, "");
        var prompt = customPrompt ?? (string.IsNullOrWhiteSpace(savedPrompt) ? FollowUp2Prompt() : savedPrompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        // Force subject to match initial email for inbox threading
        var fu2ExistingForSubject = await GetExisting(proposalId);
        if (!string.IsNullOrWhiteSpace(fu2ExistingForSubject.EmailSubject))
            subject = "Re: " + fu2ExistingForSubject.EmailSubject;

        await SaveField(proposalId, "artifact_followup2_subject", subject);
        await SaveField(proposalId, "artifact_followup2_body", body);
        return new ArtifactsResult { Ok = true, FollowUp2Subject = subject, FollowUp2Body = body, GeneratedAt = DateTime.UtcNow };
    }

    private async Task<(Proposal? proposal, string? aoEndpoint, string? aoKey, string? aoDeployment, List<PortfolioProject> portfolio, Dictionary<string,string> settings, string? error, ProposalCompanyContext? company)> GetContext(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null) return (null, null, null, null, new(), new(), "Proposal not found.", null);

        var settings = await _settings.GetAll();
        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment))
            return (null, null, null, null, new(), new(), "Azure OpenAI not configured in Settings.", null);

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

        var company = await _companyCtx.GetByProposalId(proposal.Id);
        return (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, null, company);
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

    public static string CoverLetterPrompt() => @"You are writing an Upwork cover letter on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years of experience and 40+ projects delivered.

TARGET LENGTH: 180-230 words total. Clients read on mobile. Every word must earn its place.

STRUCTURE — follow this exact order, no section titles:

1. HOOK (1 sentence)
Restate the client's core problem back to them in your own words — prove you read it.
Do NOT start with ""I"". Do NOT use ""I have reviewed"", ""I am writing to"", ""I'm excited"", ""I believe"".
If COMPANY DETAILS are provided, weave in one specific detail (size, industry, product description) naturally.

2. PROOF (1-2 sentences)
One metric-backed outcome from a past project most relevant to their stack.
Format: [What you built] — [measurable result or specific outcome].
Use only real data from RELEVANT PORTFOLIO PROJECTS in context.

3. DONE = (1 sentence)
Write one clear acceptance criteria line in the client's own language.
Format: ""Done = [specific deliverable they can test/verify]""

4. APPROACH (3 bullets)
Each bullet = one concrete technical decision with named technologies.
Each bullet must make the client think: ""he's already thought this through.""
No generic bullets like ""write clean code"" or ""ensure scalability"".

5. PORTFOLIO (1 item only)
The single most relevant project. One sentence + link.
Format: [Project Name] — [one sentence why it's relevant]. [link if available]
Do NOT list 3 projects. One sharp reference beats three generic ones.

6. QUESTIONS (2 questions max)
Smart, specific questions that show deep reading.
Numbered list.

7. SIGN-OFF (1 line + name)
""I'm Bhanu Gupta — 15+ yrs, 40+ projects, [relevant domain]. Available [timezone overlap] overlap with [client timezone].""
Then: ""Bhanu Gupta""

RULES:
- First person as Bhanu
- Do NOT mention ""Csharptek"" or any company name of Bhanu
- No filler: ""I am excited"", ""great fit"", ""passionate"", ""I'd love to"" — banned
- Metrics over adjectives: ""reduced load time by 40%"" beats ""high-performance""
- If no metric exists in portfolio context, describe a specific concrete outcome instead
- Do NOT invent portfolio items or metrics — only use what context provides

Return only the cover letter text. No preamble. No markdown.";

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

    public static string EmailPrompt() => @"You are writing an Upwork proposal on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years of experience and 40+ projects delivered.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full proposal body here with \n for line breaks""}

Proposal rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: specific, 8-12 words, references their project
- Body: 150-200 words MAX — short, direct, no fluff
- Do NOT mention ""Csharptek"" or any company name of Bhanu
- No filler: ""great fit"", ""passionate"", ""I'd love to"", ""excited"" — banned
- Do not include any name or company signature at the end

STRUCTURE — follow this exact order, no section titles:

Para 1 — HOOK (1-2 sentences):
Mirror their exact pain point back — prove you read it. If deadline is mentioned, acknowledge it directly. Do NOT start with ""I"".

Para 2 — CREDIBILITY (1-2 sentences):
One relevant past project with a specific outcome. Use only real data from RELEVANT PORTFOLIO PROJECTS in context.
Format: [What we built] — [specific measurable result]. If a YouTube Demo link exists, include it as: Demo: [url]

Para 3 — APPROACH (2-3 sentences prose, no bullets):
Brief how, not why. Name specific technologies. Must make client think: ""he's already thought this through.""

Para 4 — PRICING & CTA (2 sentences):
Sentence 1 — pricing: Use exact figures from PROPOSAL PRICING & TIMELINE section. Format: ""[Phase]: ~[hours] hrs at $[rate]/hr — $[total]. Starting today.""
If no pricing set: ""Happy to share a detailed estimate on a call.""
Sentence 2 — CTA: one clear next step, invites a reply.

SCREENING ANSWERS (only if job post contains screening questions):
Answer each question directly. One line per answer. Label each: ""[topic]: [answer]""

Pricing rules:
- ALWAYS use price and timeline from PROPOSAL PRICING & TIMELINE section
- If FinalPrice is set, use it as the exact fixed price
- If only budget range provided, quote within that range
- Never invent or hardcode a price";

    public static string FollowUp1Prompt() => @"Write a SHORT follow-up email (Follow-up #1) for a freelance software proposal. The initial cold email has already been sent — this is a gentle nudge sent 24 hours later.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Email rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: write any placeholder — it will be automatically set to ""Re: <initial subject>"" by the system for inbox threading.
- Body: MAX 2 short paragraphs, 60-100 words total
- Paragraph 1: Acknowledge the initial email briefly, then add ONE piece of new value — either a fresh insight, a relevant portfolio link, or a clarifying question about their project. Reference the INITIAL EMAIL ALREADY SENT in context so this feels like a continuation, not a copy.
- Paragraph 2: A clear, low-friction CTA — propose a 20-min call, or ask one direct question that's easy to reply to with one line.
- Tone: friendly, confident, not pushy. No apologies (""sorry to bother you"").
- Do not repeat pricing or timeline from the first email
- Do not include a name signature in the body — the system appends a signature automatically

Variables you can use in the body: {{name}}, {{first_name}}, {{email}} — only if natural.

Return only the JSON. No preamble.";

    public static string FollowUp2Prompt() => @"Write a final follow-up email (Follow-up #2) for a freelance software proposal. The initial email and Follow-up #1 have already been sent. This is the last nudge, sent 48 hours after the initial.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Email rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: write any placeholder — it will be automatically set to ""Re: <initial subject>"" by the system for inbox threading.
- Body: MAX 2 short paragraphs, 50-80 words total
- Paragraph 1: Acknowledge this is the final follow-up. Briefly restate the core value you'd bring — one concrete outcome or a single relevant portfolio reference. Do not rehash the entire pitch.
- Paragraph 2: A polite, definitive CTA — either ""Let me know if timing isn't right and I'll close this out"" or a soft yes/no question. Make it genuinely easy for them to walk away or say yes.
- Tone: warm, respectful, zero desperation. No guilt, no urgency tactics.
- Do not include a name signature in the body — the system appends a signature automatically

Variables you can use in the body: {{name}}, {{first_name}}, {{email}} — only if natural.

Return only the JSON. No preamble.";

    // ── Helpers ───────────────────────────────────────────────────────────────

    private string BuildContext(Proposal p, List<PortfolioProject> portfolio, ProposalCompanyContext? company = null)
    {
        var sb = new StringBuilder();

        sb.AppendLine("## JOB POST");
        if (!string.IsNullOrWhiteSpace(p.JobPostHeadline))
            sb.AppendLine($"Headline: {p.JobPostHeadline}");
        sb.AppendLine(p.JobPostBody);

        sb.AppendLine("\n## CLIENT INFO");
        if (!string.IsNullOrWhiteSpace(p.ClientName))
        {
            var firstName = p.ClientName.Split(new[]{' ','-'}, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? p.ClientName;
            sb.AppendLine($"Name: {p.ClientName}");
            sb.AppendLine($"First Name (use ONLY this when addressing or greeting the client, never the full name): {firstName}");
        }
        if (!string.IsNullOrWhiteSpace(p.ClientCompany)) sb.AppendLine($"Company: {p.ClientCompany}");
        if (!string.IsNullOrWhiteSpace(p.ClientEmail))   sb.AppendLine($"Email: {p.ClientEmail}");

        if (company != null)
        {
            sb.AppendLine("\n## COMPANY DETAILS");
            if (!string.IsNullOrWhiteSpace(company.CompanyName))        sb.AppendLine($"Company: {company.CompanyName}");
            if (!string.IsNullOrWhiteSpace(company.Industry))           sb.AppendLine($"Industry: {company.Industry}");
            if (!string.IsNullOrWhiteSpace(company.EstimatedEmployees)) sb.AppendLine($"Employees: {company.EstimatedEmployees}");
            if (!string.IsNullOrWhiteSpace(company.AnnualRevenue))      sb.AppendLine($"Revenue: {company.AnnualRevenue}");
            if (!string.IsNullOrWhiteSpace(company.FoundedYear))        sb.AppendLine($"Founded: {company.FoundedYear}");
            if (!string.IsNullOrWhiteSpace(company.WebsiteUrl))         sb.AppendLine($"Website: {company.WebsiteUrl}");
            if (!string.IsNullOrWhiteSpace(company.Description))        sb.AppendLine($"About: {company.Description}");
        }

        sb.AppendLine("\n## PROPOSAL PRICING & TIMELINE");
        if (p.FinalPrice.HasValue)
            sb.AppendLine($"Final Price (agreed): ${p.FinalPrice.Value:0.##}");
        else if (p.BudgetMin.HasValue || p.BudgetMax.HasValue)
            sb.AppendLine($"Budget Range: ${p.BudgetMin ?? 0:0.##} – ${p.BudgetMax ?? 0:0.##}");
        if (!string.IsNullOrWhiteSpace(p.TimelineValue) && !string.IsNullOrWhiteSpace(p.TimelineUnit))
            sb.AppendLine($"Timeline: {p.TimelineValue} {p.TimelineUnit}");

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
                if (!string.IsNullOrWhiteSpace(proj.YoutubeLinks)) sb.AppendLine($"YouTube Demo: {proj.YoutubeLinks}");
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
