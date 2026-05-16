using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/instantly")]
public class InstantlyController : ControllerBase
{
    private readonly InstantlyService _service;

    public InstantlyController(InstantlyService service)
    {
        _service = service;
    }

    [HttpGet("version")]
    public IActionResult Version() => Ok(new { version = "v2-leads-add-fix-20250516" });

    [HttpGet("campaigns")]
    public async Task<IActionResult> GetCampaigns()
    {
        var (ok, campaigns, error) = await _service.GetCampaigns();
        if (!ok)
            return BadRequest(new { error });
        return Ok(campaigns);
    }

    [HttpPost("push")]
    public async Task<IActionResult> PushContacts([FromBody] PushRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.CampaignId))
            return BadRequest(new { error = "campaignId required" });

        if (req.Contacts == null || req.Contacts.Count == 0)
            return BadRequest(new { error = "contacts required" });

        var (ok, pushed, failed, errors) = await _service.PushContacts(req.CampaignId, req.Contacts.Select(c => (c.Email, c.Name)).ToList());
        
        return Ok(new { ok, pushed, failed, errors });
    }
}

public class PushRequest
{
    public string CampaignId { get; set; } = "";
    public List<PushContact> Contacts { get; set; } = new();
}

public class PushContact
{
    public string Email { get; set; } = "";
    public string Name  { get; set; } = "";
}
