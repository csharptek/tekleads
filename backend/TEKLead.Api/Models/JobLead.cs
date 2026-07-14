namespace TEKLead.Api.Models;

public class JobLead
{
    public Guid Id { get; set; }
    public Guid? RunId { get; set; }
    public string Company { get; set; } = "";
    public string Industry { get; set; } = "";
    public string CompanySize { get; set; } = "";
    public string Country { get; set; } = "";
    public string JobTitle { get; set; } = "";
    public string JobDescription { get; set; } = "";
    public string JobUrl { get; set; } = "";
    public string? PosterName { get; set; }
    public string? PosterTitle { get; set; }
    public string? PosterLinkedin { get; set; }
    public string Status { get; set; } = "scraped"; // scraped | enriched | email_ready | scheduled | sent | replied
    public string[] MatchedKeywords { get; set; } = Array.Empty<string>();
    public string[] MissedKeywords { get; set; } = Array.Empty<string>();
    public string? ApolloPersonId { get; set; }
    public string? ContactName { get; set; }
    public string? ContactTitle { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? ContactLinkedin { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? Fu1Subject { get; set; }
    public string? Fu1Body { get; set; }
    public string? Fu2Subject { get; set; }
    public string? Fu2Body { get; set; }
    public string? SenderEmail { get; set; }
    public DateTime ScrapedAt { get; set; }
    public DateTime SavedAt { get; set; }
    public DateTime? EnrichedAt { get; set; }
    public DateTime? EmailGeneratedAt { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? Fu1SentAt { get; set; }
    public DateTime? Fu2SentAt { get; set; }
    public DateTime? RepliedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<JobLeadEvent> Activity { get; set; } = new();
}

public class JobLeadEvent
{
    public Guid Id { get; set; }
    public Guid JobLeadId { get; set; }
    public string Label { get; set; } = "";
    public DateTime At { get; set; }
}

public class JobScraperRun
{
    public Guid Id { get; set; }
    public string[] Roles { get; set; } = Array.Empty<string>();
    public string Country { get; set; } = "";
    public string CompanySize { get; set; } = "";
    public int PostedWithinDays { get; set; }
    public string Status { get; set; } = "running"; // running | completed | failed
    public int LeadsFound { get; set; }
    public string? Error { get; set; }
    public string[] LogLines { get; set; } = Array.Empty<string>();
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

public class JobLeadListResult
{
    public List<JobLead> Leads { get; set; } = new();
    public int Total { get; set; }
}

public class JobLeadStats
{
    public int Scraped { get; set; }
    public int Enriched { get; set; }
    public int EmailReady { get; set; }
    public int Sent { get; set; }
    public int Replied { get; set; }
    public int NeedsFollowUp { get; set; }
}
