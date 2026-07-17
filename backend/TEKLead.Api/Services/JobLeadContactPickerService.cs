using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class JobLeadContactPickerService
{
    private readonly SettingsService _settings;
    private readonly ApolloService _apollo;
    private readonly JobScraperService _jobs;
    private readonly ILogger<JobLeadContactPickerService> _log;

    public JobLeadContactPickerService(SettingsService settings, ApolloService apollo, JobScraperService jobs, ILogger<JobLeadContactPickerService> log)
    {
        _settings = settings;
        _apollo = apollo;
        _jobs = jobs;
        _log = log;
    }

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS job_lead_contacts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_lead_id UUID NOT NULL REFERENCES job_leads(id) ON DELETE CASCADE,
                apollo_id TEXT,
                name TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                linkedin_url TEXT,
                email TEXT,
                source TEXT NOT NULL DEFAULT '',
                selected BOOLEAN NOT NULL DEFAULT FALSE,
                enriched BOOLEAN NOT NULL DEFAULT FALSE,
                credits_used INT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_job_lead_contacts_lead ON job_lead_contacts(job_lead_id);
        ");
    }

    public async Task<List<JobLeadContact>> GetForLead(Guid leadId)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync(@"SELECT id, job_lead_id, apollo_id, name, title, linkedin_url, email, source, selected, enriched, credits_used, created_at
            FROM job_lead_contacts WHERE job_lead_id=@leadId ORDER BY source='poster' DESC, created_at ASC", new { leadId });
        return rows.Select(r => new JobLeadContact
        {
            Id = r.id, JobLeadId = r.job_lead_id, ApolloId = r.apollo_id, Name = r.name, Title = r.title,
            LinkedinUrl = r.linkedin_url, Email = r.email, Source = r.source, Selected = r.selected,
            Enriched = r.enriched, CreditsUsed = r.credits_used, CreatedAt = r.created_at,
        }).ToList();
    }

    // All enriched contacts across every job lead, with lead context joined in — powers the Job Contacts page.
    public async Task<(List<JobLeadContactWithLead> Contacts, int Total)> GetAllEnriched(
        string? search, string? source, int page, int perPage, string? sortBy, string? sortDir)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var where = new List<string> { "jlc.enriched = TRUE" };
        var p = new DynamicParameters();

        if (!string.IsNullOrWhiteSpace(search))
        {
            where.Add("(jlc.name ILIKE @search OR jlc.email ILIKE @search OR jl.company ILIKE @search)");
            p.Add("search", $"%{search}%");
        }
        if (!string.IsNullOrWhiteSpace(source) && source != "all")
        {
            where.Add("jlc.source = @source");
            p.Add("source", source);
        }

        var whereSql = "WHERE " + string.Join(" AND ", where);

        var sortCol = sortBy switch
        {
            "name" => "jlc.name",
            "company" => "jl.company",
            "createdAt" => "jlc.created_at",
            _ => "jlc.created_at",
        };
        var dir = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";

        p.Add("limit", perPage);
        p.Add("offset", (page - 1) * perPage);

        var rows = await c.QueryAsync<dynamic>($@"
            SELECT jlc.id, jlc.job_lead_id, jlc.apollo_id, jlc.name, jlc.title, jlc.linkedin_url, jlc.email,
                   jlc.source, jlc.selected, jlc.enriched, jlc.credits_used, jlc.created_at,
                   jl.company AS lead_company, jl.job_title AS lead_job_title, jl.status AS lead_status
            FROM job_lead_contacts jlc
            JOIN job_leads jl ON jl.id = jlc.job_lead_id
            {whereSql}
            ORDER BY {sortCol} {dir} NULLS LAST
            LIMIT @limit OFFSET @offset", p);

        var total = await c.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM job_lead_contacts jlc JOIN job_leads jl ON jl.id = jlc.job_lead_id {whereSql}", p);

        var contacts = rows.Select(r => new JobLeadContactWithLead
        {
            Id = r.id, JobLeadId = r.job_lead_id, ApolloId = r.apollo_id, Name = r.name, Title = r.title,
            LinkedinUrl = r.linkedin_url, Email = r.email, Source = r.source, Selected = r.selected,
            Enriched = r.enriched, CreditsUsed = r.credits_used, CreatedAt = r.created_at,
            LeadCompany = r.lead_company ?? "", LeadJobTitle = r.lead_job_title ?? "", LeadStatus = r.lead_status ?? "",
        }).ToList();

        return (contacts, total);
    }

    public async Task<(bool ok, string message)> FindCandidates(Guid leadId)
    {
        var lead = await _jobs.GetById(leadId);
        if (lead == null) return (false, "Lead not found.");
        if (string.IsNullOrWhiteSpace(lead.Company)) return (false, "Lead has no company name.");

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync("DELETE FROM job_lead_contacts WHERE job_lead_id=@leadId AND enriched=FALSE", new { leadId });

        var addedAny = false;

        if (!string.IsNullOrWhiteSpace(lead.PosterLinkedin))
        {
            try
            {
                var posterLead = await _apollo.SearchByLinkedIn(lead.PosterLinkedin!);
                if (posterLead != null)
                {
                    var email = posterLead.Emails.FirstOrDefault();
                    await c.ExecuteAsync(@"
                        INSERT INTO job_lead_contacts (job_lead_id, apollo_id, name, title, linkedin_url, email, source, enriched, credits_used)
                        VALUES (@leadId, @apolloId, @name, @title, @linkedin, @email, 'poster', @enriched, 1)",
                        new
                        {
                            leadId, apolloId = posterLead.ApolloId,
                            name = string.IsNullOrWhiteSpace(posterLead.Name) ? lead.PosterName : posterLead.Name,
                            title = string.IsNullOrWhiteSpace(posterLead.Title) ? lead.PosterTitle : posterLead.Title,
                            linkedin = posterLead.LinkedinUrl ?? lead.PosterLinkedin,
                            email = string.IsNullOrWhiteSpace(email) ? null : email,
                            enriched = !string.IsNullOrWhiteSpace(email),
                        });
                    addedAny = true;
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Poster LinkedIn match failed for lead {id}", leadId);
            }
        }
        else if (!string.IsNullOrWhiteSpace(lead.PosterName))
        {
            await c.ExecuteAsync(@"
                INSERT INTO job_lead_contacts (job_lead_id, name, title, source, enriched, credits_used)
                VALUES (@leadId, @name, @title, 'poster', FALSE, 0)",
                new { leadId, name = lead.PosterName, title = lead.PosterTitle ?? "" });
            addedAny = true;
        }

        // Resolve company name to a domain once, then use it as a hard filter for every title search below.
        // Without this, Apollo's free-text company match is fuzzy and can return the same popular
        // candidate across unrelated companies.
        string? domain = null;
        try { domain = await _apollo.SearchOrganizationDomain(lead.Company); }
        catch (Exception ex) { _log.LogWarning(ex, "Org domain lookup failed for lead {id}, company {company}", leadId, lead.Company); }

        foreach (var title in JobScraperService.ContactTitlePriority)
        {
            List<Lead> candidates;
            try
            {
                var (found, _) = domain != null
                    ? await _apollo.Search(null, title, null, null, null, domain, 1, 3)
                    : await _apollo.Search(null, title, lead.Company, null, null, null, 1, 3);
                candidates = found;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Apollo search failed for lead {id}, title {title}", leadId, title);
                continue;
            }

            var candidate = candidates.FirstOrDefault(cand =>
                !string.IsNullOrWhiteSpace(cand.ApolloId) &&
                !string.Equals(cand.Name?.Trim(), lead.Company.Trim(), StringComparison.OrdinalIgnoreCase) &&
                (domain != null || string.Equals(cand.Company?.Trim(), lead.Company.Trim(), StringComparison.OrdinalIgnoreCase)));
            if (candidate == null) continue;

            var exists = await c.ExecuteScalarAsync<bool>(
                "SELECT EXISTS(SELECT 1 FROM job_lead_contacts WHERE job_lead_id=@leadId AND apollo_id=@apolloId)",
                new { leadId, apolloId = candidate.ApolloId });
            if (exists) continue;

            await c.ExecuteAsync(@"
                INSERT INTO job_lead_contacts (job_lead_id, apollo_id, name, title, linkedin_url, source, enriched, credits_used)
                VALUES (@leadId, @apolloId, @name, @title, @linkedin, 'priority', FALSE, 0)",
                new { leadId, apolloId = candidate.ApolloId, name = candidate.Name, title = candidate.Title, linkedin = candidate.LinkedinUrl });
            addedAny = true;
        }

        await _jobs.AddEvent(leadId, addedAny ? "Found candidate contacts" : "No candidate contacts found");
        return addedAny ? (true, "Candidates found.") : (false, "No candidates found at this company.");
    }

    public async Task<(bool ok, string message)> EnrichSelected(Guid leadId, List<Guid> contactIds)
    {
        if (contactIds.Count == 0) return (false, "No contacts selected.");

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var rows = (await c.QueryAsync(
            "SELECT id, apollo_id, name, title, enriched FROM job_lead_contacts WHERE job_lead_id=@leadId AND id = ANY(@ids)",
            new { leadId, ids = contactIds.ToArray() })).ToList();

        var anyEnriched = false;

        foreach (var r in rows)
        {
            Guid id = r.id;
            string? apolloId = r.apollo_id;
            bool alreadyEnriched = r.enriched;

            if (alreadyEnriched)
            {
                await c.ExecuteAsync("UPDATE job_lead_contacts SET selected=TRUE WHERE id=@id", new { id });
                anyEnriched = true;
                continue;
            }

            if (string.IsNullOrWhiteSpace(apolloId))
            {
                _log.LogWarning("Contact {id} has no apollo_id, cannot enrich", id);
                continue;
            }

            try
            {
                var enriched = await _apollo.EnrichEmailOnly(apolloId);
                var email = enriched.Emails.FirstOrDefault();
                if (string.IsNullOrWhiteSpace(email))
                {
                    await c.ExecuteAsync("UPDATE job_lead_contacts SET selected=TRUE, credits_used=credits_used+1 WHERE id=@id", new { id });
                    continue;
                }
                await c.ExecuteAsync(@"
                    UPDATE job_lead_contacts SET email=@email, name=COALESCE(NULLIF(@name,''), name),
                        title=COALESCE(NULLIF(@title,''), title), selected=TRUE, enriched=TRUE, credits_used=credits_used+1
                    WHERE id=@id",
                    new { id, email, name = enriched.FullName, title = enriched.Title });
                anyEnriched = true;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Enrich failed for contact {id}", id);
            }
        }

        var final = (await c.QueryAsync(@"
            SELECT id, apollo_id, name, title, linkedin_url, email, source FROM job_lead_contacts
            WHERE job_lead_id=@leadId AND selected=TRUE AND email IS NOT NULL
            ORDER BY source='poster' DESC, created_at ASC LIMIT 1", new { leadId })).FirstOrDefault();

        if (final != null)
        {
            await c.ExecuteAsync(@"
                UPDATE job_leads SET
                    status = CASE WHEN status='scraped' THEN 'enriched' ELSE status END,
                    apollo_person_id=@apolloId, contact_name=@name, contact_title=@title,
                    contact_email=@email, contact_linkedin=@linkedin,
                    enriched_at=NOW(), updated_at=NOW()
                WHERE id=@leadId",
                new { leadId, apolloId = (string)final.apollo_id, name = (string)final.name, title = (string)final.title, email = (string)final.email, linkedin = (string?)final.linkedin_url });
            await _jobs.AddEvent(leadId, $"Enriched contact: {(string)final.name}");
        }

        return anyEnriched
            ? (true, final != null ? "Enriched and saved." : "Enriched, but no email found on selected contacts.")
            : (false, "No emails found for selected contacts.");
    }
}
