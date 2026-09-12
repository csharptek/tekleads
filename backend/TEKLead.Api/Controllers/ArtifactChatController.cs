using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/artifacts")]
public class ArtifactChatController : ControllerBase
{
    private readonly ArtifactChatService _chat;

    public ArtifactChatController(ArtifactChatService chat)
    {
        _chat = chat;
    }

    [HttpGet("{proposalId}/chat")]
    public async Task<IActionResult> GetHistory(Guid proposalId)
    {
        var history = await _chat.GetHistory(proposalId);
        return Ok(history.Select(ToDto));
    }

    [HttpPost("{proposalId}/chat")]
    public async Task<IActionResult> SendMessage(Guid proposalId, [FromBody] ChatSendRequest req)
    {
        try
        {
            var res = await _chat.SendMessage(proposalId, req.Message ?? "");
            if (!res.Ok) return BadRequest(new { error = res.Error });
            return Ok(ToDto(res.Message!));
        }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/chat/apply-action")]
    public async Task<IActionResult> ApplyAction(Guid proposalId, [FromBody] ChatAction action)
    {
        try
        {
            var res = await _chat.ApplyAction(proposalId, action);
            if (!res.Ok) return BadRequest(new { error = res.Error });
            return Ok(new { ok = true, summary = res.Summary, artifactsResult = res.ArtifactsResult, project = res.Project });
        }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    // ── Email coaching chat — separate thread/endpoints, cover-letter ones above untouched ──

    [HttpGet("{proposalId}/chat/email")]
    public async Task<IActionResult> GetEmailHistory(Guid proposalId)
    {
        var history = await _chat.GetHistory(proposalId, "email");
        return Ok(history.Select(ToDto));
    }

    [HttpPost("{proposalId}/chat/email")]
    public async Task<IActionResult> SendEmailMessage(Guid proposalId, [FromBody] ChatSendRequest req)
    {
        try
        {
            var res = await _chat.SendMessage(proposalId, req.Message ?? "", "email");
            if (!res.Ok) return BadRequest(new { error = res.Error });
            return Ok(ToDto(res.Message!));
        }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    [HttpPost("{proposalId}/chat/email/apply-action")]
    public async Task<IActionResult> ApplyEmailAction(Guid proposalId, [FromBody] ChatAction action)
    {
        try
        {
            var res = await _chat.ApplyAction(proposalId, action, "email");
            if (!res.Ok) return BadRequest(new { error = res.Error });
            return Ok(new { ok = true, summary = res.Summary, artifactsResult = res.ArtifactsResult, project = res.Project });
        }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    private static object ToDto(ArtifactChatMessage m) => new
    {
        id = m.Id,
        role = m.Role,
        content = m.Content,
        actions = string.IsNullOrWhiteSpace(m.ActionsJson)
            ? new List<ChatAction>()
            : System.Text.Json.JsonSerializer.Deserialize<List<ChatAction>>(m.ActionsJson) ?? new List<ChatAction>(),
        createdAt = m.CreatedAt,
    };
}

public class ChatSendRequest { public string? Message { get; set; } }
