namespace TEKLead.Api.Models;

public class Lead
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? ApolloId { get; set; }
    public string Name { get; set; } = "";
    public string Title { get; set; } = "";
    public string Company { get; set; } = "";
    public string Industry { get; set; } = "";
    public string Location { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string Country { get; set; } = "";
    public string[] Emails { get; set; } = Array.Empty<string>();
    public string[] Phones { get; set; } = Array.Empty<string>();
    public string? LinkedinUrl { get; set; }
    public string? TwitterUrl { get; set; }
    public string? GithubUrl { get; set; }
    public string? FacebookUrl { get; set; }
    public string? PhotoUrl { get; set; }
    public string? Headline { get; set; }
    public string? Seniority { get; set; }
    public string? EmailStatus { get; set; }
    public string[] Departments { get; set; } = Array.Empty<string>();
    public DateTime SavedAt { get; set; } = DateTime.UtcNow;
    public LeadOrgDetails? OrgDetails { get; set; }
    public List<LeadEmploymentHistory> EmploymentHistory { get; set; } = new();
}

public class LeadOrgDetails
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid LeadId { get; set; }
    public string? OrgWebsiteUrl { get; set; }
    public string? OrgEstimatedEmployees { get; set; }
    public string? OrgAnnualRevenue { get; set; }
    public string? OrgFoundedYear { get; set; }
    public string? OrgLogoUrl { get; set; }
    public string? OrgLinkedinUrl { get; set; }
    public string? OrgPhone { get; set; }
    public string? OrgAddress { get; set; }
}

public class LeadEmploymentHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid LeadId { get; set; }
    public string? JobTitle { get; set; }
    public string? OrgName { get; set; }
    public string? StartDate { get; set; }
    public string? EndDate { get; set; }
    public bool IsCurrent { get; set; }
}
