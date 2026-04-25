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
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<LeadsController> _log;

    public LeadsController(ApolloService apollo, LeadService leads, SettingsService settings, IHttpClientFactory http, ILogger<LeadsController> log)
    {
        _apollo = apollo;
        _leads = leads;
        _settings = settings;
        _http = http;
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

    [HttpPost("{id}/reveal-phone")]
    public async Task<IActionResult> RevealPhone(Guid id)
    {
        var lead = await _leads.GetById(id);
        if (lead == null) return NotFound(new { error = "Lead not found. Save the lead first." });
        if (string.IsNullOrEmpty(lead.ApolloId))
            return BadRequest(new { error = "Lead has no Apollo ID." });

        try
        {
            var request = HttpContext.Request;
            var webhookUrl = $"https://{request.Host}/api/leads/phone-webhook/{id}";
            var (emails, phones) = await _apollo.Enrich(lead.ApolloId, webhookUrl);

            var updated = false;
            if (emails.Length > 0 && lead.Emails.Length == 0) { lead.Emails = emails; updated = true; }
            if (phones.Length > 0) { lead.Phones = phones; updated = true; }
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                emails,
                phones,
                autoSaved = updated,
                phoneWebhookPending = phones.Length == 0,
                message = phones.Length == 0 ? "Phone request sent to Apollo — auto-saved when delivered." : null
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Enrich failed for {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("phone-webhook/{leadId}")]
    public async Task<IActionResult> PhoneWebhook(Guid leadId)
    {
        try
        {
            using var sr = new StreamReader(Request.Body);
            var body = await sr.ReadToEndAsync();
            _log.LogInformation("Phone webhook for lead {0}: {1}", leadId, body);

            var phones = ApolloService.ParsePhonesFromWebhook(body);
            if (phones.Length == 0) return Ok(new { received = true, phonesFound = 0 });

            var lead = await _leads.GetById(leadId);
            if (lead == null) return Ok(new { received = true, phonesFound = phones.Length, saved = false });

            lead.Phones = phones;
            await _leads.Upsert(lead);
            return Ok(new { received = true, phonesFound = phones.Length, saved = true });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Phone webhook error for lead {0}", leadId);
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
