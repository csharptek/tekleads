using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

public class ScrapeRunRequest
{
    public List<string> Roles { get; set; } = new();
    public string Country { get; set; } = "United States";
    public string CompanySize { get; set; } = "";
    public int PostedWithinDays { get; set; } = 7;
}

public class JobLeadSendEmailRequest
{
    public string Sender { get; set; } = "all"; // specific email, or "all" for round-robin
    public DateTime? ScheduledAt { get; set; } // null = send now
}

public class SaveEmailRequest
{
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
}

public class GenerateRequest
{
    public string? Provider { get; set; }
    public string? CustomPrompt { get; set; }
}

public class BulkIdsRequest
{
    public List<Guid> Ids { get; set; } = new();
}

public class ContactIdsRequest
{
    public List<Guid> ContactIds { get; set; } = new();
}

public class JobLeadBulkSendRecipient { public string Email { get; set; } = ""; public string? Name { get; set; } }
public class FollowUpSpecRequest { public string? Subject { get; set; } public string? Body { get; set; } public int DelayHours { get; set; } }
public class JobLeadBulkSendEmailRequest
{
    public List<JobLeadBulkSendRecipient> Recipients { get; set; } = new();
    public string Sender { get; set; } = "all";
    public int IntervalMinutes { get; set; } = 5;
    public FollowUpSpecRequest? FollowUp1 { get; set; }
    public FollowUpSpecRequest? FollowUp2 { get; set; }
}
public class JobLeadCancelFollowUpsRequest { public string? ContactEmail { get; set; } public int? Stage { get; set; } }

public class JobLeadBulkSendRequest
{
    public List<Guid> Ids { get; set; } = new();
    public string Sender { get; set; } = "all";
}

[ApiController]
[Route("api/job-leads")]
public class JobLeadsController : ControllerBase
{
    private readonly JobScraperService _jobs;
    private readonly JobLeadContactService _contacts;
    private readonly JobLeadContactPickerService _picker;
    private readonly JobLeadArtifactsService _artifacts;
    private readonly JobLeadEmailQueueService _emailQueue;
    private readonly SettingsService _settings;
    private readonly ILogger<JobLeadsController> _log;

    public JobLeadsController(
        JobScraperService jobs, JobLeadContactService contacts, JobLeadContactPickerService picker, JobLeadArtifactsService artifacts,
        JobLeadEmailQueueService emailQueue, SettingsService settings, ILogger<JobLeadsController> log)
    {
        _jobs = jobs;
        _contacts = contacts;
        _picker = picker;
        _artifacts = artifacts;
        _emailQueue = emailQueue;
        _settings = settings;
        _log = log;
    }

    [HttpGet("prompts")]
    public IActionResult GetPrompts() => Ok(new
    {
        email = JobLeadArtifactsService.DefaultEmailPrompt(),
        followUp1 = JobLeadArtifactsService.DefaultFollowUp1Prompt(),
        followUp2 = JobLeadArtifactsService.DefaultFollowUp2Prompt(),
    });

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status, [FromQuery] string? search, [FromQuery] string? keyword,
        [FromQuery] string? industry, [FromQuery] string? size, [FromQuery] string? country,
        [FromQuery] bool needsFollowUp = false, [FromQuery] DateTime? dateFrom = null, [FromQuery] DateTime? dateTo = null,
        [FromQuery] int page = 1, [FromQuery] int perPage = 20,
        [FromQuery] string? sortBy = null, [FromQuery] string? sortDir = null)
    {
        var result = await _jobs.List(status, search, keyword, industry, size, country, needsFollowUp, dateFrom, dateTo, page, perPage, sortBy, sortDir);
        var stats = await _jobs.GetStats();
        return Ok(new { leads = result.Leads, total = result.Total, stats });
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var lead = await _jobs.GetById(id);
        return lead == null ? NotFound() : Ok(lead);
    }

    [HttpPost("scrape")]
    public async Task<IActionResult> StartScrape([FromBody] ScrapeRunRequest req)
    {
        if (req.Roles.Count == 0) return BadRequest(new { error = "Select at least one role." });
        var runId = await _jobs.StartRun(req.Roles, req.Country, req.CompanySize, req.PostedWithinDays);
        return Ok(new { runId });
    }

    [HttpGet("scrape/{runId}")]
    public async Task<IActionResult> GetScrapeStatus(Guid runId)
    {
        var run = await _jobs.GetRun(runId);
        return run == null ? NotFound() : Ok(run);
    }

    [HttpGet("diag")]
    public async Task<IActionResult> Diag([FromQuery] Guid? runId)
    {
        return Ok(await _jobs.Diagnose(runId));
    }

    [HttpPost("{id}/enrich")]
    public async Task<IActionResult> Enrich(Guid id)
    {
        var (ok, message) = await _contacts.Enrich(id);
        return ok ? Ok(new { ok, message }) : BadRequest(new { ok, error = message });
    }

    [HttpPost("{id}/contacts/find")]
    public async Task<IActionResult> FindContacts(Guid id)
    {
        var (ok, message) = await _picker.FindCandidates(id);
        var list = await _picker.GetForLead(id);
        return ok ? Ok(new { ok, message, contacts = list }) : BadRequest(new { ok, error = message, contacts = list });
    }

    [HttpGet("{id}/contacts")]
    public async Task<IActionResult> GetContacts(Guid id)
    {
        var list = await _picker.GetForLead(id);
        return Ok(new { contacts = list });
    }

    [HttpGet("contacts/all")]
    public async Task<IActionResult> GetAllContacts(
        [FromQuery] string? search, [FromQuery] string? source,
        [FromQuery] int page = 1, [FromQuery] int perPage = 20,
        [FromQuery] string? sortBy = null, [FromQuery] string? sortDir = null)
    {
        var (contacts, total) = await _picker.GetAllEnriched(search, source, page, perPage, sortBy, sortDir);
        return Ok(new { contacts, total });
    }

    [HttpPost("{id}/contacts/enrich")]
    public async Task<IActionResult> EnrichContacts(Guid id, [FromBody] ContactIdsRequest req)
    {
        var (ok, message) = await _picker.EnrichSelected(id, req.ContactIds);
        var list = await _picker.GetForLead(id);
        return ok ? Ok(new { ok, message, contacts = list }) : BadRequest(new { ok, error = message, contacts = list });
    }

    [HttpPost("{id}/generate-email")]
    public async Task<IActionResult> GenerateEmail(Guid id, [FromBody] GenerateRequest req)
    {
        var result = await _artifacts.GenerateEmail(id, req.Provider, req.CustomPrompt);
        return result.Ok ? Ok(result) : BadRequest(new { error = result.Error });
    }

    [HttpPost("{id}/generate-followup1")]
    public async Task<IActionResult> GenerateFollowUp1(Guid id, [FromBody] GenerateRequest req)
    {
        var result = await _artifacts.GenerateFollowUp(id, 1, req.Provider, req.CustomPrompt);
        return result.Ok ? Ok(result) : BadRequest(new { error = result.Error });
    }

    [HttpPost("{id}/generate-followup2")]
    public async Task<IActionResult> GenerateFollowUp2(Guid id, [FromBody] GenerateRequest req)
    {
        var result = await _artifacts.GenerateFollowUp(id, 2, req.Provider, req.CustomPrompt);
        return result.Ok ? Ok(result) : BadRequest(new { error = result.Error });
    }

    [HttpPut("{id}/email")]
    public async Task<IActionResult> SaveEmail(Guid id, [FromBody] SaveEmailRequest req)
    {
        var (ok, error) = await _artifacts.SaveEmail(id, req.Subject, req.Body);
        return ok ? Ok(new { ok }) : NotFound(new { error });
    }

    [HttpPost("{id}/send")]
    public async Task<IActionResult> Send(Guid id, [FromBody] JobLeadSendEmailRequest req)
    {
        var lead = await _jobs.GetById(id);
        if (lead == null) return NotFound();
        if (string.IsNullOrWhiteSpace(lead.ContactEmail)) return BadRequest(new { error = "No contact email on this lead." });
        if (string.IsNullOrWhiteSpace(lead.EmailSubject) || string.IsNullOrWhiteSpace(lead.EmailBody)) return BadRequest(new { error = "Generate the email before sending." });

        var fromEmail = await ResolveSender(req.Sender);
        await _emailQueue.Enqueue(id, 0, lead.ContactEmail!, lead.ContactName ?? "", fromEmail, lead.EmailSubject!, lead.EmailBody!, req.ScheduledAt);

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var isImmediate = req.ScheduledAt == null || req.ScheduledAt <= DateTime.UtcNow;
        await c.ExecuteAsync("UPDATE job_leads SET status='scheduled', sender_email=@from, updated_at=NOW() WHERE id=@id", new { id, from = fromEmail });
        await _jobs.AddEvent(id, isImmediate ? "Queued to send now" : "Scheduled to send");

        return Ok(new { ok = true, sender = fromEmail });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _emailQueue.CancelPending(id);
        await _jobs.Delete(id);
        return Ok(new { ok = true });
    }

    // ── Multi-contact outreach queue (Initial + FU1/FU2, interval-staggered) ──

    [HttpPost("{id}/send-bulk")]
    public async Task<IActionResult> EnqueueBulk(Guid id, [FromBody] JobLeadBulkSendEmailRequest req)
    {
        var lead = await _jobs.GetById(id);
        if (lead == null) return NotFound();
        if (req.Recipients.Count == 0) return BadRequest(new { error = "No recipients provided." });
        if (string.IsNullOrWhiteSpace(lead.EmailSubject) || string.IsNullOrWhiteSpace(lead.EmailBody))
            return BadRequest(new { error = "Generate the email before sending." });
        if (req.IntervalMinutes < 1) req.IntervalMinutes = 1;

        var fromEmail = await ResolveSender(req.Sender);
        var recipients = req.Recipients.Select(r => (r.Email, r.Name ?? "")).ToList();

        FollowUpSpec? fu1 = null, fu2 = null;
        if (req.FollowUp1 != null && !string.IsNullOrWhiteSpace(req.FollowUp1.Subject) && !string.IsNullOrWhiteSpace(req.FollowUp1.Body))
            fu1 = new FollowUpSpec { Subject = req.FollowUp1.Subject!, Body = req.FollowUp1.Body!, DelayHours = req.FollowUp1.DelayHours > 0 ? req.FollowUp1.DelayHours : 6 };
        if (req.FollowUp2 != null && !string.IsNullOrWhiteSpace(req.FollowUp2.Subject) && !string.IsNullOrWhiteSpace(req.FollowUp2.Body))
            fu2 = new FollowUpSpec { Subject = req.FollowUp2.Subject!, Body = req.FollowUp2.Body!, DelayHours = req.FollowUp2.DelayHours > 0 ? req.FollowUp2.DelayHours : 12 };

        await _emailQueue.EnqueueBulk(id, recipients, fromEmail, lead.EmailSubject!, lead.EmailBody!, req.IntervalMinutes, fu1, fu2);
        await _jobs.AddEvent(id, $"Queued outreach to {recipients.Count} contact(s)");

        return Ok(new { queued = recipients.Count, intervalMinutes = req.IntervalMinutes, followUp1 = fu1 != null, followUp2 = fu2 != null });
    }

    [HttpGet("{id}/send-bulk/status")]
    public async Task<IActionResult> BulkStatus(Guid id)
    {
        var jobsList = await _emailQueue.GetByLead(id);
        return Ok(jobsList.Select(j => new
        {
            id = j.Id, toEmail = j.ToEmail, toName = j.ToName, scheduledAt = j.ScheduledAt,
            sentAt = j.SentAt, status = j.Status, error = j.Error, followUpStage = j.Stage,
            subject = j.Subject, body = j.Body,
        }));
    }

    [HttpPost("{id}/send-bulk/cancel")]
    public async Task<IActionResult> CancelBulk(Guid id)
    {
        await _emailQueue.CancelPending(id);
        return Ok(new { cancelled = true });
    }

    [HttpPost("{id}/send-bulk/cancel-followups")]
    public async Task<IActionResult> CancelFollowUps(Guid id, [FromBody] JobLeadCancelFollowUpsRequest req)
    {
        var count = await _emailQueue.CancelFollowUps(id, req.ContactEmail, req.Stage);
        return Ok(new { cancelled = count });
    }

    [HttpPost("send-job/{jobId}/cancel")]
    public async Task<IActionResult> CancelJob(Guid jobId)
    {
        var ok = await _emailQueue.CancelJob(jobId);
        if (!ok) return BadRequest(new { error = "Job not found or not pending." });
        return Ok(new { cancelled = true });
    }

    [HttpPost("send-job/{jobId}/send-now")]
    public async Task<IActionResult> SendJobNow(Guid jobId)
    {
        var ok = await _emailQueue.SendNow(jobId);
        if (!ok) return BadRequest(new { error = "Job not found or not pending." });
        return Ok(new { sendNow = true });
    }

    [HttpPost("bulk/enrich")]
    public async Task<IActionResult> BulkEnrich([FromBody] BulkIdsRequest req)
    {
        var results = new List<object>();
        foreach (var id in req.Ids)
        {
            var (ok, message) = await _contacts.Enrich(id);
            results.Add(new { id, ok, message });
        }
        return Ok(new { results });
    }

    [HttpPost("bulk/generate-email")]
    public async Task<IActionResult> BulkGenerateEmail([FromBody] BulkIdsRequest req)
    {
        var results = new List<object>();
        foreach (var id in req.Ids)
        {
            var result = await _artifacts.GenerateEmail(id);
            results.Add(new { id, ok = result.Ok, error = result.Error });
        }
        return Ok(new { results });
    }

    [HttpPost("bulk/send")]
    public async Task<IActionResult> BulkSend([FromBody] JobLeadBulkSendRequest req)
    {
        var results = new List<object>();
        foreach (var id in req.Ids)
        {
            var lead = await _jobs.GetById(id);
            if (lead == null || string.IsNullOrWhiteSpace(lead.ContactEmail) || string.IsNullOrWhiteSpace(lead.EmailSubject))
            {
                results.Add(new { id, ok = false, error = "Not ready to send (needs contact + generated email)." });
                continue;
            }
            var fromEmail = await ResolveSender(req.Sender);
            await _emailQueue.Enqueue(id, 0, lead.ContactEmail!, lead.ContactName ?? "", fromEmail, lead.EmailSubject!, lead.EmailBody ?? "", null);
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            await c.ExecuteAsync("UPDATE job_leads SET status='scheduled', sender_email=@from, updated_at=NOW() WHERE id=@id", new { id, from = fromEmail });
            await _jobs.AddEvent(id, "Queued to send now");
            results.Add(new { id, ok = true });
        }
        return Ok(new { results });
    }

    [HttpPost("bulk/delete")]
    public async Task<IActionResult> BulkDelete([FromBody] BulkIdsRequest req)
    {
        foreach (var id in req.Ids) await _emailQueue.CancelPending(id);
        await _jobs.BulkDelete(req.Ids);
        return Ok(new { ok = true, count = req.Ids.Count });
    }

    /// <summary>Resolves "all" to the next sender in round-robin order using an atomically-incremented setting counter.</summary>
    private async Task<string> ResolveSender(string sender)
    {
        if (!string.Equals(sender, "all", StringComparison.OrdinalIgnoreCase))
            return sender;

        var all = await _settings.GetAll();
        var sendersJson = all.GetValueOrDefault(SettingKeys.EmailSendersJson, "[]");
        List<string> emails;
        try
        {
            var parsed = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(sendersJson) ?? new();
            emails = parsed.Select(p => p.TryGetProperty("email", out var e) ? e.GetString() ?? "" : "").Where(e => !string.IsNullOrWhiteSpace(e)).ToList();
        }
        catch { emails = new(); }

        if (emails.Count == 0)
            return all.GetValueOrDefault(SettingKeys.GraphSenderEmail, "");

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var next = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO app_settings (key, value) VALUES ('job_lead_sender_rr_counter', '0')
            ON CONFLICT (key) DO UPDATE SET value = ((app_settings.value::int + 1) % @count)::text
            RETURNING value::int", new { count = emails.Count });

        return emails[next % emails.Count];
    }
}
