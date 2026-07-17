namespace TEKLead.Api.Models;

public class JobLeadContact
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobLeadId { get; set; }
    public string? ApolloId { get; set; }
    public string Name { get; set; } = "";
    public string Title { get; set; } = "";
    public string? LinkedinUrl { get; set; }
    public string? Email { get; set; }
    public string Source { get; set; } = ""; // "poster" | "priority"
    public bool Selected { get; set; }
    public bool Enriched { get; set; }
    public int CreditsUsed { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class JobLeadContactWithLead : JobLeadContact
{
    public string LeadCompany { get; set; } = "";
    public string LeadJobTitle { get; set; } = "";
    public string LeadStatus { get; set; } = "";
}
