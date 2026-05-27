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

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var lead = await _leads.GetById(id);
        return lead == null ? NotFound() : Ok(lead);
    }

    [HttpPost("search")]
    public async Task<IActionResult> Search([FromBody] LeadSearchRequest req)
    {
        try
        {
            var (leads, total) = await _apollo.Search(
                req.Name, req.Title, req.Company, req.Industry, req.Location, req.Domain,
                req.Page, req.PerPage);
            return Ok(new { leads, total });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Lead search failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("search-by-linkedin")]
    public async Task<IActionResult> SearchByLinkedIn([FromBody] LinkedInSearchRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.LinkedinUrl))
            return BadRequest(new { error = "linkedinUrl is required." });
        try
        {
            var lead = await _apollo.SearchByLinkedIn(req.LinkedinUrl);
            return Ok(new { lead });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "LinkedIn search failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("check-duplicate")]
    public async Task<IActionResult> CheckDuplicate([FromBody] DuplicateCheckRequest req)
    {
        var matches = await _leads.FindDuplicates(req.ApolloId, req.Name, req.Company, req.LinkedinUrl);
        return Ok(new { matches });
    }

    [HttpPost("check-name")]
    public async Task<IActionResult> CheckName([FromBody] NameCheckRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) return Ok(new { matches = new List<object>() });
        var matches = await _leads.FindByName(req.Name);
        return Ok(new { matches });
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] List<Lead> leads)
    {
        var savedLeads = new List<Lead>();
        foreach (var l in leads)
        {
            if (l.Id == Guid.Empty) l.Id = Guid.NewGuid();
            l.SavedAt = DateTime.UtcNow;
            var result = await _leads.Upsert(l);
            savedLeads.Add(result);
        }
        return Ok(new { saved = savedLeads.Count, leads = savedLeads });
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
            var webhookUrl = $"https://{HttpContext.Request.Host}/api/leads/phone-webhook/{id}";
            var (emails, phones, fullName, location, linkedinUrl) = await _apollo.Enrich(lead.ApolloId, webhookUrl);

            var updated = false;
            if (!string.IsNullOrEmpty(fullName)) { lead.Name = fullName; updated = true; }
            if (!string.IsNullOrEmpty(location) && string.IsNullOrEmpty(lead.Location)) { lead.Location = location; updated = true; }
            if (emails.Length > 0) { var merged = MergeStrings(lead.Emails, emails); if (!Same(lead.Emails, merged)) { lead.Emails = merged; updated = true; } }
            if (phones.Length > 0) { var merged = MergeStrings(lead.Phones, phones); if (!Same(lead.Phones, merged)) { lead.Phones = merged; updated = true; } }
            if (!string.IsNullOrEmpty(linkedinUrl) && string.IsNullOrEmpty(lead.LinkedinUrl)) { lead.LinkedinUrl = linkedinUrl; updated = true; }
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                emails,
                phones,
                fullName,
                location,
                linkedinUrl,
                autoSaved = updated,
                phoneWebhookPending = phones.Length == 0
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Enrich failed for {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{id}/reveal-email")]
    public async Task<IActionResult> RevealEmail(Guid id)
    {
        var lead = await _leads.GetById(id);
        if (lead == null) return NotFound(new { error = "Lead not found. Save the lead first." });
        if (string.IsNullOrEmpty(lead.ApolloId))
            return BadRequest(new { error = "Lead has no Apollo ID." });

        try
        {
            var (emails, fullName, location, linkedinUrl) = await _apollo.EnrichEmailOnly(lead.ApolloId);

            var updated = false;
            if (!string.IsNullOrEmpty(fullName)) { lead.Name = fullName; updated = true; }
            if (!string.IsNullOrEmpty(location) && string.IsNullOrEmpty(lead.Location)) { lead.Location = location; updated = true; }
            if (emails.Length > 0) { var merged = MergeStrings(lead.Emails, emails); if (!Same(lead.Emails, merged)) { lead.Emails = merged; updated = true; } }
            if (!string.IsNullOrEmpty(linkedinUrl) && string.IsNullOrEmpty(lead.LinkedinUrl)) { lead.LinkedinUrl = linkedinUrl; updated = true; }
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                emails,
                fullName,
                location,
                linkedinUrl,
                autoSaved = updated
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Enrich-email failed for {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{id}/reveal-phone-only")]
    public async Task<IActionResult> RevealPhoneOnly(Guid id)
    {
        var lead = await _leads.GetById(id);
        if (lead == null) return NotFound(new { error = "Lead not found. Save the lead first." });
        if (string.IsNullOrEmpty(lead.ApolloId))
            return BadRequest(new { error = "Lead has no Apollo ID." });

        try
        {
            var webhookUrl = $"https://{HttpContext.Request.Host}/api/leads/phone-webhook/{id}";
            var (phones, fullName, location, linkedinUrl) = await _apollo.EnrichPhoneOnly(lead.ApolloId, webhookUrl);

            var updated = false;
            if (!string.IsNullOrEmpty(fullName)) { lead.Name = fullName; updated = true; }
            if (!string.IsNullOrEmpty(location) && string.IsNullOrEmpty(lead.Location)) { lead.Location = location; updated = true; }
            if (phones.Length > 0) { var merged = MergeStrings(lead.Phones, phones); if (!Same(lead.Phones, merged)) { lead.Phones = merged; updated = true; } }
            if (!string.IsNullOrEmpty(linkedinUrl) && string.IsNullOrEmpty(lead.LinkedinUrl)) { lead.LinkedinUrl = linkedinUrl; updated = true; }
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                phones,
                fullName,
                location,
                linkedinUrl,
                autoSaved = updated,
                phoneWebhookPending = phones.Length == 0
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Enrich-phone-only failed for {0}", id);
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

            lead.Phones = MergeStrings(lead.Phones, phones);
            await _leads.Upsert(lead);
            return Ok(new { received = true, phonesFound = phones.Length, saved = true });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Phone webhook error for lead {0}", leadId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private static string[] MergeStrings(string[]? existing, string[]? incoming)
    {
        var set = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (existing != null)
            foreach (var s in existing)
                if (!string.IsNullOrWhiteSpace(s) && seen.Add(s.Trim())) set.Add(s.Trim());
        if (incoming != null)
            foreach (var s in incoming)
                if (!string.IsNullOrWhiteSpace(s) && seen.Add(s.Trim())) set.Add(s.Trim());
        return set.ToArray();
    }

    private static bool Same(string[]? a, string[]? b)
    {
        if (a == null || b == null) return a == b;
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (!string.Equals(a[i], b[i], StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }
}

public class DuplicateCheckRequest
{
    public string? ApolloId { get; set; }
    public string? Name { get; set; }
    public string? Company { get; set; }
    public string? LinkedinUrl { get; set; }
}

public class NameCheckRequest
{
    public string? Name { get; set; }
}

public class LeadSearchRequest
{
    public string? Name { get; set; }
    public string? Title { get; set; }
    public string? Company { get; set; }
    public string? Industry { get; set; }
    public string? Location { get; set; }
    public string? Domain { get; set; }
    public int Page { get; set; } = 1;
    public int PerPage { get; set; } = 25;
}

public class LinkedInSearchRequest
{
    public string? LinkedinUrl { get; set; }
}
