using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class UsedPortfolioItem
{
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
    public string Industry { get; set; } = "";
    public string YoutubeLinks { get; set; } = "";
    public bool HasYoutubeLink => !string.IsNullOrWhiteSpace(YoutubeLinks);
}

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
    public List<UsedPortfolioItem> UsedProjects { get; set; } = new();
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

    public async Task<ArtifactsResult> Generate(Guid proposalId, string? providerOverride = null)
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

        var companyCtx = await _companyCtx.GetByProposalId(proposal.Id);

        // RAG: industry-first portfolio retrieval (embedding may fail if not configured)
        List<PortfolioProject> portfolioItems;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            portfolioItems = await _portfolio.SearchSimilarSmart(query, companyCtx?.Industry, topK: 3);
        }
        catch
        {
            portfolioItems = new List<PortfolioProject>();
        }
        if (portfolioItems.Count == 0)
        {
            var all = await _portfolio.GetAll();
            portfolioItems = RankByIndustry(all.Where(p => p.EmbeddingIndexed).ToList(), companyCtx?.Industry, 3);
            if (portfolioItems.Count == 0)
                portfolioItems = RankByIndustry(all, companyCtx?.Industry, 3);
        }
        var context = BuildContext(proposal, portfolioItems, companyCtx);

        var clPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var waPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var emPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");
        var isGroq   = (!string.IsNullOrWhiteSpace(providerOverride) ? providerOverride : settings.GetValueOrDefault(SettingKeys.AiProvider, "azure")) == "groq";

        // Generate sequentially to avoid timeout overload
        string coverLetter, whatsapp, emailSubject, emailBody;
        try
        {
            coverLetter  = await CallAI(aoEndpoint, aoKey, aoDeployment, GetPrompt(clPrompt, CoverLetterPrompt, GroqCoverLetterPrompt, isGroq, settings, SettingKeys.ArtifactCoverLetterPromptAzure, SettingKeys.ArtifactCoverLetterPromptGroq), context);
            whatsapp     = await CallAI(aoEndpoint, aoKey, aoDeployment, GetPrompt(waPrompt, WhatsappPrompt, GroqWhatsappPrompt, isGroq, settings, SettingKeys.ArtifactWhatsappPromptAzure, SettingKeys.ArtifactWhatsappPromptGroq), context);
            var emailRaw = await CallAI(aoEndpoint, aoKey, aoDeployment, GetPrompt(emPrompt, EmailPrompt, GroqEmailPrompt, isGroq, settings, SettingKeys.ArtifactEmailPromptAzure, SettingKeys.ArtifactEmailPromptGroq), context);
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
            UsedProjects = portfolioItems.Select(p => new UsedPortfolioItem { Id = p.Id, Title = p.Title, Industry = p.Industry, YoutubeLinks = p.YoutubeLinks }).ToList()
        };
    }

    public async Task<ArtifactsResult> GenerateCoverLetter(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var isGroq = (!string.IsNullOrWhiteSpace(providerOverride) ? providerOverride : settings.GetValueOrDefault(SettingKeys.AiProvider, "azure")) == "groq";
        var prompt = customPrompt ?? GetPrompt(savedPrompt, CoverLetterPrompt, GroqCoverLetterPrompt, isGroq, settings, SettingKeys.ArtifactCoverLetterPromptAzure, SettingKeys.ArtifactCoverLetterPromptGroq);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_cover_letter", result);
        return new ArtifactsResult { Ok = true, CoverLetter = result, GeneratedAt = DateTime.UtcNow, UsedProjects = portfolioItems.Select(p => new UsedPortfolioItem { Id = p.Id, Title = p.Title, Industry = p.Industry, YoutubeLinks = p.YoutubeLinks }).ToList() };
    }

    public async Task<ArtifactsResult> GenerateWhatsapp(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var isGroq = (!string.IsNullOrWhiteSpace(providerOverride) ? providerOverride : settings.GetValueOrDefault(SettingKeys.AiProvider, "azure")) == "groq";
        var prompt = customPrompt ?? GetPrompt(savedPrompt, WhatsappPrompt, GroqWhatsappPrompt, isGroq, settings, SettingKeys.ArtifactWhatsappPromptAzure, SettingKeys.ArtifactWhatsappPromptGroq);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_whatsapp", result);
        return new ArtifactsResult { Ok = true, WhatsappMessage = result, GeneratedAt = DateTime.UtcNow, UsedProjects = portfolioItems.Select(p => new UsedPortfolioItem { Id = p.Id, Title = p.Title, Industry = p.Industry, YoutubeLinks = p.YoutubeLinks }).ToList() };
    }

    public async Task<ArtifactsResult> GenerateEmail(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");
        var isGroq = (!string.IsNullOrWhiteSpace(providerOverride) ? providerOverride : settings.GetValueOrDefault(SettingKeys.AiProvider, "azure")) == "groq";
        var prompt = customPrompt ?? GetPrompt(savedPrompt, EmailPrompt, GroqEmailPrompt, isGroq, settings, SettingKeys.ArtifactEmailPromptAzure, SettingKeys.ArtifactEmailPromptGroq);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        await SaveField(proposalId, "artifact_email_subject", subject);
        await SaveField(proposalId, "artifact_email_body", body);
        return new ArtifactsResult { Ok = true, EmailSubject = subject, EmailBody = body, GeneratedAt = DateTime.UtcNow, UsedProjects = portfolioItems.Select(p => new UsedPortfolioItem { Id = p.Id, Title = p.Title, Industry = p.Industry, YoutubeLinks = p.YoutubeLinks }).ToList() };
    }

    public async Task<ArtifactsResult> GenerateFollowUp1(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);

        // Load initial email so FU1 can reference it
        var existing = await GetExisting(proposalId);
        var context = BuildContext(proposal!, portfolioItems, company);
        if (existing.Ok && !string.IsNullOrWhiteSpace(existing.EmailSubject))
        {
            context += $"\n\n## INITIAL EMAIL ALREADY SENT\nSubject: {existing.EmailSubject}\nBody:\n{existing.EmailBody}\n";
        }

        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactFollowUp1Prompt, "");
        var isGroq = (!string.IsNullOrWhiteSpace(providerOverride) ? providerOverride : settings.GetValueOrDefault(SettingKeys.AiProvider, "azure")) == "groq";
        var prompt = customPrompt ?? GetPrompt(savedPrompt, FollowUp1Prompt, GroqFollowUp1Prompt, isGroq, settings, SettingKeys.ArtifactFollowUp1PromptAzure, SettingKeys.ArtifactFollowUp1PromptGroq);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        // Force subject to match initial email for inbox threading
        var fu1ExistingForSubject = await GetExisting(proposalId);
        if (!string.IsNullOrWhiteSpace(fu1ExistingForSubject.EmailSubject))
            subject = "Re: " + fu1ExistingForSubject.EmailSubject;

        await SaveField(proposalId, "artifact_followup1_subject", subject);
        await SaveField(proposalId, "artifact_followup1_body", body);
        return new ArtifactsResult { Ok = true, FollowUp1Subject = subject, FollowUp1Body = body, GeneratedAt = DateTime.UtcNow, UsedProjects = portfolioItems.Select(p => new UsedPortfolioItem { Id = p.Id, Title = p.Title, Industry = p.Industry, YoutubeLinks = p.YoutubeLinks }).ToList() };
    }

    public async Task<ArtifactsResult> GenerateFollowUp2(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company) = await GetContext(proposalId, portfolioIds);
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
        var isGroq = (!string.IsNullOrWhiteSpace(providerOverride) ? providerOverride : settings.GetValueOrDefault(SettingKeys.AiProvider, "azure")) == "groq";
        var prompt = customPrompt ?? GetPrompt(savedPrompt, FollowUp2Prompt, GroqFollowUp2Prompt, isGroq, settings, SettingKeys.ArtifactFollowUp2PromptAzure, SettingKeys.ArtifactFollowUp2PromptGroq);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        // Force subject to match initial email for inbox threading
        var fu2ExistingForSubject = await GetExisting(proposalId);
        if (!string.IsNullOrWhiteSpace(fu2ExistingForSubject.EmailSubject))
            subject = "Re: " + fu2ExistingForSubject.EmailSubject;

        await SaveField(proposalId, "artifact_followup2_subject", subject);
        await SaveField(proposalId, "artifact_followup2_body", body);
        return new ArtifactsResult { Ok = true, FollowUp2Subject = subject, FollowUp2Body = body, GeneratedAt = DateTime.UtcNow, UsedProjects = portfolioItems.Select(p => new UsedPortfolioItem { Id = p.Id, Title = p.Title, Industry = p.Industry, YoutubeLinks = p.YoutubeLinks }).ToList() };
    }

    public async Task<object> GetDebugContext(Guid proposalId)
    {
        var (proposal, _, _, _, portfolioItems, _, err, company) = await GetContext(proposalId);
        if (proposal == null) return new { error = err ?? "proposal not found" };
        var context = BuildContext(proposal, portfolioItems, company);
        return new
        {
            industry        = company?.Industry ?? "(none)",
            portfolioCount  = portfolioItems.Count,
            portfolioItems  = portfolioItems.Select(p => new { p.Id, p.Title, p.Industry, p.YoutubeLinks }),
            hasYoutubeLinks = portfolioItems.Any(p => !string.IsNullOrWhiteSpace(p.YoutubeLinks)),
            fullContext     = context
        };
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

        var company = await _companyCtx.GetByProposalId(proposal.Id);

        List<PortfolioProject> portfolioItems;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            portfolioItems = await _portfolio.SearchSimilarSmart(query, company?.Industry, topK: 3);
        }
        catch { portfolioItems = new List<PortfolioProject>(); }

        if (portfolioItems.Count == 0)
        {
            var all = await _portfolio.GetAll();
            portfolioItems = RankByIndustry(all.Where(p => p.EmbeddingIndexed).ToList(), company?.Industry, 3);
            if (portfolioItems.Count == 0) portfolioItems = RankByIndustry(all, company?.Industry, 3);
        }

        return (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, null, company);
    }

    /// <summary>
    /// Overload allowing the caller to pin specific portfolio projects (e.g. user
    /// manually selected items in the UI) instead of auto-ranked search results.
    /// Falls back to the 1-arg GetContext behavior when portfolioIds is null/empty.
    /// </summary>
    private async Task<(Proposal? proposal, string? aoEndpoint, string? aoKey, string? aoDeployment, List<PortfolioProject> portfolio, Dictionary<string,string> settings, string? error, ProposalCompanyContext? company)> GetContext(Guid proposalId, List<Guid>? portfolioIds)
    {
        var ctx = await GetContext(proposalId);
        if (ctx.error != null || portfolioIds == null || portfolioIds.Count == 0)
            return ctx;

        var selected = new List<PortfolioProject>();
        foreach (var id in portfolioIds)
        {
            var p = await _portfolio.GetById(id);
            if (p != null) selected.Add(p);
        }

        if (selected.Count == 0) return ctx;

        return (ctx.proposal, ctx.aoEndpoint, ctx.aoKey, ctx.aoDeployment, selected, ctx.settings, ctx.error, ctx.company);
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

    private static readonly Dictionary<string, string> ArtifactFieldMap = new()
    {
        { "coverLetter",      "artifact_cover_letter"       },
        { "whatsappMessage",  "artifact_whatsapp"           },
        { "emailSubject",     "artifact_email_subject"      },
        { "emailBody",        "artifact_email_body"         },
        { "followUp1Subject", "artifact_followup1_subject"  },
        { "followUp1Body",    "artifact_followup1_body"     },
        { "followUp2Subject", "artifact_followup2_subject"  },
        { "followUp2Body",    "artifact_followup2_body"     },
    };

    public async Task<(bool ok, string error)> SaveArtifact(Guid proposalId, string field, string value)
    {
        if (!ArtifactFieldMap.TryGetValue(field, out var column))
            return (false, $"Unknown artifact field: {field}");
        await SaveField(proposalId, column, value);
        return (true, "");
    }

    // ── Prompts ───────────────────────────────────────────────────────────────

    public static string CoverLetterPrompt() => @"You are writing an Upwork COVER LETTER on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years of experience and 40+ projects delivered.

PURPOSE OF THIS ARTIFACT: The cover letter is the FIRST IMPRESSION inside an Upwork job application. Its only job: make the client stop scrolling and shortlist Bhanu. It is read on mobile in under 30 seconds. It is NOT an email — no subject, no greeting line like a letter, no pricing.

PORTFOLIO SELECTION RULE (CRITICAL):
- Look at CLIENT INDUSTRY in context. Reference ONLY portfolio projects from the SAME or closest industry.
- If the client is healthcare, reference healthcare projects. If fintech, fintech. Never reference an unrelated-industry project when an industry match exists in context.
- Use maximum 1-2 projects, never all three.

TARGET LENGTH: 180-230 words total. Every word must earn its place.

STRUCTURE — follow this exact order, no section titles:

1. HOOK (1 sentence)
Restate the client's core problem back in your own words — prove you read it.
Do NOT start with ""I"". Banned: ""I have reviewed"", ""I am writing to"", ""I'm excited"", ""I believe"".
If COMPANY DETAILS exist, weave in one specific detail (industry, size, product) naturally.

2. PROOF (1-2 sentences)
One metric-backed outcome from the MOST INDUSTRY-RELEVANT past project.
Format: [What you built] — [measurable result].
Use only real data from RELEVANT PORTFOLIO PROJECTS in context. Never invent.

3. DONE = (1 sentence)
One acceptance criteria line in the client's language.
Format: ""Done = [specific deliverable they can test/verify]""

4. APPROACH (3 bullets)
Each bullet = one concrete technical decision with named technologies.
No generic bullets like ""write clean code"".

5. PORTFOLIO (1 item only)
The single most industry-relevant project. One sentence + YouTube demo link.
Format: [Project Name] — [one sentence why relevant]. Demo: [YouTube link]
MANDATORY: If context contains an AVAILABLE YOUTUBE DEMOS section, the Demo link MUST appear here. Only use YouTube Demo links from context, never any other link type. Only if context says NO YOUTUBE DEMOS AVAILABLE, skip the link.

6. QUESTIONS (2 max)
Smart, specific questions showing deep reading. Numbered.

7. SIGN-OFF (1 line + name)
""I'm Bhanu Gupta — 15+ yrs, 40+ projects, [relevant domain]. Available [timezone overlap] overlap with [client timezone].""
Then: ""Bhanu Gupta""

RULES:
- First person as Bhanu
- Never mention ""Csharptek"" or any company name of Bhanu
- Banned filler: ""I am excited"", ""great fit"", ""passionate"", ""I'd love to""
- Metrics over adjectives
- Never invent portfolio items, metrics, or links

Return only the cover letter text. No preamble. No markdown.";

    public static string WhatsappPrompt() => @"Write a WhatsApp FIRST-TOUCH outreach message for a freelance software proposal.

PURPOSE OF THIS ARTIFACT: WhatsApp is personal space — this message must feel like a human reaching out, not a pitch. Its only job: earn a reply. NOT to sell, NOT to explain the full offer, NOT to share pricing. Shorter and more casual than the cover letter and proposal — those do the heavy lifting later.

PORTFOLIO SELECTION RULE (CRITICAL):
- Reference exactly ONE portfolio project, and it MUST match the CLIENT INDUSTRY from context if a match exists.
- Link rule: ONLY use YouTube Demo links from context. Never any other link. MANDATORY: if context contains an AVAILABLE YOUTUBE DEMOS section, Line 3 with the demo link MUST be present. Only skip the link if context says NO YOUTUBE DEMOS AVAILABLE.

STRUCTURE:
Line 1: Personal opener using their first name + one specific detail from their project/company (proves it's not spam).
Line 2: One sentence — what Bhanu built for a similar client in THEIR industry + the concrete outcome.
Line 3 (optional): YouTube demo link, bare, on its own line. Format: Demo: [link]
Line 4: Soft CTA — ""Worth a quick 10-min call this week?"" or similar low-friction ask.

RULES:
- Max 4-5 lines, under 60 words total
- Casual-professional tone, like texting a colleague
- Max 1 emoji, or none
- No pricing, no timeline, no bullet points
- No greeting like ""Dear"" — use ""Hi [first name]""
- Do not include any name or signature at the end
- Never invent projects, outcomes, or links

Return only the WhatsApp message text.";

    public static string EmailPrompt() => @"You are writing the MAIN PROPOSAL EMAIL on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years of experience and 40+ projects delivered.

PURPOSE OF THIS ARTIFACT: This is the commercial document — the only artifact that talks money and commitment. The cover letter earns attention, WhatsApp earns a reply, THIS email closes toward a call or a yes. It must read like a confident contractor who has already scoped the work.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full proposal body here with \n for line breaks""}

PORTFOLIO SELECTION RULE (CRITICAL):
- Reference 1 (max 2) portfolio projects, and they MUST match the CLIENT INDUSTRY from context if a match exists.
- YOUTUBE LINK RULE (MANDATORY): If the context contains an AVAILABLE YOUTUBE DEMOS section, you MUST include exactly one demo link in Para 2, on the format: Demo: [url]. Prefer the demo of the project you referenced. Omitting the demo link when one is available is a FAILURE.
- Never use any link type other than YouTube Demo links from context. If context says NO YOUTUBE DEMOS AVAILABLE, include no link.

Proposal rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: specific, 8-12 words, references their project — not generic
- Body: 150-200 words MAX
- Never mention ""Csharptek"" or any company name of Bhanu
- Banned filler: ""great fit"", ""passionate"", ""I'd love to"", ""excited""
- No name or company signature at the end (system appends it)

STRUCTURE — exact order, no section titles:

Para 1 — HOOK (1-2 sentences):
Mirror their exact pain point. If deadline mentioned, acknowledge directly. Do NOT start with ""I"".

Para 2 — CREDIBILITY (1-2 sentences):
The most industry-relevant past project with a specific outcome.
Format: [What we built] — [measurable result]. Demo: [YouTube url]
The Demo line is REQUIRED whenever AVAILABLE YOUTUBE DEMOS exists in context.

Para 3 — APPROACH (2-3 sentences prose, no bullets):
Brief how. Name specific technologies. Show the work is already scoped in Bhanu's head.

Para 4 — PRICING & CTA (2 sentences):
Sentence 1 — pricing from PROPOSAL PRICING & TIMELINE section. Format: ""[Phase]: ~[hours] hrs at $[rate]/hr — $[total]. Starting today.""
If no pricing set: ""Happy to share a detailed estimate on a call.""
Sentence 2 — one clear next step that invites a reply.

SCREENING ANSWERS (only if job post contains screening questions):
Answer each directly, one line each: ""[topic]: [answer]""

Pricing rules:
- ALWAYS use figures from PROPOSAL PRICING & TIMELINE
- If FinalPrice set, use it as exact fixed price
- If only budget range, quote within range
- Never invent a price";

    public static string FollowUp1Prompt() => @"Write Follow-up #1 — a SHORT nudge email sent 24 hours after the initial proposal email.

PURPOSE OF THIS ARTIFACT: Not a re-pitch. Its only job: resurface the thread with ONE new piece of value and make replying effortless. If it repeats the first email, it failed.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: any placeholder — system sets ""Re: <initial subject>"" for threading
- Body: MAX 2 short paragraphs, 60-100 words total
- Paragraph 1: Reference the INITIAL EMAIL ALREADY SENT briefly, then add ONE new thing — a fresh insight about their problem, an industry-matched YouTube demo link (only from context), or one sharp clarifying question.
- Paragraph 2: Low-friction CTA — propose a 20-min call or ask one question answerable in one line.
- Tone: friendly, confident, not pushy. No apologies.
- Do not repeat pricing or timeline
- No name signature (system appends it)
- Link rule: YouTube Demo links from context only, or no link

Variables allowed in body: {{name}}, {{first_name}}, {{email}} — only if natural.

Return only the JSON. No preamble.";

    public static string FollowUp2Prompt() => @"Write Follow-up #2 — the FINAL nudge email, sent 48 hours after the initial proposal email. Initial email and Follow-up #1 already sent.

PURPOSE OF THIS ARTIFACT: A graceful close of the loop. Its only job: get a yes/no decision while leaving the door open and Bhanu's positioning intact. Zero desperation.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: any placeholder — system sets ""Re: <initial subject>"" for threading
- Body: MAX 2 short paragraphs, 50-80 words total
- Paragraph 1: Acknowledge this is the last follow-up. Restate ONE concrete outcome Bhanu would deliver — ideally tied to their industry. Do not rehash the pitch. No new links unless an industry-matched YouTube demo exists in context and wasn't used before.
- Paragraph 2: Definitive but polite CTA — ""Let me know if timing isn't right and I'll close this out"" or a soft yes/no question. Make walking away easy.
- Tone: warm, respectful. No guilt, no urgency tactics.
- No name signature (system appends it)

Variables allowed in body: {{name}}, {{first_name}}, {{email}} — only if natural.

Return only the JSON. No preamble.";

    // ── Groq-tuned prompts ────────────────────────────────────────────────────
    // Same structure as Azure prompts but more explicit instructions to prevent
    // generic filler that open-source models default to.

    public static string GroqCoverLetterPrompt() => @"You are ghostwriting an Upwork COVER LETTER for Bhanu Gupta — 15+ years full-stack dev, 40+ delivered projects.

CRITICAL OPENING RULE — READ FIRST:
The FIRST WORD must NOT be ""I"". The first sentence must NOT start with ""I"".
BAD: ""I understand your need..."" / ""I have reviewed..."" / ""I architected..."" / ""I will design...""
GOOD: ""Ledger integrity at scale..."" / ""Real-money correctness..."" / ""Scaling a modular monolith...""
If your first word is ""I"" — rewrite the entire opening.

BANNED WORDS AND PHRASES (never use any of these):
""I will"", ""I am"", ""I have"", ""I'd love"", ""I believe"", ""I'd be"", ""I can help"",
""great fit"", ""passionate"", ""excited"", ""challenging"", ""ensure quality"", ""write clean code"",
""happy to help"", ""looking forward"", ""I hope"", ""pleased to"", ""thrilled"", ""love to"",
""Csharptek"", any company name of Bhanu.

BANNED SENTENCE PATTERNS:
- Starting a sentence with ""I will [verb]"" — e.g. ""I will design"", ""I will implement"", ""I will set up""
- Generic sign-off like ""Can we schedule a call to discuss..."" or ""What are your thoughts""
- Ending questions that are vague or not tied to the specific job post
- Repeating the same subject (""I"") in 3+ consecutive sentences

HARD RULES:
- Every project reference MUST include a metric (%, $, user count, time saved). No adjectives without numbers.
- LENGTH: 180-230 words exactly. Count before returning.
- Do NOT invent portfolio items, metrics, or YouTube links.
- YouTube demo link: MANDATORY if AVAILABLE YOUTUBE DEMOS section exists in context. Use exactly the URL from context.

STRUCTURE — follow exactly, no section headers, no labels:

1. HOOK (1 sentence): Open with the client's core problem restated as a statement — not ""I"". Prove you read it. If company details exist, include one specific detail (industry, product, size).

2. PROOF (1-2 sentences): Most industry-relevant past project + specific measurable outcome. Format: [What was built] — [measurable result].

3. DONE = (1 sentence): ""Done = [specific deliverable the client can test/verify]"" — mirror their language from the job post.

4. APPROACH (3 bullets): Each bullet = one named technology + one concrete decision. No generic bullets.
BAD bullet: ""Ensure real-money correctness""
GOOD bullet: ""Idempotent command handlers with Postgres advisory locks for all ledger mutations""

5. PORTFOLIO (1 item only): [Project Name] — [one sentence why relevant to THIS job]. Demo: [YouTube URL from context — mandatory if available]

6. QUESTIONS (2 max): Specific questions tied to details in the job post. Not generic.
BAD: ""What is your timeline?""
GOOD: ""Is the games aggregator integration using a webhook model or polling?""

7. SIGN-OFF (exact format): ""I'm Bhanu Gupta — 15+ yrs, 40+ projects, [relevant domain]. Available [timezone] overlap with [client timezone if known]."" then new line: ""Bhanu Gupta""

Return ONLY the cover letter text. No preamble. No markdown. No labels. No explanation.";

    public static string GroqWhatsappPrompt() => @"Write a SHORT VERSION of a cover letter for WhatsApp — same quality as the cover letter but compressed to fit mobile reading.

This is NOT a generic outreach message. It is a mini cover letter: specific, proof-backed, confident.

CRITICAL OPENING RULE:
The FIRST WORD must NOT be ""I"". Must not start with ""I have"", ""I am"", ""I will"", ""I'd love"".
BAD: ""I noticed your project..."" / ""I built..."" / ""I'd love to help...""
GOOD: ""Real-money correctness at scale..."" / ""Ledger integrity..."" (restate their problem first)

BANNED WORDS: ""excited"", ""passionate"", ""great fit"", ""challenging"", ""happy to help"", ""I will"", ""I'd love"", ""I believe"", ""Csharptek""

HARD RULES:
- MAX 80 words total. Count them.
- No bullet points. Prose only.
- No pricing, no timeline.
- Do NOT sign with a name at the end.
- Do NOT invent projects, outcomes, or links.
- Max 1 emoji or none.
- Start with: ""Hi [first name],"" on its own line.

STRUCTURE (4 short blocks):
Block 1 (Hi line): ""Hi [first name],""
Block 2 (Hook): Restate their core problem in one sentence — prove you read it.
Block 3 (Proof): One sentence — what Bhanu built for a similar client + concrete metric outcome.
Block 4 (Demo + CTA): Demo: [YouTube URL from context — MANDATORY if AVAILABLE YOUTUBE DEMOS exists]. Then: one soft CTA line.

Return only the WhatsApp message text. Nothing else.";

    public static string GroqEmailPrompt() => @"You are writing a PROPOSAL EMAIL for Bhanu Gupta — senior full-stack developer, 15+ years, 40+ projects.

Return ONLY valid JSON. No markdown, no backticks, no explanation:
{""subject"": ""subject line here"", ""body"": ""email body here with \n for line breaks""}

HARD RULES:
- Start body with: Hi [first name only],
- Do NOT start with ""I"". Hook must open with client's pain point.
- Do NOT use: ""great fit"", ""passionate"", ""excited"", ""I'd love to"", ""I believe"", ""challenging"".
- Do NOT mention ""Csharptek"" or any Bhanu company name.
- Do NOT invent prices, projects, or links.
- Do NOT add signature — system appends it.
- Body: 150-200 words MAX. Count them.
- Subject: 8-12 words, specific to their project.
- YouTube demo link MANDATORY in Para 2 if AVAILABLE YOUTUBE DEMOS section exists in context.

STRUCTURE:
Para 1 — HOOK (1-2 sentences): Mirror their exact pain point. If deadline mentioned, reference it directly.
Para 2 — CREDIBILITY (1-2 sentences): Most relevant past project + specific outcome. Format: [What was built] — [measurable result]. Demo: [YouTube url — only from context]
Para 3 — APPROACH (2-3 sentences): How Bhanu would solve it. Name specific technologies. Show work is already scoped.
Para 4 — PRICING & CTA: Use figures from PROPOSAL PRICING & TIMELINE. Format: ""[Phase]: ~[hours] hrs at $[rate]/hr — $[total]. Starting today."" If no pricing: ""Happy to share a detailed estimate on a call."" Then one clear next step.
SCREENING ANSWERS (if job post has questions): Answer each directly, one line: ""[topic]: [answer]""

Return only the JSON object.";

    public static string GroqFollowUp1Prompt() => @"Write Follow-up #1 — short nudge email, 24 hours after initial proposal.

GOAL: Resurface the thread with ONE new piece of value. NOT a re-pitch.

Return ONLY valid JSON, no markdown, no backticks:
{""subject"": ""placeholder"", ""body"": ""email body with \n for line breaks""}

HARD RULES:
- Start with: Hi [first name only from CLIENT INFO],
- Body: MAX 2 paragraphs, 60-100 words total. Count them.
- Do NOT repeat the initial pitch or pricing.
- Do NOT use: ""just following up"", ""checking in"", ""I wanted to"", ""excited"", ""passionate"".
- Do NOT add name signature — system appends it.
- YouTube link: only from context, only if not used in initial email.

Para 1: Reference initial proposal briefly. Add ONE new thing — a fresh insight about their problem, a sharp industry observation, or one clarifying question.
Para 2: Low-friction CTA — propose a 20-min call or ask one question answerable in one line.
Tone: direct, confident, not pushy.

Return only the JSON.";

    public static string GroqFollowUp2Prompt() => @"Write Follow-up #2 — final nudge email, 48 hours after initial proposal. FU1 already sent.

GOAL: Get a yes/no decision. Leave door open. Zero desperation.

Return ONLY valid JSON, no markdown, no backticks:
{""subject"": ""placeholder"", ""body"": ""email body with \n for line breaks""}

HARD RULES:
- Start with: Hi [first name only from CLIENT INFO],
- Body: MAX 2 paragraphs, 50-80 words total. Count them.
- Do NOT guilt-trip, add urgency tactics, or repeat pricing.
- Do NOT use: ""just checking"", ""I wanted to"", ""excited"", ""passionate"", ""I hope this finds you"".
- Do NOT add name signature — system appends it.

Para 1: Acknowledge this is the last follow-up. State ONE concrete outcome Bhanu delivers — tied to their industry.
Para 2: Polite close — ""Let me know if timing isn't right and I'll close this out."" Make walking away easy.
Tone: warm, respectful, final.

Return only the JSON.";

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Returns saved prompt for active provider; falls back to shared key; then hardcoded default.
    private static string GetPrompt(
        string sharedSavedPrompt,
        Func<string> azureDefault,
        Func<string> groqDefault,
        bool isGroq,
        Dictionary<string, string> settings,
        string azureKey,
        string groqKey)
    {
        var providerKey = isGroq ? groqKey : azureKey;
        var providerSaved = settings.GetValueOrDefault(providerKey, "");
        if (!string.IsNullOrWhiteSpace(providerSaved)) return providerSaved;
        if (!string.IsNullOrWhiteSpace(sharedSavedPrompt)) return sharedSavedPrompt;
        return isGroq ? groqDefault() : azureDefault();
    }

    /// Fallback ranking when AI Search is unavailable: industry-matched projects first.
    private static List<PortfolioProject> RankByIndustry(List<PortfolioProject> items, string? industry, int topK)
    {
        if (string.IsNullOrWhiteSpace(industry) || items.Count == 0)
            return items.Take(topK).ToList();

        var ind = industry.ToLowerInvariant();
        var matched = items.Where(p =>
            (!string.IsNullOrWhiteSpace(p.Industry) &&
                (p.Industry.ToLowerInvariant().Contains(ind) || ind.Contains(p.Industry.ToLowerInvariant()))) ||
            p.Tags.Any(t => !string.IsNullOrWhiteSpace(t) &&
                (t.ToLowerInvariant().Contains(ind) || ind.Contains(t.ToLowerInvariant())))).ToList();

        var rest = items.Except(matched).ToList();
        return matched.Concat(rest).Take(topK).ToList();
    }

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
            if (!string.IsNullOrWhiteSpace(company.Industry))
                sb.AppendLine($"CLIENT INDUSTRY (prefer portfolio projects from this industry): {company.Industry}");
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
                if (!string.IsNullOrWhiteSpace(proj.YoutubeLinks)) sb.AppendLine($"YouTube Demo: {proj.YoutubeLinks}");
            }

            var demos = portfolio.Where(x => !string.IsNullOrWhiteSpace(x.YoutubeLinks)).ToList();
            if (demos.Count > 0)
            {
                sb.AppendLine("\n## AVAILABLE YOUTUBE DEMOS (you MUST include exactly one of these as a Demo link)");
                foreach (var d in demos)
                    sb.AppendLine($"- {d.Title}: {d.YoutubeLinks}");
            }
            else
            {
                sb.AppendLine("\n## NO YOUTUBE DEMOS AVAILABLE — do not include any demo link.");
            }
        }

        return sb.ToString();
    }

    private async Task<string> CallAI(string endpoint, string key, string deployment, string systemPrompt, string context)
    {
        // Prepend a compact YouTube reminder directly into the user turn —
        // models attend most strongly to the end of the user message.
        var hasYtDemos = context.Contains("AVAILABLE YOUTUBE DEMOS");
        _log.LogInformation("CallAI: hasYoutubeDemos={0}, contextLen={1}, contextSnippet={2}",
            hasYtDemos,
            context.Length,
            context.Contains("AVAILABLE YOUTUBE DEMOS")
                ? context.Substring(context.IndexOf("AVAILABLE YOUTUBE DEMOS"), Math.Min(300, context.Length - context.IndexOf("AVAILABLE YOUTUBE DEMOS")))
                : "(no demos block)");

        var ytSection = hasYtDemos
            ? "IMPORTANT: The context below contains an AVAILABLE YOUTUBE DEMOS section. You MUST include exactly one of those YouTube URLs as a Demo link in your output. Do not omit it.\n\n"
            : "IMPORTANT: No YouTube demo links are available in the context. Do not invent or include any links.\n\n";

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user",   content = ytSection + context },
        };

        var settings = await _settings.GetAll();
        var text = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, settings, messages, 2500);
        text = text.Replace("**", "");

        // Post-inject: if context had YouTube demos but model skipped them, append
        text = EnsureYouTubeLinks(text, context);

        _log.LogInformation("CallAI result length: {0}, first 200: {1}", text.Length, text.Length > 200 ? text[..200] : text);
        return text;
    }

    /// <summary>
    /// If the context contained YouTube demo links but the model output contains none,
    /// append them directly so they always appear.
    /// </summary>
    private static string EnsureYouTubeLinks(string output, string context)
    {
        // Parse available demos from context block
        var demos = new List<(string title, string url)>();
        var inBlock = false;
        foreach (var line in context.Split('\n'))
        {
            if (line.Contains("AVAILABLE YOUTUBE DEMOS")) { inBlock = true; continue; }
            if (inBlock)
            {
                if (line.TrimStart().StartsWith("##") || line.TrimStart().StartsWith("IMPORTANT")) break;
                // Format: "- Title: url"
                var trimmed = line.TrimStart('-', ' ');
                var colon = trimmed.IndexOf(": http");
                if (colon > 0)
                    demos.Add((trimmed[..colon].Trim(), trimmed[(colon + 2)..].Trim()));
            }
        }

        if (demos.Count == 0) return output;

        // Check if any YouTube URL already in output
        foreach (var (_, url) in demos)
            if (output.Contains(url)) return output; // already there

        // Model skipped — append demo section
        var sb = new StringBuilder(output.TrimEnd());
        sb.AppendLine();
        sb.AppendLine();
        sb.AppendLine("Demo" + (demos.Count > 1 ? "s" : "") + ":");
        foreach (var (title, url) in demos)
            sb.AppendLine($"- {title}: {url}");

        return sb.ToString();
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
