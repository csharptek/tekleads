using System.Text.Json.Serialization;

namespace TEKLead.Api.Models;

public class JdScoreResult
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EntityType { get; set; } = ""; // "proposal" | "job_lead"
    public Guid EntityId { get; set; }
    public int Score { get; set; }
    public string DurationSignal { get; set; } = "unclear";       // long_term | short_term | unclear
    public bool BudgetMentioned { get; set; }
    public decimal? BudgetAmount { get; set; }
    public string TimelinePressure { get; set; } = "unclear";     // urgent | flexible | unclear
    public bool HasScreeningQuestions { get; set; }
    public string ProjectType { get; set; } = "unclear";          // new_build | existing | unclear
    public string? ExistingSubtype { get; set; }                  // feature_add | troubleshooting | null
    public string Recommendation { get; set; } = "";
    public double? EstimatedHoursMin { get; set; }
    public double? EstimatedHoursMax { get; set; }
    public string EstimateNotes { get; set; } = "";
    public DateTime AnalyzedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Raw structured fields the LLM extracts. Scoring is computed separately, deterministically.</summary>
public class JdExtraction
{
    [JsonPropertyName("duration_signal")]
    public string DurationSignal { get; set; } = "unclear";

    [JsonPropertyName("budget_mentioned")]
    public bool BudgetMentioned { get; set; }

    [JsonPropertyName("budget_amount")]
    public decimal? BudgetAmount { get; set; }

    [JsonPropertyName("timeline_pressure")]
    public string TimelinePressure { get; set; } = "unclear";

    [JsonPropertyName("has_screening_questions")]
    public bool HasScreeningQuestions { get; set; }

    [JsonPropertyName("project_type")]
    public string ProjectType { get; set; } = "unclear";

    [JsonPropertyName("existing_subtype")]
    public string? ExistingSubtype { get; set; }

    [JsonPropertyName("estimated_hours_min")]
    public double? EstimatedHoursMin { get; set; }

    [JsonPropertyName("estimated_hours_max")]
    public double? EstimatedHoursMax { get; set; }

    [JsonPropertyName("estimate_notes")]
    public string EstimateNotes { get; set; } = "";
}
