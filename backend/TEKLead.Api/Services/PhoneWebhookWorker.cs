using Dapper;
using System.Text.Json;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

/// <summary>
/// Background worker that processes phone_webhook_events table.
/// When Apollo delivers a phone number via webhook, the endpoint writes
/// a row here. This worker picks it up, merges into the lead / saved_lead
/// and its matching saved-prospect contacts, then fires a WhatsApp message.
/// </summary>
public class PhoneWebhookWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<PhoneWebhookWorker> _log;
    private const int PollMs = 5_000;

    public PhoneWebhookWorker(IServiceScopeFactory scopeFactory, ILogger<PhoneWebhookWorker> log)
    {
        _scopeFactory = scopeFactory;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Give the app time to finish startup
        await Task.Delay(3_000, ct);

        await EnsureSchema();

        while (!ct.IsCancellationRequested)
        {
            try { await ProcessBatch(ct); }
            catch (Exception ex) { _log.LogError(ex, "PhoneWebhookWorker batch error"); }

            await Task.Delay(PollMs, ct);
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Schema
    // ──────────────────────────────────────────────────────────────────────
    private async Task EnsureSchema()
    {
        using var scope = _scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();

        await using var c = new NpgsqlConnection(settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS phone_webhook_events (
                id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                source       TEXT        NOT NULL,   -- 'lead' | 'contact'
                entity_id    UUID        NOT NULL,   -- lead.id or contacts.id
                phones       TEXT[]      NOT NULL,
                wa_sent      BOOLEAN     NOT NULL DEFAULT FALSE,
                wa_result    TEXT,
                wa_picked_at TIMESTAMPTZ,
                processed_at TIMESTAMPTZ,
                contact_name TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_pwe_processed ON phone_webhook_events (processed_at) WHERE processed_at IS NULL;
            ALTER TABLE phone_webhook_events ADD COLUMN IF NOT EXISTS wa_picked_at TIMESTAMPTZ;
            ALTER TABLE phone_webhook_events ADD COLUMN IF NOT EXISTS contact_name TEXT;
        ");
        _log.LogInformation("PhoneWebhookWorker schema OK.");
    }

    // ──────────────────────────────────────────────────────────────────────
    // Main processing loop
    // ──────────────────────────────────────────────────────────────────────
    private async Task ProcessBatch(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        var leads    = scope.ServiceProvider.GetRequiredService<LeadService>();
        var wa       = scope.ServiceProvider.GetRequiredService<WhatsAppCloudService>();

        await using var c = new NpgsqlConnection(settings.ConnectionString);
        await c.OpenAsync();

        // Claim up to 10 unprocessed events
        var events = (await c.QueryAsync<PhoneWebhookEvent>(
            @"SELECT id, source, entity_id AS EntityId, phones, wa_sent AS WaSent
              FROM phone_webhook_events
              WHERE processed_at IS NULL
              ORDER BY created_at
              LIMIT 10")).ToList();

        foreach (var evt in events)
        {
            if (ct.IsCancellationRequested) break;
            await HandleEvent(evt, c, leads, wa, ct);
        }
    }

    private async Task HandleEvent(
        PhoneWebhookEvent evt,
        NpgsqlConnection c,
        LeadService leads,
        WhatsAppCloudService wa,
        CancellationToken ct)
    {
        try
        {
            _log.LogInformation("PhoneWebhookWorker processing {Source} {EntityId} phones={Phones}",
                evt.Source, evt.EntityId, string.Join(",", evt.Phones));

            // Stamp when we picked this event up
            await c.ExecuteAsync(
                "UPDATE phone_webhook_events SET wa_picked_at = NOW() WHERE id = @id",
                new { evt.Id });

            string? whatsappTarget = null;
            string firstName = "";
            string company   = "";

            if (evt.Source == "lead")
            {
                var r = await MergeIntoLead(evt.EntityId, evt.Phones, c, leads);
                whatsappTarget = r.Phone;
                firstName      = r.FirstName;
                company        = r.Company;
            }
            else if (evt.Source == "contact")
            {
                var r = await MergeIntoContact(evt.EntityId, evt.Phones, c);
                whatsappTarget = r.Phone;
                firstName      = r.FirstName;
                company        = r.Company;
            }

            // Also update saved_leads + proposal contacts if apollo_id matches
            if (!string.IsNullOrEmpty(whatsappTarget))
            {
                await PushToSavedLeads(evt.EntityId, evt.Phones, c);
                await PushToProposalContacts(evt.EntityId, evt.Phones, c);
            }

            // Send WhatsApp
            string waResult = "no_phone";
            bool waSent = false;

            if (!string.IsNullOrEmpty(whatsappTarget))
            {
                var bodyVars = new List<string>
                {
                    string.IsNullOrWhiteSpace(firstName) ? "there" : firstName,
                    string.IsNullOrWhiteSpace(company)   ? "your business" : company,
                };

                var (ok, _, err, _) = await wa.SendTemplate(
                    whatsappTarget,
                    templateName:  "csharptek_intro_v2_util_2",
                    langCode:      null,
                    bodyVariables: bodyVars,
                    leadId:        evt.EntityId.ToString());

                waSent   = ok;
                waResult = ok ? "sent" : $"failed:{err}";
                _log.LogInformation("PhoneWebhookWorker WA send to {Phone} vars=[{V1},{V2}] → {Result}",
                    whatsappTarget, bodyVars[0], bodyVars[1], waResult);
            }

            // Resolve contact name for the log
            string contactName = "";
            try {
                contactName = await c.QuerySingleOrDefaultAsync<string>(
                    @"SELECT COALESCE(name, '') FROM leads WHERE id = @id
                      UNION ALL
                      SELECT COALESCE(name, '') FROM contacts WHERE id = @id
                      LIMIT 1",
                    new { id = evt.EntityId }) ?? "";
            } catch { }

            await c.ExecuteAsync(
                @"UPDATE phone_webhook_events
                  SET processed_at = NOW(), wa_sent = @waSent, wa_result = @waResult, contact_name = @contactName
                  WHERE id = @id",
                new { evt.Id, waSent, waResult, contactName });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "PhoneWebhookWorker failed to process event {Id}", evt.Id);
            await c.ExecuteAsync(
                @"UPDATE phone_webhook_events
                  SET processed_at = NOW(), wa_result = @err
                  WHERE id = @id",
                new { evt.Id, err = ex.Message });
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Merge into leads table
    // ──────────────────────────────────────────────────────────────────────
    private async Task<(string? Phone, string FirstName, string Company)> MergeIntoLead(
        Guid leadId, string[] phones,
        NpgsqlConnection c, LeadService leads)
    {
        var lead = await leads.GetById(leadId);
        if (lead == null) return (null, "", "");

        var existing = lead.Phones ?? Array.Empty<string>();
        var merged   = existing.Union(phones, StringComparer.OrdinalIgnoreCase).ToArray();

        if (merged.Length != existing.Length)
        {
            lead.Phones = merged;
            await leads.Upsert(lead);
            _log.LogInformation("PhoneWebhookWorker merged {Count} phones into lead {Id}", merged.Length, leadId);
        }

        var firstName = (lead.Name ?? "").Split(' ')[0];
        var company   = lead.Company ?? "";
        return (merged.FirstOrDefault(), firstName, company);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Merge into contacts table
    // ──────────────────────────────────────────────────────────────────────
    private async Task<(string? Phone, string FirstName, string Company)> MergeIntoContact(
        Guid contactId, string[] phones,
        NpgsqlConnection c)
    {
        if (phones.Length == 0) return (null, "", "");
        var first = phones[0];

        await c.ExecuteAsync(
            "UPDATE contacts SET phone = @phone WHERE id = @contactId AND (phone IS NULL OR phone = '')",
            new { phone = first, contactId });

        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT phone, name, company FROM contacts WHERE id = @contactId", new { contactId });

        var phone     = row != null ? ((string?)row.phone ?? first) : first;
        var firstName = row != null ? ((string?)row.name ?? "").Split(' ')[0] : "";
        var company   = row != null ? ((string?)row.company ?? "") : "";
        return (string.IsNullOrWhiteSpace(phone) ? first : phone, firstName, company);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Also push phones to saved_leads by matching apollo_id from the lead
    // ──────────────────────────────────────────────────────────────────────
    private async Task PushToSavedLeads(Guid leadId, string[] phones, NpgsqlConnection c)
    {
        if (phones.Length == 0) return;

        // Get apollo_id from leads table
        var apolloId = await c.QuerySingleOrDefaultAsync<string?>(
            "SELECT apollo_id FROM leads WHERE id = @leadId", new { leadId });
        if (string.IsNullOrEmpty(apolloId)) return;

        // Merge phones array in saved_leads
        await c.ExecuteAsync(@"
            UPDATE saved_leads
            SET phones = (
                SELECT array_agg(DISTINCT p)
                FROM (
                    SELECT unnest(COALESCE(phones, ARRAY[]::TEXT[])) AS p
                    UNION
                    SELECT unnest(@phones::TEXT[]) AS p
                ) sub
            )
            WHERE apollo_id = @apolloId",
            new { apolloId, phones });

        _log.LogInformation("PhoneWebhookWorker updated saved_leads for apollo_id {Id}", apolloId);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Update contacts_json + apollo_contact_json in proposals matching apollo_id
    // ──────────────────────────────────────────────────────────────────────
    private async Task PushToProposalContacts(Guid leadId, string[] phones, NpgsqlConnection c)
    {
        if (phones.Length == 0) return;
        var phone = phones[0];

        // Get apollo_id for this lead
        var apolloId = await c.QuerySingleOrDefaultAsync<string?>(
            "SELECT apollo_id FROM leads WHERE id = @leadId", new { leadId });
        if (string.IsNullOrEmpty(apolloId)) return;

        // Find proposals that reference this apollo_id in apollo_contact_json or contacts_json
        var proposals = (await c.QueryAsync<dynamic>(
            @"SELECT id, contacts_json, apollo_contact_json
              FROM proposals
              WHERE apollo_contact_json::text ILIKE @apolloPattern
                 OR contacts_json IS NOT NULL",
            new { apolloPattern = $"%{apolloId}%" })).ToList();

        foreach (var row in proposals)
        {
            bool updated = false;
            string? newContactsJson = row.contacts_json;
            string? newApolloJson   = row.apollo_contact_json;

            // Patch contacts_json — array of {name, email, phone, role, linkedin}
            if (!string.IsNullOrWhiteSpace(newContactsJson))
            {
                try
                {
                    var arr = JsonSerializer.Deserialize<List<JsonElement>>(newContactsJson);
                    if (arr != null)
                    {
                        var patched = new System.Text.Json.Nodes.JsonArray();
                        foreach (var el in arr)
                        {
                            var obj = System.Text.Json.Nodes.JsonObject.Create(el)!;
                            // Only patch if phone is empty
                            var existing = obj["phone"]?.GetValue<string>() ?? "";
                            if (string.IsNullOrWhiteSpace(existing))
                            {
                                obj["phone"] = phone;
                                updated = true;
                            }
                            patched.Add(obj);
                        }
                        if (updated) newContactsJson = patched.ToJsonString();
                    }
                }
                catch (Exception ex) { _log.LogWarning("PushToProposalContacts contacts_json parse error: {0}", ex.Message); }
            }

            // Patch apollo_contact_json — full lead object with phones array
            if (!string.IsNullOrWhiteSpace(newApolloJson) && newApolloJson.Contains(apolloId))
            {
                try
                {
                    var obj = System.Text.Json.Nodes.JsonNode.Parse(newApolloJson) as System.Text.Json.Nodes.JsonObject;
                    if (obj != null)
                    {
                        var existingPhones = obj["phones"]?.AsArray();
                        if (existingPhones == null || existingPhones.Count == 0)
                        {
                            var arr = new System.Text.Json.Nodes.JsonArray();
                            arr.Add(phone);
                            obj["phones"] = arr;
                            updated = true;
                        }
                        if (updated) newApolloJson = obj.ToJsonString();
                    }
                }
                catch (Exception ex) { _log.LogWarning("PushToProposalContacts apollo_contact_json parse error: {0}", ex.Message); }
            }

            if (updated)
            {
                await c.ExecuteAsync(
                    @"UPDATE proposals
                      SET contacts_json = @newContactsJson,
                          apollo_contact_json = @newApolloJson
                      WHERE id = @id",
                    new { newContactsJson, newApolloJson, id = (Guid)row.id });
                _log.LogInformation("PushToProposalContacts updated proposal {Id} for apollo_id {ApolloId}", (Guid)row.id, apolloId);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DTO for reading events from DB
// ──────────────────────────────────────────────────────────────────────────
public class PhoneWebhookEvent
{
    public Guid     Id       { get; set; }
    public string   Source   { get; set; } = "";
    public Guid     EntityId { get; set; }
    public string[] Phones   { get; set; } = Array.Empty<string>();
    public bool     WaSent   { get; set; }
}
