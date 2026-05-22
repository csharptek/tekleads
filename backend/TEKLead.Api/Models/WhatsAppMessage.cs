namespace TEKLead.Api.Models;

public class WhatsAppMessage
{
    public string Id { get; set; } = "";
    public string? LeadId { get; set; }
    public string? ProposalId { get; set; }
    public string Direction { get; set; } = "outbound"; // outbound | inbound
    public string ToPhone { get; set; } = "";
    public string FromPhone { get; set; } = "";
    public string MessageType { get; set; } = "template"; // template | text
    public string? TemplateName { get; set; }
    public string? Body { get; set; }
    public string? Wamid { get; set; } // WhatsApp message id from Meta
    public string Status { get; set; } = "queued"; // queued | sent | delivered | read | failed | received
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public string? RawPayload { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class WhatsAppInboxThread
{
    public string Phone { get; set; } = "";
    public string? ContactName { get; set; }
    public string? LastMessage { get; set; }
    public string? LastTemplate { get; set; }
    public DateTime LastAt { get; set; }
    public int MessageCount { get; set; }
    public int UnreadCount { get; set; }
}
