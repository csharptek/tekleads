using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/logs")]
public class LogsController : ControllerBase
{
    private readonly LogService _logs;

    public LogsController(LogService logs) => _logs = logs;

    [HttpGet]
    public async Task<IActionResult> GetPaged(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? method = null,
        [FromQuery] string? path = null,
        [FromQuery] int? status = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);
        page = Math.Max(1, page);
        var (items, total) = await _logs.GetPagedAsync(page, pageSize, method, path, status, from, to);
        return Ok(new { items, total, page, pageSize, totalPages = (int)Math.Ceiling((double)total / pageSize) });
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetById(long id)
    {
        var log = await _logs.GetByIdAsync(id);
        return log == null ? NotFound() : Ok(log);
    }

    [HttpDelete]
    public async Task<IActionResult> Clear()
    {
        await _logs.ClearAsync();
        return Ok(new { cleared = true });
    }
}
