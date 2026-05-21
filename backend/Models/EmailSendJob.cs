namespace TEKLead.Api.Models;

public class EmailSendJob
{
    public Guid Id { get; set; }
    public Guid ProposalId { get; set; }
    public string ToEmail { get; set; } = "";
    public string ToName { get; set; } = "";
    public DateTime ScheduledAt { get; set; }
    public DateTime? SentAt { get; set; }
    public string Status { get; set; } = "pending"; // pending | sent | failed | cancelled
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }

    // Follow-up support
    public int FollowUpStage { get; set; } = 0; // 0 = initial, 1 = FU1, 2 = FU2
    public string? Subject { get; set; }        // null for initial (uses artifact); set for FU1/FU2
    public string? Body { get; set; }           // null for initial (uses artifact); set for FU1/FU2
}
