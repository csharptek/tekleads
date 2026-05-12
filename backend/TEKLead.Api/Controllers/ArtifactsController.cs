using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;

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
    });

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
        try { var r = await _svc.Generate(proposalId); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/cover-letter")]
    public async Task<IActionResult> GenerateCoverLetter(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateCoverLetter(proposalId, req?.CustomPrompt); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/whatsapp")]
    public async Task<IActionResult> GenerateWhatsapp(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateWhatsapp(proposalId, req?.CustomPrompt); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/email")]
    public async Task<IActionResult> GenerateEmail(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateEmail(proposalId, req?.CustomPrompt); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
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
        await _queue.EnqueueBulk(proposalId, list, req.IntervalMinutes);
        return Ok(new { queued = list.Count, intervalMinutes = req.IntervalMinutes });
    }

    [HttpGet("{proposalId}/send-bulk/status")]
    public async Task<IActionResult> BulkStatus(Guid proposalId)
    {
        var jobs = await _queue.GetByProposal(proposalId);
        return Ok(jobs.Select(j => new
        {
            id          = j.Id,
            toEmail     = j.ToEmail,
            toName      = j.ToName,
            scheduledAt = j.ScheduledAt,
            sentAt      = j.SentAt,
            status      = j.Status,
            error       = j.Error,
        }));
    }

    [HttpPost("{proposalId}/send-bulk/cancel")]
    public async Task<IActionResult> CancelBulk(Guid proposalId)
    {
        await _queue.CancelPending(proposalId);
        return Ok(new { cancelled = true });
    }
}

public class CustomPromptRequest  { public string? CustomPrompt { get; set; } }
public class SendEmailRequest     { public string ToEmail { get; set; } = ""; public string? ToName { get; set; } public string? Signature { get; set; } }
public class BulkSendRecipient    { public string Email { get; set; } = ""; public string? Name { get; set; } }
public class BulkSendRequest      { public List<BulkSendRecipient> Recipients { get; set; } = new(); public int IntervalMinutes { get; set; } = 5; }
