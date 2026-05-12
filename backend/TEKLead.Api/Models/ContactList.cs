namespace TEKLead.Api.Models;

public class ContactList
{
    public Guid   Id          { get; set; }
    public string Title       { get; set; } = "";
    public int    Total       { get; set; }
    public int    Enriched    { get; set; }
    public int    NotEnriched { get; set; }
    public int    Failed      { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Contact
{
    public Guid   Id          { get; set; }
    public Guid   ListId      { get; set; }
    public string Name        { get; set; } = "";
    public string Title       { get; set; } = "";
    public string Company     { get; set; } = "";
    public string Location    { get; set; } = "";
    public string Email       { get; set; } = "";
    public string Phone       { get; set; } = "";
    public string LinkedinUrl { get; set; } = "";
    public string ApolloId    { get; set; } = "";
    // pending | enriched | failed
    public string EnrichStatus { get; set; } = "pending";
    public DateTime? EnrichedAt { get; set; }
    public DateTime  CreatedAt  { get; set; }
}

public class ContactTemplate
{
    public Guid   Id      { get; set; }
    public Guid   ListId  { get; set; }
    // email | whatsapp
    public string Type    { get; set; } = "email";
    public string Name    { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body    { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class ContactOutreachLog
{
    public Guid   Id         { get; set; }
    public Guid   ContactId  { get; set; }
    public Guid   ListId     { get; set; }
    // email | whatsapp
    public string Type       { get; set; } = "";
    public string Recipient  { get; set; } = "";
    public string Status     { get; set; } = "";
    public string? Error     { get; set; }
    public DateTime SentAt   { get; set; }
}
