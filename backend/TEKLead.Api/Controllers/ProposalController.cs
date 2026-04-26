using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/proposals")]
public class ProposalController : ControllerBase
{
    private readonly ProposalService _proposals;
    private readonly LeadService _leads;
    private readonly ILogger<ProposalController> _log;

    public ProposalController(ProposalService proposals, LeadService leads, ILogger<ProposalController> log)
    {
        _proposals = proposals;
        _leads = leads;
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

    [HttpPost("{id}/link-contact")]
    public async Task<IActionResult> LinkContact(Guid id, [FromBody] LinkContactRequest req)
    {
        var p = await _proposals.GetById(id);
        if (p == null) return NotFound();

        // Save contact as a lead row so we can reuse enrich flow
        Lead savedLead;
        if (req.Lead != null)
        {
            req.Lead.SavedAt = DateTime.UtcNow;
            savedLead = await _leads.Upsert(req.Lead);
        }
        else
        {
            savedLead = new Lead { Id = Guid.NewGuid() };
        }

        p.LinkedLeadId = savedLead.Id;
        p.ApolloContactJson = req.ApolloContactJson;
        if (!string.IsNullOrEmpty(req.ClientName)) p.ClientName = req.ClientName;
        if (!string.IsNullOrEmpty(req.ClientCompany)) p.ClientCompany = req.ClientCompany;

        var saved = await _proposals.Upsert(p);
        return Ok(new { proposal = saved, leadId = savedLead.Id });
    }

}

public class LinkContactRequest
{
    public Guid? LeadId { get; set; }
    public string? ApolloContactJson { get; set; }
    public string? ClientName { get; set; }
    public string? ClientCompany { get; set; }
    public Lead? Lead { get; set; }
}
