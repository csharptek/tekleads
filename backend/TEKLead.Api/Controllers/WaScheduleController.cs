using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/wa-schedule")]
public class WaScheduleController : ControllerBase
{
    private readonly WaScheduleService _svc;
    public WaScheduleController(WaScheduleService svc) => _svc = svc;

    // GET /api/wa-schedule?listId=...
    [HttpGet]
    public async Task<IActionResult> GetByList([FromQuery] Guid listId)
        => Ok(await _svc.GetByList(listId));

    // POST /api/wa-schedule
    [HttpPost]
    public async Task<IActionResult> Schedule([FromBody] WaScheduleRequest req)
    {
        if (req.Jobs == null || req.Jobs.Count == 0)
            return BadRequest(new { error = "No jobs." });

        var jobs = req.Jobs.Select(j => new WaScheduledJob
        {
            ListId       = req.ListId,
            ListName     = req.ListName ?? "",
            ContactId    = j.ContactId ?? "",
            ContactName  = j.ContactName ?? "",
            Phone        = j.Phone,
            Mode         = j.Mode ?? "template",
            TemplateName = j.TemplateName,
            TemplateLang = j.TemplateLang ?? "en",
            BodyJson     = j.BodyVariables != null ? JsonSerializer.Serialize(j.BodyVariables) : null,
            Body         = j.Body,
            ScheduledAt  = req.ScheduledAtUtc,
        }).ToList();

        var ids = await _svc.EnqueueBatch(jobs);
        return Ok(new { queued = ids.Count, ids });
    }

    // DELETE /api/wa-schedule/{id}
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Cancel(Guid id)
    {
        await _svc.Cancel(id);
        return Ok(new { cancelled = true });
    }
}

public class WaScheduleRequest
{
    public Guid   ListId        { get; set; }
    public string? ListName     { get; set; }
    public DateTime ScheduledAtUtc { get; set; }
    public List<WaScheduleJobItem> Jobs { get; set; } = new();
}

public class WaScheduleJobItem
{
    public string? ContactId     { get; set; }
    public string? ContactName   { get; set; }
    public string  Phone         { get; set; } = "";
    public string? Mode          { get; set; }
    public string? TemplateName  { get; set; }
    public string? TemplateLang  { get; set; }
    public List<string>? BodyVariables { get; set; }
    public string? Body          { get; set; }
}
