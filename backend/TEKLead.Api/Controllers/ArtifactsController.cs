using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;
using System.Linq;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/artifacts")]
public class ArtifactsController : ControllerBase
{
    private readonly ArtifactsService _svc;
    private readonly GraphEmailService _graphEmail;
    private readonly EmailSendQueueService _queue;

    public ArtifactsController(ArtifactsService svc, GraphEmailService graphEmail, EmailSendQueueService queue)
    {
        _svc = svc;
        _graphEmail = graphEmail;
        _queue = queue;
    }

    [HttpGet("prompts")]
    public IActionResult GetPrompts() => Ok(new
    {
        coverLetter = ArtifactsService.CoverLetterPrompt(),
        whatsapp    = ArtifactsService.WhatsappPrompt(),
        email       = ArtifactsService.EmailPrompt(),
        followUp1   = ArtifactsService.FollowUp1Prompt(),
        followUp2   = ArtifactsService.FollowUp2Prompt(),
    });

    [HttpGet("{proposalId}/debug-context")]
    public async Task<IActionResult> DebugContext(Guid proposalId)
    {
        var ctx = await _svc.GetDebugContext(proposalId);
        return Ok(ctx);
    }

    [HttpGet("{proposalId}")]
    public async Task<IActionResult> GetExisting(Guid proposalId)
    {
        var result = await _svc.GetExisting(proposalId);
        if (!result.Ok) return NotFound(new { error = result.Error });
        return Ok(result);
    }

    [HttpPost("{proposalId}/generate")]
    public async Task<IActionResult> Generate(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.Generate(proposalId, req?.Provider); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/cover-letter")]
    public async Task<IActionResult> GenerateCoverLetter(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateCoverLetter(proposalId, req?.CustomPrompt, req?.PortfolioIds, req?.Provider); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/whatsapp")]
    public async Task<IActionResult> GenerateWhatsapp(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateWhatsapp(proposalId, req?.CustomPrompt, req?.PortfolioIds, req?.Provider); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/email")]
    public async Task<IActionResult> GenerateEmail(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateEmail(proposalId, req?.CustomPrompt, req?.PortfolioIds, req?.Provider); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/followup1")]
    public async Task<IActionResult> GenerateFollowUp1(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateFollowUp1(proposalId, req?.CustomPrompt, req?.PortfolioIds, req?.Provider); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/followup2")]
    public async Task<IActionResult> GenerateFollowUp2(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateFollowUp2(proposalId, req?.CustomPrompt, req?.PortfolioIds, req?.Provider); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPatch("{proposalId}/artifact")]
    public async Task<IActionResult> SaveArtifact(Guid proposalId, [FromBody] SaveArtifactRequest req)
    {
        try
        {
            var (ok, error) = await _svc.SaveArtifact(proposalId, req.Field, req.Value ?? "");
            return ok ? Ok(new { ok }) : BadRequest(new { error });
        }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    // ── Bulk send via backend queue ───────────────────────────────────────────

    [HttpPost("{proposalId}/send-bulk")]
    public async Task<IActionResult> EnqueueBulk(Guid proposalId, [FromBody] BulkSendRequest req)
    {
        if (req.Recipients == null || req.Recipients.Count == 0)
            return BadRequest(new { error = "No recipients provided." });
        if (req.IntervalMinutes < 1) req.IntervalMinutes = 1;

        var list = req.Recipients.Select(r => (r.Email, r.Name ?? "")).ToList();

        FollowUpSpec? fu1 = null, fu2 = null, fu3 = null;
        if (req.FollowUp1 != null && !string.IsNullOrWhiteSpace(req.FollowUp1.Subject) && !string.IsNullOrWhiteSpace(req.FollowUp1.Body))
        {
            fu1 = new FollowUpSpec
            {
                Subject = req.FollowUp1.Subject!,
                Body = req.FollowUp1.Body!,
                DelayHours = req.FollowUp1.DelayHours > 0 ? req.FollowUp1.DelayHours : 6,
            };
        }
        if (req.FollowUp2 != null && !string.IsNullOrWhiteSpace(req.FollowUp2.Subject) && !string.IsNullOrWhiteSpace(req.FollowUp2.Body))
        {
            fu2 = new FollowUpSpec
            {
                Subject = req.FollowUp2.Subject!,
                Body = req.FollowUp2.Body!,
                DelayHours = req.FollowUp2.DelayHours > 0 ? req.FollowUp2.DelayHours : 12,
            };
        }
        if (req.FollowUp3 != null && !string.IsNullOrWhiteSpace(req.FollowUp3.Subject) && !string.IsNullOrWhiteSpace(req.FollowUp3.Body))
        {
            fu3 = new FollowUpSpec
            {
                Subject = req.FollowUp3.Subject!,
                Body = req.FollowUp3.Body!,
                DelayHours = req.FollowUp3.DelayHours > 0 ? req.FollowUp3.DelayHours : 24,
            };
        }

        string? attachmentPath = null;
        if (!string.IsNullOrWhiteSpace(req.AttachmentToken))
        {
            attachmentPath = LocalAttachmentStore.ResolvePath(req.AttachmentToken);
            if (attachmentPath == null)
                return BadRequest(new { error = "Attachment not found — please re-upload." });
        }

        await _queue.EnqueueBulk(proposalId, list, req.IntervalMinutes, fu1, fu2, fu3, req.Subject, req.Body,
            string.IsNullOrWhiteSpace(req.Channel) ? "graph" : req.Channel, attachmentPath);
        return Ok(new
        {
            queued = list.Count,
            intervalMinutes = req.IntervalMinutes,
            followUp1 = fu1 != null,
            followUp2 = fu2 != null,
            followUp3 = fu3 != null,
        });
    }

    [HttpPost("upload-attachment")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> UploadAttachment(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { error = "No file provided." });
        if (file.Length > 15_000_000) return BadRequest(new { error = "File too large (max 15MB)." });

        var token = await LocalAttachmentStore.SaveAsync(file);
        return Ok(new { token, fileName = file.FileName });
    }

    [HttpGet("{proposalId}/send-bulk/status")]
    public async Task<IActionResult> BulkStatus(Guid proposalId)
    {
        var jobs = await _queue.GetByProposal(proposalId);
        return Ok(jobs.Select(j => new
        {
            id            = j.Id,
            toEmail       = j.ToEmail,
            toName        = j.ToName,
            scheduledAt   = j.ScheduledAt,
            sentAt        = j.SentAt,
            status        = j.Status,
            error         = j.Error,
            followUpStage = j.FollowUpStage,
            subject       = j.Subject,
            body          = j.Body,
        }));
    }

    [HttpGet("quick-outreach/status")]
    public async Task<IActionResult> QuickOutreachStatus()
    {
        var gmailJobs = await _queue.GetByChannel("gmail_smtp");
        var graphJobs = await _queue.GetByChannel("graph");
        var jobs = gmailJobs.Concat(graphJobs).OrderByDescending(j => j.ScheduledAt);
        return Ok(jobs.Select(j => new
        {
            id            = j.Id,
            proposalId    = j.ProposalId,
            toEmail       = j.ToEmail,
            toName        = j.ToName,
            scheduledAt   = j.ScheduledAt,
            sentAt        = j.SentAt,
            status        = j.Status,
            error         = j.Error,
            followUpStage = j.FollowUpStage,
            subject       = j.Subject,
            hasAttachment = !string.IsNullOrWhiteSpace(j.AttachmentPath),
            channel       = j.Channel,
        }));
    }

    [HttpPost("quick-outreach/{proposalId}/cancel")]
    public async Task<IActionResult> CancelQuickOutreach(Guid proposalId)
    {
        await _queue.CancelPending(proposalId);
        return Ok(new { ok = true });
    }

    [HttpPost("{proposalId}/send-bulk/cancel")]
    public async Task<IActionResult> CancelBulk(Guid proposalId)
    {
        await _queue.CancelPending(proposalId);
        return Ok(new { cancelled = true });
    }

    // ── Cancel a single job ─────────────────────────────────────────────────

    [HttpPost("send-job/{jobId}/cancel")]
    public async Task<IActionResult> CancelJob(Guid jobId)
    {
        var ok = await _queue.CancelJob(jobId);
        if (!ok) return BadRequest(new { error = "Job not found or not pending." });
        return Ok(new { cancelled = true });
    }

    // ── Cancel follow-ups (all or by stage, optionally per-contact) ─────────

    [HttpPost("{proposalId}/send-bulk/cancel-followups")]
    public async Task<IActionResult> CancelFollowUps(Guid proposalId, [FromBody] CancelFollowUpsRequest req)
    {
        var count = await _queue.CancelFollowUps(proposalId, req.ContactEmail, req.Stage);
        return Ok(new { cancelled = count });
    }

    // ── Send Now for a specific job ──────────────────────────────────────────

    [HttpPost("send-job/{jobId}/send-now")]
    public async Task<IActionResult> SendJobNow(Guid jobId)
    {
        var ok = await _queue.SendNow(jobId);
        if (!ok) return BadRequest(new { error = "Job not found or not pending." });
        return Ok(new { sendNow = true });
    }
}

public class CustomPromptRequest  { public string? CustomPrompt { get; set; } public List<Guid>? PortfolioIds { get; set; } public string? Provider { get; set; } }
public class SaveArtifactRequest  { public string Field { get; set; } = ""; public string? Value { get; set; } }
public class SendEmailRequest     { public string ToEmail { get; set; } = ""; public string? ToName { get; set; } public string? Signature { get; set; } }
public class BulkSendRecipient    { public string Email { get; set; } = ""; public string? Name { get; set; } }
public class CancelFollowUpsRequest { public string? ContactEmail { get; set; } public int? Stage { get; set; } }

public class FollowUpRequest
{
    public string? Subject { get; set; }
    public string? Body { get; set; }
    public int DelayHours { get; set; }
}

public class BulkSendRequest
{
    public List<BulkSendRecipient> Recipients { get; set; } = new();
    public int IntervalMinutes { get; set; } = 5;
    public FollowUpRequest? FollowUp1 { get; set; }
    public FollowUpRequest? FollowUp2 { get; set; }
    public FollowUpRequest? FollowUp3 { get; set; }
    // Optional — when provided, used directly for the initial send instead of the proposal's generated artifact.
    public string? Subject { get; set; }
    public string? Body { get; set; }
    public string? Channel { get; set; } // "graph" (default) or "gmail_smtp"
    public string? AttachmentToken { get; set; } // returned by /api/artifacts/upload-attachment
}
