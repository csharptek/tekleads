namespace TEKLead.Api.Models;

// ── LinkedIn engage module DTOs ─────────────────────────────────────────────

public class LiPerson
{
    public Guid LeadId { get; set; }
    public string Name { get; set; } = "";
    public string Title { get; set; } = "";
    public string Company { get; set; } = "";
    public string Industry { get; set; } = "";
    public string Location { get; set; } = "";
    public string? LinkedinUrl { get; set; }
    public string? PhotoUrl { get; set; }
    public string? Headline { get; set; }
    public DateTime SavedAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public string Stage { get; set; } = "";
    public DateTime? LastCommentAt { get; set; }
    public int CommentCount { get; set; }
    public bool HasBrief { get; set; }
}

public class LiEngagement
{
    public int Id { get; set; }
    public Guid LeadId { get; set; }
    public string Source { get; set; } = "comments"; // comments | conversations
    public string? PostUrl { get; set; }
    public string? PostText { get; set; }
    public string? Comment { get; set; }
    public string Status { get; set; } = "drafted"; // queued | batching | drafted | done | skipped | removed | failed
    public string? Problems { get; set; }
    public string? ContextUsed { get; set; }
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DoneAt { get; set; }
}

public class LiConvoReply
{
    public int Id { get; set; }
    public Guid LeadId { get; set; }
    public string Channel { get; set; } = "comment"; // comment | dm | other
    public string TheirText { get; set; } = "";
    public string? Suggestion { get; set; }
    public string? DmText { get; set; }
    public string? Action { get; set; }
    public string? Reason { get; set; }
    public string? MyReply { get; set; }
    public DateTime? PostedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class LiReminder
{
    public int Id { get; set; }
    public Guid LeadId { get; set; }
    public string Note { get; set; } = "";
    public DateTime DueAt { get; set; }
    public string Status { get; set; } = "open";
    public string? Name { get; set; }
}

public class LiCommentsState
{
    public int DoneToday { get; set; }
    public int NewTotal { get; set; }
    public int OldTotal { get; set; }
    public int NewPerPage { get; set; }
    public int OldPerDay { get; set; }
    public List<LiEngagement> InProgress { get; set; } = new();
    public List<LiPerson> InProgressPeople { get; set; } = new();
    public List<LiPerson> NewPeople { get; set; } = new();
    public List<LiPerson> OldPeople { get; set; } = new();
}

public class LiConvoCard
{
    public LiPerson Person { get; set; } = new();
    public List<LiEngagement> Comments { get; set; } = new();
    public LiEngagement? Draft { get; set; }
    public List<LiConvoReply> Thread { get; set; } = new();
    public LiReminder? Reminder { get; set; }
    public bool NeedsReply { get; set; }
    public DateTime Activity { get; set; }
}

public class LiConvoPage
{
    public int Total { get; set; }
    public int Page { get; set; }
    public int Pages { get; set; }
    public List<LiConvoCard> Cards { get; set; } = new();
    public List<LiReminder> DueReminders { get; set; } = new();
}

// ── Requests ───────────────────────────────────────────────────────────────

public class LiDraftCommentReq
{
    public Guid LeadId { get; set; }
    public string PostText { get; set; } = "";
    public string? PostUrl { get; set; }
    public string Source { get; set; } = "comments";
}

public class LiDraftAllReq
{
    public List<LiDraftCommentReq> Items { get; set; } = new();
}

public class LiDoneReq { public int Id { get; set; } public string? Comment { get; set; } }
public class LiIdReq { public int Id { get; set; } }
public class LiLeadReq { public Guid LeadId { get; set; } public string? Reason { get; set; } }
public class LiLogReplyReq { public Guid LeadId { get; set; } public string Channel { get; set; } = "comment"; public string TheirText { get; set; } = ""; }
public class LiPostedReq { public int Id { get; set; } public string? MyReply { get; set; } }
public class LiStageReq { public Guid LeadId { get; set; } public string Stage { get; set; } = ""; }
public class LiRemindReq { public Guid LeadId { get; set; } public int Days { get; set; } public string? Note { get; set; } }
public class LiSettingsSaveReq { public Dictionary<string, string?> Values { get; set; } = new(); }
