// DEPLOY-CHECK: whatsapp-cloud-v1-20260520
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

/// <summary>
/// WhatsApp Business Cloud API (Meta) integration.
/// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
/// </summary>
public class WhatsAppCloudService
{
    private readonly HttpClient _http;
    private readonly SettingsService _settings;
    private readonly ILogger<WhatsAppCloudService> _log;

    private const string DefaultApiVersion = "v22.0";

    public WhatsAppCloudService(HttpClient http, SettingsService settings, ILogger<WhatsAppCloudService> log)
    {
        _http = http;
        _settings = settings;
        _log = log;
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
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_lead ON whatsapp_messages (lead_id)");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_wamid ON whatsapp_messages (wamid)");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_wa_created ON whatsapp_messages (created_at DESC)");
        _log.LogInformation("WhatsAppCloud schema OK.");
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

        // Build payload
        var templateObj = new Dictionary<string, object>
        {
            ["name"] = tpl,
            ["language"] = new { code = lang }
        };

        if (bodyVariables != null && bodyVariables.Count > 0)
        {
            var parameters = bodyVariables.Select(v => new { type = "text", text = v ?? "" }).ToArray();
            templateObj["components"] = new[]
            {
                new { type = "body", parameters }
            };
        }

        var payload = new
        {
            messaging_product = "whatsapp",
            to = phone,
            type = "template",
            template = templateObj
        };

        var url = $"https://graph.facebook.com/{cfg.version}/{cfg.phoneId}/messages";
        return await Post(url, cfg.token, payload, phone, "template", tpl, null, leadId, proposalId);
    }

    // ─────────────────────────────────────────────────────────────
    // Send free-form text (only valid inside 24hr customer service window)
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

        var payload = new
        {
            messaging_product = "whatsapp",
            recipient_type = "individual",
            to = phone,
            type = "text",
            text = new { preview_url = false, body = body }
        };

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

        // Persist
        try
        {
            await SaveOutbound(new WhatsAppMessage
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
    public async Task SaveOutbound(WhatsAppMessage m)
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO whatsapp_messages
                (id, lead_id, proposal_id, direction, to_phone, from_phone, message_type, template_name,
                 body, wamid, status, error_code, error_message, raw_payload, created_at, updated_at)
            VALUES
                (@Id, @LeadId, @ProposalId, @Direction, @ToPhone, @FromPhone, @MessageType, @TemplateName,
                 @Body, @Wamid, @Status, @ErrorCode, @ErrorMessage, @RawPayload, @CreatedAt, @UpdatedAt)",
            m);
    }

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
                   error_code AS ErrorCode, error_message AS ErrorMessage, raw_payload AS RawPayload,
                   created_at AS CreatedAt, updated_at AS UpdatedAt
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
                   error_code AS ErrorCode, error_message AS ErrorMessage, raw_payload AS RawPayload,
                   created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM whatsapp_messages
            ORDER BY created_at DESC
            LIMIT @Limit", new { Limit = limit });
        return rows.ToList();
    }

    // ─────────────────────────────────────────────────────────────
    // Webhook ingestion (status updates + inbound messages)
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
                            if (type == "text" && m.TryGetProperty("text", out var tx) &&
                                tx.TryGetProperty("body", out var bEl))
                                body = bEl.GetString() ?? "";

                            if (!string.IsNullOrEmpty(cs))
                            {
                                await SaveOutbound(new WhatsAppMessage
                                {
                                    Id = Guid.NewGuid().ToString(),
                                    Direction = "inbound",
                                    FromPhone = from,
                                    MessageType = type,
                                    Body = body,
                                    Wamid = wamid,
                                    Status = "received",
                                    RawPayload = m.GetRawText(),
                                    CreatedAt = DateTime.UtcNow,
                                    UpdatedAt = DateTime.UtcNow
                                });
                                inbound++;
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
    // Status snapshot
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
}
