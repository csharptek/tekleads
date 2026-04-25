using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _svc;
    private readonly ILogger<SettingsController> _log;

    public SettingsController(SettingsService svc, ILogger<SettingsController> log)
    {
        _svc = svc;
        _log = log;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        try
        {
            var all = await _svc.GetAll();
            var values = new Dictionary<string, string>();
            var isSet = new Dictionary<string, bool>();

            foreach (var key in SettingKeys.AllKnown)
            {
                var v = all.TryGetValue(key, out var s) ? s : "";
                isSet[key] = !string.IsNullOrEmpty(v);
                // Secrets always returned as empty; non-secrets echoed.
                values[key] = SettingKeys.Secrets.Contains(key) ? "" : v;
            }

            return Ok(new { values, isSet });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "GET /api/settings failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Body: { "values": { "apollo_api_key": "...", "graph_tenant_id": "..." } }
    /// Only include keys you want to update. Omit a key = leave as-is.
    /// Empty string value = explicit clear.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Save([FromBody] SaveRequest? req)
    {
        if (req?.Values == null)
        {
            _log.LogWarning("POST /api/settings: empty body");
            return BadRequest(new { error = "Request body must include 'values' object." });
        }

        try
        {
            // Convert to nullable dict (we already filter at controller level — no nulls here).
            var incoming = req.Values.ToDictionary(kv => kv.Key, kv => (string?)(kv.Value ?? ""));
            var rows = await _svc.SaveMany(incoming);
            return Ok(new { ok = true, rowsAffected = rows });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "POST /api/settings failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("diag")]
    public async Task<IActionResult> Diag()
    {
        var info = await _svc.Diagnose();
        return Ok(info);
    }
}

public class SaveRequest
{
    public Dictionary<string, string>? Values { get; set; }
}
