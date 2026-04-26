namespace TEKLead.Api.Models;

// ── Request DTOs ──────────────────────────────────────────────────────────────

public class GenerateProposalRequest
{
    /// <summary>Manually selected portfolio item IDs. If empty, RAG auto-selects.</summary>
    public Guid[]? SelectedPortfolioIds { get; set; }

    /// <summary>Per-proposal prompt override. If null, falls back to default prompt from settings.</summary>
    public string? CustomPrompt { get; set; }
}

public class RefineProposalRequest
{
    /// <summary>The refinement instruction e.g. "make it shorter", "add more about HIPAA"</summary>
    public string Instruction { get; set; } = "";

    /// <summary>Section labels that must not be modified during refinement.</summary>
    public string[]? LockedSections { get; set; }

    /// <summary>Prior AI conversation messages for context continuity.</summary>
    public ConversationMessage[]? ConversationHistory { get; set; }
}

public class ConversationMessage
{
    public string Role { get; set; } = "user"; // "user" | "assistant"
    public string Content { get; set; } = "";
    public string Timestamp { get; set; } = "";
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

public class ProposalGenerationResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? GeneratedText { get; set; }
    public PortfolioRef[]? PortfolioItemsUsed { get; set; }
    public QualityScoreResult? QualityScore { get; set; }
    public string? VersionLabel { get; set; }
}

public class PortfolioRef
{
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
}

public class QualityScoreResult
{
    public int Score { get; set; }
    public string Reason { get; set; } = "";
}

// ── DB Model ──────────────────────────────────────────────────────────────────

public class ProposalVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProposalId { get; set; }
    public string Label { get; set; } = "";
    public string Content { get; set; } = "";
    public string? Prompt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
