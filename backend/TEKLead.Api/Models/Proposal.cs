namespace TEKLead.Api.Models;

public class Proposal
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string JobPostHeadline { get; set; } = "";
    public string JobPostBody { get; set; } = "";
    public string ClientName { get; set; } = "";
    public string ClientCompany { get; set; } = "";
    public string ClientCountry { get; set; } = "";
    public string ClientCity { get; set; } = "";
    public string ClientEmail { get; set; } = "";
    public string ClientLinkedin { get; set; } = "";
    public string[] ClientQuestions { get; set; } = Array.Empty<string>();
    public string[] Links { get; set; } = Array.Empty<string>();
    public string[] LinkLabels { get; set; } = Array.Empty<string>();
    public string[] DocumentUrls { get; set; } = Array.Empty<string>();
    public string[] DocumentNames { get; set; } = Array.Empty<string>();
    public string? TimelineValue { get; set; }
    public string? TimelineUnit { get; set; }
    public decimal? BudgetMin { get; set; }
    public decimal? BudgetMax { get; set; }
    public decimal? FinalPrice { get; set; }
    public string Status { get; set; } = "draft";
    public string? LostReason { get; set; }
    public string? Notes { get; set; }
    public string? Tags { get; set; }
    public DateTime? FollowUpDate { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? WonAt { get; set; }
    public DateTime? LostAt { get; set; }
    public Guid? LinkedLeadId { get; set; }
    public string? ApolloContactJson { get; set; }
    public string? ContactsJson { get; set; }
    public string? GeneratedResponse { get; set; }
    // ── Generation fields ──
    public Guid[] SelectedPortfolioIds { get; set; } = Array.Empty<Guid>();
    public string? CustomPrompt { get; set; }
    public DateTime? GeneratedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
