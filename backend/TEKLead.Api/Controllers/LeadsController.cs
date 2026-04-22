using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.DTOs;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/leads")]
public class LeadsController : ControllerBase
{
    private readonly ApolloService _apollo;
    private readonly DbService _db;

    public LeadsController(ApolloService apollo, DbService db) { _apollo = apollo; _db = db; }

    [HttpPost("search")]
    public async Task<IActionResult> Search([FromBody] LeadSearchRequest request)
    {
        var (leads, hasMore) = await _apollo.SearchPeople(request);
        return Ok(new { leads, hasMore, page = request.Page });
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] Lead lead)
    {
        lead.Id = Guid.NewGuid();
        lead.SavedAt = DateTime.UtcNow;
        return Ok(await _db.InsertLead(lead));
    }

    [HttpGet("saved")]
    public async Task<IActionResult> GetSaved() => Ok(await _db.GetLeads());

    [HttpPut("{id}/phones")]
    public async Task<IActionResult> UpdatePhones(Guid id, [FromBody] UpdatePhonesRequest request)
    {
        var lead = await _db.GetLeadById(id);
        if (lead == null) return NotFound("Lead not found");
        await _db.UpdateLeadPhones(id, request.Phones);
        return Ok();
    }

    [HttpPost("{id}/reveal-phones")]
    public async Task<IActionResult> RevealPhones(Guid id, [FromBody] RevealPhoneRequest request)
    {
        var lead = await _db.GetLeadById(id);
        if (lead == null) return NotFound("Lead not found");
        var phones = await _apollo.RevealPhones(request.ApolloPersonId);
        await _db.UpdateLeadPhones(id, phones);
        return Ok(new { phones });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _db.DeleteLead(id);
        return Ok();
    }
}
