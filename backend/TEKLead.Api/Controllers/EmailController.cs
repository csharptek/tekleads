using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.DTOs;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/email")]
public class EmailController : ControllerBase
{
    private readonly EmailAiService _ai;
    private readonly DbService _db;

    public EmailController(EmailAiService ai, DbService db) { _ai = ai; _db = db; }

    [HttpPost("generate")]
    public async Task<IActionResult> Generate([FromBody] EmailGenerateRequest request)
    {
        if (!Guid.TryParse(request.LeadId, out var leadId)) return BadRequest("Invalid lead id");
        var lead = await _db.GetLeadById(leadId);
        if (lead == null) return NotFound("Lead not found");

        var (subject, body) = await _ai.GenerateEmail(lead, request.AdditionalContext, request.Tone);
        return Ok(new EmailGenerateResponse(subject, body));
    }
}
