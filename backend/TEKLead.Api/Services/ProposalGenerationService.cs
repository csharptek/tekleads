using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProposalGenerationService
{
    private readonly SettingsService _settings;
    private readonly PortfolioService _portfolio;
    private readonly ProposalService _proposals;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ProposalGenerationService> _log;

    public ProposalGenerationService(
        SettingsService settings,
        PortfolioService portfolio,
        ProposalService proposals,
        IHttpClientFactory http,
        ILogger<ProposalGenerationService> log)
    {
        _settings = settings;
        _portfolio = portfolio;
        _proposals = proposals;
        _http = http;
        _log = log;
    }

    // ── Generate ──────────────────────────────────────────────────────────────

    public async Task<ProposalGenerationResult> Generate(Guid proposalId, GenerateProposalRequest req)
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

        // 1. Pull portfolio context (RAG)
        List<PortfolioProject> portfolioItems;
        if (req.SelectedPortfolioIds?.Length > 0)
        {
            // User manually selected items
            portfolioItems = new List<PortfolioProject>();
            foreach (var pid in req.SelectedPortfolioIds)
            {
                var item = await _portfolio.GetById(pid);
                if (item != null) portfolioItems.Add(item);
            }
        }
        else
        {
            // Auto-select via vector similarity search
            var query = $"{proposal.JobPostHeadline} {proposal.JobPostBody}".Trim();
            if (query.Length > 500) query = query[..500];
            portfolioItems = await _portfolio.SearchSimilar(query, topK: 3);

            // Fallback: get all indexed if search returns nothing
            if (portfolioItems.Count == 0)
            {
                var all = await _portfolio.GetAll();
                portfolioItems = all.Where(p => p.EmbeddingIndexed).Take(3).ToList();
            }
        }

        // 2. Build the system prompt
        var systemPrompt = BuildSystemPrompt(req.CustomPrompt, settings);

        // 3. Build the user message with full context
        var userMessage = BuildUserMessage(proposal, portfolioItems, req);

        // 4. Call Azure OpenAI
        string generatedText;
        try
        {
            generatedText = await CallAzureOpenAI(aoEndpoint, aoKey, aoDeployment, systemPrompt, userMessage);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "OpenAI call failed for proposal {0}", proposalId);
            return Fail($"AI generation failed: {ex.Message}");
        }

        // 5. Score the proposal (optional — separate lightweight call)
        var score = await ScoreProposal(aoEndpoint, aoKey, aoDeployment, generatedText, proposal.JobPostBody);

        // 6. Save generated text + selected portfolio IDs to proposal
        proposal.GeneratedResponse = generatedText;
        proposal.SelectedPortfolioIds = req.SelectedPortfolioIds ?? portfolioItems.Select(p => p.Id).ToArray();
        proposal.CustomPrompt = req.CustomPrompt;
        proposal.GeneratedAt = DateTime.UtcNow;
        await _proposals.Upsert(proposal);

        // 7. Save to generation history
        await SaveVersion(proposalId, generatedText, req.CustomPrompt, systemPrompt);

        return new ProposalGenerationResult
        {
            Ok = true,
            GeneratedText = generatedText,
            PortfolioItemsUsed = portfolioItems.Select(p => new PortfolioRef { Id = p.Id, Title = p.Title }).ToArray(),
            QualityScore = score,
            VersionLabel = $"v{await GetVersionCount(proposalId)} — Generated",
        };
    }

    // ── Refine ────────────────────────────────────────────────────────────────

    public async Task<ProposalGenerationResult> Refine(Guid proposalId, RefineProposalRequest req)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null) return Fail("Proposal not found.");

        if (string.IsNullOrWhiteSpace(proposal.GeneratedResponse))
            return Fail("No generated proposal to refine. Generate first.");

        var settings = await _settings.GetAll();
        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment))
            return Fail("Azure OpenAI not configured in Settings.");

        // Build locked sections instruction
        var lockedInstruction = req.LockedSections?.Length > 0
            ? $"\n\nIMPORTANT: Do NOT change these sections — keep them exactly as written: {string.Join(", ", req.LockedSections)}."
            : "";

        var systemPrompt = $@"You are a professional proposal editor. The user will provide an existing proposal and an instruction for how to modify it.
Apply the instruction carefully and return the full revised proposal.
Keep the overall structure and formatting intact unless instructed otherwise.{lockedInstruction}
Return only the proposal text — no preamble, no explanation.";

        // Build conversation history for context
        var messages = new List<object>
        {
            new { role = "system", content = systemPrompt }
        };

        // Include prior conversation history
        if (req.ConversationHistory?.Length > 0)
        {
            foreach (var msg in req.ConversationHistory.TakeLast(6)) // cap at last 6 exchanges
                messages.Add(new { role = msg.Role, content = msg.Content });
        }

        // Current turn
        messages.Add(new
        {
            role = "user",
            content = $"Here is the current proposal:\n\n{proposal.GeneratedResponse}\n\n---\n\nInstruction: {req.Instruction}"
        });

        string refinedText;
        try
        {
            refinedText = await CallAzureOpenAIMessages(aoEndpoint, aoKey, aoDeployment, messages);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Refine call failed for proposal {0}", proposalId);
            return Fail($"AI refinement failed: {ex.Message}");
        }

        // Save
        proposal.GeneratedResponse = refinedText;
        await _proposals.Upsert(proposal);
        await SaveVersion(proposalId, refinedText, null, req.Instruction);

        var score = await ScoreProposal(aoEndpoint, aoKey, aoDeployment, refinedText, proposal.JobPostBody);

        return new ProposalGenerationResult
        {
            Ok = true,
            GeneratedText = refinedText,
            QualityScore = score,
            VersionLabel = $"v{await GetVersionCount(proposalId)} — \"{req.Instruction.Truncate(25)}\"",
        };
    }

    // ── History ───────────────────────────────────────────────────────────────

    public async Task<List<ProposalVersion>> GetVersions(Guid proposalId)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM proposal_versions WHERE proposal_id=@id ORDER BY created_at ASC", new { id = proposalId });
        return rows.Select(r => new ProposalVersion
        {
            Id = r.id, ProposalId = r.proposal_id, Label = r.label ?? "",
            Content = r.content ?? "", Prompt = r.prompt, CreatedAt = r.created_at,
        }).ToList();
    }

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS proposal_versions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                proposal_id UUID NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                prompt TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_pv_proposal ON proposal_versions(proposal_id)");

        // Migrations on proposals table
        var migrations = new[]
        {
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS selected_portfolio_ids UUID[] NOT NULL DEFAULT '{}'",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS custom_prompt TEXT",
            "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ",
        };
        foreach (var m in migrations)
        {
            try { await c.ExecuteAsync(m); } catch { }
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private string BuildSystemPrompt(string? customPrompt, Dictionary<string, string> settings)
    {
        // Priority: per-proposal custom prompt > default from proposal_settings > hardcoded default
        if (!string.IsNullOrWhiteSpace(customPrompt))
            return customPrompt;

        var defaultPrompt = settings.GetValueOrDefault("proposal_default_prompt", "");
        if (!string.IsNullOrWhiteSpace(defaultPrompt))
            return defaultPrompt;

        return @"You are a professional proposal writer for a software development company.

Generate a compelling, personalized proposal based on the client's job post, their questions, and the company's relevant portfolio projects.

Guidelines:
- Write in a professional but approachable tone
- Reference specific portfolio projects by name and include their links/demo URLs
- Include a clear project scope breakdown with numbered phases or sprints
- Add a timeline table using the provided timeline if given
- Address each client question directly if provided
- End with a strong ""Why Us"" section that references the portfolio
- Use markdown formatting with headers and tables
- Keep total length between 800–1400 words
- Return only the proposal text — no preamble, no explanation
- CRITICAL: Never mention, reference, or repeat the client's stated budget or budget range anywhere in the proposal. Do not include lines like "Within your stated range of..." or any budget allocation breakdown referencing their budget. The pricing section should present your value and price independently.";
    }

    private string BuildUserMessage(Proposal p, List<PortfolioProject> portfolio, GenerateProposalRequest req)
    {
        var sb = new StringBuilder();

        sb.AppendLine("## CLIENT JOB POST");
        if (!string.IsNullOrWhiteSpace(p.JobPostHeadline))
            sb.AppendLine($"**Headline:** {p.JobPostHeadline}");
        sb.AppendLine(p.JobPostBody);

        sb.AppendLine("\n## CLIENT INFORMATION");
        if (!string.IsNullOrWhiteSpace(p.ClientName)) sb.AppendLine($"Name: {p.ClientName}");
        if (!string.IsNullOrWhiteSpace(p.ClientCompany)) sb.AppendLine($"Company: {p.ClientCompany}");
        if (!string.IsNullOrWhiteSpace(p.ClientCity) || !string.IsNullOrWhiteSpace(p.ClientCountry))
            sb.AppendLine($"Location: {string.Join(", ", new[] { p.ClientCity, p.ClientCountry }.Where(s => !string.IsNullOrEmpty(s)))}");

        if (p.ClientQuestions?.Length > 0)
        {
            sb.AppendLine("\n## CLIENT QUESTIONS");
            foreach (var q in p.ClientQuestions.Where(q => !string.IsNullOrWhiteSpace(q)))
                sb.AppendLine($"- {q}");
        }

        sb.AppendLine("\n## PROJECT PARAMETERS");
        if (!string.IsNullOrWhiteSpace(p.TimelineValue))
            sb.AppendLine($"Timeline: {p.TimelineValue} {p.TimelineUnit}");
        if (p.BudgetMin.HasValue || p.BudgetMax.HasValue)
        {
            var budgetStr = (p.BudgetMin.HasValue && p.BudgetMax.HasValue)
                ? $"${p.BudgetMin:N0} – ${p.BudgetMax:N0} USD"
                : $"${(p.BudgetMin ?? p.BudgetMax):N0} USD";
            sb.AppendLine($"Budget: {budgetStr}");
        }

        if (p.Links?.Length > 0)
        {
            var validLinks = p.Links.Where(l => !string.IsNullOrWhiteSpace(l)).ToArray();
            if (validLinks.Length > 0)
            {
                sb.AppendLine("\n## CLIENT-PROVIDED LINKS");
                for (int i = 0; i < validLinks.Length; i++)
                {
                    var label = p.LinkLabels?.Length > i ? p.LinkLabels[i] : "";
                    sb.AppendLine($"- {(string.IsNullOrWhiteSpace(label) ? validLinks[i] : $"{label}: {validLinks[i]}")}");
                }
            }
        }

        if (portfolio.Count > 0)
        {
            sb.AppendLine("\n## OUR RELEVANT PORTFOLIO PROJECTS (include references to these)");
            foreach (var proj in portfolio)
            {
                sb.AppendLine($"\n### {proj.Title}");
                if (!string.IsNullOrWhiteSpace(proj.Industry)) sb.AppendLine($"Industry: {proj.Industry}");
                if (proj.Tags?.Length > 0) sb.AppendLine($"Tags: {string.Join(", ", proj.Tags)}");
                if (!string.IsNullOrWhiteSpace(proj.Problem)) sb.AppendLine($"Problem: {proj.Problem}");
                if (!string.IsNullOrWhiteSpace(proj.Solution)) sb.AppendLine($"Solution: {proj.Solution}");
                if (!string.IsNullOrWhiteSpace(proj.TechStack)) sb.AppendLine($"Tech Stack: {proj.TechStack}");
                if (!string.IsNullOrWhiteSpace(proj.Outcomes)) sb.AppendLine($"Outcomes: {proj.Outcomes}");
                if (!string.IsNullOrWhiteSpace(proj.Links))
                {
                    sb.AppendLine("Links:");
                    foreach (var link in proj.Links.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                        sb.AppendLine($"  - {link.Trim()}");
                }
            }
        }

        sb.AppendLine("\n---");
        sb.AppendLine("Now write a complete, professional proposal using the above context.");

        return sb.ToString();
    }

    private async Task<string> CallAzureOpenAI(string endpoint, string key, string deployment, string system, string user)
    {
        return await CallAzureOpenAIMessages(endpoint, key, deployment, new List<object>
        {
            new { role = "system", content = system },
            new { role = "user",   content = user   },
        });
    }

    private async Task<string> CallAzureOpenAIMessages(string endpoint, string key, string deployment, List<object> messages)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);
        client.Timeout = TimeSpan.FromSeconds(120);

        var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-02-01";
        var body = JsonSerializer.Serialize(new { messages, max_completion_tokens = 2500 });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"OpenAI {(int)resp.StatusCode}: {json}");

        var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    private async Task<QualityScoreResult?> ScoreProposal(string endpoint, string key, string deployment, string proposalText, string jobPost)
    {
        try
        {
            var prompt = $@"Rate this proposal on a scale of 1-10 and give a one-sentence reason. 
Job Post: {jobPost.Truncate(300)}
Proposal (first 800 chars): {proposalText.Truncate(800)}

Respond ONLY with valid JSON: {{""score"": 8, ""reason"": ""one sentence""}}";

            var result = await CallAzureOpenAI(endpoint, key, deployment,
                "You are a proposal quality assessor. Respond only with JSON.",
                prompt);

            result = result.Trim();
            if (result.StartsWith("```")) result = result.Split('\n', 2)[1];
            if (result.EndsWith("```")) result = result[..result.LastIndexOf("```")];

            var doc = JsonDocument.Parse(result.Trim());
            return new QualityScoreResult
            {
                Score = doc.RootElement.GetProperty("score").GetInt32(),
                Reason = doc.RootElement.GetProperty("reason").GetString() ?? "",
            };
        }
        catch (Exception ex)
        {
            _log.LogWarning("Score call failed: {0}", ex.Message);
            return null;
        }
    }

    private async Task SaveVersion(Guid proposalId, string content, string? prompt, string? label)
    {
        try
        {
            var count = await GetVersionCount(proposalId);
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            await c.ExecuteAsync(
                "INSERT INTO proposal_versions (proposal_id, label, content, prompt) VALUES (@pid, @label, @content, @prompt)",
                new { pid = proposalId, label = $"v{count + 1}{(label != null ? $" — {label.Truncate(30)}" : "")}", content, prompt });
        }
        catch (Exception ex) { _log.LogWarning("SaveVersion failed: {0}", ex.Message); }
    }

    private async Task<int> GetVersionCount(Guid proposalId)
    {
        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            return await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM proposal_versions WHERE proposal_id=@id", new { id = proposalId });
        }
        catch { return 0; }
    }

    private static ProposalGenerationResult Fail(string msg) => new() { Ok = false, Error = msg };
}

// ── Extension ─────────────────────────────────────────────────────────────────

public static class StringExtensions
{
    public static string Truncate(this string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";
}
