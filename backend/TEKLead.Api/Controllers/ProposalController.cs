using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/proposals")]
public class ProposalController : ControllerBase
{
    private readonly ProposalService _proposals;
    private readonly ApolloService _apollo;
    private readonly ILogger<ProposalController> _log;

    public ProposalController(ProposalService proposals, ApolloService apollo, ILogger<ProposalController> log)
    {
        _proposals = proposals;
        _apollo = apollo;
        _log = log;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await _proposals.GetAll());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await _proposals.GetById(id);
        return p == null ? NotFound() : Ok(p);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Proposal p)
    {
        p.Id = Guid.NewGuid();
        p.CreatedAt = DateTime.UtcNow;
        var saved = await _proposals.Upsert(p);
        return Ok(saved);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] Proposal p)
    {
        p.Id = id;
        var saved = await _proposals.Upsert(p);
        return Ok(saved);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _proposals.Delete(id);
        return Ok(new { deleted = true });
    }

    [HttpPost("apollo-search")]
    public async Task<IActionResult> ApolloSearch([FromBody] ApolloSearchForProposalRequest req)
    {
        try
        {
            var (leads, total) = await _apollo.Search(
                req.Name, req.Title, req.Company, null, null, 1, 10);
            return Ok(new { leads, total });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Apollo search for proposal failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{id}/link-contact")]
    public async Task<IActionResult> LinkContact(Guid id, [FromBody] LinkContactRequest req)
    {
        var p = await _proposals.GetById(id);
        if (p == null) return NotFound();

        p.LinkedLeadId = req.LeadId;
        p.ApolloContactJson = req.ApolloContactJson;
        if (!string.IsNullOrEmpty(req.ClientName)) p.ClientName = req.ClientName;
        if (!string.IsNullOrEmpty(req.ClientCompany)) p.ClientCompany = req.ClientCompany;

        var saved = await _proposals.Upsert(p);
        return Ok(saved);
    }
}

public class ApolloSearchForProposalRequest
{
    public string? Name { get; set; }
    public string? Company { get; set; }
    public string? Title { get; set; }
}

public class LinkContactRequest
{
    public Guid? LeadId { get; set; }
    public string? ApolloContactJson { get; set; }
    public string? ClientName { get; set; }
    public string? ClientCompany { get; set; }
}
