using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.DTOs;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/outreach")]
public class OutreachController : ControllerBase
{
    private readonly OutreachService _outreach;
    private readonly DbService _db;

    public OutreachController(OutreachService outreach, DbService db) { _outreach = outreach; _db = db; }

    [HttpPost("email")]
    public async Task<IActionResult> SendEmail([FromBody] SendEmailRequest request)
    {
        if (!Guid.TryParse(request.LeadId, out var leadId)) return BadRequest("Invalid lead id");
        var lead = await _db.GetLeadById(leadId);
        if (lead == null) return NotFound("Lead not found");
        if (lead.Emails == null || lead.Emails.Length == 0) return BadRequest("Lead has no email");
        var toEmail = lead.Emails[0];

        var record = new OutreachRecord
        {
            LeadId = lead.Id, LeadName = lead.Name,
            Channel = "email", Subject = request.Subject, Body = request.Body,
        };

        try { await _outreach.SendEmail(toEmail, lead.Name, request.Subject, request.Body); }
        catch (Exception ex) { record.Status = "failed"; await _db.InsertOutreach(record); return StatusCode(500, ex.Message); }

        return Ok(await _db.InsertOutreach(record));
    }

    [HttpPost("whatsapp")]
    public async Task<IActionResult> SendWhatsApp([FromBody] SendWhatsAppRequest request)
    {
        var record = new OutreachRecord { LeadName = request.To, Channel = "whatsapp", Body = request.Message };

        try { await _outreach.SendWhatsApp(request.To, request.Message); }
        catch (Exception ex) { record.Status = "failed"; await _db.InsertOutreach(record); return StatusCode(500, ex.Message); }

        return Ok(await _db.InsertOutreach(record));
    }

    [HttpGet("history")]
    public async Task<IActionResult> GetHistory() => Ok(await _db.GetOutreachHistory());
}
