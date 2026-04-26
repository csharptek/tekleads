using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/proposals/{id:guid}")]
public class ProposalExportController : ControllerBase
{
    private readonly ProposalExportService _export;
    private readonly ProposalService _proposals;
    private readonly ILogger<ProposalExportController> _log;

    public ProposalExportController(ProposalExportService export, ProposalService proposals, ILogger<ProposalExportController> log)
    {
        _export = export;
        _proposals = proposals;
        _log = log;
    }

    /// <summary>
    /// Export proposal as Word document.
    /// GET /api/proposals/{id}/export/word
    /// Returns application/vnd.openxmlformats-officedocument.wordprocessingml.document
    /// </summary>
    [HttpGet("export/word")]
    public async Task<IActionResult> ExportWord(Guid id)
    {
        try
        {
            var (bytes, fileName) = await _export.ExportWord(id);
            return File(
                bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                fileName);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Word export failed for proposal {0}", id);
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Save manually edited proposal content.
    /// POST /api/proposals/{id}/save-content
    /// Body: { "content": "..." }
    /// </summary>
    [HttpPost("save-content")]
    public async Task<IActionResult> SaveContent(Guid id, [FromBody] SaveContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Content))
            return BadRequest(new { error = "Content is required." });

        try
        {
            var proposal = await _proposals.GetById(id);
            if (proposal == null) return NotFound(new { error = "Proposal not found." });

            proposal.GeneratedResponse = req.Content;
            await _proposals.Upsert(proposal);

            return Ok(new { ok = true });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "SaveContent failed for proposal {0}", id);
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public class SaveContentRequest
{
    public string Content { get; set; } = "";
}
