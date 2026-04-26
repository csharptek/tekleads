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
    private readonly BlobService _blob;
    private readonly ILogger<ProposalController> _log;

    public ProposalController(ProposalService proposals, LeadService leads, BlobService blob, ILogger<ProposalController> log)
    {
        _proposals = proposals;
        _leads = leads;
        _blob = blob;
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

    [HttpPost("{id}/upload")]
    [RequestSizeLimit(20 * 1024 * 1024)] // 20MB
    public async Task<IActionResult> UploadDocument(Guid id, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var allowed = new[] { "application/pdf", "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg", "image/png", "image/gif", "image/webp" };
        if (!allowed.Contains(file.ContentType))
            return BadRequest(new { error = "File type not allowed. Use PDF, Word, or images." });

        var proposal = await _proposals.GetById(id);
        if (proposal == null) return NotFound();

        await using var stream = file.OpenReadStream();
        var url = await _blob.UploadAsync(stream, file.FileName, file.ContentType);

        var urls = proposal.DocumentUrls.ToList();
        var names = proposal.DocumentNames.ToList();
        urls.Add(url);
        names.Add(file.FileName);
        proposal.DocumentUrls = urls.ToArray();
        proposal.DocumentNames = names.ToArray();
        await _proposals.Upsert(proposal);

        return Ok(new { url, name = file.FileName });
    }

    [HttpDelete("{id}/document")]
    public async Task<IActionResult> DeleteDocument(Guid id, [FromBody] DeleteDocRequest req)
    {
        var proposal = await _proposals.GetById(id);
        if (proposal == null) return NotFound();

        var urls = proposal.DocumentUrls.ToList();
        var names = proposal.DocumentNames.ToList();
        var idx = urls.IndexOf(req.Url);
        if (idx >= 0)
        {
            urls.RemoveAt(idx);
            if (idx < names.Count) names.RemoveAt(idx);
            proposal.DocumentUrls = urls.ToArray();
            proposal.DocumentNames = names.ToArray();
            await _proposals.Upsert(proposal);
            try { await _blob.DeleteAsync(req.Url); } catch { }
        }
        return Ok(new { deleted = true });
    }

    [HttpPost("{id}/link-contact")]
    public async Task<IActionResult> LinkContact(Guid id, [FromBody] LinkContactRequest req)
    {
        var p = await _proposals.GetById(id);
        if (p == null) return NotFound();

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

public class DeleteDocRequest
{
    public string Url { get; set; } = "";
}
