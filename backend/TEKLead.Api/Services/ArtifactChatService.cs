using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ChatSendResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public ArtifactChatMessage? Message { get; set; }
}

public class ChatApplyResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string Summary { get; set; } = "";
    public ArtifactsResult? ArtifactsResult { get; set; }
    public PortfolioProject? Project { get; set; }
}

public class ArtifactChatService
{
    private readonly SettingsService _settings;
    private readonly ProposalService _proposals;
    private readonly ProposalCompanyContextService _companyCtx;
    private readonly PortfolioService _portfolio;
    private readonly ArtifactsService _artifacts;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ArtifactChatService> _log;

    public ArtifactChatService(
        SettingsService settings,
        ProposalService proposals,
        ProposalCompanyContextService companyCtx,
        PortfolioService portfolio,
        ArtifactsService artifacts,
        IHttpClientFactory http,
        ILogger<ArtifactChatService> log)
    {
        _settings = settings;
        _proposals = proposals;
        _companyCtx = companyCtx;
        _portfolio = portfolio;
        _artifacts = artifacts;
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
            CREATE TABLE IF NOT EXISTS artifact_chat_messages (
                id UUID PRIMARY KEY,
                proposal_id UUID NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                actions_json TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        try { await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_artifact_chat_proposal ON artifact_chat_messages(proposal_id, created_at)"); } catch { }
    }

    public async Task<List<ArtifactChatMessage>> GetHistory(Guid proposalId)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT id, proposal_id, role, content, actions_json, created_at FROM artifact_chat_messages WHERE proposal_id=@id ORDER BY created_at ASC",
            new { id = proposalId });
        return rows.Select(Map).ToList();
    }

    public async Task<ChatSendResult> SendMessage(Guid proposalId, string userMessage)
    {
        if (string.IsNullOrWhiteSpace(userMessage))
            return new ChatSendResult { Ok = false, Error = "Message is empty." };

        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null)
            return new ChatSendResult { Ok = false, Error = "Proposal not found." };

        var settings = await _settings.GetAll();
        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.ClaudeApiKey, "")))
            return new ChatSendResult { Ok = false, Error = "Claude API key not configured in Settings." };

        await SaveMessage(proposalId, "user", userMessage, null);

        var existing = await _artifacts.GetExisting(proposalId);
        var company = await _companyCtx.GetByProposalId(proposalId);

        List<PortfolioService.PortfolioMatchInfo> matchInfos;
        try
        {
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            matchInfos = await _portfolio.SearchSimilarEnhanced(query, company?.Industry, topK: 3);
        }
        catch
        {
            matchInfos = new List<PortfolioService.PortfolioMatchInfo>();
        }

        // GetHistory already includes the user message just saved above — drop it here
        // since it's rendered separately as "BHANU'S MESSAGE" in the prompt.
        var history = await GetHistory(proposalId);
        var priorHistory = history.Count > 0 ? history.Take(history.Count - 1).TakeLast(20).ToList() : history;

        var systemPrompt = BuildSystemPrompt();
        var userTurn = BuildUserTurn(proposal, company, existing, matchInfos, priorHistory, userMessage);

        string raw;
        try
        {
            var messages = new List<object>
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userTurn },
            };
            var chatSettings = new Dictionary<string, string>(settings) { [SettingKeys.AiProvider] = "claude" };
            raw = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, chatSettings, messages, 1200);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Artifact chat call failed for {0}", proposalId);
            return new ChatSendResult { Ok = false, Error = $"AI call failed: {ex.Message}" };
        }

        var (reply, actions) = ParseAssistantResponse(raw);
        var actionsJson = actions.Count > 0 ? JsonSerializer.Serialize(actions) : null;
        var saved = await SaveMessage(proposalId, "assistant", reply, actionsJson);

        return new ChatSendResult { Ok = true, Message = saved };
    }

    /// <summary>
    /// Executes exactly one action the assistant proposed. Never called automatically —
    /// only from an explicit button click on the frontend.
    /// </summary>
    public async Task<ChatApplyResult> ApplyAction(Guid proposalId, ChatAction action)
    {
        switch (action.Type)
        {
            case "regenerate":
            {
                var result = await _artifacts.FixCoverLetter(proposalId);
                if (!result.Ok) return new ChatApplyResult { Ok = false, Error = result.Error };
                return new ChatApplyResult { Ok = true, Summary = $"Cover letter regenerated — score {result.CoverLetterScore}%.", ArtifactsResult = result };
            }

            case "suggest_portfolio_project":
            {
                if (string.IsNullOrWhiteSpace(action.Title))
                    return new ChatApplyResult { Ok = false, Error = "Missing project title." };
                var project = new PortfolioProject
                {
                    Title = action.Title!,
                    Industry = action.Industry ?? "",
                    Tags = action.Tags?.ToArray() ?? Array.Empty<string>(),
                    Problem = action.Problem ?? "",
                    Solution = action.Solution ?? "",
                    TechStack = action.TechStack ?? "",
                    EmbeddingIndexed = false,
                };
                var saved = await _portfolio.Upsert(project);
                return new ChatApplyResult { Ok = true, Summary = $"Draft portfolio project \"{saved.Title}\" created — open Portfolio to fill in outcomes/links and index it.", Project = saved };
            }

            case "retag_project":
            {
                if (action.ProjectId == null) return new ChatApplyResult { Ok = false, Error = "Missing project id." };
                var project = await _portfolio.GetById(action.ProjectId.Value);
                if (project == null) return new ChatApplyResult { Ok = false, Error = "Project not found." };
                if (action.NewTags != null) project.Tags = action.NewTags.ToArray();
                if (!string.IsNullOrWhiteSpace(action.NewIndustry)) project.Industry = action.NewIndustry!;
                var saved = await _portfolio.Upsert(project);
                return new ChatApplyResult { Ok = true, Summary = $"Updated \"{saved.Title}\" — industry: {saved.Industry}, tags: {string.Join(", ", saved.Tags)}.", Project = saved };
            }

            default:
                return new ChatApplyResult { Ok = false, Error = $"Unknown action type: {action.Type}" };
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private async Task<ArtifactChatMessage> SaveMessage(Guid proposalId, string role, string content, string? actionsJson)
    {
        var msg = new ArtifactChatMessage { ProposalId = proposalId, Role = role, Content = content, ActionsJson = actionsJson };
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "INSERT INTO artifact_chat_messages (id, proposal_id, role, content, actions_json, created_at) VALUES (@Id, @ProposalId, @Role, @Content, @ActionsJson, @CreatedAt)",
            msg);
        return msg;
    }

    private static ArtifactChatMessage Map(dynamic row) => new()
    {
        Id = row.id,
        ProposalId = row.proposal_id,
        Role = row.role,
        Content = row.content ?? "",
        ActionsJson = row.actions_json,
        CreatedAt = row.created_at,
    };

    private static string BuildSystemPrompt() => @"You are coaching Bhanu, a freelance developer, on how to improve one specific Upwork proposal's cover letter and portfolio matching. You are having a conversation, not writing the letter yourself.

You will be given: the job post, the current cover letter, its quality score and flagged issues, the portfolio projects that were matched (with match tier/score), and recent chat history.

Your reply must be grounded in the specific job post and cover letter given — never generic advice. When you recommend a concrete fix, always offer it as a structured action so Bhanu can apply it with one click; never say ""I've updated X"" or ""I've added Y"" — you never write to anything directly.

Return ONLY valid JSON, no markdown fences, no commentary outside the JSON:
{
  ""reply"": ""your conversational response as plain text"",
  ""actions"": [
    { ""type"": ""regenerate"", ""label"": ""Regenerate cover letter"" },
    { ""type"": ""suggest_portfolio_project"", ""label"": ""Draft new portfolio project: <title>"", ""title"": ""..."", ""industry"": ""..."", ""tags"": [""...""], ""problem"": ""..."", ""solution"": ""..."", ""techStack"": ""...""},
    { ""type"": ""retag_project"", ""label"": ""Retag <project title> as <industry>"", ""projectId"": ""<guid from context>"", ""newTags"": [""...""], ""newIndustry"": ""...""}
  ]
}
""actions"" is optional — omit it (empty array) when you're just answering a question with no concrete change to propose. Only emit ""retag_project"" with a projectId that was actually given to you in context. Never invent a project id.";

    private static string BuildUserTurn(
        Proposal proposal,
        ProposalCompanyContext? company,
        ArtifactsResult existing,
        List<PortfolioService.PortfolioMatchInfo> matchInfos,
        List<ArtifactChatMessage> history,
        string userMessage)
    {
        var sb = new StringBuilder();
        sb.AppendLine("## JOB POST");
        if (!string.IsNullOrWhiteSpace(proposal.JobPostHeadline)) sb.AppendLine($"Headline: {proposal.JobPostHeadline}");
        sb.AppendLine(proposal.JobPostBody);

        if (company != null && !string.IsNullOrWhiteSpace(company.Industry))
            sb.AppendLine($"\nCLIENT INDUSTRY: {company.Industry}");

        sb.AppendLine("\n## CURRENT COVER LETTER");
        sb.AppendLine(existing.Ok && !string.IsNullOrWhiteSpace(existing.CoverLetter) ? existing.CoverLetter : "(none generated yet)");

        if (existing.CoverLetterScore.HasValue)
        {
            sb.AppendLine($"\n## QUALITY SCORE: {existing.CoverLetterScore}%");
            if (existing.CoverLetterScoreReasons?.Count > 0)
            {
                sb.AppendLine("FLAGGED ISSUES:");
                foreach (var r in existing.CoverLetterScoreReasons) sb.AppendLine($"- {r}");
            }
        }

        sb.AppendLine("\n## PORTFOLIO MATCH STATE");
        if (matchInfos.Count == 0)
        {
            sb.AppendLine("No portfolio project cleared the match threshold for this job.");
        }
        else
        {
            foreach (var m in matchInfos)
            {
                sb.AppendLine($"- \"{m.Project.Title}\" (id={m.Project.Id}) — industry: {m.Project.Industry}, tags: {string.Join(", ", m.Project.Tags)}, tier: {m.Tier}, score: {Math.Round(m.CombinedScore * 100)}%");
            }
        }

        if (history.Count > 0)
        {
            sb.AppendLine("\n## RECENT CHAT HISTORY");
            foreach (var h in history)
                sb.AppendLine($"{h.Role}: {h.Content}");
        }

        sb.AppendLine("\n## BHANU'S MESSAGE");
        sb.AppendLine(userMessage);

        return sb.ToString();
    }

    private static (string reply, List<ChatAction> actions) ParseAssistantResponse(string raw)
    {
        try
        {
            var clean = raw.Trim();
            if (clean.StartsWith("```")) { var i = clean.IndexOf('\n'); clean = clean[(i + 1)..]; }
            if (clean.EndsWith("```")) clean = clean[..clean.LastIndexOf("```")];
            var doc = JsonDocument.Parse(clean.Trim());
            var reply = doc.RootElement.TryGetProperty("reply", out var r) ? (r.GetString() ?? "") : clean;
            var actions = new List<ChatAction>();
            if (doc.RootElement.TryGetProperty("actions", out var actsEl) && actsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in actsEl.EnumerateArray())
                {
                    var action = new ChatAction
                    {
                        Type = a.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "",
                        Label = a.TryGetProperty("label", out var l) ? (l.GetString() ?? "") : "",
                        Title = a.TryGetProperty("title", out var ti) ? ti.GetString() : null,
                        Industry = a.TryGetProperty("industry", out var ind) ? ind.GetString() : null,
                        Problem = a.TryGetProperty("problem", out var pr) ? pr.GetString() : null,
                        Solution = a.TryGetProperty("solution", out var so) ? so.GetString() : null,
                        TechStack = a.TryGetProperty("techStack", out var ts) ? ts.GetString() : null,
                        NewIndustry = a.TryGetProperty("newIndustry", out var ni) ? ni.GetString() : null,
                    };
                    if (a.TryGetProperty("tags", out var tagsEl) && tagsEl.ValueKind == JsonValueKind.Array)
                        action.Tags = tagsEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != "").ToList();
                    if (a.TryGetProperty("newTags", out var newTagsEl) && newTagsEl.ValueKind == JsonValueKind.Array)
                        action.NewTags = newTagsEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != "").ToList();
                    if (a.TryGetProperty("projectId", out var pidEl) && pidEl.ValueKind == JsonValueKind.String
                        && Guid.TryParse(pidEl.GetString(), out var pid))
                        action.ProjectId = pid;
                    if (!string.IsNullOrWhiteSpace(action.Type)) actions.Add(action);
                }
            }
            return (reply, actions);
        }
        catch
        {
            return (raw, new List<ChatAction>());
        }
    }
}
