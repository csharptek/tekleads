using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class LeadService
{
    private readonly SettingsService _settings;
    private readonly ILogger<LeadService> _log;

    public LeadService(SettingsService settings, ILogger<LeadService> log)
    {
        _settings = settings;
        _log = log;
    }

    private NpgsqlConnection Conn() => new(_settings.ConnectionString);

    public async Task EnsureSchema()
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS leads (
                id UUID PRIMARY KEY,
                apollo_id TEXT,
                name TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                company TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                emails TEXT[] NOT NULL DEFAULT '{}',
                phones TEXT[] NOT NULL DEFAULT '{}',
                linkedin_url TEXT,
                saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        await c.ExecuteAsync("CREATE UNIQUE INDEX IF NOT EXISTS leads_apollo_id_idx ON leads(apollo_id) WHERE apollo_id IS NOT NULL");
    }

    public async Task<List<Lead>> GetAll()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>("SELECT * FROM leads ORDER BY saved_at DESC");
        return rows.Select(Map).ToList();
    }

    public async Task<Lead?> GetById(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM leads WHERE id=@id", new { id });
        return row == null ? null : Map(row);
    }

    public async Task<bool> ExistsByApolloId(string apolloId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        return await c.QuerySingleOrDefaultAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM leads WHERE apollo_id=@apolloId)", new { apolloId });
    }

    public async Task<Lead> Upsert(Lead lead)
    {
        await using var c = Conn();
        await c.OpenAsync();

        if (!string.IsNullOrEmpty(lead.ApolloId))
        {
            // Upsert by apollo_id — handles duplicate apollo_id across different UUID rows
            await c.ExecuteAsync(@"
                INSERT INTO leads (id, apollo_id, name, title, company, industry, location, emails, phones, linkedin_url, saved_at)
                VALUES (@Id, @ApolloId, @Name, @Title, @Company, @Industry, @Location, @Emails, @Phones, @LinkedinUrl, @SavedAt)
                ON CONFLICT (apollo_id) DO UPDATE SET
                    name         = EXCLUDED.name,
                    title        = EXCLUDED.title,
                    company      = EXCLUDED.company,
                    industry     = EXCLUDED.industry,
                    location     = EXCLUDED.location,
                    emails       = EXCLUDED.emails,
                    phones       = EXCLUDED.phones,
                    linkedin_url = EXCLUDED.linkedin_url,
                    saved_at     = EXCLUDED.saved_at",
                new
                {
                    lead.Id, lead.ApolloId, lead.Name, lead.Title, lead.Company,
                    lead.Industry, lead.Location, lead.Emails, lead.Phones,
                    lead.LinkedinUrl, lead.SavedAt
                });
        }
        else
        {
            // No apollo_id — upsert by primary key
            await c.ExecuteAsync(@"
                INSERT INTO leads (id, apollo_id, name, title, company, industry, location, emails, phones, linkedin_url, saved_at)
                VALUES (@Id, @ApolloId, @Name, @Title, @Company, @Industry, @Location, @Emails, @Phones, @LinkedinUrl, @SavedAt)
                ON CONFLICT (id) DO UPDATE SET
                    name         = EXCLUDED.name,
                    title        = EXCLUDED.title,
                    company      = EXCLUDED.company,
                    industry     = EXCLUDED.industry,
                    location     = EXCLUDED.location,
                    emails       = EXCLUDED.emails,
                    phones       = EXCLUDED.phones,
                    linkedin_url = EXCLUDED.linkedin_url,
                    saved_at     = EXCLUDED.saved_at",
                new
                {
                    lead.Id, lead.ApolloId, lead.Name, lead.Title, lead.Company,
                    lead.Industry, lead.Location, lead.Emails, lead.Phones,
                    lead.LinkedinUrl, lead.SavedAt
                });
        }

        _log.LogInformation("Upserted lead {0} ({1})", lead.Name, lead.Id);
        return lead;
    }

    private static Lead Map(dynamic r) => new()
    {
        Id          = r.id,
        ApolloId    = r.apollo_id,
        Name        = r.name ?? "",
        Title       = r.title ?? "",
        Company     = r.company ?? "",
        Industry    = r.industry ?? "",
        Location    = r.location ?? "",
        Emails      = r.emails ?? Array.Empty<string>(),
        Phones      = r.phones ?? Array.Empty<string>(),
        LinkedinUrl = r.linkedin_url,
        SavedAt     = r.saved_at,
    };
}
