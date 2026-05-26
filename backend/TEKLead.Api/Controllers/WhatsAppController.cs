using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/whatsapp")]
public class WhatsAppController : ControllerBase
{
    private readonly WhatsAppCloudService _svc;
    private readonly SettingsService _settings;
    private readonly ILogger<WhatsAppController> _log;

    public WhatsAppController(WhatsAppCloudService svc, SettingsService settings, ILogger<WhatsAppController> log)
    {
        _svc = svc;
        _settings = settings;
        _log = log;
    }

    [HttpGet("version")]
    public IActionResult Version() => Ok(new { version = "whatsapp-cloud-v2-hr-inbox-20260525" });

    [HttpGet("status")]
    public async Task<IActionResult> Status() => Ok(await _svc.Status());

    // ─────────────────────────────────────────────
    // Send template
    // ─────────────────────────────────────────────
    [HttpPost("send-template")]
    public async Task<IActionResult> SendTemplate([FromBody] SendTemplateRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.To))
            return BadRequest(new { error = "'to' phone required" });

        var (ok, wamid, err, raw) = await _svc.SendTemplate(
            req.To, req.TemplateName, req.LanguageCode, req.BodyVariables, req.LeadId, req.ProposalId);

        if (!ok) return StatusCode(502, new { ok = false, error = err, raw });
        return Ok(new { ok = true, wamid, raw });
    }

    // ─────────────────────────────────────────────
    // Send free-form text (24hr window only)
    // ─────────────────────────────────────────────
    [HttpPost("send-text")]
    public async Task<IActionResult> SendText([FromBody] SendTextRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.To))
            return BadRequest(new { error = "'to' phone required" });
        if (string.IsNullOrWhiteSpace(req.Body))
            return BadRequest(new { error = "'body' required" });

        var (ok, wamid, err, raw) = await _svc.SendText(req.To, req.Body, req.LeadId, req.ProposalId);

        if (!ok) return StatusCode(502, new { ok = false, error = err, raw });
        return Ok(new { ok = true, wamid, raw });
    }

    // ─────────────────────────────────────────────
    // Send attachment
    // ─────────────────────────────────────────────
    [HttpPost("send-attachment")]
    public async Task<IActionResult> SendAttachment([FromBody] SendAttachmentRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.To))
            return BadRequest(new { error = "'to' phone required" });
        if (string.IsNullOrWhiteSpace(req.FileUrl))
            return BadRequest(new { error = "'fileUrl' required" });

        var (ok, wamid, err, raw) = await _svc.SendAttachment(
            req.To, req.FileUrl, req.AttachmentType ?? "document",
            req.Caption, req.Filename, req.LeadId, req.ProposalId);

        if (!ok) return StatusCode(502, new { ok = false, error = err, raw });
        return Ok(new { ok = true, wamid, raw });
    }

    // ─────────────────────────────────────────────
    // ─────────────────────────────────────────────
    [HttpGet("messages")]
    public async Task<IActionResult> Recent([FromQuery] int limit = 50)
        => Ok(await _svc.ListRecent(limit));

    [HttpGet("inbox")]
    public async Task<IActionResult> Inbox([FromQuery] string inbox = "sales")
        => Ok(await _svc.GetInbox(inbox));

    [HttpGet("conversation/{phone}")]
    public async Task<IActionResult> Conversation(string phone)
        => Ok(await _svc.GetConversation(phone));

    [HttpGet("lead/{leadId}/messages")]
    public async Task<IActionResult> ByLead(string leadId)
        => Ok(await _svc.ListByLead(leadId));

    // ─────────────────────────────────────────────
    // Webhook — Meta verification (GET)
    // ─────────────────────────────────────────────
    [HttpGet("webhook")]
    public async Task<IActionResult> WebhookVerify(
        [FromQuery(Name = "hub.mode")] string? mode,
        [FromQuery(Name = "hub.verify_token")] string? token,
        [FromQuery(Name = "hub.challenge")] string? challenge)
    {
        var all = await _settings.GetAll();
        var expected = all.GetValueOrDefault(SettingKeys.WhatsappCloudVerifyToken, "");

        _log.LogInformation("WA webhook verify: mode={Mode} tokenMatch={Match}",
            mode, !string.IsNullOrEmpty(expected) && token == expected);

        if (mode == "subscribe" && !string.IsNullOrEmpty(expected) && token == expected)
            return Content(challenge ?? "", "text/plain");

        return StatusCode(403, new { error = "verify_token_mismatch" });
    }

    // ─────────────────────────────────────────────
    // Webhook — events (POST)
    // ─────────────────────────────────────────────
    [HttpPost("webhook")]
    public async Task<IActionResult> WebhookEvent()
    {
        using var reader = new StreamReader(Request.Body);
        var raw = await reader.ReadToEndAsync();
        _log.LogInformation("WA webhook payload: {Raw}", raw);

        var (ok, note) = await _svc.IngestWebhook(raw);
        // Always 200 to Meta to avoid retries unless server error
        return Ok(new { ok, note });
    }
}

public class SendTemplateRequest
{
    public string To { get; set; } = "";
    public string? TemplateName { get; set; }
    public string? LanguageCode { get; set; }
    public List<string>? BodyVariables { get; set; }
    public string? LeadId { get; set; }
    public string? ProposalId { get; set; }
}

public class SendAttachmentRequest
{
    public string To { get; set; } = "";
    public string FileUrl { get; set; } = "";
    public string? AttachmentType { get; set; } // document | image | video | audio
    public string? Caption { get; set; }
    public string? Filename { get; set; }
    public string? LeadId { get; set; }
    public string? ProposalId { get; set; }
}

public class SendTextRequest
{
    public string To { get; set; } = "";
    public string Body { get; set; } = "";
    public string? LeadId { get; set; }
    public string? ProposalId { get; set; }
}
