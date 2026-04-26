using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/proposals/{id:guid}")]
public class ProposalGenerationController : ControllerBase
{
    private readonly ProposalGenerationService _gen;
    private readonly ILogger<ProposalGenerationController> _log;

    public ProposalGenerationController(ProposalGenerationService gen, ILogger<ProposalGenerationController> log)
    {
        _gen = gen;
        _log = log;
    }

    /// <summary>
    /// Generate a proposal using RAG (portfolio) + Azure OpenAI.
    /// POST /api/proposals/{id}/generate
    /// Body: { selectedPortfolioIds: [...], customPrompt: "..." }
    /// </summary>
    [HttpPost("generate")]
    public async Task<IActionResult> Generate(Guid id, [FromBody] GenerateProposalRequest req)
    {
        try
        {
            var result = await _gen.Generate(id, req);
            return result.Ok ? Ok(result) : BadRequest(result);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Generate failed for proposal {0}", id);
            return StatusCode(500, new { ok = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Refine an existing generated proposal with an AI instruction.
    /// POST /api/proposals/{id}/refine
    /// Body: { instruction: "make it shorter", lockedSections: [...], conversationHistory: [...] }
    /// </summary>
    [HttpPost("refine")]
    public async Task<IActionResult> Refine(Guid id, [FromBody] RefineProposalRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Instruction))
            return BadRequest(new { ok = false, error = "Instruction is required." });

        try
        {
            var result = await _gen.Refine(id, req);
            return result.Ok ? Ok(result) : BadRequest(result);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Refine failed for proposal {0}", id);
            return StatusCode(500, new { ok = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Get version history for a proposal.
    /// GET /api/proposals/{id}/versions
    /// </summary>
    [HttpGet("versions")]
    public async Task<IActionResult> GetVersions(Guid id)
    {
        try
        {
            var versions = await _gen.GetVersions(id);
            return Ok(versions);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "GetVersions failed for proposal {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }
}
