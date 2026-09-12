namespace TEKLead.Api.Models;

public class ArtifactChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProposalId { get; set; }
    public string Role { get; set; } = ""; // "user" | "assistant"
    public string Content { get; set; } = "";
    public string? ActionsJson { get; set; } // JSON array of ChatAction, assistant messages only
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ChatAction
{
    public string Type { get; set; } = ""; // regenerate | suggest_portfolio_project | retag_project
    public string Label { get; set; } = ""; // button text shown to user

    // suggest_portfolio_project
    public string? Title { get; set; }
    public string? Industry { get; set; }
    public List<string>? Tags { get; set; }
    public string? Problem { get; set; }
    public string? Solution { get; set; }
    public string? TechStack { get; set; }

    // retag_project
    public Guid? ProjectId { get; set; }
    public List<string>? NewTags { get; set; }
    public string? NewIndustry { get; set; }
}
