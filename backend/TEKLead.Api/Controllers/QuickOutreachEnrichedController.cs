using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/quick-outreach/enriched")]
public class QuickOutreachEnrichedController : ControllerBase
{
    private readonly QuickOutreachEnrichedService _svc;

    public QuickOutreachEnrichedController(QuickOutreachEnrichedService svc)
    {
        _svc = svc;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var leads = await _svc.GetAll();
        return Ok(leads);
    }

    [HttpPost]
    public async Task<IActionResult> UpsertMany([FromBody] List<Lead> leads)
    {
        await _svc.UpsertMany(leads);
        return Ok(new { count = leads.Count });
    }

    [HttpDelete("{leadId}")]
    public async Task<IActionResult> Remove(string leadId)
    {
        await _svc.Remove(leadId);
        return Ok();
    }
}
