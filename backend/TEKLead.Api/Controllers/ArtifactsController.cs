using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/artifacts")]
public class ArtifactsController : ControllerBase
{
    private readonly ArtifactsService _svc;

    public ArtifactsController(ArtifactsService svc)
    {
        _svc = svc;
    }

    // GET existing artifacts for a proposal
    [HttpGet("{proposalId}")]
    public async Task<IActionResult> GetExisting(Guid proposalId)
    {
        var result = await _svc.GetExisting(proposalId);
        if (!result.Ok) return NotFound(new { error = result.Error });
        return Ok(result);
    }

    // POST generate (or regenerate) artifacts
    [HttpPost("{proposalId}/generate")]
    public async Task<IActionResult> Generate(Guid proposalId)
    {
        var result = await _svc.Generate(proposalId);
        if (!result.Ok) return BadRequest(new { error = result.Error });
        return Ok(result);
    }
}
