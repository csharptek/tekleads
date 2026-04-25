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
    public string[] Emails { get; set; } = Array.Empty<string>();
    public string[] Phones { get; set; } = Array.Empty<string>();
    public string? LinkedinUrl { get; set; }
    public DateTime SavedAt { get; set; } = DateTime.UtcNow;
}
