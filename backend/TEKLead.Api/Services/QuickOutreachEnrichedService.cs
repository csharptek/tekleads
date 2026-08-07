using Dapper;
using Npgsql;
using System.Text.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class QuickOutreachEnrichedService
{
    private readonly SettingsService _settings;

    public QuickOutreachEnrichedService(SettingsService settings)
    {
        _settings = settings;
    }

    public async Task EnsureSchema()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS quick_outreach_enriched_contacts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id TEXT NOT NULL UNIQUE,
                lead_json JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_qoec_created ON quick_outreach_enriched_contacts(created_at DESC);
        ");
    }

    public async Task<List<Lead>> GetAll()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<string>(
            "SELECT lead_json FROM quick_outreach_enriched_contacts ORDER BY created_at DESC");
        var result = new List<Lead>();
        foreach (var row in rows)
        {
            var lead = JsonSerializer.Deserialize<Lead>(row, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (lead != null) result.Add(lead);
        }
        return result;
    }

    public async Task UpsertMany(List<Lead> leads)
    {
        if (leads.Count == 0) return;
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        foreach (var lead in leads)
        {
            var json = JsonSerializer.Serialize(lead);
            await c.ExecuteAsync(@"
                INSERT INTO quick_outreach_enriched_contacts (lead_id, lead_json, updated_at)
                VALUES (@LeadId, @Json::jsonb, NOW())
                ON CONFLICT (lead_id) DO UPDATE
                SET lead_json = @Json::jsonb, updated_at = NOW()",
                new { LeadId = lead.Id.ToString(), Json = json });
        }
    }

    public async Task Remove(string leadId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "DELETE FROM quick_outreach_enriched_contacts WHERE lead_id = @LeadId",
            new { LeadId = leadId });
    }
}
