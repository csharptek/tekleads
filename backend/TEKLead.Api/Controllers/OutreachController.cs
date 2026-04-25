using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.DTOs;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/outreach")]
public class OutreachController : ControllerBase
{
    private readonly GraphEmailService _graph;
    private readonly WhatsAppService _whatsapp;
    private readonly DbService _db;
    private readonly ILogger<OutreachController> _logger;

    public OutreachController(GraphEmailService graph, WhatsAppService whatsapp, DbService db, ILogger<OutreachController> logger)
    {
        _graph = graph;
        _whatsapp = whatsapp;
        _db = db;
        _logger = logger;
    }

    [HttpPost("email")]
    public async Task<IActionResult> SendEmail([FromBody] SendEmailRequest request)
    {
        if (!Guid.TryParse(request.LeadId, out var leadId)) return BadRequest(new { error = "Invalid lead id" });
        var lead = await _db.GetLeadById(leadId);
        if (lead == null) return NotFound(new { error = "Lead not found" });
        if (lead.Emails == null || lead.Emails.Length == 0) return BadRequest(new { error = "Lead has no email" });

        var toEmail = lead.Emails[0];
        var record = new OutreachRecord
        {
            LeadId = lead.Id,
            LeadName = lead.Name,
            Channel = "email",
            Subject = request.Subject,
            Body = request.Body,
            Status = "sent"
        };

        try
        {
            await _graph.SendEmail(toEmail, lead.Name, request.Subject, request.Body);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Email send failed for lead {0}", leadId);
            record.Status = "failed";
            await _db.InsertOutreach(record);
            return StatusCode(500, new { error = ex.Message });
        }

        return Ok(await _db.InsertOutreach(record));
    }

    /// <summary>
    /// Builds wa.me link. Does NOT send — caller opens the URL.
    /// Optionally logs the outreach as "queued" so it shows in history.
    /// </summary>
    [HttpPost("whatsapp")]
    public async Task<IActionResult> WhatsAppLink([FromBody] SendWhatsAppRequest request)
    {
        if (!Guid.TryParse(request.LeadId, out var leadId)) return BadRequest(new { error = "Invalid lead id" });
        var lead = await _db.GetLeadById(leadId);
        if (lead == null) return NotFound(new { error = "Lead not found" });

        var phone = lead.Phones != null && lead.Phones.Length > 0 ? lead.Phones[0] : null;
        if (string.IsNullOrEmpty(phone))
            return BadRequest(new { error = "Lead has no phone number" });

        try
        {
            var (url, number) = await _whatsapp.BuildLink(phone, request.Message);

            await _db.InsertOutreach(new OutreachRecord
            {
                LeadId = lead.Id,
                LeadName = lead.Name,
                Channel = "whatsapp",
                Body = request.Message,
                Status = "queued"
            });

            return Ok(new WhatsAppLinkResponse(url, number));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WhatsApp link build failed for lead {0}", leadId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("history")]
    public async Task<IActionResult> GetHistory() => Ok(await _db.GetOutreachHistory());
}
