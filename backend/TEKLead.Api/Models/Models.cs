namespace TEKLead.Api.Models;

public class Project
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public string Industry { get; set; } = "";
    public string[] Tags { get; set; } = Array.Empty<string>();
    public string Problem { get; set; } = "";
    public string Solution { get; set; } = "";
    public string TechStack { get; set; } = "";
    public string Outcomes { get; set; } = "";
    public string Links { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Lead
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Title { get; set; } = "";
    public string Company { get; set; } = "";
    public string Industry { get; set; } = "";
    public string Location { get; set; } = "";
    public string[] Emails { get; set; } = Array.Empty<string>();
    public string[] Phones { get; set; } = Array.Empty<string>();
    public string? LinkedinUrl { get; set; }
    public DateTime SavedAt { get; set; } = DateTime.UtcNow;
}

public class OutreachRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? LeadId { get; set; }
    public string LeadName { get; set; } = "";
    public string Channel { get; set; } = "";
    public string? Subject { get; set; }
    public string Body { get; set; } = "";
    public string Status { get; set; } = "sent";
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
}

public class AppSettings
{
    public string AzureOpenAiEndpoint { get; set; } = "";
    public string AzureOpenAiKey { get; set; } = "";
    public string AzureOpenAiDeployment { get; set; } = "gpt-4";
    public string AzureBlobConnectionString { get; set; } = "";
    public string ApolloApiKey { get; set; } = "";
    public string SendgridApiKey { get; set; } = "";
    public string SendgridFromEmail { get; set; } = "";
    public string TwilioAccountSid { get; set; } = "";
    public string TwilioAuthToken { get; set; } = "";
    public string TwilioWhatsappFrom { get; set; } = "";
    public string PgConnectionString { get; set; } = "";
}
