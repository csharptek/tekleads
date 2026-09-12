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

    // Match transparency — mirrors the test panel. SemanticScore/CombinedScore are 0
    // and Tier is "Manual selection" when the project came from the manual picker
    // rather than auto-retrieval, since there's no score to show for a manual pick.
    public double SemanticScore { get; set; }
    public double CombinedScore { get; set; }
    public string Tier { get; set; } = "";
    public bool IndustryMatch { get; set; }
    public List<string> MatchedTags { get; set; } = new();
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

    // Cover-letter quality score — rule checks + one AI grading pass, computed right
    // after generation/regeneration. Null when never scored (e.g. older saved letters).
    public int? CoverLetterScore { get; set; }
    public List<string> CoverLetterScoreReasons { get; set; } = new();

    // Email quality score — same idea as CoverLetterScore, stored separately in
    // artifact_scores (field="email") rather than on the proposals table.
    public int? EmailScore { get; set; }
    public List<string> EmailScoreReasons { get; set; } = new();
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
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_cover_letter_score INT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS artifact_cover_letter_score_reasons TEXT",
        };
        foreach (var m in migrations)
        {
            try { await c.ExecuteAsync(m); } catch { }
        }

        // Generic per-artifact-type score store — used for artifact types beyond the
        // cover letter (which keeps its own dedicated columns above, untouched).
        // One row per (proposal, field); upserted on every score/re-score.
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS artifact_scores (
                proposal_id UUID NOT NULL,
                field TEXT NOT NULL,
                score INT NOT NULL,
                reasons_json TEXT NOT NULL DEFAULT '[]',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (proposal_id, field)
            )");
    }

    public async Task<ArtifactsResult> GetExisting(Guid proposalId)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            @"SELECT artifact_cover_letter, artifact_whatsapp, artifact_email_subject, artifact_email_body, artifact_generated_at,
                     artifact_followup1_subject, artifact_followup1_body, artifact_followup2_subject, artifact_followup2_body,
                     artifact_cover_letter_score, artifact_cover_letter_score_reasons
              FROM proposals WHERE id=@id",
            new { id = proposalId });

        if (row == null || string.IsNullOrEmpty((string?)row.artifact_cover_letter))
            return new ArtifactsResult { Ok = false, Error = "No artifacts generated yet." };

        var (emailScore, emailScoreReasons) = await GetArtifactScore(c, proposalId, "email");

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
            CoverLetterScore = row.artifact_cover_letter_score,
            CoverLetterScoreReasons = string.IsNullOrWhiteSpace((string?)row.artifact_cover_letter_score_reasons)
                ? new List<string>()
                : (JsonSerializer.Deserialize<List<string>>((string)row.artifact_cover_letter_score_reasons) ?? new List<string>()),
            EmailScore = emailScore,
            EmailScoreReasons = emailScoreReasons,
        };
    }

    /// <summary>Reads one (proposal, field) row from the generic artifact_scores table. Additive — used for artifact types other than the cover letter.</summary>
    private static async Task<(int? score, List<string> reasons)> GetArtifactScore(NpgsqlConnection c, Guid proposalId, string field)
    {
        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT score, reasons_json FROM artifact_scores WHERE proposal_id=@id AND field=@field",
            new { id = proposalId, field });
        if (row == null) return (null, new List<string>());
        List<string> reasons;
        try { reasons = JsonSerializer.Deserialize<List<string>>((string)row.reasons_json) ?? new(); }
        catch { reasons = new(); }
        return ((int)row.score, reasons);
    }

    /// <summary>Upserts one (proposal, field) row in the generic artifact_scores table.</summary>
    private async Task SaveArtifactScore(Guid proposalId, string field, int score, List<string> reasons)
    {
        var cs = _settings.ConnectionString;
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            INSERT INTO artifact_scores (proposal_id, field, score, reasons_json, updated_at)
            VALUES (@id, @field, @score, @reasons, NOW())
            ON CONFLICT (proposal_id, field) DO UPDATE SET
                score = EXCLUDED.score, reasons_json = EXCLUDED.reasons_json, updated_at = NOW()",
            new { id = proposalId, field, score, reasons = JsonSerializer.Serialize(reasons) });
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

        // Artifacts always generate on Claude now, regardless of the global AI Provider setting.
        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.ClaudeApiKey, "")))
            return Fail("Claude API key not configured in Settings.");

        var companyCtx = await _companyCtx.GetByProposalId(proposal.Id);

        // RAG: industry+tags+semantic tiered portfolio retrieval (see PortfolioService.
        // SearchSimilarEnhanced). Throws only on real infra failure (no embedding key,
        // embedding call failed, DB error) — that's the only case that falls back to
        // RankByIndustry below. A clean empty result means "nothing genuinely relevant",
        // which is left empty on purpose so the prompt doesn't force an unrelated citation.
        List<PortfolioService.PortfolioMatchInfo> matchInfos;
        var portfolioSearchFailed = false;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            matchInfos = await _portfolio.SearchSimilarEnhanced(query, companyCtx?.Industry, topK: 3);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Portfolio search failed for proposal {0}, falling back to industry ranking", proposalId);
            matchInfos = new List<PortfolioService.PortfolioMatchInfo>();
            portfolioSearchFailed = true;
        }
        if (portfolioSearchFailed)
        {
            var all = await _portfolio.GetAll();
            var fallback = RankByIndustry(all.Where(p => p.EmbeddingIndexed).ToList(), companyCtx?.Industry, 3);
            if (fallback.Count == 0)
                fallback = RankByIndustry(all, companyCtx?.Industry, 3);
            matchInfos = fallback.Select(p => new PortfolioService.PortfolioMatchInfo { Project = p, Tier = "Fallback" }).ToList();
        }
        // Never cite a project with zero proof (no iOS/Android/Web/YouTube link on file) —
        // a name-drop with nothing to back it up reads as padding.
        matchInfos = matchInfos.Where(m => HasAnyLink(m.Project)).ToList();
        var portfolioItems = matchInfos.Select(m => m.Project).ToList();
        var context = BuildContext(proposal, portfolioItems, companyCtx);

        var clPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var waPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var emPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");

        // Generate sequentially to avoid timeout overload
        string coverLetter, whatsapp, emailSubject, emailBody;
        int clScore; List<string> clScoreReasons;
        try
        {
            var linkBlock = BuildLinkBlocks(portfolioItems);
            coverLetter  = await CallAI(aoEndpoint, aoKey, aoDeployment, GetPrompt(clPrompt, CoverLetterPrompt), context, forceLinkInBody: false);
            (clScore, clScoreReasons) = await ScoreCoverLetter(proposal, coverLetter);
            if (linkBlock != null) coverLetter = coverLetter.TrimEnd() + "\n\n" + linkBlock;
            whatsapp     = await CallAI(aoEndpoint, aoKey, aoDeployment, GetPrompt(waPrompt, WhatsappPrompt), context);
            var emailRaw = await CallAI(aoEndpoint, aoKey, aoDeployment, GetPrompt(emPrompt, EmailPrompt), context, forceLinkInBody: false);
            (emailSubject, emailBody) = ParseEmail(emailRaw);
            if (linkBlock != null) emailBody = emailBody.TrimEnd() + "\n\n" + linkBlock;
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
                artifact_cover_letter_score=@cls,
                artifact_cover_letter_score_reasons=@clsr,
                artifact_generated_at=NOW(),
                updated_at=NOW()
            WHERE id=@id",
            new { cl = coverLetter, wa = whatsapp, es = emailSubject, eb = emailBody, cls = clScore, clsr = JsonSerializer.Serialize(clScoreReasons), id = proposalId });

        return new ArtifactsResult
        {
            Ok = true,
            CoverLetter = coverLetter,
            WhatsappMessage = whatsapp,
            EmailSubject = emailSubject,
            EmailBody = emailBody,
            GeneratedAt = DateTime.UtcNow,
            UsedProjects = matchInfos.Select(ToUsedItem).ToList(),
            CoverLetterScore = clScore,
            CoverLetterScoreReasons = clScoreReasons
        };
    }

    public async Task<ArtifactsResult> GenerateCoverLetter(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var prompt = customPrompt ?? GetPrompt(savedPrompt, CoverLetterPrompt);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context, forceLinkInBody: false);
        var (score, reasons) = await ScoreCoverLetter(proposal!, result);
        var linkBlock = BuildLinkBlocks(portfolioItems);
        if (linkBlock != null) result = result.TrimEnd() + "\n\n" + linkBlock;
        await SaveField(proposalId, "artifact_cover_letter", result);
        await SaveCoverLetterScore(proposalId, score, reasons);
        return new ArtifactsResult { Ok = true, CoverLetter = result, GeneratedAt = DateTime.UtcNow, UsedProjects = matchInfos.Select(ToUsedItem).ToList(), CoverLetterScore = score, CoverLetterScoreReasons = reasons };
    }

    /// <summary>
    /// Manual "Fix Issues" action: takes the currently saved cover letter + its
    /// flagged score reasons, asks the model to revise it addressing those specific
    /// issues (keeping everything that already works), re-scores, and keeps trying
    /// up to 2 revision passes total — stopping early once a pass doesn't improve
    /// on the best score seen so far. Never picks a worse draft than the one it started with.
    /// </summary>
    public async Task<ArtifactsResult> FixCoverLetter(Guid proposalId)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, null);
        if (err != null) return Fail(err);

        var existing = await GetExisting(proposalId);
        if (!existing.Ok || string.IsNullOrWhiteSpace(existing.CoverLetter))
            return Fail("No cover letter to fix yet — generate one first.");

        var issues = existing.CoverLetterScoreReasons ?? new List<string>();
        if (issues.Count == 0)
            return existing; // nothing flagged — nothing to fix

        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactCoverLetterPrompt, "");
        var basePrompt = GetPrompt(savedPrompt, CoverLetterPrompt);

        var best = StripLinkBlock(existing.CoverLetter);
        var bestScore = existing.CoverLetterScore ?? 0;
        var bestReasons = issues;

        const int maxAttempts = 2;
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            string candidate;
            try
            {
                var fixPrompt = BuildFixPrompt(basePrompt, best, bestReasons);
                candidate = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, fixPrompt, context, forceLinkInBody: false);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Cover letter fix pass failed for {0}", proposalId);
                break;
            }

            var (candScore, candReasons) = await ScoreCoverLetter(proposal!, candidate);
            if (candScore > bestScore)
            {
                best = candidate;
                bestScore = candScore;
                bestReasons = candReasons;
            }
            if (candReasons.Count == 0 || candScore <= bestScore) break; // no more issues, or this pass didn't help — stop
        }

        var linkBlock = BuildLinkBlocks(portfolioItems);
        var finalText = linkBlock != null ? best.TrimEnd() + "\n\n" + linkBlock : best;
        await SaveField(proposalId, "artifact_cover_letter", finalText);
        await SaveCoverLetterScore(proposalId, bestScore, bestReasons);
        return new ArtifactsResult { Ok = true, CoverLetter = finalText, GeneratedAt = DateTime.UtcNow, UsedProjects = matchInfos.Select(ToUsedItem).ToList(), CoverLetterScore = bestScore, CoverLetterScoreReasons = bestReasons };
    }

    private static string StripLinkBlock(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var idx = text.IndexOf("\nFor reference, here", StringComparison.Ordinal);
        return idx < 0 ? text : text[..idx].TrimEnd();
    }

    private static string BuildFixPrompt(string basePrompt, string currentDraftText, List<string> issues)
    {
        var issuesText = string.Join("\n", issues.Select(i => $"- {i}"));
        return basePrompt + $@"

REVISION MODE — READ CAREFULLY:
A previous draft of this exact cover letter was reviewed and specific problems were flagged below. Revise the draft to fix EVERY flagged issue while keeping everything that already works — do not throw away good, JD-grounded content just to change something, and do not introduce a new violation of any rule above while fixing these.

PREVIOUS DRAFT:
{currentDraftText}

FLAGGED ISSUES TO FIX:
{issuesText}

Return ONLY the revised cover letter text — same format as the structure rules above, no commentary, no explanation of what changed, no markdown fences.";
    }

    public async Task<ArtifactsResult> GenerateWhatsapp(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactWhatsappPrompt, "");
        var prompt = customPrompt ?? GetPrompt(savedPrompt, WhatsappPrompt);
        var result = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        await SaveField(proposalId, "artifact_whatsapp", result);
        return new ArtifactsResult { Ok = true, WhatsappMessage = result, GeneratedAt = DateTime.UtcNow, UsedProjects = matchInfos.Select(ToUsedItem).ToList() };
    }

    public async Task<ArtifactsResult> GenerateEmail(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);
        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");
        var prompt = customPrompt ?? GetPrompt(savedPrompt, EmailPrompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context, forceLinkInBody: false);
        var (subject, body) = ParseEmail(raw);
        var (emailScore, emailScoreReasons) = await ScoreEmail(proposal!, body);
        var linkBlock = BuildLinkBlocks(portfolioItems);
        if (linkBlock != null) body = body.TrimEnd() + "\n\n" + linkBlock;
        await SaveField(proposalId, "artifact_email_subject", subject);
        await SaveField(proposalId, "artifact_email_body", body);
        await SaveArtifactScore(proposalId, "email", emailScore, emailScoreReasons);
        return new ArtifactsResult {
            Ok = true, EmailSubject = subject, EmailBody = body, GeneratedAt = DateTime.UtcNow,
            UsedProjects = matchInfos.Select(ToUsedItem).ToList(),
            EmailScore = emailScore, EmailScoreReasons = emailScoreReasons,
        };
    }

    /// <summary>
    /// Manual "Fix Issues" for the proposal email — mirrors FixCoverLetter's 2-pass
    /// regenerate-and-keep-best loop, but for the Email artifact's own rules/prompt.
    /// Independent method: does not touch FixCoverLetter or its behavior.
    /// </summary>
    public async Task<ArtifactsResult> FixEmail(Guid proposalId)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, null);
        if (err != null) return Fail(err);

        var existing = await GetExisting(proposalId);
        if (!existing.Ok || string.IsNullOrWhiteSpace(existing.EmailBody))
            return Fail("No email to fix yet — generate one first.");

        var issues = existing.EmailScoreReasons ?? new List<string>();
        if (issues.Count == 0)
            return existing; // nothing flagged — nothing to fix

        var context = BuildContext(proposal!, portfolioItems, company);
        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactEmailPrompt, "");
        var basePrompt = GetPrompt(savedPrompt, EmailPrompt);

        var bestSubject = existing.EmailSubject;
        var bestBody = StripLinkBlock(existing.EmailBody);
        var bestScore = existing.EmailScore ?? 0;
        var bestReasons = issues;

        const int maxAttempts = 2;
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            string candidateRaw;
            try
            {
                var fixPrompt = BuildEmailFixPrompt(basePrompt, bestSubject, bestBody, bestReasons);
                candidateRaw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, fixPrompt, context, forceLinkInBody: false);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Email fix pass failed for {0}", proposalId);
                break;
            }

            var (candSubject, candBody) = ParseEmail(candidateRaw);
            var (candScore, candReasons) = await ScoreEmail(proposal!, candBody);
            if (candScore > bestScore)
            {
                bestSubject = candSubject;
                bestBody = candBody;
                bestScore = candScore;
                bestReasons = candReasons;
            }
            if (candReasons.Count == 0 || candScore <= bestScore) break;
        }

        var linkBlock = BuildLinkBlocks(portfolioItems);
        var finalBody = linkBlock != null ? bestBody.TrimEnd() + "\n\n" + linkBlock : bestBody;
        await SaveField(proposalId, "artifact_email_subject", bestSubject);
        await SaveField(proposalId, "artifact_email_body", finalBody);
        await SaveArtifactScore(proposalId, "email", bestScore, bestReasons);
        return new ArtifactsResult {
            Ok = true, EmailSubject = bestSubject, EmailBody = finalBody, GeneratedAt = DateTime.UtcNow,
            UsedProjects = matchInfos.Select(ToUsedItem).ToList(),
            EmailScore = bestScore, EmailScoreReasons = bestReasons,
        };
    }

    private static string BuildEmailFixPrompt(string basePrompt, string currentSubject, string currentBody, List<string> issues)
    {
        var issuesText = string.Join("\n", issues.Select(i => $"- {i}"));
        return basePrompt + $@"

REVISION MODE — READ CAREFULLY:
A previous draft of this exact proposal email was reviewed and specific problems were flagged below. Revise it to fix EVERY flagged issue while keeping everything that already works — do not throw away good, JD-grounded content just to change something, and do not introduce a new violation of any rule above while fixing these.

PREVIOUS SUBJECT:
{currentSubject}

PREVIOUS BODY:
{currentBody}

FLAGGED ISSUES TO FIX:
{issuesText}

Return ONLY valid JSON in the exact same {{""subject"": ""..."", ""body"": ""...""}} format as the structure rules above — no commentary, no markdown fences.";
    }

    public async Task<ArtifactsResult> GenerateFollowUp1(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, portfolioIds);
        if (err != null) return Fail(err);

        // Load initial email so FU1 can reference it
        var existing = await GetExisting(proposalId);
        var context = BuildContext(proposal!, portfolioItems, company);
        if (existing.Ok && !string.IsNullOrWhiteSpace(existing.EmailSubject))
        {
            context += $"\n\n## INITIAL EMAIL ALREADY SENT\nSubject: {existing.EmailSubject}\nBody:\n{existing.EmailBody}\n";
        }

        var savedPrompt = settings.GetValueOrDefault(SettingKeys.ArtifactFollowUp1Prompt, "");
        var prompt = customPrompt ?? GetPrompt(savedPrompt, FollowUp1Prompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        // Force subject to match initial email for inbox threading
        var fu1ExistingForSubject = await GetExisting(proposalId);
        if (!string.IsNullOrWhiteSpace(fu1ExistingForSubject.EmailSubject))
            subject = "Re: " + fu1ExistingForSubject.EmailSubject;

        await SaveField(proposalId, "artifact_followup1_subject", subject);
        await SaveField(proposalId, "artifact_followup1_body", body);
        return new ArtifactsResult { Ok = true, FollowUp1Subject = subject, FollowUp1Body = body, GeneratedAt = DateTime.UtcNow, UsedProjects = matchInfos.Select(ToUsedItem).ToList() };
    }

    public async Task<ArtifactsResult> GenerateFollowUp2(Guid proposalId, string? customPrompt = null, List<Guid>? portfolioIds = null, string? providerOverride = null)
    {
        var (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, err, company, matchInfos) = await GetContext(proposalId, portfolioIds);
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
        var prompt = customPrompt ?? GetPrompt(savedPrompt, FollowUp2Prompt);
        var raw = await CallAI(aoEndpoint!, aoKey!, aoDeployment!, prompt, context);
        var (subject, body) = ParseEmail(raw);
        // Force subject to match initial email for inbox threading
        var fu2ExistingForSubject = await GetExisting(proposalId);
        if (!string.IsNullOrWhiteSpace(fu2ExistingForSubject.EmailSubject))
            subject = "Re: " + fu2ExistingForSubject.EmailSubject;

        await SaveField(proposalId, "artifact_followup2_subject", subject);
        await SaveField(proposalId, "artifact_followup2_body", body);
        return new ArtifactsResult { Ok = true, FollowUp2Subject = subject, FollowUp2Body = body, GeneratedAt = DateTime.UtcNow, UsedProjects = matchInfos.Select(ToUsedItem).ToList() };
    }

    public async Task<object> GetDebugContext(Guid proposalId)
    {
        var (proposal, _, _, _, portfolioItems, _, err, company, matchInfos) = await GetContext(proposalId);
        if (proposal == null) return new { error = err ?? "proposal not found" };
        var context = BuildContext(proposal, portfolioItems, company);
        return new
        {
            industry        = company?.Industry ?? "(none)",
            portfolioCount  = portfolioItems.Count,
            portfolioItems  = matchInfos.Select(m => new { m.Project.Id, m.Project.Title, m.Project.Industry, m.Project.YoutubeLinks, m.SemanticScore, m.CombinedScore, m.Tier, m.IndustryMatch, m.MatchedTags }),
            hasYoutubeLinks = portfolioItems.Any(p => !string.IsNullOrWhiteSpace(p.YoutubeLinks)),
            fullContext     = context
        };
    }

    private async Task<(Proposal? proposal, string? aoEndpoint, string? aoKey, string? aoDeployment, List<PortfolioProject> portfolio, Dictionary<string,string> settings, string? error, ProposalCompanyContext? company, List<PortfolioService.PortfolioMatchInfo> matchInfos)> GetContext(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null) return (null, null, null, null, new(), new(), "Proposal not found.", null, new());

        var settings = await _settings.GetAll();
        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        // Artifacts always generate on Claude now, regardless of the global AI Provider setting.
        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.ClaudeApiKey, "")))
            return (null, null, null, null, new(), new(), "Claude API key not configured in Settings.", null, new());

        var company = await _companyCtx.GetByProposalId(proposal.Id);

        List<PortfolioService.PortfolioMatchInfo> matchInfos;
        var portfolioSearchFailed = false;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            matchInfos = await _portfolio.SearchSimilarEnhanced(query, company?.Industry, topK: 3);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Portfolio search failed for proposal {0}, falling back to industry ranking", proposalId);
            matchInfos = new List<PortfolioService.PortfolioMatchInfo>();
            portfolioSearchFailed = true;
        }

        if (portfolioSearchFailed)
        {
            var all = await _portfolio.GetAll();
            var fallback = RankByIndustry(all.Where(p => p.EmbeddingIndexed).ToList(), company?.Industry, 3);
            if (fallback.Count == 0) fallback = RankByIndustry(all, company?.Industry, 3);
            matchInfos = fallback.Select(p => new PortfolioService.PortfolioMatchInfo { Project = p, Tier = "Fallback" }).ToList();
        }
        matchInfos = matchInfos.Where(m => HasAnyLink(m.Project)).ToList();
        var portfolioItems = matchInfos.Select(m => m.Project).ToList();

        return (proposal, aoEndpoint, aoKey, aoDeployment, portfolioItems, settings, null, company, matchInfos);
    }

    /// <summary>
    /// Overload allowing the caller to pin specific portfolio projects (e.g. user
    /// manually selected items in the UI) instead of auto-ranked search results.
    /// Falls back to the 1-arg GetContext behavior when portfolioIds is null/empty.
    /// </summary>
    private async Task<(Proposal? proposal, string? aoEndpoint, string? aoKey, string? aoDeployment, List<PortfolioProject> portfolio, Dictionary<string,string> settings, string? error, ProposalCompanyContext? company, List<PortfolioService.PortfolioMatchInfo> matchInfos)> GetContext(Guid proposalId, List<Guid>? portfolioIds)
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

        // Manual pick — no auto-score to show, label it plainly instead of a number.
        var manualMatchInfos = selected.Select(p => new PortfolioService.PortfolioMatchInfo { Project = p, Tier = "Manual selection" }).ToList();

        return (ctx.proposal, ctx.aoEndpoint, ctx.aoKey, ctx.aoDeployment, selected, ctx.settings, ctx.error, ctx.company, manualMatchInfos);
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

    private async Task SaveCoverLetterScore(Guid proposalId, int score, List<string> reasons)
    {
        var cs = _settings.ConnectionString;
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await conn.ExecuteAsync(
            "UPDATE proposals SET artifact_cover_letter_score=@s, artifact_cover_letter_score_reasons=@r, updated_at=NOW() WHERE id=@id",
            new { s = score, r = JsonSerializer.Serialize(reasons), id = proposalId });
    }

    // ── Cover letter quality scoring ────────────────────────────────────────
    // Rule checks mirror the CoverLetterPrompt's own rules (kept here as plain
    // string/regex checks so they run instantly with no extra API call), combined
    // 50/50 with one extra Claude grading call that judges JD-groundedness —
    // something a keyword check can't catch (a sentence can dodge every banned
    // phrase and still be generic filler that ignores the actual job post).
    private static readonly string[] ScoreBannedPhrases =
    {
        "i will", "i am", "i have", "i'd love", "i believe", "i'd be", "i can help", "i am excited",
        "great fit", "passionate", "excited", "challenging", "ensure quality", "write clean code",
        "happy to help", "looking forward", "i hope", "pleased to", "thrilled", "love to", "csharptek",
    };

    private static readonly string[] ScoreBannedHookSnippets =
    {
        "turning ", "is not just", "is exactly the kind of", "living knowledge base",
        "workspaces into ecosystems", "from prototype to production-ready",
        "ledger integrity at scale", "real-money correctness", "scaling a modular monolith",
    };

    private async Task<(int score, List<string> reasons)> ScoreCoverLetter(Proposal proposal, string coverLetterText)
    {
        var reasons = new List<string>();
        var text = coverLetterText ?? "";
        var lower = text.ToLowerInvariant();
        int checks = 0, passed = 0;

        var firstWordMatch = System.Text.RegularExpressions.Regex.Match(text.TrimStart(), @"^[A-Za-z']+");
        var firstWord = firstWordMatch.Success ? firstWordMatch.Value : "";
        checks++;
        if (!string.Equals(firstWord, "I", StringComparison.OrdinalIgnoreCase)) passed++;
        else reasons.Add("Opens with \"I\" — banned opening word.");

        checks++;
        var hitBanned = ScoreBannedPhrases.FirstOrDefault(p => lower.Contains(p));
        if (hitBanned == null) passed++;
        else reasons.Add($"Contains banned filler phrase: \"{hitBanned}\".");

        checks++;
        var hitHook = ScoreBannedHookSnippets.FirstOrDefault(p => lower.Contains(p));
        if (hitHook == null) passed++;
        else reasons.Add($"Uses a banned generic hook pattern: \"{hitHook.Trim()}\".");

        checks++;
        if (!lower.Contains("done =")) passed++;
        else reasons.Add("Uses the literal \"Done =\" template — reads as mechanical.");

        checks++;
        if (!lower.Contains("bhanu")) passed++;
        else reasons.Add("Names \"Bhanu\" in the sign-off — should stay unnamed (sent from multiple accounts).");

        var wordCount = text.Split(new[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries).Length;
        checks++;
        if (wordCount >= 170 && wordCount <= 330) passed++;
        else reasons.Add($"Length is {wordCount} words — target is 200-300.");

        var jdText = $"{proposal.JobPostHeadline} {proposal.JobPostBody}";
        var trapMatch = System.Text.RegularExpressions.Regex.Match(
            jdText, @"reply\s+(?:with|using)\s+(?:the\s+word\s+)?[""']?([A-Za-z0-9]{2,20})[""']?",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (trapMatch.Success)
        {
            checks++;
            var word = trapMatch.Groups[1].Value;
            if (lower.Contains(word.ToLowerInvariant())) passed++;
            else reasons.Add($"JD asks you to reply with \"{word}\" — missing from the letter.");
        }

        var ruleScore = checks > 0 ? (int)Math.Round(100.0 * passed / checks) : 100;

        var aiScore = ruleScore; // fallback if the grading call fails
        try
        {
            const string gradingPrompt = @"You are a strict reviewer grading an Upwork cover letter against the job post it was written for.
Score 0-100 on how well the letter is grounded in THIS SPECIFIC job post (not a generic template) — every claim/sentence should trace to something actually stated in the job post, the proof/credibility paragraph should read specific and credible (not vague filler like ""we've delivered comparable solutions""), and any questions should reference real details from this job post.
DO NOT flag the sign-off line as an issue (something like ""I'm available — 15+ yrs, 40+ projects, [domain]. Available [overlap] with [timezone]."") — that exact line is a REQUIRED, deliberate template the letter must always end with, not a mistake. Never list it, or its ""15+ yrs"" / ""40+ projects"" figures, as ""generic"", ""unverifiable"", or ""filler"" in issues.
Return ONLY JSON: {""score"": <0-100>, ""issues"": [""short reason"", ...]} — issues is up to 4 short, specific problems (empty array if none). No markdown, no commentary.";
            var userMsg = $"JOB POST:\n{jdText}\n\nCOVER LETTER:\n{text}";
            var gradingSettings = new Dictionary<string, string>(await _settings.GetAll()) { [SettingKeys.AiProvider] = "claude" };
            var messages = new List<object>
            {
                new { role = "system", content = gradingPrompt },
                new { role = "user", content = userMsg },
            };
            var raw = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, gradingSettings, messages, 500);
            var clean = raw.Trim();
            if (clean.StartsWith("```")) { var i = clean.IndexOf('\n'); clean = clean[(i + 1)..]; }
            if (clean.EndsWith("```")) clean = clean[..clean.LastIndexOf("```")];
            var doc = JsonDocument.Parse(clean.Trim());
            aiScore = doc.RootElement.GetProperty("score").GetInt32();
            if (doc.RootElement.TryGetProperty("issues", out var issuesEl))
                foreach (var issue in issuesEl.EnumerateArray())
                {
                    var s = issue.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) reasons.Add(s);
                }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Cover letter AI grading failed for {0}, using rule score only", proposal.Id);
        }

        var overall = (int)Math.Round(0.5 * ruleScore + 0.5 * aiScore);
        var finalReasons = reasons.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct().Take(6).ToList();
        return (overall, finalReasons);
    }

    // ── Email quality scoring — independent of ScoreCoverLetter, own rules ─────
    // Mirrors the pattern (deterministic rule checks + one AI grading call, 50/50)
    // but against EmailPrompt()'s own rules, not the cover letter's.
    private static readonly string[] ScoreEmailBannedPhrases =
    {
        "great fit", "passionate", "i'd love to", "excited", "i believe", "challenging",
        "i will", "i am", "i have", "i'd be", "i can help", "csharptek",
    };

    private async Task<(int score, List<string> reasons)> ScoreEmail(Proposal proposal, string emailBodyText)
    {
        var reasons = new List<string>();
        var text = emailBodyText ?? "";
        var lower = text.ToLowerInvariant();
        int checks = 0, passed = 0;

        var firstWordMatch = System.Text.RegularExpressions.Regex.Match(text.TrimStart(), @"^[A-Za-z']+");
        var firstWord = firstWordMatch.Success ? firstWordMatch.Value : "";
        checks++;
        // First real word after the "Hi [name]," opener shouldn't be "I" either —
        // check the first word of the second line/sentence, not the greeting itself.
        var afterGreeting = System.Text.RegularExpressions.Regex.Replace(text.TrimStart(), @"^Hi[^,\n]*,?\s*", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var hookFirstWordMatch = System.Text.RegularExpressions.Regex.Match(afterGreeting.TrimStart(), @"^[A-Za-z']+");
        var hookFirstWord = hookFirstWordMatch.Success ? hookFirstWordMatch.Value : firstWord;
        if (!string.Equals(hookFirstWord, "I", StringComparison.OrdinalIgnoreCase)) passed++;
        else reasons.Add("Hook opens with \"I\" — banned opening word.");

        checks++;
        var hitBanned = ScoreEmailBannedPhrases.FirstOrDefault(p => lower.Contains(p));
        if (hitBanned == null) passed++;
        else reasons.Add($"Contains banned filler phrase: \"{hitBanned}\".");

        checks++;
        var hasPricing = System.Text.RegularExpressions.Regex.IsMatch(lower, @"\$\s?\d|\d+\s?(usd|per hour|/hr|/hour)");
        if (!hasPricing) passed++;
        else reasons.Add("Mentions pricing/rate numbers — email must not discuss cost.");

        checks++;
        if (!lower.Contains("bhanu")) passed++;
        else reasons.Add("Names \"Bhanu\" — should stay unnamed (system appends the signature).");

        var wordCount = text.Split(new[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries).Length;
        checks++;
        if (wordCount >= 120 && wordCount <= 220) passed++;
        else reasons.Add($"Length is {wordCount} words — target is 150-200.");

        var ruleScore = checks > 0 ? (int)Math.Round(100.0 * passed / checks) : 100;

        var jdText = $"{proposal.JobPostHeadline} {proposal.JobPostBody}";
        var aiScore = ruleScore;
        try
        {
            const string gradingPrompt = @"You are a strict reviewer grading a freelance proposal EMAIL against the job post it was written for.
Score 0-100 on how well the email is grounded in THIS SPECIFIC job post — the hook should mirror a real, specific pain point stated in the job post (not a generic template), the credibility paragraph's past-project reference should read specific and relevant (not vague filler), and the call-to-action should tie to something concrete from this email/job post rather than a generic ""let's hop on a call"".
This email must NOT discuss pricing, rates, or cost — flag it if it does.
Return ONLY JSON: {""score"": <0-100>, ""issues"": [""short reason"", ...]} — issues is up to 4 short, specific problems (empty array if none). No markdown, no commentary.";
            var userMsg = $"JOB POST:\n{jdText}\n\nEMAIL BODY:\n{text}";
            var gradingSettings = new Dictionary<string, string>(await _settings.GetAll()) { [SettingKeys.AiProvider] = "claude" };
            var messages = new List<object>
            {
                new { role = "system", content = gradingPrompt },
                new { role = "user", content = userMsg },
            };
            var raw = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, gradingSettings, messages, 500);
            var clean = raw.Trim();
            if (clean.StartsWith("```")) { var i = clean.IndexOf('\n'); clean = clean[(i + 1)..]; }
            if (clean.EndsWith("```")) clean = clean[..clean.LastIndexOf("```")];
            var doc = JsonDocument.Parse(clean.Trim());
            aiScore = doc.RootElement.GetProperty("score").GetInt32();
            if (doc.RootElement.TryGetProperty("issues", out var issuesEl))
                foreach (var issue in issuesEl.EnumerateArray())
                {
                    var s = issue.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) reasons.Add(s);
                }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Email AI grading failed for {0}, using rule score only", proposal.Id);
        }

        var overallEmail = (int)Math.Round(0.5 * ruleScore + 0.5 * aiScore);
        var finalEmailReasons = reasons.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct().Take(6).ToList();
        return (overallEmail, finalEmailReasons);
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

    public async Task<(bool ok, string error, int? coverLetterScore, List<string>? coverLetterScoreReasons)> SaveArtifact(Guid proposalId, string field, string value)
    {
        if (!ArtifactFieldMap.TryGetValue(field, out var column))
            return (false, $"Unknown artifact field: {field}", null, null);
        await SaveField(proposalId, column, value);

        // A manual edit to the cover letter becomes the version everything downstream
        // (Fix Issues, the coaching chat, the next "Redo") reads as current — re-score
        // it right away so the score badge/flagged issues never go stale after a save.
        if (field == "coverLetter")
        {
            var proposal = await _proposals.GetById(proposalId);
            if (proposal != null)
            {
                var (score, reasons) = await ScoreCoverLetter(proposal, value);
                await SaveCoverLetterScore(proposalId, score, reasons);
                return (true, "", score, reasons);
            }
        }

        // Same idea for a manual edit to the email body — re-score so Fix Issues and
        // the email coaching chat read the edited text's actual score, not a stale one.
        if (field == "emailBody")
        {
            var proposal = await _proposals.GetById(proposalId);
            if (proposal != null)
            {
                var (score, reasons) = await ScoreEmail(proposal, value);
                await SaveArtifactScore(proposalId, "email", score, reasons);
                return (true, "", score, reasons);
            }
        }

        return (true, "", null, null);
    }

    // ── Prompts ───────────────────────────────────────────────────────────────

    public static string CoverLetterPrompt() => @"You are writing an Upwork COVER LETTER on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years of experience and 40+ projects delivered.

PURPOSE OF THIS ARTIFACT: The cover letter is the FIRST IMPRESSION inside an Upwork job application. Its only job: make the client stop scrolling and shortlist Bhanu. It is read on mobile in under 30 seconds. It is NOT an email — no subject, no greeting line like a letter, no pricing.

CRITICAL OPENING RULE — READ FIRST:
The first word must NOT be ""I"". The opening sentence must be a plain declarative statement using a concrete noun/feature/deadline LIFTED FROM THE JOB POST — never an abstract metaphor or gerund fragment.
BAD (starts with I): ""I understand your need..."" / ""I have reviewed..."" / ""I architected...""
BAD (generic template — banned outright): ""Turning [X] into [Y] — is exactly the kind of...""  /  ""[X] is not just [Y], it's [Z]""  /  ""Ledger integrity at scale...""  /  ""Real-money correctness...""  /  ""Scaling a modular monolith...""
GOOD (specific to the actual job post): restate the literal problem stated in the job, e.g. ""The games aggregator needs webhook-based settlement instead of nightly polling.""
If your first word is ""I"", OR your sentence would still make sense pasted into a different job's cover letter, rewrite the entire opening using a detail unique to THIS job post.

ACCURACY RULE (CRITICAL):
- Every sentence must be grounded in THIS job post — a named feature, integration, tech, deadline, or pain point actually stated in it. Never generalize into abstract industry buzzwords.
- If the job post is thin on detail, use its single most specific noun phrase instead of inventing atmosphere.
- Never invent portfolio items, metrics, features, or links not present in context.
- Test: if a sentence could be pasted unchanged into a cover letter for a DIFFERENT job post, it is too generic — rewrite it using a literal detail from THIS job post.

BANNED HOOK PATTERNS (never use these or close variants — they read as generic AI filler):
- ""Turning [X] into [Y]"" / ""...— is exactly the kind of [thing] that's easy to [A] and hard to [B]""
- ""[X] is not just [Y], it's [Z]""
- Any abstract noun phrase or gerund fragment followed by an em dash and ""is exactly"" / ""is the real challenge"" / ""is where it gets hard""
- Vague metaphors: ""living knowledge base"", ""workspaces into ecosystems"", ""from prototype to production-ready"", ""scattered X into unified Y""

BANNED WORDS AND PHRASES (never use any of these):
""I will"", ""I am"", ""I have"", ""I'd love"", ""I believe"", ""I'd be"", ""I can help"", ""I am excited"",
""great fit"", ""passionate"", ""excited"", ""challenging"", ""ensure quality"", ""write clean code"",
""happy to help"", ""looking forward"", ""I hope"", ""pleased to"", ""thrilled"", ""love to"",
""Csharptek"", any company name of Bhanu.

BANNED SENTENCE PATTERNS:
- Starting a sentence with ""I will [verb]"" — e.g. ""I will design"", ""I will implement"", ""I will set up""
- Generic sign-off like ""Can we schedule a call to discuss..."" or ""What are your thoughts""
- Ending questions that are vague or not tied to the specific job post
- Repeating the same subject (""I"") in 3+ consecutive sentences

CLIENT SCREENING INSTRUCTIONS (CRITICAL — CHECK EVERY JOB POST, NO EXCEPTIONS):
Many clients bury a literal compliance instruction inside the job post to filter out copy-paste/AI-generated applicants — e.g. ""reply with the word AUTO"", ""start your proposal with [word]"", ""confirm you read this by saying..."", ""include today's date"", or a direct request like ""tell me your timeline"" / ""when can you start"". Read the ENTIRE job post text for this before writing anything.
If ANY such instruction exists, you MUST comply with it exactly (the literal word/phrase requested, verbatim) somewhere in the letter — this overrides word count, structure, and every other rule. Missing it gets the application auto-rejected before a human ever reads the rest.
If it's a magic word/phrase to include: state it plainly and literally, e.g. ""AUTO"" — don't paraphrase it.
If it's a timeline/availability ask: give a concrete, short estimate as its own line near the sign-off, e.g. ""Can start immediately — [X] for a working v1, based on the scope above.""
If no such instruction exists in the job post, do nothing extra — do not invent one.

PORTFOLIO SELECTION RULE (CRITICAL):
- Look at CLIENT INDUSTRY in context. Reference ONLY portfolio projects from the SAME or closest industry.
- If the client is healthcare, reference healthcare projects. If fintech, fintech. Never reference an unrelated-industry project when an industry match exists in context.
- Use maximum 1-2 projects, never all three.

TARGET LENGTH: 200-300 words total (Upwork's own recommended range). Count before returning. Every word must earn its place.

STRUCTURE — follow this exact order, no section titles:

1. HOOK (1 plain declarative sentence)
Upwork shows ONLY the first 1-2 sentences of a proposal in the client's search-results preview — before they ever open it. This sentence must work completely standalone, with zero other context, and still clearly show you understand THEIR specific problem. Never write a hook that only makes sense once the reader continues into PROOF or APPROACH.
State the client's actual problem using a concrete phrase LIFTED FROM THE JOB POST — a named feature, integration, deadline, or pain point. Not a metaphor. Not one of the BANNED HOOK PATTERNS above. Do NOT start with ""I"".
If COMPANY DETAILS exist, weave in one specific detail (industry, size, product) naturally.

2. PROOF (1-2 sentences)
One metric-backed outcome from the MOST INDUSTRY-RELEVANT past project.
Format: [What you built] — [measurable result].
Use only real data from RELEVANT PORTFOLIO PROJECTS in context. Never invent.
Do NOT include any link, URL, or ""Demo:"" line here or anywhere else in the body — a separate system step appends the project name and any available links (YouTube demo, etc.) after your text. Writing a link yourself creates a duplicate.

3. ACCEPTANCE CRITERIA (1 sentence)
One plain-English sentence stating exactly what ""working"" looks like for this job — a specific, testable/verifiable outcome, in the client's language.
Do NOT use the literal template ""Done = ..."" — that exact formula shows up identically across too many letters and reads as a mechanical tell. Write it as a normal sentence instead, e.g. ""You'll know it's working when [X]"", ""In practice, that means [X]"", ""Success here is [X]"", or just a direct statement of the outcome — vary the phrasing letter to letter, never the same opener twice in a row.

4. APPROACH (3 bullets)
Each bullet = one concrete technical decision with named technologies.
No generic bullets like ""write clean code"" or ""ensure real-money correctness"". Instead, e.g.: ""Idempotent command handlers with Postgres advisory locks for all ledger mutations"" — named tech + specific decision.

5. QUESTIONS (3 max)
Each question must trace to a SPECIFIC phrase or requirement in THIS job post — quote or closely paraphrase the exact thing they mentioned (a named tool, a stated pain point like ""troubleshoot issues"" or ""optimize for accuracy"", a specific deliverable). If a question could be copy-pasted into a different job post unchanged, it's too generic — rewrite it or drop it. Generic filler (""What is your timeline?"", ""Which LLM provider?"" asked with no JD basis) is banned.

6. CALL TO ACTION (1 short line, before the sign-off)
Invite a concrete next step tied to what was just discussed — not a generic ""Can we schedule a call?"" (banned above). Tie it to a specific artifact of this conversation, e.g. ""Can share a short breakdown of the [specific approach/module] if that's useful before you decide"" or ""Can start with [specific first step] this week if the scope above lines up."" Must reference something specific from THIS letter, not be copy-pasteable elsewhere.

7. SIGN-OFF (1 line, no name — this goes out under different Upwork accounts, never sign a specific person's name)
""I'm available — 15+ yrs, 40+ projects, [relevant domain]. Available [timezone overlap] overlap with [client timezone].""

RULES:
- First person as Bhanu, but never named
- Never mention ""Csharptek"" or any company name of Bhanu
- Metrics over adjectives — every project reference must include a metric (%, $, user count, time saved)
- Never invent portfolio items, metrics, or links
- No link, URL, or ""Demo:"" line anywhere in your output — the system appends it separately

Return only the cover letter text. No preamble. No markdown. No labels.";

    public static string WhatsappPrompt() => @"Write a WhatsApp FIRST-TOUCH outreach message for a freelance software proposal.

PURPOSE OF THIS ARTIFACT: WhatsApp is personal space — this message must feel like a human reaching out, not a pitch. Its only job: earn a reply. NOT to sell, NOT to explain the full offer, NOT to share pricing. Shorter and more casual than the cover letter and proposal — those do the heavy lifting later.

CRITICAL OPENING RULE:
Do NOT start with ""I"". Open with the person's first name.
BANNED WORDS: ""excited"", ""passionate"", ""great fit"", ""challenging"", ""happy to help"", ""I will"", ""I'd love"", ""I believe"", ""Csharptek""

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

CRITICAL OPENING RULE: The HOOK paragraph must NOT start with ""I"". Mirror the client's pain point as a plain statement instead.

PORTFOLIO SELECTION RULE (CRITICAL):
- Reference 1 (max 2) portfolio projects, and they MUST match the CLIENT INDUSTRY from context if a match exists.
- Do NOT include any link, URL, or ""Demo:"" line yourself anywhere in the body — a separate system step appends the project name and any available links (iOS/Android/Web/YouTube demo) after your text. Writing a link yourself creates a duplicate.

Proposal rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- If CLIENT INFO says no name found, start with: Hi there,
- If Title / Seniority / Headline are present in CLIENT INFO, let it shape tone and the APPROACH paragraph (e.g. a hands-on technical title → more specific tech detail; a founder/exec title → outcome-and-speed framing). Never state their title back to them verbatim, never say ""As a CTO...""
- Subject: specific, 8-12 words, references their project — not generic
- Body: 150-200 words MAX. Count before returning.
- Never mention ""Csharptek"" or any company name of Bhanu
- No self-introduction paragraph — do not describe who Bhanu is or what the company does. Every sentence addresses their problem or proves relevant experience, never sender bio.
- Banned filler: ""great fit"", ""passionate"", ""I'd love to"", ""excited"", ""I believe"", ""challenging""
- No pricing, rates, or numbers about cost anywhere in this email — even if PROPOSAL PRICING & TIMELINE is present in context, ignore it for this artifact
- No name or company signature at the end (system appends it)

STRUCTURE — exact order, no section titles:

Para 1 — HOOK (1-2 sentences):
Mirror their exact pain point. If deadline mentioned, acknowledge directly. Do NOT start with ""I"".

Para 2 — CREDIBILITY (1-2 sentences):
The most industry-relevant past project with a specific outcome.
Format: [What we built] — [measurable result]. No link here — links are appended separately.

Para 3 — APPROACH (2-3 sentences prose, no bullets):
Brief how. Name specific technologies. Show the work is already scoped in Bhanu's head.

Para 4 — CTA (1-2 sentences):
One clear, specific next step that invites a reply (e.g. ""Worth 15 min this week?""). No pricing, no rates, no numbers about cost anywhere in this email.

SCREENING ANSWERS (only if job post contains screening questions):
Answer each directly, one line each: ""[topic]: [answer]""";

    public static string FollowUp1Prompt() => @"Write Follow-up #1 — a SHORT nudge email sent 24 hours after the initial proposal email.

PURPOSE OF THIS ARTIFACT: Not a re-pitch. Its only job: resurface the thread with ONE new piece of value and make replying effortless. If it repeats the first email, it failed.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{""subject"": ""your subject line here"", ""body"": ""full email body here with \n for line breaks""}

Rules:
- Start with: Hi [first name only from CLIENT INFO Name field],
- Subject: any placeholder — system sets ""Re: <initial subject>"" for threading
- Body: MAX 2 short paragraphs, 60-100 words total. Count before returning.
- Paragraph 1: Reference the INITIAL EMAIL ALREADY SENT briefly, then add ONE new thing — a fresh insight about their problem, an industry-matched YouTube demo link (only from context), or one sharp clarifying question.
- Paragraph 2: Low-friction CTA — propose a 20-min call or ask one question answerable in one line.
- Tone: friendly, confident, not pushy. No apologies.
- Do NOT use: ""just following up"", ""checking in"", ""I wanted to"", ""excited"", ""passionate""
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
- Body: MAX 2 short paragraphs, 50-80 words total. Count before returning.
- Paragraph 1: Acknowledge this is the last follow-up. Restate ONE concrete outcome Bhanu would deliver — ideally tied to their industry. Do not rehash the pitch. No new links unless an industry-matched YouTube demo exists in context and wasn't used before.
- Paragraph 2: Definitive but polite CTA — ""Let me know if timing isn't right and I'll close this out"" or a soft yes/no question. Make walking away easy.
- Tone: warm, respectful. No guilt, no urgency tactics.
- Do NOT use: ""just checking"", ""I wanted to"", ""excited"", ""passionate"", ""I hope this finds you""
- No name signature (system appends it)

Variables allowed in body: {{name}}, {{first_name}}, {{email}} — only if natural.

Return only the JSON. No preamble.";

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Returns the saved custom prompt if one is set, else the hardcoded default.
    /// Provider is always Claude now — no more per-provider prompt variants or
    /// per-provider saved-prompt keys (a stale one used to silently win over
    /// whatever was pasted into the Prompt modal).
    private static string GetPrompt(string savedPrompt, Func<string> defaultPrompt)
    {
        return !string.IsNullOrWhiteSpace(savedPrompt) ? savedPrompt : defaultPrompt();
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

    /// <summary>
    /// Best-effort parse of the raw Apollo contact JSON already stored per-proposal.
    /// Apollo's people/contact object shape varies slightly by endpoint, so this checks
    /// the common field names defensively and never throws — a malformed/partial blob
    /// just yields empty strings rather than breaking generation.
    /// </summary>
    private static (string title, string seniority, string headline) ParseApolloContact(string json)
    {
        try
        {
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string Get(params string[] keys)
            {
                foreach (var k in keys)
                    if (root.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String)
                    {
                        var s = v.GetString();
                        if (!string.IsNullOrWhiteSpace(s)) return s!;
                    }
                return "";
            }
            return (Get("title", "job_title"), Get("seniority"), Get("headline"));
        }
        catch
        {
            return ("", "", "");
        }
    }

    /// <summary>
    /// True if a project has at least one link on file (iOS/Android/Web/YouTube).
    /// Used to filter out projects before they're ever offered to a prompt as
    /// something to cite by name — a name-drop with zero proof reads as padding.
    /// </summary>
    private static bool HasAnyLink(PortfolioProject p) =>
        !string.IsNullOrWhiteSpace(p.IosLink) || !string.IsNullOrWhiteSpace(p.AndroidLink)
     || !string.IsNullOrWhiteSpace(p.WebLink) || !string.IsNullOrWhiteSpace(p.YoutubeLinks);

    /// <summary>
    /// Carries match transparency (score/tier/matched tags) from PortfolioService's
    /// scoring into what the live "Portfolio projects used" UI displays.
    /// </summary>
    private static UsedPortfolioItem ToUsedItem(PortfolioService.PortfolioMatchInfo m) => new()
    {
        Id = m.Project.Id,
        Title = m.Project.Title,
        Industry = m.Project.Industry,
        YoutubeLinks = m.Project.YoutubeLinks,
        SemanticScore = m.SemanticScore,
        CombinedScore = m.CombinedScore,
        Tier = m.Tier,
        IndustryMatch = m.IndustryMatch,
        MatchedTags = m.MatchedTags,
    };

    /// <summary>
    /// Deterministic Project/iOS/Android/Web/YouTube block appended to the generated email
    /// body — never left to the LLM's formatting. Any field that's empty on the record is
    /// omitted entirely (never printed as "not found" or left blank). Cites up to 2 projects
    /// (matches the "PORTFOLIO SELECTION RULE" allowance of 1-2 references in the prompts).
    /// </summary>
    private static string? BuildLinkBlocks(List<PortfolioProject> projects, int max = 2)
    {
        var chosen = projects.Where(p => p != null && !string.IsNullOrWhiteSpace(p.Title)).Take(max).ToList();
        if (chosen.Count == 0) return null;

        var sb = new StringBuilder();
        sb.AppendLine(chosen.Count > 1
            ? "For reference, here are similar projects we've delivered:"
            : "For reference, here's a similar project we delivered:");

        foreach (var project in chosen)
        {
            var youtube = (project.YoutubeLinks ?? "")
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault() ?? "";

            sb.AppendLine();
            sb.AppendLine($"Project Name: {project.Title}");
            if (!string.IsNullOrWhiteSpace(project.IosLink))     sb.AppendLine($"iOS Link: {project.IosLink}");
            if (!string.IsNullOrWhiteSpace(project.AndroidLink)) sb.AppendLine($"Android Link: {project.AndroidLink}");
            if (!string.IsNullOrWhiteSpace(project.WebLink))     sb.AppendLine($"Web Link: {project.WebLink}");
            if (!string.IsNullOrWhiteSpace(youtube))             sb.AppendLine($"Youtube Demo: {youtube}");
        }

        return sb.ToString().TrimEnd('\n', '\r');
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
            if (!string.IsNullOrWhiteSpace(firstName))
                sb.AppendLine($"First Name (use ONLY this when addressing or greeting the client, never the full name): {firstName}");
            else
                sb.AppendLine("No first name found — greet with \"Hi there,\" instead of a name.");
        }
        else
        {
            sb.AppendLine("No client name captured — greet with \"Hi there,\" instead of a name.");
        }
        if (!string.IsNullOrWhiteSpace(p.ClientCompany)) sb.AppendLine($"Company: {p.ClientCompany}");
        if (!string.IsNullOrWhiteSpace(p.ClientEmail))   sb.AppendLine($"Email: {p.ClientEmail}");

        // Parsed from p.ApolloContactJson — captured from Apollo at lead time but previously
        // never read back out. Gives the model real signal about who it's writing to instead
        // of just a first name.
        if (!string.IsNullOrWhiteSpace(p.ApolloContactJson))
        {
            var (title, seniority, headline) = ParseApolloContact(p.ApolloContactJson);
            if (!string.IsNullOrWhiteSpace(title))     sb.AppendLine($"Title: {title}");
            if (!string.IsNullOrWhiteSpace(seniority)) sb.AppendLine($"Seniority: {seniority}");
            if (!string.IsNullOrWhiteSpace(headline))  sb.AppendLine($"Headline: {headline}");
        }

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
        else
        {
            // No past project cleared the relevance bar for this job — this single line
            // covers every artifact prompt (cover letter, WhatsApp, email, follow-ups)
            // without needing to edit each one: don't let the model fabricate or force
            // a citation just because its structure has a "portfolio" section.
            sb.AppendLine("\n## RELEVANT PORTFOLIO PROJECTS: none found for this job. Do NOT reference any past project by name, do NOT invent one, do NOT include any project link, and do NOT use vague filler like \"we've delivered comparable solutions in this space before\" — that reads as empty. Instead, ground the credibility statement in the SPECIFIC named technologies, tools, or practices this job post itself calls for (e.g. \"Terraform-managed multi-cloud IaC with policy-as-code gates\" rather than \"comparable platforms\") — concrete and technical, tied to 15+ yrs / 40+ projects background, never a fabricated project, client, or metric.");
        }

        return sb.ToString();
    }

    private async Task<string> CallAI(string endpoint, string key, string deployment, string systemPrompt, string context, bool forceLinkInBody = true)
    {
        // Prepend a compact YouTube reminder directly into the user turn —
        // models attend most strongly to the end of the user message.
        // forceLinkInBody=false for the Email artifact: it gets a deterministic,
        // code-built Project/iOS/Android/Web/YouTube block appended after generation
        // instead (see BuildLinkBlock) — forcing a link into the prose too would duplicate it.
        var hasYtDemos = context.Contains("AVAILABLE YOUTUBE DEMOS");
        _log.LogInformation("CallAI: hasYoutubeDemos={0}, contextLen={1}, contextSnippet={2}",
            hasYtDemos,
            context.Length,
            context.Contains("AVAILABLE YOUTUBE DEMOS")
                ? context.Substring(context.IndexOf("AVAILABLE YOUTUBE DEMOS"), Math.Min(300, context.Length - context.IndexOf("AVAILABLE YOUTUBE DEMOS")))
                : "(no demos block)");

        string ytSection;
        if (!forceLinkInBody)
            ytSection = "IMPORTANT: Do not include any link, URL, or \"Demo:\" line in your output — links are appended separately by the system.\n\n";
        else
            ytSection = hasYtDemos
                ? "IMPORTANT: The context below contains an AVAILABLE YOUTUBE DEMOS section. You MUST include exactly one of those YouTube URLs as a Demo link in your output. Do not omit it.\n\n"
                : "IMPORTANT: No YouTube demo links are available in the context. Do not invent or include any links.\n\n";

        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt },
            new { role = "user",   content = ytSection + context },
        };

        // Always Claude for artifacts, regardless of the global AI Provider setting.
        var settings = new Dictionary<string, string>(await _settings.GetAll()) { [SettingKeys.AiProvider] = "claude" };
        var text = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, settings, messages, 2500);
        text = text.Replace("**", "");

        // Post-inject: if context had YouTube demos but model skipped them, append
        // (skipped for Email — BuildLinkBlock handles that artifact's link block instead)
        if (forceLinkInBody)
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
