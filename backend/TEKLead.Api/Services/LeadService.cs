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
            CREATE TABLE IF NOT EXISTS saved_leads (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                apollo_id TEXT,
                name TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                company TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                city TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                emails TEXT[] NOT NULL DEFAULT '{}',
                phones TEXT[] NOT NULL DEFAULT '{}',
                linkedin_url TEXT,
                twitter_url TEXT,
                github_url TEXT,
                facebook_url TEXT,
                photo_url TEXT,
                headline TEXT,
                seniority TEXT,
                email_status TEXT,
                departments TEXT[] NOT NULL DEFAULT '{}',
                saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");

        // Migrate existing tables — add columns if missing
        var newCols = new[]
        {
            ("city",         "TEXT NOT NULL DEFAULT ''"),
            ("state",        "TEXT NOT NULL DEFAULT ''"),
            ("country",      "TEXT NOT NULL DEFAULT ''"),
            ("twitter_url",  "TEXT"),
            ("github_url",   "TEXT"),
            ("facebook_url", "TEXT"),
            ("photo_url",    "TEXT"),
            ("headline",     "TEXT"),
            ("seniority",    "TEXT"),
            ("email_status", "TEXT"),
            ("departments",  "TEXT[] NOT NULL DEFAULT '{}'"),
        };
        foreach (var (col, def) in newCols)
            await c.ExecuteAsync($"ALTER TABLE saved_leads ADD COLUMN IF NOT EXISTS {col} {def}");

        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS lead_org_details (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id UUID NOT NULL REFERENCES saved_leads(id) ON DELETE CASCADE,
                org_website_url TEXT,
                org_estimated_employees TEXT,
                org_annual_revenue TEXT,
                org_founded_year TEXT,
                org_logo_url TEXT,
                org_linkedin_url TEXT,
                org_phone TEXT,
                org_address TEXT,
                UNIQUE(lead_id)
            )");

        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS lead_employment_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id UUID NOT NULL REFERENCES saved_leads(id) ON DELETE CASCADE,
                job_title TEXT,
                org_name TEXT,
                start_date TEXT,
                end_date TEXT,
                is_current BOOLEAN NOT NULL DEFAULT FALSE
            )");

        _log.LogInformation("Lead schema OK");
    }

    public async Task<List<Lead>> GetAll()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>("SELECT * FROM saved_leads ORDER BY saved_at DESC");
        var leads = rows.Select(MapBase).ToList();
        await HydrateRelations(c, leads);
        return leads;
    }

    public async Task<Lead?> GetById(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM saved_leads WHERE id=@id", new { id });
        if (row == null) return null;
        var lead = MapBase(row);
        await HydrateRelations(c, new List<Lead> { lead });
        return lead;
    }

    public async Task<Lead> Upsert(Lead lead)
    {
        await using var c = Conn();
        await c.OpenAsync();

        if (!string.IsNullOrEmpty(lead.ApolloId))
        {
            var existing = await c.QuerySingleOrDefaultAsync<dynamic>(
                "SELECT id FROM saved_leads WHERE apollo_id = @apolloId", new { apolloId = lead.ApolloId });

            if (existing != null)
            {
                lead.Id = existing.id;
                await UpsertLeadRow(c, lead, isUpdate: true);
            }
            else
            {
                if (lead.Id == Guid.Empty) lead.Id = Guid.NewGuid();
                await UpsertLeadRow(c, lead, isUpdate: false);
            }
        }
        else
        {
            if (lead.Id == Guid.Empty) lead.Id = Guid.NewGuid();
            await c.ExecuteAsync(@"
                INSERT INTO saved_leads (
                    id, apollo_id, name, title, company, industry, location, city, state, country,
                    emails, phones, linkedin_url, twitter_url, github_url, facebook_url, photo_url,
                    headline, seniority, email_status, departments, saved_at)
                VALUES (
                    @Id, @ApolloId, @Name, @Title, @Company, @Industry, @Location, @City, @State, @Country,
                    @Emails, @Phones, @LinkedinUrl, @TwitterUrl, @GithubUrl, @FacebookUrl, @PhotoUrl,
                    @Headline, @Seniority, @EmailStatus, @Departments, @SavedAt)
                ON CONFLICT (id) DO UPDATE SET
                    name=EXCLUDED.name, title=EXCLUDED.title, company=EXCLUDED.company,
                    industry=EXCLUDED.industry, location=EXCLUDED.location,
                    city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country,
                    emails=EXCLUDED.emails, phones=EXCLUDED.phones,
                    linkedin_url=EXCLUDED.linkedin_url, twitter_url=EXCLUDED.twitter_url,
                    github_url=EXCLUDED.github_url, facebook_url=EXCLUDED.facebook_url,
                    photo_url=EXCLUDED.photo_url, headline=EXCLUDED.headline,
                    seniority=EXCLUDED.seniority, email_status=EXCLUDED.email_status,
                    departments=EXCLUDED.departments, saved_at=EXCLUDED.saved_at",
                BuildParams(lead));
        }

        await UpsertOrgDetails(c, lead);
        await UpsertEmploymentHistory(c, lead);

        _log.LogInformation("Saved lead {0} ({1})", lead.Name, lead.Id);
        return lead;
    }

    private static async Task UpsertLeadRow(NpgsqlConnection c, Lead lead, bool isUpdate)
    {
        if (isUpdate)
        {
            await c.ExecuteAsync(@"
                UPDATE saved_leads SET
                    name=@Name, title=@Title, company=@Company, industry=@Industry,
                    location=@Location, city=@City, state=@State, country=@Country,
                    emails=@Emails, phones=@Phones, linkedin_url=@LinkedinUrl,
                    twitter_url=@TwitterUrl, github_url=@GithubUrl, facebook_url=@FacebookUrl,
                    photo_url=@PhotoUrl, headline=@Headline, seniority=@Seniority,
                    email_status=@EmailStatus, departments=@Departments, saved_at=@SavedAt
                WHERE apollo_id=@ApolloId", BuildParams(lead));
        }
        else
        {
            await c.ExecuteAsync(@"
                INSERT INTO saved_leads (
                    id, apollo_id, name, title, company, industry, location, city, state, country,
                    emails, phones, linkedin_url, twitter_url, github_url, facebook_url, photo_url,
                    headline, seniority, email_status, departments, saved_at)
                VALUES (
                    @Id, @ApolloId, @Name, @Title, @Company, @Industry, @Location, @City, @State, @Country,
                    @Emails, @Phones, @LinkedinUrl, @TwitterUrl, @GithubUrl, @FacebookUrl, @PhotoUrl,
                    @Headline, @Seniority, @EmailStatus, @Departments, @SavedAt)",
                BuildParams(lead));
        }
    }

    private static object BuildParams(Lead lead) => new
    {
        lead.Id, lead.ApolloId, lead.Name, lead.Title, lead.Company, lead.Industry,
        lead.Location, lead.City, lead.State, lead.Country,
        lead.Emails, lead.Phones, lead.LinkedinUrl, lead.TwitterUrl, lead.GithubUrl,
        lead.FacebookUrl, lead.PhotoUrl, lead.Headline, lead.Seniority, lead.EmailStatus,
        lead.Departments, lead.SavedAt,
    };

    private static async Task UpsertOrgDetails(NpgsqlConnection c, Lead lead)
    {
        if (lead.OrgDetails == null) return;
        var o = lead.OrgDetails;
        o.LeadId = lead.Id;
        if (o.Id == Guid.Empty) o.Id = Guid.NewGuid();
        await c.ExecuteAsync(@"
            INSERT INTO lead_org_details (
                id, lead_id, org_website_url, org_estimated_employees, org_annual_revenue,
                org_founded_year, org_logo_url, org_linkedin_url, org_phone, org_address)
            VALUES (
                @Id, @LeadId, @OrgWebsiteUrl, @OrgEstimatedEmployees, @OrgAnnualRevenue,
                @OrgFoundedYear, @OrgLogoUrl, @OrgLinkedinUrl, @OrgPhone, @OrgAddress)
            ON CONFLICT (lead_id) DO UPDATE SET
                org_website_url=EXCLUDED.org_website_url,
                org_estimated_employees=EXCLUDED.org_estimated_employees,
                org_annual_revenue=EXCLUDED.org_annual_revenue,
                org_founded_year=EXCLUDED.org_founded_year,
                org_logo_url=EXCLUDED.org_logo_url,
                org_linkedin_url=EXCLUDED.org_linkedin_url,
                org_phone=EXCLUDED.org_phone,
                org_address=EXCLUDED.org_address", o);
    }

    private static async Task UpsertEmploymentHistory(NpgsqlConnection c, Lead lead)
    {
        if (lead.EmploymentHistory == null || lead.EmploymentHistory.Count == 0) return;
        await c.ExecuteAsync("DELETE FROM lead_employment_history WHERE lead_id=@leadId", new { leadId = lead.Id });
        foreach (var e in lead.EmploymentHistory)
        {
            e.LeadId = lead.Id;
            if (e.Id == Guid.Empty) e.Id = Guid.NewGuid();
            await c.ExecuteAsync(@"
                INSERT INTO lead_employment_history (id, lead_id, job_title, org_name, start_date, end_date, is_current)
                VALUES (@Id, @LeadId, @JobTitle, @OrgName, @StartDate, @EndDate, @IsCurrent)", e);
        }
    }

    private static async Task HydrateRelations(NpgsqlConnection c, List<Lead> leads)
    {
        if (leads.Count == 0) return;
        var ids = leads.Select(l => l.Id).ToArray();

        var orgRows = await c.QueryAsync<dynamic>(
            "SELECT * FROM lead_org_details WHERE lead_id = ANY(@ids)", new { ids });
        var orgMap = orgRows.ToDictionary(r => (Guid)r.lead_id, r => MapOrg(r));

        var empRows = await c.QueryAsync<dynamic>(
            "SELECT * FROM lead_employment_history WHERE lead_id = ANY(@ids) ORDER BY is_current DESC, start_date DESC", new { ids });
        var empMap = empRows.GroupBy(r => (Guid)r.lead_id)
            .ToDictionary(g => g.Key, g => g.Select(r => (LeadEmploymentHistory)MapEmp(r)).ToList());

        foreach (var lead in leads)
        {
            if (orgMap.TryGetValue(lead.Id, out var org)) lead.OrgDetails = org;
            if (empMap.TryGetValue(lead.Id, out var emp)) lead.EmploymentHistory = emp;
        }
    }

    public async Task<List<Lead>> FindDuplicates(string? apolloId, string? name, string? company, string? linkedinUrl)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var results = new List<Lead>();
        var seen = new HashSet<Guid>();

        if (!string.IsNullOrWhiteSpace(apolloId))
        {
            var rows = await c.QueryAsync<dynamic>("SELECT * FROM saved_leads WHERE apollo_id = @apolloId", new { apolloId });
            foreach (var r in rows) { var l = MapBase(r); if (seen.Add(l.Id)) results.Add(l); }
        }
        if (!string.IsNullOrWhiteSpace(linkedinUrl))
        {
            var rows = await c.QueryAsync<dynamic>("SELECT * FROM saved_leads WHERE LOWER(linkedin_url) = LOWER(@linkedinUrl)", new { linkedinUrl });
            foreach (var r in rows) { var l = MapBase(r); if (seen.Add(l.Id)) results.Add(l); }
        }
        if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(company))
        {
            var rows = await c.QueryAsync<dynamic>(
                "SELECT * FROM saved_leads WHERE LOWER(name) = LOWER(@name) AND LOWER(company) = LOWER(@company)",
                new { name, company });
            foreach (var r in rows) { var l = MapBase(r); if (seen.Add(l.Id)) results.Add(l); }
        }
        return results;
    }

    public async Task<List<Lead>> FindByName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return new List<Lead>();
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM saved_leads WHERE LOWER(name) = LOWER(@name)", new { name });
        return rows.Select(MapBase).ToList();
    }

    public static Lead MapBase(dynamic r) => new()
    {
        Id          = r.id,
        ApolloId    = r.apollo_id,
        Name        = r.name ?? "",
        Title       = r.title ?? "",
        Company     = r.company ?? "",
        Industry    = r.industry ?? "",
        Location    = r.location ?? "",
        City        = r.city ?? "",
        State       = r.state ?? "",
        Country     = r.country ?? "",
        Emails      = r.emails ?? Array.Empty<string>(),
        Phones      = r.phones ?? Array.Empty<string>(),
        LinkedinUrl = r.linkedin_url,
        TwitterUrl  = r.twitter_url,
        GithubUrl   = r.github_url,
        FacebookUrl = r.facebook_url,
        PhotoUrl    = r.photo_url,
        Headline    = r.headline,
        Seniority   = r.seniority,
        EmailStatus = r.email_status,
        Departments = r.departments ?? Array.Empty<string>(),
        SavedAt     = r.saved_at,
    };

    private static LeadOrgDetails MapOrg(dynamic r) => new()
    {
        Id                    = r.id,
        LeadId                = r.lead_id,
        OrgWebsiteUrl         = r.org_website_url,
        OrgEstimatedEmployees = r.org_estimated_employees,
        OrgAnnualRevenue      = r.org_annual_revenue,
        OrgFoundedYear        = r.org_founded_year,
        OrgLogoUrl            = r.org_logo_url,
        OrgLinkedinUrl        = r.org_linkedin_url,
        OrgPhone              = r.org_phone,
        OrgAddress            = r.org_address,
    };

    private static LeadEmploymentHistory MapEmp(dynamic r) => new()
    {
        Id        = r.id,
        LeadId    = r.lead_id,
        JobTitle  = r.job_title,
        OrgName   = r.org_name,
        StartDate = r.start_date,
        EndDate   = r.end_date,
        IsCurrent = r.is_current,
    };
}
