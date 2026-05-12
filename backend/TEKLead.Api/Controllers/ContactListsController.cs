using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/contact-lists")]
public class ContactListsController : ControllerBase
{
    private readonly ContactListService _svc;
    private readonly GraphEmailService  _graphEmail;
    private readonly ApolloService      _apollo;
    private readonly ILogger<ContactListsController> _log;

    public ContactListsController(
        ContactListService svc,
        GraphEmailService graphEmail,
        ApolloService apollo,
        ILogger<ContactListsController> log)
    {
        _svc        = svc;
        _graphEmail = graphEmail;
        _apollo     = apollo;
        _log        = log;
    }

    // ── Lists ─────────────────────────────────────────────────────────────

    [HttpGet]
    public async Task<IActionResult> GetLists() =>
        Ok(await _svc.GetLists());

    [HttpPost("upload")]
    public async Task<IActionResult> Upload([FromForm] string title, IFormFile file)
    {
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(new { error = "Title is required." });
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "File is required." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".xlsx")
            return BadRequest(new { error = "Only .xlsx files are supported." });

        var listId = await _svc.CreateList(title.Trim());
        await using var stream = file.OpenReadStream();
        var count = await _svc.ImportExcel(listId, stream);

        return Ok(new { listId, imported = count });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteList(Guid id)
    {
        await _svc.DeleteList(id);
        return Ok(new { deleted = true });
    }

    // ── Contacts ─────────────────────────────────────────────────────────

    [HttpGet("{listId:guid}/contacts")]
    public async Task<IActionResult> GetContacts(
        Guid listId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? search = null,
        [FromQuery] string? status = null)
    {
        var (items, total) = await _svc.GetContacts(listId, page, pageSize, search, status);
        return Ok(new { items, total, page, pageSize });
    }

    // ── Enrichment ───────────────────────────────────────────────────────

    [HttpPost("{listId:guid}/enrich")]
    public async Task<IActionResult> Enrich(Guid listId, [FromBody] EnrichRequest req)
    {
        if (req.ContactIds == null || req.ContactIds.Count == 0)
            return BadRequest(new { error = "No contacts selected." });

        var baseUrl = $"{Request.Scheme}://{Request.Host}";
        var (ok, failed) = await _svc.EnrichContacts(req.ContactIds, baseUrl);
        return Ok(new { enriched = ok, failed });
    }

    [HttpPost("phone-webhook/{contactId:guid}")]
    public async Task<IActionResult> PhoneWebhook(Guid contactId)
    {
        using var sr   = new StreamReader(Request.Body);
        var body       = await sr.ReadToEndAsync();
        var phones     = ApolloService.ParsePhonesFromWebhook(body);
        await _svc.PhoneWebhook(contactId, phones);
        return Ok(new { received = true, phonesFound = phones.Length });
    }

    // ── Templates ────────────────────────────────────────────────────────

    [HttpGet("{listId:guid}/templates")]
    public async Task<IActionResult> GetTemplates(Guid listId) =>
        Ok(await _svc.GetTemplates(listId));

    [HttpPost("{listId:guid}/templates")]
    public async Task<IActionResult> UpsertTemplate(Guid listId, [FromBody] ContactTemplate t)
    {
        t.ListId = listId;
        var id = await _svc.UpsertTemplate(t);
        return Ok(new { id });
    }

    [HttpDelete("{listId:guid}/templates/{templateId:guid}")]
    public async Task<IActionResult> DeleteTemplate(Guid listId, Guid templateId)
    {
        await _svc.DeleteTemplate(templateId);
        return Ok(new { deleted = true });
    }

    // ── Outreach ─────────────────────────────────────────────────────────

    [HttpPost("{listId:guid}/send-email")]
    public async Task<IActionResult> SendEmail(Guid listId, [FromBody] ContactEmailSendRequest req)
    {
        if (string.IsNullOrEmpty(req.ToEmail))
            return BadRequest(new { error = "Email required." });

        try
        {
            var (ok, err) = await _graphEmail.SendEmail(req.ToEmail, req.ToName ?? "", req.Subject, req.Body);
            if (!ok) throw new Exception(err);
            await _svc.LogOutreach(new ContactOutreachLog
            {
                ContactId = req.ContactId,
                ListId    = listId,
                Type      = "email",
                Recipient = req.ToEmail,
                Status    = "sent",
            });
            return Ok(new { sent = true });
        }
        catch (Exception ex)
        {
            await _svc.LogOutreach(new ContactOutreachLog
            {
                ContactId = req.ContactId,
                ListId    = listId,
                Type      = "email",
                Recipient = req.ToEmail,
                Status    = "failed",
                Error     = ex.Message,
            });
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpPost("{listId:guid}/log-whatsapp")]
    public async Task<IActionResult> LogWhatsApp(Guid listId, [FromBody] ContactWhatsAppLogRequest req)
    {
        await _svc.LogOutreach(new ContactOutreachLog
        {
            ContactId = req.ContactId,
            ListId    = listId,
            Type      = "whatsapp",
            Recipient = req.Phone,
            Status    = "opened",
        });
        return Ok(new { logged = true });
    }

    [HttpGet("{listId:guid}/outreach-log")]
    public async Task<IActionResult> GetOutreachLog(Guid listId) =>
        Ok(await _svc.GetOutreachLog(listId));
}

public class EnrichRequest
{
    public List<Guid> ContactIds { get; set; } = new();
}

public class ContactEmailSendRequest
{
    public Guid   ContactId { get; set; }
    public string ToEmail   { get; set; } = "";
    public string? ToName   { get; set; }
    public string Subject   { get; set; } = "";
    public string Body      { get; set; } = "";
}

public class ContactWhatsAppLogRequest
{
    public Guid   ContactId { get; set; }
    public string Phone     { get; set; } = "";
}
