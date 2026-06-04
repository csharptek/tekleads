using Dapper;
using System.Text.Json;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

/// <summary>
/// Flow per event:
/// 1. Pick event from phone_webhook_events
/// 2. Check if phone already exists on the contact/lead — if yes, skip WA (do nothing)
/// 3. If phone is new → save phone to lead, saved_leads, proposal contacts_json
/// 4. Find which proposal(s) this contact belongs to
/// 5. Update proposal contacts with new phone
/// 6. Send WhatsApp: {{1}} = first name, {{2}} = proposal job_post_headline
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
                source       TEXT        NOT NULL,
                entity_id    UUID        NOT NULL,
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
    // Batch
    // ──────────────────────────────────────────────────────────────────────
    private async Task ProcessBatch(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        var leads    = scope.ServiceProvider.GetRequiredService<LeadService>();
        var wa       = scope.ServiceProvider.GetRequiredService<WhatsAppCloudService>();

        await using var c = new NpgsqlConnection(settings.ConnectionString);
        await c.OpenAsync();

        var events = (await c.QueryAsync<PhoneWebhookEvent>(
            @"SELECT id, source, entity_id AS EntityId, phones, wa_sent AS WaSent
              FROM phone_webhook_events
              WHERE processed_at IS NULL
              ORDER BY created_at
              LIMIT 10")).ToList();

        foreach (var evt in events)
        {
            if (ct.IsCancellationRequested) break;
            await HandleEvent(evt, c, leads, wa);
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Handle single event
    // ──────────────────────────────────────────────────────────────────────
    private async Task HandleEvent(
        PhoneWebhookEvent evt,
        NpgsqlConnection c,
        LeadService leads,
        WhatsAppCloudService wa)
    {
        try
        {
            _log.LogInformation("PhoneWebhookWorker processing {Source} {EntityId} phones={Phones}",
                evt.Source, evt.EntityId, string.Join(",", evt.Phones));

            await c.ExecuteAsync(
                "UPDATE phone_webhook_events SET wa_picked_at = NOW() WHERE id = @id",
                new { evt.Id });

            // ── Step 2 & 3: check if phone already exists, merge if new ──
            var mergeResult = await MergePhone(evt, c, leads);

            string waResult    = "skipped_existing_phone";
            bool   waSent      = false;
            string contactName = mergeResult.ContactName;

            if (!mergeResult.PhoneIsNew)
            {
                // Phone already existed — nothing to do
                _log.LogInformation("PhoneWebhookWorker phone already exists for {EntityId}, skipping WA", evt.EntityId);
                waResult = "skipped_existing_phone";
            }
            else if (string.IsNullOrEmpty(mergeResult.Phone))
            {
                waResult = "no_phone";
            }
            else
            {
                // ── Step 4 & 5: find proposal for this contact, update contacts_json ──
                var proposalHeadline = await PushToProposalContacts(evt.EntityId, mergeResult.ApolloId, mergeResult.Phone, c);

                // Also update saved_leads
                await PushToSavedLeads(mergeResult.ApolloId, evt.Phones, c);

                // ── Step 6: send WhatsApp with first name + proposal headline ──
                var firstName = string.IsNullOrWhiteSpace(mergeResult.FirstName) ? "there" : mergeResult.FirstName;
                var headline  = string.IsNullOrWhiteSpace(proposalHeadline)      ? "your project" : proposalHeadline;

                var (ok, _, err, _) = await wa.SendTemplate(
                    mergeResult.Phone,
                    templateName:  "csharptek_intro_v2_util_2",
                    langCode:      null,
                    bodyVariables: new List<string> { firstName, headline },
                    leadId:        evt.EntityId.ToString());

                waSent   = ok;
                waResult = ok ? "sent" : $"failed:{err}";
                _log.LogInformation("PhoneWebhookWorker WA to {Phone} [{Name}][{Headline}] → {Result}",
                    mergeResult.Phone, firstName, headline, waResult);
            }

            await c.ExecuteAsync(
                @"UPDATE phone_webhook_events
                  SET processed_at = NOW(), wa_sent = @waSent, wa_result = @waResult, contact_name = @contactName
                  WHERE id = @id",
                new { evt.Id, waSent, waResult, contactName });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "PhoneWebhookWorker failed event {Id}", evt.Id);
            await c.ExecuteAsync(
                "UPDATE phone_webhook_events SET processed_at = NOW(), wa_result = @err WHERE id = @id",
                new { evt.Id, err = ex.Message });
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 2 & 3: check existing phone, merge if new
    // ──────────────────────────────────────────────────────────────────────
    private async Task<MergeResult> MergePhone(PhoneWebhookEvent evt, NpgsqlConnection c, LeadService leads)
    {
        if (evt.Source == "lead")
        {
            var lead = await leads.GetById(evt.EntityId);
            if (lead == null) return new MergeResult();

            var existing  = lead.Phones ?? Array.Empty<string>();
            var newPhones = evt.Phones.Except(existing, StringComparer.OrdinalIgnoreCase).ToArray();
            var phoneIsNew = newPhones.Length > 0;

            if (phoneIsNew)
            {
                lead.Phones = existing.Union(evt.Phones, StringComparer.OrdinalIgnoreCase).ToArray();
                await leads.Upsert(lead);
                _log.LogInformation("PhoneWebhookWorker merged phones into lead {Id}", evt.EntityId);
            }

            return new MergeResult
            {
                Phone       = (lead.Phones ?? Array.Empty<string>()).FirstOrDefault(),
                FirstName   = (lead.Name ?? "").Split(' ')[0],
                ContactName = lead.Name ?? "",
                ApolloId    = lead.ApolloId ?? "",
                PhoneIsNew  = phoneIsNew,
            };
        }
        else // contact
        {
            var row = await c.QuerySingleOrDefaultAsync<dynamic>(
                "SELECT id, phone, name, company, apollo_id FROM contacts WHERE id = @id",
                new { id = evt.EntityId });
            if (row == null) return new MergeResult();

            string existingPhone = (string?)row.phone ?? "";
            bool   phoneIsNew    = string.IsNullOrWhiteSpace(existingPhone);
            string phone         = existingPhone;

            if (phoneIsNew)
            {
                phone = evt.Phones[0];
                await c.ExecuteAsync(
                    "UPDATE contacts SET phone = @phone WHERE id = @id AND (phone IS NULL OR phone = '')",
                    new { phone, id = evt.EntityId });
            }

            return new MergeResult
            {
                Phone       = phone,
                FirstName   = ((string?)row.name ?? "").Split(' ')[0],
                ContactName = (string?)row.name ?? "",
                ApolloId    = (string?)row.apollo_id ?? "",
                PhoneIsNew  = phoneIsNew,
            };
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 4 & 5: find proposals for this contact, update phone, return headline
    // ──────────────────────────────────────────────────────────────────────
    private async Task<string> PushToProposalContacts(Guid leadId, string apolloId, string phone, NpgsqlConnection c)
    {
        var headline = "";

        // Find proposals linked to this lead directly OR via apollo_id in apollo_contact_json
        var proposals = (await c.QueryAsync<dynamic>(
            @"SELECT id, contacts_json, apollo_contact_json, job_post_headline
              FROM proposals
              WHERE linked_lead_id = @leadId
                 OR (apollo_contact_json IS NOT NULL AND apollo_contact_json::text LIKE @apolloPattern)",
            new { leadId, apolloPattern = string.IsNullOrEmpty(apolloId) ? "NO_MATCH" : $"%{apolloId}%" }
        )).ToList();

        foreach (var row in proposals)
        {
            // Capture headline from first matched proposal
            if (string.IsNullOrEmpty(headline))
                headline = (string?)row.job_post_headline ?? "";

            bool updated = false;
            string? newContactsJson = (string?)row.contacts_json;
            string? newApolloJson   = (string?)row.apollo_contact_json;

            // Patch contacts_json — only fill empty phone fields
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
                catch (Exception ex) { _log.LogWarning("PushToProposalContacts contacts_json error: {0}", ex.Message); }
            }

            // Patch apollo_contact_json phones array
            if (!string.IsNullOrWhiteSpace(newApolloJson))
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
                catch (Exception ex) { _log.LogWarning("PushToProposalContacts apollo_contact_json error: {0}", ex.Message); }
            }

            if (updated)
            {
                await c.ExecuteAsync(
                    @"UPDATE proposals
                      SET contacts_json = @newContactsJson, apollo_contact_json = @newApolloJson
                      WHERE id = @id",
                    new { newContactsJson, newApolloJson, id = (Guid)row.id });
                _log.LogInformation("PushToProposalContacts updated proposal {Id}", (Guid)row.id);
            }
        }

        return headline;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Push phones to saved_leads
    // ──────────────────────────────────────────────────────────────────────
    private async Task PushToSavedLeads(string apolloId, string[] phones, NpgsqlConnection c)
    {
        if (string.IsNullOrEmpty(apolloId) || phones.Length == 0) return;
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
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal result DTO
// ──────────────────────────────────────────────────────────────────────────
public class MergeResult
{
    public string? Phone       { get; set; }
    public string  FirstName   { get; set; } = "";
    public string  ContactName { get; set; } = "";
    public string  ApolloId    { get; set; } = "";
    public bool    PhoneIsNew  { get; set; }
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
