using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/leads")]
public class LeadsController : ControllerBase
{
    private readonly ApolloService _apollo;
    private readonly LeadService _leads;
    private readonly ILogger<LeadsController> _log;

    public LeadsController(ApolloService apollo, LeadService leads, ILogger<LeadsController> log)
    {
        _apollo = apollo;
        _leads = leads;
        _log = log;
    }

    // GET /api/leads — saved leads
    [HttpGet]
    public async Task<IActionResult> GetSaved() => Ok(await _leads.GetAll());

    // POST /api/leads/search
    [HttpPost("search")]
    public async Task<IActionResult> Search([FromBody] LeadSearchRequest req)
    {
        try
        {
            var (leads, total) = await _apollo.Search(
                req.Name, req.Title, req.Company, req.Industry, req.Location,
                req.Page, req.PerPage);
            return Ok(new { leads, total });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Lead search failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // POST /api/leads/save — save selected leads (multi)
    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] List<Lead> leads)
    {
        var saved = new List<Lead>();
        foreach (var l in leads)
        {
            if (l.Id == Guid.Empty) l.Id = Guid.NewGuid();
            l.SavedAt = DateTime.UtcNow;
            saved.Add(await _leads.Upsert(l));
        }
        return Ok(new { saved = saved.Count });
    }

    // POST /api/leads/{id}/reveal-phone
    // Reveal phone via Apollo. If phone found → auto-save/update lead.
    [HttpPost("{id}/reveal-phone")]
    public async Task<IActionResult> RevealPhone(Guid id)
    {
        var lead = await _leads.GetById(id);
        if (lead == null) return NotFound(new { error = "Lead not found" });
        if (string.IsNullOrEmpty(lead.ApolloId))
            return BadRequest(new { error = "Lead has no Apollo ID — cannot reveal phone." });

        try
        {
            var phones = await _apollo.RevealPhone(lead.ApolloId);
            if (phones.Length > 0)
            {
                lead.Phones = phones;
                await _leads.Upsert(lead); // auto-save with phone
                _log.LogInformation("Phone revealed + auto-saved for lead {0}", id);
                return Ok(new { phones, autoSaved = true });
            }
            return Ok(new { phones = Array.Empty<string>(), autoSaved = false });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Reveal phone failed for {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public class LeadSearchRequest
{
    public string? Name { get; set; }
    public string? Title { get; set; }
    public string? Company { get; set; }
    public string? Industry { get; set; }
    public string? Location { get; set; }
    public int Page { get; set; } = 1;
    public int PerPage { get; set; } = 25;
}
