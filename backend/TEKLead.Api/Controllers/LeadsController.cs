using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
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
    private readonly ILogger<LeadsController> _log;

    public LeadsController(ApolloService apollo, LeadService leads, SettingsService settings, ILogger<LeadsController> log)
    {
        _apollo = apollo;
        _leads = leads;
        _settings = settings;
        _log = log;
    }

    private async Task<string> BuildWebhookUrl(string path)
    {
        var all = await _settings.GetAll();
        var appUrl = all.GetValueOrDefault("app_url", "").TrimEnd('/');
        if (!string.IsNullOrEmpty(appUrl))
            return $"{appUrl}{path}";
        return $"https://{HttpContext.Request.Host}{path}";
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
            var webhookUrl = await BuildWebhookUrl($"/api/leads/phone-webhook/{id}");
            _log.LogInformation("Enrich webhookUrl={0}", webhookUrl);
            var result = await _apollo.EnrichFull(lead.ApolloId, webhookUrl);
            var updated = MergeEnrichResult(lead, result, mergePhones: true);
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                lead,
                emails = result.Emails,
                phones = result.Phones,
                fullName = result.FullName,
                location = result.Location,
                linkedinUrl = result.LinkedinUrl,
                autoSaved = updated,
                phoneWebhookPending = result.Phones.Count == 0
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
            var result = await _apollo.EnrichEmailOnly(lead.ApolloId);
            var updated = MergeEnrichResult(lead, result, mergePhones: false);
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                lead,
                emails = result.Emails,
                fullName = result.FullName,
                location = result.Location,
                linkedinUrl = result.LinkedinUrl,
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
            var webhookUrl = await BuildWebhookUrl($"/api/leads/phone-webhook/{id}");
            var result = await _apollo.EnrichPhoneOnly(lead.ApolloId, webhookUrl);
            var updated = MergeEnrichResult(lead, result, mergePhones: true);
            if (updated) await _leads.Upsert(lead);

            return Ok(new
            {
                lead,
                phones = result.Phones,
                fullName = result.FullName,
                location = result.Location,
                linkedinUrl = result.LinkedinUrl,
                autoSaved = updated,
                phoneWebhookPending = result.Phones.Count == 0
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Enrich-phone-only failed for {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{id}/poll-phone")]
    public async Task<IActionResult> PollPhone(Guid id)
    {
        var lead = await _leads.GetById(id);
        if (lead == null) return NotFound(new { error = "Lead not found." });

        // If no request_id stored, try enriching again to get one
        if (!lead.ApolloRequestId.HasValue || lead.ApolloRequestId == 0)
        {
            if (string.IsNullOrEmpty(lead.ApolloId))
                return BadRequest(new { error = "No Apollo ID or request ID on this lead." });
            var webhookUrl = await BuildWebhookUrl($"/api/leads/phone-webhook/{id}");
            _log.LogInformation("poll-phone: no request_id, re-enriching lead {0}", id);
            var freshResult = await _apollo.EnrichPhoneOnly(lead.ApolloId, webhookUrl);
            MergeEnrichResult(lead, freshResult, mergePhones: true);
            await _leads.Upsert(lead);
            if (freshResult.Phones.Count > 0)
                return Ok(new { phones = freshResult.Phones, source = "enrich", saved = true });
            if (!lead.ApolloRequestId.HasValue)
                return Ok(new { phones = Array.Empty<string>(), source = "enrich", pending = true });
        }

        // Poll Apollo for webhook result
        _log.LogInformation("poll-phone: polling request_id={0} for lead {1}", lead.ApolloRequestId, id);
        var (phones, isReady) = await _apollo.PollWebhookResult(lead.ApolloRequestId!.Value);
        if (phones.Length > 0)
        {
            lead.Phones = MergeStrings(lead.Phones, phones);
            await _leads.Upsert(lead);
            _log.LogInformation("poll-phone: found {0} phones for lead {1}", phones.Length, id);
            return Ok(new { phones, source = "poll", saved = true, pending = false });
        }

        // isReady=false means Apollo is still processing — tell frontend to keep waiting
        return Ok(new { phones = Array.Empty<string>(), source = "poll", pending = !isReady, notReady = !isReady });
    }

    [HttpPost("phone-webhook/{leadId}")]
    public async Task<IActionResult> PhoneWebhook(Guid leadId)
    {
        try
        {
            using var sr = new StreamReader(Request.Body);
            var body = await sr.ReadToEndAsync();
            ApolloService.LogWebhookReceived(_log, body);
            _log.LogInformation("Phone webhook for lead {0}: {1}", leadId, body[..Math.Min(2000, body.Length)]);

            var phones = ApolloService.ParsePhonesFromWebhook(body);
            if (phones.Length == 0) return Ok(new { received = true, phonesFound = 0 });

            // Dedup: skip if same phone already queued/processed for this lead in last 24h
            await using var c = new NpgsqlConnection(_settings.ConnectionString);
            await c.OpenAsync();
            var already = await c.QuerySingleAsync<int>(
                @"SELECT COUNT(*) FROM phone_webhook_events
                  WHERE entity_id = @leadId
                    AND phones && @phones::TEXT[]
                    AND created_at > NOW() - INTERVAL '24 hours'",
                new { leadId, phones });
            if (already > 0)
                return Ok(new { received = true, phonesFound = phones.Length, queued = false, skipped = true });

            await c.ExecuteAsync(
                @"INSERT INTO phone_webhook_events (source, entity_id, phones)
                  VALUES ('lead', @leadId, @phones)",
                new { leadId, phones });

            return Ok(new { received = true, phonesFound = phones.Length, queued = true });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Phone webhook error for lead {0}", leadId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // Merge enrichment result into lead — merge not replace
    private static bool MergeEnrichResult(Lead lead, EnrichResult result, bool mergePhones)
    {
        var updated = false;

        if (!string.IsNullOrEmpty(result.FullName)) { lead.Name = result.FullName; updated = true; }
        if (!string.IsNullOrEmpty(result.Title) && string.IsNullOrEmpty(lead.Title)) { lead.Title = result.Title; updated = true; }
        if (!string.IsNullOrEmpty(result.Headline) && string.IsNullOrEmpty(lead.Headline)) { lead.Headline = result.Headline; updated = true; }
        if (!string.IsNullOrEmpty(result.Seniority) && string.IsNullOrEmpty(lead.Seniority)) { lead.Seniority = result.Seniority; updated = true; }
        if (!string.IsNullOrEmpty(result.EmailStatus)) { lead.EmailStatus = result.EmailStatus; updated = true; }
        if (!string.IsNullOrEmpty(result.Location) && string.IsNullOrEmpty(lead.Location)) { lead.Location = result.Location; updated = true; }
        if (!string.IsNullOrEmpty(result.City) && string.IsNullOrEmpty(lead.City)) { lead.City = result.City; updated = true; }
        if (!string.IsNullOrEmpty(result.State) && string.IsNullOrEmpty(lead.State)) { lead.State = result.State; updated = true; }
        if (!string.IsNullOrEmpty(result.Country) && string.IsNullOrEmpty(lead.Country)) { lead.Country = result.Country; updated = true; }
        if (!string.IsNullOrEmpty(result.LinkedinUrl) && string.IsNullOrEmpty(lead.LinkedinUrl)) { lead.LinkedinUrl = result.LinkedinUrl; updated = true; }
        if (!string.IsNullOrEmpty(result.TwitterUrl) && string.IsNullOrEmpty(lead.TwitterUrl)) { lead.TwitterUrl = result.TwitterUrl; updated = true; }
        if (!string.IsNullOrEmpty(result.GithubUrl) && string.IsNullOrEmpty(lead.GithubUrl)) { lead.GithubUrl = result.GithubUrl; updated = true; }
        if (!string.IsNullOrEmpty(result.FacebookUrl) && string.IsNullOrEmpty(lead.FacebookUrl)) { lead.FacebookUrl = result.FacebookUrl; updated = true; }
        if (!string.IsNullOrEmpty(result.PhotoUrl) && string.IsNullOrEmpty(lead.PhotoUrl)) { lead.PhotoUrl = result.PhotoUrl; updated = true; }
        if (result.Departments.Length > 0 && lead.Departments.Length == 0) { lead.Departments = result.Departments; updated = true; }
        if (!string.IsNullOrEmpty(result.Company) && string.IsNullOrEmpty(lead.Company)) { lead.Company = result.Company; updated = true; }
        if (!string.IsNullOrEmpty(result.Industry) && string.IsNullOrEmpty(lead.Industry)) { lead.Industry = result.Industry; updated = true; }

        if (result.Emails.Count > 0)
        {
            var merged = MergeStrings(lead.Emails, result.Emails.ToArray());
            if (!Same(lead.Emails, merged)) { lead.Emails = merged; updated = true; }
        }
        if (mergePhones && result.Phones.Count > 0)
        {
            var merged = MergeStrings(lead.Phones, result.Phones.ToArray());
            if (!Same(lead.Phones, merged)) { lead.Phones = merged; updated = true; }
        }
        if (result.RequestId.HasValue && result.RequestId != 0)
        {
            lead.ApolloRequestId = result.RequestId;
            updated = true;
        }
        if (result.OrgDetails != null)
        {
            lead.OrgDetails = result.OrgDetails;
            updated = true;
        }
        if (result.EmploymentHistory.Count > 0)
        {
            lead.EmploymentHistory = result.EmploymentHistory;
            updated = true;
        }

        return updated;
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

public class NameCheckRequest { public string? Name { get; set; } }

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

public class LinkedInSearchRequest { public string? LinkedinUrl { get; set; } }
