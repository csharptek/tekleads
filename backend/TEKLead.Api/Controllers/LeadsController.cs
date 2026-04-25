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

    [HttpGet]
    public async Task<IActionResult> GetSaved() => Ok(await _leads.GetAll());

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

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] List<Lead> leads)
    {
        var saved = 0;
        foreach (var l in leads)
        {
            if (l.Id == Guid.Empty) l.Id = Guid.NewGuid();
            l.SavedAt = DateTime.UtcNow;
            await _leads.Upsert(l);
            saved++;
        }
        return Ok(new { saved });
    }

    /// <summary>
    /// Enrich a lead by Apollo ID → get email + any available phones.
    /// If phone found → auto-save the lead with phone.
    /// Phone reveal via webhook is NOT supported (no webhook infrastructure).
    /// </summary>
    [HttpPost("{id}/reveal-phone")]
    public async Task<IActionResult> RevealPhone(Guid id)
    {
        var lead = await _leads.GetById(id);
        if (lead == null) return NotFound(new { error = "Lead not found. Save the lead first." });
        if (string.IsNullOrEmpty(lead.ApolloId))
            return BadRequest(new { error = "Lead has no Apollo ID." });

        try
        {
            var (emails, phones) = await _apollo.Enrich(lead.ApolloId);

            var updated = false;
            if (emails.Length > 0 && lead.Emails.Length == 0)  { lead.Emails = emails; updated = true; }
            if (phones.Length > 0)                             { lead.Phones = phones; updated = true; }

            if (updated)
            {
                await _leads.Upsert(lead);
                _log.LogInformation("Auto-saved enriched data for lead {0}", id);
            }

            return Ok(new
            {
                emails,
                phones,
                autoSaved = updated,
                note = phones.Length == 0
                    ? "No phone available. Apollo phone reveal requires a webhook (async) — not supported in this setup."
                    : null
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Enrich failed for {0}", id);
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
