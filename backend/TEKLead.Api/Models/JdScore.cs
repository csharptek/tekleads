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
    public string? ExtractedClientName { get; set; }
    public string? ExtractedCompanyName { get; set; }
    public List<string> ClientNameCandidates { get; set; } = new();   // every distinct name found, most-mentioned first
    public List<string> CompanyNameCandidates { get; set; } = new();
    public string ExtractionSource { get; set; } = "";             // jd_text | comment | signature | testimonial | none
    public string ExtractionConfidence { get; set; } = "low";      // high | low
    public string? ContactLinkedinUrl { get; set; }
    public string ContactLinkedinSource { get; set; } = "none";    // apollo | none
    public double? EstimatedHoursMin { get; set; }
    public double? EstimatedHoursMax { get; set; }
    public string EstimateNotes { get; set; } = "";
    public DateTime AnalyzedAt { get; set; } = DateTime.UtcNow;

    // Contact-research panel — transient, not persisted (regenerated fresh on every Analyze() call).
    // Both lists are free/best-effort: ApolloCandidates comes only from the credit-free
    // mixed_people/api_search discovery endpoint; WebSearchCandidates only populates if
    // a Serper.dev key is configured in Settings. Neither ever costs Apollo credits.
    public List<ContactCandidate> ApolloCandidates { get; set; } = new();
    public List<ContactCandidate> WebSearchCandidates { get; set; } = new();
}

public class ContactCandidate
{
    public string Name { get; set; } = "";
    public string? Title { get; set; }
    public string? Company { get; set; }
    public string? LinkedinUrl { get; set; }
    public string? Snippet { get; set; }
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

    [JsonPropertyName("extracted_client_name")]
    public string? ExtractedClientName { get; set; }

    [JsonPropertyName("extracted_company_name")]
    public string? ExtractedCompanyName { get; set; }

    [JsonPropertyName("extracted_client_name_candidates")]
    public List<string>? ClientNameCandidates { get; set; }

    [JsonPropertyName("extracted_company_name_candidates")]
    public List<string>? CompanyNameCandidates { get; set; }

    [JsonPropertyName("extraction_source")]
    public string ExtractionSource { get; set; } = "none";

    [JsonPropertyName("extraction_confidence")]
    public string ExtractionConfidence { get; set; } = "low";
}
