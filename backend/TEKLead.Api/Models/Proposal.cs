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
    public string? TimelineValue { get; set; }
    public string? TimelineUnit { get; set; } // days, weeks, months
    public decimal? BudgetMin { get; set; }
    public decimal? BudgetMax { get; set; }
    public string Status { get; set; } = "draft"; // draft, sent, won, lost
    public Guid? LinkedLeadId { get; set; }
    public string? ApolloContactJson { get; set; }
    public string? GeneratedResponse { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
