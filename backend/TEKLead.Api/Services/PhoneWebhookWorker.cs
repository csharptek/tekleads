using Dapper;
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
                processed_at TIMESTAMPTZ,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_pwe_processed ON phone_webhook_events (processed_at) WHERE processed_at IS NULL;
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

            string? whatsappTarget = null;

            if (evt.Source == "lead")
            {
                whatsappTarget = await MergeIntoLead(evt.EntityId, evt.Phones, c, leads);
            }
            else if (evt.Source == "contact")
            {
                whatsappTarget = await MergeIntoContact(evt.EntityId, evt.Phones, c);
            }

            // Also update saved_leads row if apollo_id matches
            if (!string.IsNullOrEmpty(whatsappTarget))
                await PushToSavedLeads(evt.EntityId, evt.Phones, c);

            // Send WhatsApp
            string waResult = "no_phone";
            bool waSent = false;

            if (!string.IsNullOrEmpty(whatsappTarget))
            {
                var (ok, _, err, _) = await wa.SendTemplate(
                    whatsappTarget,
                    templateName: null,   // uses default from settings
                    langCode:     null,
                    bodyVariables: null,
                    leadId: evt.EntityId.ToString());

                waSent   = ok;
                waResult = ok ? "sent" : $"failed:{err}";
                _log.LogInformation("PhoneWebhookWorker WA send to {Phone} → {Result}", whatsappTarget, waResult);
            }

            await c.ExecuteAsync(
                @"UPDATE phone_webhook_events
                  SET processed_at = NOW(), wa_sent = @waSent, wa_result = @waResult
                  WHERE id = @id",
                new { evt.Id, waSent, waResult });
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
    private async Task<string?> MergeIntoLead(
        Guid leadId, string[] phones,
        NpgsqlConnection c, LeadService leads)
    {
        var lead = await leads.GetById(leadId);
        if (lead == null) return null;

        var existing = lead.Phones ?? Array.Empty<string>();
        var merged   = existing.Union(phones, StringComparer.OrdinalIgnoreCase).ToArray();

        if (merged.Length != existing.Length)
        {
            lead.Phones = merged;
            await leads.Upsert(lead);
            _log.LogInformation("PhoneWebhookWorker merged {Count} phones into lead {Id}", merged.Length, leadId);
        }

        return merged.FirstOrDefault();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Merge into contacts table
    // ──────────────────────────────────────────────────────────────────────
    private async Task<string?> MergeIntoContact(
        Guid contactId, string[] phones,
        NpgsqlConnection c)
    {
        if (phones.Length == 0) return null;
        var first = phones[0];

        await c.ExecuteAsync(
            "UPDATE contacts SET phone = @phone WHERE id = @contactId AND (phone IS NULL OR phone = '')",
            new { phone = first, contactId });

        // Return whatever the current phone is
        var existing = await c.QuerySingleOrDefaultAsync<string?>(
            "SELECT phone FROM contacts WHERE id = @contactId", new { contactId });

        return string.IsNullOrWhiteSpace(existing) ? first : existing;
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
