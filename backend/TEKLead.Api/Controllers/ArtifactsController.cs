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

    // GET default prompts
    [HttpGet("prompts")]
    public IActionResult GetPrompts()
    {
        return Ok(new
        {
            coverLetter = ArtifactsService.CoverLetterPrompt(),
            whatsapp = ArtifactsService.WhatsappPrompt(),
            email = ArtifactsService.EmailPrompt(),
        });
    }

    // GET existing artifacts for a proposal
    [HttpGet("{proposalId}")]
    public async Task<IActionResult> GetExisting(Guid proposalId)
    {
        var result = await _svc.GetExisting(proposalId);
        if (!result.Ok) return NotFound(new { error = result.Error });
        return Ok(result);
    }

    [HttpPost("{proposalId}/generate")]
    public async Task<IActionResult> Generate(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.Generate(proposalId); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/cover-letter")]
    public async Task<IActionResult> GenerateCoverLetter(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateCoverLetter(proposalId, req?.CustomPrompt); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/whatsapp")]
    public async Task<IActionResult> GenerateWhatsapp(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateWhatsapp(proposalId, req?.CustomPrompt); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/generate/email")]
    public async Task<IActionResult> GenerateEmail(Guid proposalId, [FromBody] CustomPromptRequest? req = null)
    {
        try { var r = await _svc.GenerateEmail(proposalId, req?.CustomPrompt); return r.Ok ? Ok(r) : BadRequest(new { error = r.Error }); }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }
}

public class CustomPromptRequest
{
    public string? CustomPrompt { get; set; }
}
