using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProposalService
{
    private readonly SettingsService _settings;
    private readonly ILogger<ProposalService> _log;

    public ProposalService(SettingsService settings, ILogger<ProposalService> log)
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
            CREATE TABLE IF NOT EXISTS proposals (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_post_headline TEXT NOT NULL DEFAULT '',
                job_post_body TEXT NOT NULL DEFAULT '',
                client_name TEXT NOT NULL DEFAULT '',
                client_company TEXT NOT NULL DEFAULT '',
                client_country TEXT NOT NULL DEFAULT '',
                client_city TEXT NOT NULL DEFAULT '',
                client_email TEXT NOT NULL DEFAULT '',
                client_linkedin TEXT NOT NULL DEFAULT '',
                client_questions TEXT[] NOT NULL DEFAULT '{}',
                links TEXT[] NOT NULL DEFAULT '{}',
                link_labels TEXT[] NOT NULL DEFAULT '{}',
                document_urls TEXT[] NOT NULL DEFAULT '{}',
                timeline_value TEXT,
                timeline_unit TEXT,
                budget_min NUMERIC,
                budget_max NUMERIC,
                status TEXT NOT NULL DEFAULT 'draft',
                linked_lead_id UUID,
                apollo_contact_json TEXT,
                generated_response TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        _log.LogInformation("proposals table OK");
    }

    public async Task<List<Proposal>> GetAll()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>("SELECT * FROM proposals ORDER BY created_at DESC");
        return rows.Select(Map).ToList();
    }

    public async Task<Proposal?> GetById(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM proposals WHERE id=@id", new { id });
        return row == null ? null : Map(row);
    }

    public async Task<Proposal> Upsert(Proposal p)
    {
        p.UpdatedAt = DateTime.UtcNow;
        await using var c = Conn();
        await c.OpenAsync();

        var existing = await c.QuerySingleOrDefaultAsync<dynamic>("SELECT id FROM proposals WHERE id=@id", new { id = p.Id });
        if (existing == null)
        {
            if (p.Id == Guid.Empty) p.Id = Guid.NewGuid();
            await c.ExecuteAsync(@"
                INSERT INTO proposals (id, job_post_headline, job_post_body, client_name, client_company,
                    client_country, client_city, client_email, client_linkedin, client_questions,
                    links, link_labels, document_urls, timeline_value, timeline_unit,
                    budget_min, budget_max, status, linked_lead_id, apollo_contact_json,
                    generated_response, created_at, updated_at)
                VALUES (@Id, @JobPostHeadline, @JobPostBody, @ClientName, @ClientCompany,
                    @ClientCountry, @ClientCity, @ClientEmail, @ClientLinkedin, @ClientQuestions,
                    @Links, @LinkLabels, @DocumentUrls, @TimelineValue, @TimelineUnit,
                    @BudgetMin, @BudgetMax, @Status, @LinkedLeadId, @ApolloContactJson,
                    @GeneratedResponse, @CreatedAt, @UpdatedAt)", p);
        }
        else
        {
            await c.ExecuteAsync(@"
                UPDATE proposals SET
                    job_post_headline=@JobPostHeadline, job_post_body=@JobPostBody,
                    client_name=@ClientName, client_company=@ClientCompany,
                    client_country=@ClientCountry, client_city=@ClientCity,
                    client_email=@ClientEmail, client_linkedin=@ClientLinkedin,
                    client_questions=@ClientQuestions, links=@Links, link_labels=@LinkLabels,
                    document_urls=@DocumentUrls, timeline_value=@TimelineValue, timeline_unit=@TimelineUnit,
                    budget_min=@BudgetMin, budget_max=@BudgetMax, status=@Status,
                    linked_lead_id=@LinkedLeadId, apollo_contact_json=@ApolloContactJson,
                    generated_response=@GeneratedResponse, updated_at=@UpdatedAt
                WHERE id=@Id", p);
        }

        _log.LogInformation("Saved proposal {0}", p.Id);
        return p;
    }

    public async Task Delete(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM proposals WHERE id=@id", new { id });
    }

    private static Proposal Map(dynamic r) => new()
    {
        Id = r.id,
        JobPostHeadline = r.job_post_headline ?? "",
        JobPostBody = r.job_post_body ?? "",
        ClientName = r.client_name ?? "",
        ClientCompany = r.client_company ?? "",
        ClientCountry = r.client_country ?? "",
        ClientCity = r.client_city ?? "",
        ClientEmail = r.client_email ?? "",
        ClientLinkedin = r.client_linkedin ?? "",
        ClientQuestions = r.client_questions ?? Array.Empty<string>(),
        Links = r.links ?? Array.Empty<string>(),
        LinkLabels = r.link_labels ?? Array.Empty<string>(),
        DocumentUrls = r.document_urls ?? Array.Empty<string>(),
        TimelineValue = r.timeline_value,
        TimelineUnit = r.timeline_unit,
        BudgetMin = r.budget_min,
        BudgetMax = r.budget_max,
        Status = r.status ?? "draft",
        LinkedLeadId = r.linked_lead_id,
        ApolloContactJson = r.apollo_contact_json,
        GeneratedResponse = r.generated_response,
        CreatedAt = r.created_at,
        UpdatedAt = r.updated_at,
    };
}
