using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProposalCompanyContext
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProposalId { get; set; }
    public Guid? LeadId { get; set; }
    public string? CompanyName { get; set; }
    public string? Industry { get; set; }
    public string? Description { get; set; }
    public string? EstimatedEmployees { get; set; }
    public string? AnnualRevenue { get; set; }
    public string? FoundedYear { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? LinkedinUrl { get; set; }
    public string? Address { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class ProposalCompanyContextService
{
    private readonly SettingsService _settings;
    private readonly ILogger<ProposalCompanyContextService> _log;

    public ProposalCompanyContextService(SettingsService settings, ILogger<ProposalCompanyContextService> log)
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
            CREATE TABLE IF NOT EXISTS proposal_company_context (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
                lead_id UUID,
                company_name TEXT,
                industry TEXT,
                description TEXT,
                estimated_employees TEXT,
                annual_revenue TEXT,
                founded_year TEXT,
                website_url TEXT,
                linkedin_url TEXT,
                address TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(proposal_id)
            )");
        _log.LogInformation("proposal_company_context table OK");
    }

    public async Task<ProposalCompanyContext?> GetByProposalId(Guid proposalId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM proposal_company_context WHERE proposal_id=@proposalId", new { proposalId });
        return row == null ? null : Map(row);
    }

    public async Task Upsert(ProposalCompanyContext ctx)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO proposal_company_context (
                id, proposal_id, lead_id, company_name, industry, description,
                estimated_employees, annual_revenue, founded_year,
                website_url, linkedin_url, address, created_at, updated_at)
            VALUES (
                @Id, @ProposalId, @LeadId, @CompanyName, @Industry, @Description,
                @EstimatedEmployees, @AnnualRevenue, @FoundedYear,
                @WebsiteUrl, @LinkedinUrl, @Address, NOW(), NOW())
            ON CONFLICT (proposal_id) DO UPDATE SET
                lead_id=EXCLUDED.lead_id,
                company_name=EXCLUDED.company_name,
                industry=EXCLUDED.industry,
                description=EXCLUDED.description,
                estimated_employees=EXCLUDED.estimated_employees,
                annual_revenue=EXCLUDED.annual_revenue,
                founded_year=EXCLUDED.founded_year,
                website_url=EXCLUDED.website_url,
                linkedin_url=EXCLUDED.linkedin_url,
                address=EXCLUDED.address,
                updated_at=NOW()", ctx);
    }

    private static ProposalCompanyContext Map(dynamic r) => new()
    {
        Id                = r.id,
        ProposalId        = r.proposal_id,
        LeadId            = r.lead_id,
        CompanyName       = r.company_name,
        Industry          = r.industry,
        Description       = r.description,
        EstimatedEmployees = r.estimated_employees,
        AnnualRevenue     = r.annual_revenue,
        FoundedYear       = r.founded_year,
        WebsiteUrl        = r.website_url,
        LinkedinUrl       = r.linkedin_url,
        Address           = r.address,
        CreatedAt         = r.created_at,
        UpdatedAt         = r.updated_at,
    };
}
