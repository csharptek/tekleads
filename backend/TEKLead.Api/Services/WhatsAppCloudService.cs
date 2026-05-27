// DEPLOY-CHECK: whatsapp-cloud-v2-hr-inbox-20260525
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class WhatsAppCloudService
{
    private readonly HttpClient _http;
    private readonly SettingsService _settings;
    private readonly ILogger<WhatsAppCloudService> _log;
    private readonly ContactListService _contactListSvc;
    private readonly GraphEmailService _email;

    private const string DefaultApiVersion = "v22.0";

    public WhatsAppCloudService(HttpClient http, SettingsService settings, ILogger<WhatsAppCloudService> log, GraphEmailService email, ContactListService contactListSvc)
    {
        _http = http;
        _settings = settings;
        _log = log;
        _contactListSvc = contactListSvc;
        _email = email;
    }

    // ─────────────────────────────────────────────────────────────
    // Schema
    // ─────────────────────────────────────────────────────────────
    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs))
        {
            _log.LogWarning("WhatsAppCloud: no PG conn string; skipping schema.");
            return;
        }
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS whatsapp_messages (
                id TEXT PRIMARY KEY,
                lead_id TEXT NULL,
                proposal_id TEXT NULL,
                direction TEXT NOT NULL DEFAULT 'outbound',
                to_phone TEXT NOT NULL DEFAULT '',
                from_phone TEXT NOT NULL DEFAULT '',
                message_type TEXT NOT NULL DEFAULT 'template',
                template_name TEXT NULL,
                body TEXT NULL,
                wamid TEXT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                error_code TEXT NULL,
                error_message TEXT NULL,
                raw_payload TEXT NULL,
                media_url TEXT NULL,
                media_caption TEXT NULL,
                inbox_type TEXT NOT NULL DEFAULT 'sales',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_lead ON whatsapp_messages (lead_id)");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_wamid ON whatsapp_messages (wamid)");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_created ON whatsapp_messages (created_at DESC)");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_inbox_type ON whatsapp_messages (inbox_type)");
        // Migration: add inbox_type if table already existed without it
        await c.ExecuteAsync(@"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='whatsapp_messages' AND column_name='inbox_type'
                ) THEN
                    ALTER TABLE whatsapp_messages ADD COLUMN inbox_type TEXT NOT NULL DEFAULT 'sales';
                END IF;
            END$$");
        await c.ExecuteAsync(@"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='whatsapp_messages' AND column_name='media_url'
                ) THEN
                    ALTER TABLE whatsapp_messages ADD COLUMN media_url TEXT NULL;
                END IF;
            END$$");
        await c.ExecuteAsync(@"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='whatsapp_messages' AND column_name='media_caption'
                ) THEN
                    ALTER TABLE whatsapp_messages ADD COLUMN media_caption TEXT NULL;
                END IF;
            END$$");
        // Migration: add is_hot_lead to whatsapp_messages if missing
        await c.ExecuteAsync(@"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='whatsapp_messages' AND column_name='is_hot_lead'
                ) THEN
                    ALTER TABLE whatsapp_messages ADD COLUMN is_hot_lead BOOLEAN NOT NULL DEFAULT FALSE;
                END IF;
            END$$");
        _log.LogInformation("WhatsAppCloud schema OK.");
    }

    // ─────────────────────────────────────────────────────────────
    // Resolve Meta media_id → public download URL
    // ─────────────────────────────────────────────────────────────
    private async Task<string?> ResolveMediaUrl(string mediaId, string token, string version)
    {
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Get,
                $"https://graph.facebook.com/{version}/{mediaId}");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;
            var raw = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("url", out var urlEl))
                return urlEl.GetString();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "ResolveMediaUrl failed for {MediaId}", mediaId);
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────
    // Routing: +91 → HR inbox
    // ─────────────────────────────────────────────────────────────
    private static string ResolveInboxType(string phone)
    {
        var clean = new string((phone ?? "").Where(char.IsDigit).ToArray());
        return (clean.StartsWith("91") && clean.Length >= 12) ? "hr" : "sales";
    }

    // ─────────────────────────────────────────────────────────────
    // Config helpers
    // ─────────────────────────────────────────────────────────────
    private async Task<(string token, string phoneId, string version, string verifyToken, string tplName, string tplLang)> LoadConfig()
    {
        var s = await _settings.GetAll();
        return (
            s.GetValueOrDefault(SettingKeys.WhatsappCloudAccessToken, ""),
            s.GetValueOrDefault(SettingKeys.WhatsappCloudPhoneNumberId, ""),
            string.IsNullOrWhiteSpace(s.GetValueOrDefault(SettingKeys.WhatsappCloudApiVersion, ""))
                ? DefaultApiVersion
                : s[SettingKeys.WhatsappCloudApiVersion],
            s.GetValueOrDefault(SettingKeys.WhatsappCloudVerifyToken, ""),
            s.GetValueOrDefault(SettingKeys.WhatsappCloudTemplateName, "hello_world"),
            string.IsNullOrWhiteSpace(s.GetValueOrDefault(SettingKeys.WhatsappCloudTemplateLang, ""))
                ? "en_US"
                : s[SettingKeys.WhatsappCloudTemplateLang]
        );
    }

    private static string CleanPhone(string raw) =>
        new string((raw ?? "").Where(char.IsDigit).ToArray());

    // ─────────────────────────────────────────────────────────────
    // Send template
    // ─────────────────────────────────────────────────────────────
    public async Task<(bool Ok, string Wamid, string Error, string RawResponse)> SendTemplate(
        string toPhone,
        string? templateName,
        string? langCode,
        List<string>? bodyVariables,
        string? leadId = null,
        string? proposalId = null)
    {
        var cfg = await LoadConfig();
        if (string.IsNullOrWhiteSpace(cfg.token)) return (false, "", "Access token not configured.", "");
        if (string.IsNullOrWhiteSpace(cfg.phoneId)) return (false, "", "Phone Number ID not configured.", "");

        var phone = CleanPhone(toPhone);
        if (string.IsNullOrWhiteSpace(phone)) return (false, "", "Recipient phone is empty.", "");

        var tpl = string.IsNullOrWhiteSpace(templateName) ? cfg.tplName : templateName!;
        var lang = string.IsNullOrWhiteSpace(langCode) ? cfg.tplLang : langCode!;

        object templateObj;
        if (bodyVariables != null && bodyVariables.Count > 0)
        {
            var parameters = bodyVariables
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Select(v => new { type = "text", text = System.Text.RegularExpressions.Regex.Replace(v.Trim().Replace("\n", " ").Replace("\r", " ").Replace("\t", " "), @" {5,}", "    ") })
                .ToArray();
            templateObj = new { name = tpl, language = new { code = lang }, components = new[] { new { type = "body", parameters } } };
        }
        else
        {
            templateObj = new { name = tpl, language = new { code = lang } };
        }

        var payload = new { messaging_product = "whatsapp", to = phone, type = "template", template = templateObj };
        var url = $"https://graph.facebook.com/{cfg.version}/{cfg.phoneId}/messages";
        return await Post(url, cfg.token, payload, phone, "template", tpl, null, leadId, proposalId);
    }

    // ─────────────────────────────────────────────────────────────
    // Send attachment (document / image / video / audio)
    // ─────────────────────────────────────────────────────────────
    public async Task<(bool Ok, string Wamid, string Error, string RawResponse)> SendAttachment(
        string toPhone,
        string fileUrl,
        string attachmentType,   // document | image | video | audio
        string? caption,
        string? filename,
        string? leadId = null,
        string? proposalId = null)
    {
        var cfg = await LoadConfig();
        if (string.IsNullOrWhiteSpace(cfg.token)) return (false, "", "Access token not configured.", "");
        if (string.IsNullOrWhiteSpace(cfg.phoneId)) return (false, "", "Phone Number ID not configured.", "");

        var phone = CleanPhone(toPhone);
        if (string.IsNullOrWhiteSpace(phone)) return (false, "", "Recipient phone is empty.", "");
        if (string.IsNullOrWhiteSpace(fileUrl)) return (false, "", "File URL is empty.", "");

        var type = attachmentType?.ToLower() switch
        {
            "image"    => "image",
            "video"    => "video",
            "audio"    => "audio",
            _          => "document"
        };

        object mediaObj;
        if (type == "document")
            mediaObj = new { link = fileUrl, caption = caption ?? "", filename = filename ?? System.IO.Path.GetFileName(fileUrl) };
        else if (type == "image")
            mediaObj = new { link = fileUrl, caption = caption ?? "" };
        else
            mediaObj = new { link = fileUrl };

        var payloadDict = new Dictionary<string, object>
        {
            ["messaging_product"] = "whatsapp",
            ["recipient_type"]    = "individual",
            ["to"]                = phone,
            ["type"]              = type,
            [type]                = mediaObj
        };

        var url = $"https://graph.facebook.com/{cfg.version}/{cfg.phoneId}/messages";
        return await Post(url, cfg.token, payloadDict, phone, type, null, caption ?? filename ?? fileUrl, leadId, proposalId);
    }

    // ─────────────────────────────────────────────────────────────
    // Send free-form text
    // ─────────────────────────────────────────────────────────────
    public async Task<(bool Ok, string Wamid, string Error, string RawResponse)> SendText(
        string toPhone,
        string body,
        string? leadId = null,
        string? proposalId = null)
    {
        var cfg = await LoadConfig();
        if (string.IsNullOrWhiteSpace(cfg.token)) return (false, "", "Access token not configured.", "");
        if (string.IsNullOrWhiteSpace(cfg.phoneId)) return (false, "", "Phone Number ID not configured.", "");

        var phone = CleanPhone(toPhone);
        if (string.IsNullOrWhiteSpace(phone)) return (false, "", "Recipient phone is empty.", "");
        if (string.IsNullOrWhiteSpace(body)) return (false, "", "Message body is empty.", "");

        var payload = new { messaging_product = "whatsapp", recipient_type = "individual", to = phone, type = "text", text = new { preview_url = false, body = body } };
        var url = $"https://graph.facebook.com/{cfg.version}/{cfg.phoneId}/messages";
        return await Post(url, cfg.token, payload, phone, "text", null, body, leadId, proposalId);
    }

    // ─────────────────────────────────────────────────────────────
    // Generic POST + persistence
    // ─────────────────────────────────────────────────────────────
    private async Task<(bool Ok, string Wamid, string Error, string RawResponse)> Post(
        string url, string token, object payload,
        string toPhone, string messageType, string? templateName, string? body,
        string? leadId, string? proposalId)
    {
        var json = JsonSerializer.Serialize(payload);
        var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        string raw = "";
        bool ok = false;
        string wamid = "";
        string err = "";

        try
        {
            var res = await _http.SendAsync(req);
            raw = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                err = $"{(int)res.StatusCode} {res.ReasonPhrase}: {raw}";
                _log.LogError("WA Cloud send failed: {Err}", err);
            }
            else
            {
                ok = true;
                try
                {
                    using var doc = JsonDocument.Parse(raw);
                    if (doc.RootElement.TryGetProperty("messages", out var msgs) &&
                        msgs.ValueKind == JsonValueKind.Array && msgs.GetArrayLength() > 0)
                    {
                        var first = msgs[0];
                        if (first.TryGetProperty("id", out var idEl))
                            wamid = idEl.GetString() ?? "";
                    }
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            err = ex.Message;
            _log.LogError(ex, "WA Cloud send exception");
        }

        // Outbound messages from TEKLead are sales-context
        try
        {
            await SaveMessage(new WhatsAppMessage
            {
                Id = Guid.NewGuid().ToString(),
                LeadId = leadId,
                ProposalId = proposalId,
                Direction = "outbound",
                ToPhone = toPhone,
                MessageType = messageType,
                TemplateName = templateName,
                Body = body,
                Wamid = wamid,
                Status = ok ? "sent" : "failed",
                ErrorMessage = ok ? null : err,
                RawPayload = raw,
                InboxType = "sales",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Persist outbound WA message failed");
        }

        return (ok, wamid, err, raw);
    }

    // ─────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────
    public async Task SaveMessage(WhatsAppMessage m)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO whatsapp_messages
                (id, lead_id, proposal_id, direction, to_phone, from_phone, message_type, template_name,
                 body, wamid, status, error_code, error_message, raw_payload, media_url, media_caption,
                 inbox_type, created_at, updated_at)
            VALUES
                (@Id, @LeadId, @ProposalId, @Direction, @ToPhone, @FromPhone, @MessageType, @TemplateName,
                 @Body, @Wamid, @Status, @ErrorCode, @ErrorMessage, @RawPayload, @MediaUrl, @MediaCaption,
                 @InboxType, @CreatedAt, @UpdatedAt)",
            m);
    }

    // Keep old name as alias for callers that still use it
    public Task SaveOutbound(WhatsAppMessage m) => SaveMessage(m);

    public async Task<List<WhatsAppMessage>> ListByLead(string leadId)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return new();
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<WhatsAppMessage>(@"
            SELECT id AS Id, lead_id AS LeadId, proposal_id AS ProposalId, direction AS Direction,
                   to_phone AS ToPhone, from_phone AS FromPhone, message_type AS MessageType,
                   template_name AS TemplateName, body AS Body, wamid AS Wamid, status AS Status,
                   error_code AS ErrorCode, error_message AS ErrorMessage, raw_payload AS RawPayload, media_url AS MediaUrl, media_caption AS MediaCaption,
                   inbox_type AS InboxType, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM whatsapp_messages
            WHERE lead_id = @LeadId
            ORDER BY created_at DESC", new { LeadId = leadId });
        return rows.ToList();
    }

    public async Task<List<WhatsAppMessage>> ListRecent(int limit = 50)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return new();
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<WhatsAppMessage>(@"
            SELECT id AS Id, lead_id AS LeadId, proposal_id AS ProposalId, direction AS Direction,
                   to_phone AS ToPhone, from_phone AS FromPhone, message_type AS MessageType,
                   template_name AS TemplateName, body AS Body, wamid AS Wamid, status AS Status,
                   error_code AS ErrorCode, error_message AS ErrorMessage, raw_payload AS RawPayload, media_url AS MediaUrl, media_caption AS MediaCaption,
                   inbox_type AS InboxType, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM whatsapp_messages
            ORDER BY created_at DESC
            LIMIT @Limit", new { Limit = limit });
        return rows.ToList();
    }

    // ─────────────────────────────────────────────────────────────
    // Webhook ingestion
    // ─────────────────────────────────────────────────────────────
    public async Task<(bool Ok, string Note)> IngestWebhook(string rawBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(rawBody);
            var root = doc.RootElement;
            if (!root.TryGetProperty("entry", out var entries) || entries.ValueKind != JsonValueKind.Array)
                return (true, "no entries");

            var cs = _settings.ConnectionString;
            int statusUpdates = 0, inbound = 0;

            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("changes", out var changes) || changes.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var change in changes.EnumerateArray())
                {
                    if (!change.TryGetProperty("value", out var val)) continue;

                    // Statuses
                    if (val.TryGetProperty("statuses", out var statuses) && statuses.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var st in statuses.EnumerateArray())
                        {
                            var wamid = st.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
                            var status = st.TryGetProperty("status", out var sEl) ? sEl.GetString() ?? "" : "";
                            string? errCode = null, errMsg = null;
                            if (st.TryGetProperty("errors", out var errs) && errs.ValueKind == JsonValueKind.Array && errs.GetArrayLength() > 0)
                            {
                                var e0 = errs[0];
                                if (e0.TryGetProperty("code", out var ec)) errCode = ec.ToString();
                                if (e0.TryGetProperty("title", out var et)) errMsg = et.GetString();
                                if (e0.TryGetProperty("message", out var em)) errMsg = em.GetString() ?? errMsg;
                            }

                            if (!string.IsNullOrEmpty(wamid) && !string.IsNullOrEmpty(cs))
                            {
                                await using var c = new NpgsqlConnection(cs);
                                await c.OpenAsync();
                                await c.ExecuteAsync(@"
                                    UPDATE whatsapp_messages
                                    SET status = @Status,
                                        error_code = COALESCE(@ErrCode, error_code),
                                        error_message = COALESCE(@ErrMsg, error_message),
                                        updated_at = NOW()
                                    WHERE wamid = @Wamid",
                                    new { Wamid = wamid, Status = status, ErrCode = errCode, ErrMsg = errMsg });
                                statusUpdates++;

                                // Auto-flag contact as wa_failed / wa_delivered
                                if (status == "failed" || status == "delivered" || status == "read")
                                {
                                    var waContactStatus = status == "failed" ? "wa_failed" : "wa_delivered";
                                    var toPhone = await c.ExecuteScalarAsync<string>(
                                        "SELECT to_phone FROM whatsapp_messages WHERE wamid = @Wamid LIMIT 1",
                                        new { Wamid = wamid }) ?? "";
                                    if (!string.IsNullOrEmpty(toPhone))
                                        await _contactListSvc.UpdateWaOutreachStatus(toPhone, waContactStatus);
                                }
                            }
                        }
                    }

                    // Inbound messages
                    if (val.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var m in msgs.EnumerateArray())
                        {
                            var wamid = m.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
                            var from = m.TryGetProperty("from", out var fEl) ? fEl.GetString() ?? "" : "";
                            var type = m.TryGetProperty("type", out var tEl) ? tEl.GetString() ?? "" : "";
                            string body = "";
                            if (type == "text" && m.TryGetProperty("text", out var tx) && tx.TryGetProperty("body", out var bEl))
                                body = bEl.GetString() ?? "";
                            else if (type == "button" && m.TryGetProperty("button", out var btn) && btn.TryGetProperty("text", out var btEl))
                                body = btEl.GetString() ?? "";
                            else if (type == "interactive" && m.TryGetProperty("interactive", out var intr))
                            {
                                var iType = intr.TryGetProperty("type", out var itEl) ? itEl.GetString() : "";
                                if (iType == "button_reply" && intr.TryGetProperty("button_reply", out var br) && br.TryGetProperty("title", out var brT))
                                    body = brT.GetString() ?? "";
                                else if (iType == "list_reply" && intr.TryGetProperty("list_reply", out var lr) && lr.TryGetProperty("title", out var lrT))
                                    body = lrT.GetString() ?? "";
                            }
                            else if (type == "image" || type == "video" || type == "audio" || type == "document")
                                body = $"[{type}]";
                            if (string.IsNullOrEmpty(body) && !string.IsNullOrEmpty(type))
                                body = $"[{type}]";

                            // Extract media_id and caption for media messages
                            string? mediaUrl = null;
                            string? mediaCaption = null;
                            if (type == "image" || type == "video" || type == "audio" || type == "document")
                            {
                                if (m.TryGetProperty(type, out var mediaEl))
                                {
                                    var mediaId = mediaEl.TryGetProperty("id", out var midEl) ? midEl.GetString() : null;
                                    mediaCaption = mediaEl.TryGetProperty("caption", out var capEl) ? capEl.GetString() : null;
                                    if (!string.IsNullOrEmpty(mediaId))
                                    {
                                        var cfg2 = await LoadConfig();
                                        mediaUrl = await ResolveMediaUrl(mediaId, cfg2.token, cfg2.version);
                                    }
                                }
                            }

                            // Determine inbox routing
                            var inboxType = ResolveInboxType(from);

                            if (!string.IsNullOrEmpty(cs))
                            {
                                await SaveMessage(new WhatsAppMessage
                                {
                                    Id = Guid.NewGuid().ToString(),
                                    Direction = "inbound",
                                    FromPhone = from,
                                    MessageType = type,
                                    Body = body,
                                    Wamid = wamid,
                                    Status = "received",
                                    RawPayload = m.GetRawText(),
                                    MediaUrl = mediaUrl,
                                    MediaCaption = mediaCaption,
                                    InboxType = inboxType,
                                    CreatedAt = DateTime.UtcNow,
                                    UpdatedAt = DateTime.UtcNow
                                });
                                inbound++;

                                var capturedFrom = from;
                                var capturedBody = body;
                                var capturedType = type;
                                var capturedInboxType = inboxType;

                                _ = Task.Run(async () =>
                                {
                                    try
                                    {
                                        var contactName = await GetContactNameByPhone(capturedFrom);
                                        var displayName = string.IsNullOrEmpty(contactName) ? $"+{capturedFrom}" : contactName;
                                        var msgText = string.IsNullOrEmpty(capturedBody) ? $"[{capturedType}]" : capturedBody;
                                        var time = DateTime.UtcNow.ToString("dd MMM yyyy, hh:mm tt") + " UTC";
                                        var subject = $"New WhatsApp Reply from +{capturedFrom}";
                                        var emailBody = $@"You have a new WhatsApp reply on TEKLead AI.

Contact: {displayName}
Phone: +{capturedFrom}
Message: {msgText}
Time: {time}

Login to TEKLead AI to respond.";

                                        if (capturedInboxType == "hr")
                                        {
                                            await _email.SendEmail("hr@csharptek.com", "HR Team", subject, emailBody);
                                            await _email.SendEmail("amrita.rani@csharptek.com", "Amrita", subject, emailBody);
                                        }
                                        else
                                        {
                                            await _email.SendEmail("bhanu@csharptek.com", "Bhanu", subject, emailBody);
                                            await _email.SendEmail("manjika.tantia@csharptek.com", "Manjika", subject, emailBody);
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        _log.LogWarning(ex, "WA reply email notification failed");
                                    }
                                });
                            }
                        }
                    }
                }
            }

            return (true, $"statuses:{statusUpdates} inbound:{inbound}");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "WA webhook ingest failed");
            return (false, ex.Message);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Status
    // ─────────────────────────────────────────────────────────────
    public async Task<object> Status()
    {
        var cfg = await LoadConfig();
        return new
        {
            phoneNumberIdSet = !string.IsNullOrWhiteSpace(cfg.phoneId),
            accessTokenSet   = !string.IsNullOrWhiteSpace(cfg.token),
            verifyTokenSet   = !string.IsNullOrWhiteSpace(cfg.verifyToken),
            apiVersion       = cfg.version,
            defaultTemplate  = cfg.tplName,
            defaultLanguage  = cfg.tplLang
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Inbox — scoped by inbox type
    // ─────────────────────────────────────────────────────────────
    public async Task<WhatsAppInboxPage> GetInbox(string inboxType = "sales", int page = 1, int pageSize = 50)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return new();
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var offset = (page - 1) * pageSize;

        var rows = await c.QueryAsync<WhatsAppInboxThread>(@"
            SELECT
                w.Phone,
                COALESCE(sl.name, ct.name) AS ContactName,
                w.LastMessage,
                w.LastTemplate,
                w.LastAt,
                w.MessageCount,
                w.UnreadCount,
                w.InboxType,
                w.IsHotLead,
                w.HasInbound,
                w.LastOutboundStatus
            FROM (
                SELECT
                    COALESCE(NULLIF(from_phone,''), to_phone) AS Phone,
                    MAX(body) AS LastMessage,
                    MAX(template_name) AS LastTemplate,
                    MAX(created_at) AS LastAt,
                    COUNT(*) AS MessageCount,
                    SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS UnreadCount,
                    MAX(inbox_type) AS InboxType,
                    BOOL_OR(COALESCE(is_hot_lead, FALSE)) AS IsHotLead,
                    SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) > 0 AS HasInbound,
                    (SELECT status FROM whatsapp_messages m2
                     WHERE m2.direction='outbound'
                       AND (m2.to_phone = COALESCE(NULLIF(wm.from_phone,''), wm.to_phone)
                            OR m2.from_phone = COALESCE(NULLIF(wm.from_phone,''), wm.to_phone))
                     ORDER BY m2.created_at DESC LIMIT 1) AS LastOutboundStatus
                FROM whatsapp_messages wm
                WHERE inbox_type = @InboxType
                GROUP BY COALESCE(NULLIF(from_phone,''), to_phone)
            ) w
            LEFT JOIN saved_leads sl
                ON EXISTS (
                    SELECT 1 FROM unnest(sl.phones) AS p
                    WHERE regexp_replace(p, '[^0-9]', '', 'g') = regexp_replace(w.Phone, '[^0-9]', '', 'g')
                )
            LEFT JOIN contacts ct
                ON regexp_replace(ct.phone, '[^0-9]', '', 'g') = regexp_replace(w.Phone, '[^0-9]', '', 'g')
            ORDER BY w.IsHotLead DESC, w.LastAt DESC
            LIMIT @PageSize OFFSET @Offset",
            new { InboxType = inboxType, PageSize = pageSize, Offset = offset });

        var total = await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT COALESCE(NULLIF(from_phone,''), to_phone))
            FROM whatsapp_messages WHERE inbox_type = @InboxType",
            new { InboxType = inboxType });

        var list = rows.ToList();
        return new WhatsAppInboxPage
        {
            Items = list,
            Total = total,
            Page = page,
            PageSize = pageSize,
            HasMore = (offset + list.Count) < total
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Hot lead toggle — sets/unsets is_hot_lead on all messages for phone
    // ─────────────────────────────────────────────────────────────
    public async Task<bool> ToggleHotLead(string phone, bool isHot)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return false;
        var clean = new string((phone ?? "").Where(char.IsDigit).ToArray());
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            UPDATE whatsapp_messages
            SET is_hot_lead = @IsHot, updated_at = NOW()
            WHERE regexp_replace(COALESCE(NULLIF(from_phone,''), to_phone), '[^0-9]', '', 'g') = @Phone",
            new { IsHot = isHot, Phone = clean });
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // DB-wide search by name or phone
    // ─────────────────────────────────────────────────────────────
    public async Task<List<WhatsAppInboxThread>> SearchConversations(string query, string inboxType = "sales")
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return new();
        var search = "%" + query.Trim().ToLower() + "%";
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<WhatsAppInboxThread>(@"
            SELECT
                w.Phone,
                COALESCE(sl.name, ct.name) AS ContactName,
                w.LastMessage,
                w.LastTemplate,
                w.LastAt,
                w.MessageCount,
                w.UnreadCount,
                w.InboxType,
                BOOL_OR(COALESCE(w.IsHotLead, FALSE)) AS IsHotLead,
                w.HasInbound,
                w.LastOutboundStatus
            FROM (
                SELECT
                    COALESCE(NULLIF(from_phone,''), to_phone) AS Phone,
                    MAX(body) AS LastMessage,
                    MAX(template_name) AS LastTemplate,
                    MAX(created_at) AS LastAt,
                    COUNT(*) AS MessageCount,
                    SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS UnreadCount,
                    MAX(inbox_type) AS InboxType,
                    BOOL_OR(COALESCE(is_hot_lead, FALSE)) AS IsHotLead,
                    SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) > 0 AS HasInbound,
                    NULL::TEXT AS LastOutboundStatus
                FROM whatsapp_messages
                WHERE inbox_type = @InboxType
                GROUP BY COALESCE(NULLIF(from_phone,''), to_phone)
            ) w
            LEFT JOIN saved_leads sl
                ON EXISTS (
                    SELECT 1 FROM unnest(sl.phones) AS p
                    WHERE regexp_replace(p, '[^0-9]', '', 'g') = regexp_replace(w.Phone, '[^0-9]', '', 'g')
                )
            LEFT JOIN contacts ct
                ON regexp_replace(ct.phone, '[^0-9]', '', 'g') = regexp_replace(w.Phone, '[^0-9]', '', 'g')
            WHERE LOWER(w.Phone) LIKE @Search
               OR LOWER(COALESCE(sl.name, ct.name, '')) LIKE @Search
            ORDER BY w.LastAt DESC
            LIMIT 50",
            new { InboxType = inboxType, Search = search });
        return rows.ToList();
    }

    // ─────────────────────────────────────────────────────────────
    // Conversation — unchanged (phone-scoped, inbox-agnostic)
    // ─────────────────────────────────────────────────────────────
    public async Task<List<WhatsAppMessage>> GetConversation(string phone)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return new();
        var clean = new string((phone ?? "").Where(char.IsDigit).ToArray());
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<WhatsAppMessage>(@"
            SELECT id AS Id, lead_id AS LeadId, proposal_id AS ProposalId, direction AS Direction,
                   to_phone AS ToPhone, from_phone AS FromPhone, message_type AS MessageType,
                   template_name AS TemplateName, body AS Body, wamid AS Wamid, status AS Status,
                   error_code AS ErrorCode, error_message AS ErrorMessage, raw_payload AS RawPayload, media_url AS MediaUrl, media_caption AS MediaCaption,
                   inbox_type AS InboxType, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM whatsapp_messages
            WHERE to_phone = @Phone OR from_phone = @Phone
            ORDER BY created_at ASC", new { Phone = clean });
        return rows.ToList();
    }

    private async Task<string> GetContactNameByPhone(string phone)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return "";
        try
        {
            var clean = new string(phone.Where(char.IsDigit).ToArray());
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            var name = await c.QueryFirstOrDefaultAsync<string>(@"
                SELECT name FROM saved_leads
                WHERE EXISTS (
                    SELECT 1 FROM unnest(phones) AS p
                    WHERE regexp_replace(p, '[^0-9]', '', 'g') = @Clean
                )
                LIMIT 1", new { Clean = clean });
            if (!string.IsNullOrEmpty(name)) return name;
            return await c.QueryFirstOrDefaultAsync<string>(@"
                SELECT name FROM contacts
                WHERE regexp_replace(phone, '[^0-9]', '', 'g') = @Clean
                LIMIT 1", new { Clean = clean }) ?? "";
        }
        catch { return ""; }
    }

    // ─────────────────────────────────────────────────────────────
    // Fetch Meta message templates
    // ─────────────────────────────────────────────────────────────
    public async Task<(bool Ok, List<MetaTemplate> Templates, string Error)> GetTemplates()
    {
        var s = await _settings.GetAll();
        var token  = s.GetValueOrDefault(SettingKeys.WhatsappCloudAccessToken, "");
        var wabaId = s.GetValueOrDefault(SettingKeys.WhatsappCloudWabaId, "");
        var ver    = string.IsNullOrWhiteSpace(s.GetValueOrDefault(SettingKeys.WhatsappCloudApiVersion, ""))
            ? DefaultApiVersion : s[SettingKeys.WhatsappCloudApiVersion];

        if (string.IsNullOrWhiteSpace(token))  return (false, new(), "Access token not configured.");
        if (string.IsNullOrWhiteSpace(wabaId)) return (false, new(), "WABA ID not configured.");

        var url = $"https://graph.facebook.com/{ver}/{wabaId}/message_templates?fields=name,status,language,components&limit=100";
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var resp = await _http.SendAsync(req);
        var raw  = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            return (false, new(), $"Meta API error: {raw}");

        try
        {
            var doc  = System.Text.Json.JsonDocument.Parse(raw);
            var data = doc.RootElement.GetProperty("data");
            var list = new List<MetaTemplate>();
            foreach (var el in data.EnumerateArray())
            {
                var name   = el.TryGetProperty("name",     out var n) ? n.GetString() ?? "" : "";
                var status = el.TryGetProperty("status",   out var st) ? st.GetString() ?? "" : "";
                var lang   = el.TryGetProperty("language", out var l) ? l.GetString() ?? "" : "";
                string bodyText = "";
                if (el.TryGetProperty("components", out var comps))
                {
                    foreach (var comp in comps.EnumerateArray())
                    {
                        if (comp.TryGetProperty("type", out var t) && t.GetString() == "BODY"
                            && comp.TryGetProperty("text", out var tx))
                        {
                            bodyText = tx.GetString() ?? "";
                            break;
                        }
                    }
                }
                list.Add(new MetaTemplate { Name = name, Status = status, Language = lang, BodyText = bodyText });
            }
            return (true, list, "");
        }
        catch (Exception ex)
        {
            return (false, new(), $"Parse error: {ex.Message}");
        }
    }
}

public class MetaTemplate
{
    public string Name     { get; set; } = "";
    public string Status   { get; set; } = "";
    public string Language { get; set; } = "";
    public string BodyText { get; set; } = "";
}
