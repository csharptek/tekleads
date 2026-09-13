using Dapper;
using Npgsql;
using System.Text.Json;
using TEKLead.Api.Models;
using TEKLead.Api.Services.Llm;

namespace TEKLead.Api.Services;

/// <summary>
/// JD Quality Score: LLM extracts facts from a job description, scoring is
/// deterministic (post-LLM) so it stays consistent and threshold changes
/// don't require a re-prompt. Score is 1-5, persisted per (entityType, entityId).
/// </summary>
public class JdQualityService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<JdQualityService> _log;

    // Built-in defaults — work out of the box, no manual settings entry required.
    public const int DefaultMinDurationWeeks = 4;
    public const decimal DefaultMinBudget = 1000m;

    public JdQualityService(SettingsService settings, IHttpClientFactory http, ILogger<JdQualityService> log)
    {
        _settings = settings;
        _http = http;
        _log = log;
    }

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) { _log.LogError("JdQuality: PG_CONNECTION_STRING not set."); return; }

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS jd_scores (
                id                      UUID PRIMARY KEY,
                entity_type             TEXT NOT NULL,
                entity_id               UUID NOT NULL,
                score                   INT NOT NULL,
                duration_signal         TEXT NOT NULL DEFAULT 'unclear',
                budget_mentioned        BOOLEAN NOT NULL DEFAULT FALSE,
                budget_amount           NUMERIC,
                timeline_pressure       TEXT NOT NULL DEFAULT 'unclear',
                has_screening_questions BOOLEAN NOT NULL DEFAULT FALSE,
                project_type            TEXT NOT NULL DEFAULT 'unclear',
                existing_subtype        TEXT,
                recommendation          TEXT NOT NULL DEFAULT '',
                analyzed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (entity_type, entity_id)
            )");
        _log.LogInformation("JdQuality schema OK.");
    }

    public async Task<(int MinDurationWeeks, decimal MinBudget)> GetThresholds()
    {
        var all = await _settings.GetAll();
        var durStr = all.GetValueOrDefault(SettingKeys.JdMinDurationWeeks, "");
        var budStr = all.GetValueOrDefault(SettingKeys.JdMinBudget, "");

        var dur = int.TryParse(durStr, out var d) && d > 0 ? d : DefaultMinDurationWeeks;
        var bud = decimal.TryParse(budStr, out var b) && b > 0 ? b : DefaultMinBudget;
        return (dur, bud);
    }

    public async Task<JdScoreResult> Analyze(string entityType, Guid entityId, string title, string description)
    {
        var (minWeeks, minBudget) = await GetThresholds();
        var settingsAll = await _settings.GetAll();

        var extraction = await ExtractViaLlm(settingsAll, title, description);
        var result = Score(extraction, minWeeks, minBudget);
        result.EntityType = entityType;
        result.EntityId = entityId;

        await Save(result);
        return result;
    }

    public async Task<JdScoreResult?> GetSaved(string entityType, Guid entityId)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return null;

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<JdScoreRow>(@"
            SELECT id AS ""Id"", entity_type AS ""EntityType"", entity_id AS ""EntityId"", score AS ""Score"",
                   duration_signal AS ""DurationSignal"", budget_mentioned AS ""BudgetMentioned"",
                   budget_amount AS ""BudgetAmount"", timeline_pressure AS ""TimelinePressure"",
                   has_screening_questions AS ""HasScreeningQuestions"", project_type AS ""ProjectType"",
                   existing_subtype AS ""ExistingSubtype"", recommendation AS ""Recommendation"",
                   analyzed_at AS ""AnalyzedAt""
            FROM jd_scores WHERE entity_type=@t AND entity_id=@i",
            new { t = entityType, i = entityId });

        return row == null ? null : row.ToResult();
    }

    private async Task Save(JdScoreResult r)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) throw new InvalidOperationException("PG_CONNECTION_STRING not set.");

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO jd_scores (id, entity_type, entity_id, score, duration_signal, budget_mentioned,
                budget_amount, timeline_pressure, has_screening_questions, project_type, existing_subtype,
                recommendation, analyzed_at)
            VALUES (@Id, @EntityType, @EntityId, @Score, @DurationSignal, @BudgetMentioned,
                @BudgetAmount, @TimelinePressure, @HasScreeningQuestions, @ProjectType, @ExistingSubtype,
                @Recommendation, @AnalyzedAt)
            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                score = EXCLUDED.score,
                duration_signal = EXCLUDED.duration_signal,
                budget_mentioned = EXCLUDED.budget_mentioned,
                budget_amount = EXCLUDED.budget_amount,
                timeline_pressure = EXCLUDED.timeline_pressure,
                has_screening_questions = EXCLUDED.has_screening_questions,
                project_type = EXCLUDED.project_type,
                existing_subtype = EXCLUDED.existing_subtype,
                recommendation = EXCLUDED.recommendation,
                analyzed_at = EXCLUDED.analyzed_at",
            r);
    }

    private async Task<JdExtraction> ExtractViaLlm(Dictionary<string, string> settings, string title, string description)
    {
        var prompt = $@"You extract structured facts from a freelance job post. Output ONLY valid JSON, no markdown fences, no commentary.

Job Title: {title}
Job Description:
{description}

Return JSON with exactly these fields:
{{
  ""duration_signal"": ""long_term"" | ""short_term"" | ""unclear"",
  ""budget_mentioned"": true | false,
  ""budget_amount"": <number or null>,
  ""timeline_pressure"": ""urgent"" | ""flexible"" | ""unclear"",
  ""has_screening_questions"": true | false,
  ""project_type"": ""new_build"" | ""existing"" | ""unclear"",
  ""existing_subtype"": ""feature_add"" | ""troubleshooting"" | null
}}

Rules:
- duration_signal: long_term if the post implies an ongoing/multi-week/multi-month engagement or long-term relationship; short_term if it reads as a one-time/quick task; unclear if not stated.
- budget_amount: extract the number only if an explicit dollar figure or range is given (use the higher end of a range). Null if not mentioned.
- timeline_pressure: urgent if the client stresses a tight deadline or ASAP language; flexible if timeline is open/relaxed; unclear otherwise.
- has_screening_questions: true if the post asks the applicant to answer specific questions in their proposal.
- project_type: new_build if this is a from-scratch project; existing if it's about an existing/live product or codebase.
- existing_subtype: only set when project_type is ""existing"" — feature_add if adding new functionality, troubleshooting if fixing bugs/issues/errors. Null otherwise.";

        var messages = new List<object>
        {
            new { role = "system", content = "You are a precise information-extraction engine. Always respond with strictly valid JSON matching the requested schema. No prose." },
            new { role = "user", content = prompt }
        };

        var raw = await LlmClient.ChatAsync(_http, settings, messages, maxTokens: 500);
        var cleaned = raw.Trim();
        if (cleaned.StartsWith("```"))
        {
            var firstNl = cleaned.IndexOf('\n');
            cleaned = firstNl >= 0 ? cleaned[(firstNl + 1)..] : cleaned;
            var lastFence = cleaned.LastIndexOf("```");
            if (lastFence >= 0) cleaned = cleaned[..lastFence];
        }

        try
        {
            var extraction = JsonSerializer.Deserialize<JdExtraction>(cleaned, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return extraction ?? new JdExtraction();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "JdQuality: failed to parse LLM JSON, raw={0}", raw);
            return new JdExtraction();
        }
    }

    private JdScoreResult Score(JdExtraction e, int minWeeks, decimal minBudget)
    {
        decimal score = 3m;

        if (e.DurationSignal == "long_term") score += 1;
        else if (e.DurationSignal == "short_term") score -= 1;

        if (e.BudgetMentioned && e.BudgetAmount.HasValue)
        {
            if (e.BudgetAmount.Value >= minBudget) score += 1;
            else score -= 1;
        }

        if (e.TimelinePressure == "urgent") score -= 0.5m;

        if (e.ProjectType == "new_build") score += 0.5m;
        else if (e.ProjectType == "existing" && e.ExistingSubtype == "troubleshooting") score -= 0.5m;

        var finalScore = (int)Math.Round(Math.Clamp(score, 1m, 5m), MidpointRounding.AwayFromZero);

        string recommendation = finalScore switch
        {
            >= 4 => "Strong fit — long-term, good budget.",
            3 => "Moderate — review details.",
            _ => "Low priority — short-term/low-budget/troubleshooting.",
        };

        if (e.ExistingSubtype == "troubleshooting")
            recommendation += " Flag: this looks like a troubleshooting/bug-fix job, not new development.";

        return new JdScoreResult
        {
            Score = finalScore,
            DurationSignal = e.DurationSignal,
            BudgetMentioned = e.BudgetMentioned,
            BudgetAmount = e.BudgetAmount,
            TimelinePressure = e.TimelinePressure,
            HasScreeningQuestions = e.HasScreeningQuestions,
            ProjectType = e.ProjectType,
            ExistingSubtype = e.ExistingSubtype,
            Recommendation = recommendation,
            AnalyzedAt = DateTime.UtcNow,
        };
    }

    private class JdScoreRow
    {
        public Guid Id { get; set; }
        public string EntityType { get; set; } = "";
        public Guid EntityId { get; set; }
        public int Score { get; set; }
        public string DurationSignal { get; set; } = "";
        public bool BudgetMentioned { get; set; }
        public decimal? BudgetAmount { get; set; }
        public string TimelinePressure { get; set; } = "";
        public bool HasScreeningQuestions { get; set; }
        public string ProjectType { get; set; } = "";
        public string? ExistingSubtype { get; set; }
        public string Recommendation { get; set; } = "";
        public DateTime AnalyzedAt { get; set; }

        public JdScoreResult ToResult() => new()
        {
            Id = Id, EntityType = EntityType, EntityId = EntityId, Score = Score,
            DurationSignal = DurationSignal, BudgetMentioned = BudgetMentioned, BudgetAmount = BudgetAmount,
            TimelinePressure = TimelinePressure, HasScreeningQuestions = HasScreeningQuestions,
            ProjectType = ProjectType, ExistingSubtype = ExistingSubtype, Recommendation = Recommendation,
            AnalyzedAt = AnalyzedAt,
        };
    }
}
