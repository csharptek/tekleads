using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/jd")]
public class JdQualityController : ControllerBase
{
    private readonly JdQualityService _svc;

    public JdQualityController(JdQualityService svc)
    {
        _svc = svc;
    }

    // entityType: "proposal" | "job_lead"
    [HttpPost("analyze/{entityType}/{entityId}")]
    public async Task<IActionResult> Analyze(string entityType, Guid entityId, [FromBody] JdAnalyzeRequest req)
    {
        if (entityType != "proposal" && entityType != "job_lead")
            return BadRequest(new { error = "entityType must be 'proposal' or 'job_lead'." });
        if (string.IsNullOrWhiteSpace(req.Description))
            return BadRequest(new { error = "Job description is required." });

        try
        {
            var result = await _svc.Analyze(entityType, entityId, req.Title ?? "", req.Description);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet("analyze/{entityType}/{entityId}")]
    public async Task<IActionResult> GetSaved(string entityType, Guid entityId)
    {
        var result = await _svc.GetSaved(entityType, entityId);
        if (result == null) return NotFound();
        return Ok(result);
    }
}

public class JdAnalyzeRequest
{
    public string? Title { get; set; }
    public string Description { get; set; } = "";
}
