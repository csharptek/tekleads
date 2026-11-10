using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services.LinkedIn;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/linkedin")]
public class LinkedInController : ControllerBase
{
    private readonly LinkedInService _svc;
    private readonly LiSettingsService _li;
    private readonly ILogger<LinkedInController> _log;

    public LinkedInController(LinkedInService svc, LiSettingsService li, ILogger<LinkedInController> log)
    {
        _svc = svc; _li = li; _log = log;
    }

    private async Task<IActionResult> Run(Func<Task<object?>> f)
    {
        try { return Ok(await f() ?? new { ok = true }); }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "LinkedIn API error");
            return BadRequest(new { error = ex.Message });
        }
    }

    // Comments page
    [HttpGet("comments")]
    public Task<IActionResult> Comments([FromQuery] int newPage = 1) => Run(async () => await _svc.CommentsState(newPage));

    [HttpPost("comments/draft")]
    public Task<IActionResult> Draft([FromBody] LiDraftCommentReq req) => Run(async () => await _svc.DraftComment(req));

    [HttpPost("comments/draft-all")]
    public Task<IActionResult> DraftAll([FromBody] LiDraftAllReq req) => Run(async () => new { queued = await _svc.QueueDraftAll(req) });

    [HttpPost("comments/done")]
    public Task<IActionResult> Done([FromBody] LiDoneReq req) => Run(async () => { await _svc.MarkDone(req); return null; });

    [HttpPost("people/skip")]
    public Task<IActionResult> Skip([FromBody] LiLeadReq req) => Run(async () => { await _svc.SkipLead(req.LeadId); return null; });

    [HttpPost("people/remove")]
    public Task<IActionResult> Remove([FromBody] LiLeadReq req) => Run(async () => { await _svc.RemoveLead(req.LeadId, req.Reason); return null; });

    [HttpPost("people/accept")]
    public Task<IActionResult> Accept([FromBody] LiLeadReq req) => Run(async () => { await _svc.Accept(req.LeadId); return null; });

    [HttpPost("people/unaccept")]
    public Task<IActionResult> Unaccept([FromBody] LiLeadReq req) => Run(async () => { await _svc.Unaccept(req.LeadId); return null; });

    [HttpPost("people/stage")]
    public Task<IActionResult> Stage([FromBody] LiStageReq req) => Run(async () => { await _svc.SetStage(req); return null; });

    // Conversations page
    [HttpGet("conversations")]
    public Task<IActionResult> Conversations([FromQuery] string? f, [FromQuery] string? q, [FromQuery] int page = 1)
        => Run(async () => await _svc.Conversations(f, q, page));

    [HttpPost("conversations/reply")]
    public Task<IActionResult> LogReply([FromBody] LiLogReplyReq req) => Run(async () => { await _svc.LogReply(req); return null; });

    [HttpPost("conversations/regenerate")]
    public Task<IActionResult> Regenerate([FromBody] LiIdReq req) => Run(async () => { await _svc.Regenerate(req.Id); return null; });

    [HttpPost("conversations/posted")]
    public Task<IActionResult> Posted([FromBody] LiPostedReq req) => Run(async () => { await _svc.Posted(req); return null; });

    [HttpPost("conversations/delete")]
    public Task<IActionResult> DeleteReply([FromBody] LiIdReq req) => Run(async () => { await _svc.DeleteReply(req.Id); return null; });

    [HttpPost("reminders")]
    public Task<IActionResult> Remind([FromBody] LiRemindReq req) => Run(async () => { await _svc.Remind(req); return null; });

    [HttpPost("reminders/cancel")]
    public Task<IActionResult> CancelRemind([FromBody] LiIdReq req) => Run(async () => { await _svc.CancelRemind(req.Id); return null; });

    [HttpPost("reminders/done")]
    public Task<IActionResult> DoneRemind([FromBody] LiIdReq req) => Run(async () => { await _svc.DoneRemind(req.Id); return null; });

    // Settings + usage
    [HttpGet("settings")]
    public Task<IActionResult> GetSettings() => Run(async () => new { values = await _li.GetAll(), defaults = LiSettingsService.Defaults });

    [HttpPost("settings")]
    public Task<IActionResult> SaveSettings([FromBody] LiSettingsSaveReq req) => Run(async () => { await _li.Save(req.Values); return null; });

    [HttpGet("usage")]
    public Task<IActionResult> Usage() => Run(async () => await _svc.Usage());

    [HttpPost("briefs/build")]
    public Task<IActionResult> BuildBriefs() => Run(async () => new { submitted = await _svc.SubmitBriefs(200) });
}
