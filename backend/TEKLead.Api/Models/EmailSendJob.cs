namespace TEKLead.Api.Models;

public class EmailSendJob
{
    public Guid Id { get; set; }
    public Guid ProposalId { get; set; }
    public string ToEmail { get; set; } = "";
    public string ToName { get; set; } = "";
    public DateTime ScheduledAt { get; set; }
    public DateTime? SentAt { get; set; }
    public string Status { get; set; } = "pending"; // pending | sent | failed
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }
}
