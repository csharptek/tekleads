using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/portfolio")]
public class PortfolioController : ControllerBase
{
    private readonly PortfolioService _svc;
    private readonly ILogger<PortfolioController> _log;

    public PortfolioController(PortfolioService svc, ILogger<PortfolioController> log)
    {
        _svc = svc;
        _log = log;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await _svc.GetAll());

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await _svc.GetById(id);
        return p == null ? NotFound() : Ok(p);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PortfolioProject project)
    {
        project.Id = Guid.NewGuid();
        project.CreatedAt = DateTime.UtcNow;
        project.EmbeddingIndexed = false;
        var saved = await _svc.Upsert(project);
        return Ok(saved);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] PortfolioProject project)
    {
        var existing = await _svc.GetById(id);
        if (existing == null) return NotFound();
        project.Id = id;
        project.CreatedAt = existing.CreatedAt;
        project.EmbeddingIndexed = false; // mark as needing re-index
        var saved = await _svc.Upsert(project);
        return Ok(saved);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _svc.Delete(id);
        return Ok(new { ok = true });
    }

    [HttpPost("{id:guid}/index")]
    public async Task<IActionResult> IndexEmbedding(Guid id)
    {
        try
        {
            var (ok, message) = await _svc.IndexEmbedding(id);
            return ok ? Ok(new { ok, message }) : BadRequest(new { ok, message });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Index embedding failed for {0}", id);
            return StatusCode(500, new { ok = false, message = ex.Message });
        }
    }

    [HttpPost("search-similar")]
    public async Task<IActionResult> SearchSimilar([FromBody] SimilarSearchRequest req)
    {
        try
        {
            var results = await _svc.SearchSimilar(req.Query, req.TopK);
            return Ok(results);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Similar search failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public class SimilarSearchRequest
{
    public string Query { get; set; } = "";
    public int TopK { get; set; } = 3;
}
