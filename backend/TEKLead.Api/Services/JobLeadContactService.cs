using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class JobLeadContactService
{
    private readonly SettingsService _settings;
    private readonly ApolloService _apollo;
    private readonly JobScraperService _jobs;
    private readonly ILogger<JobLeadContactService> _log;

    public JobLeadContactService(SettingsService settings, ApolloService apollo, JobScraperService jobs, ILogger<JobLeadContactService> log)
    {
        _settings = settings;
        _apollo = apollo;
        _jobs = jobs;
        _log = log;
    }

    public async Task<(bool ok, string message)> Enrich(Guid leadId)
    {
        var lead = await _jobs.GetById(leadId);
        if (lead == null) return (false, "Lead not found.");
        if (string.IsNullOrWhiteSpace(lead.Company)) return (false, "Lead has no company name.");

        foreach (var title in JobScraperService.ContactTitlePriority)
        {
            List<Lead> candidates;
            try
            {
                var (found, _) = await _apollo.Search(null, title, lead.Company, null, null, null, 1, 3);
                candidates = found;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Apollo search failed for lead {id}, title {title}", leadId, title);
                continue;
            }

            var candidate = candidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c.ApolloId));
            if (candidate == null) continue;

            EnrichResult enriched;
            try
            {
                enriched = await _apollo.EnrichEmailOnly(candidate.ApolloId!);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Apollo enrich failed for lead {id}, apolloId {apolloId}", leadId, candidate.ApolloId);
                continue;
            }

            var email = enriched.Emails.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(email)) continue;

            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            await c.ExecuteAsync(@"
                UPDATE job_leads SET
                    status = CASE WHEN status='scraped' THEN 'enriched' ELSE status END,
                    apollo_person_id=@apolloId, contact_name=@name, contact_title=@title,
                    contact_email=@email, contact_linkedin=@linkedin, enriched_at=NOW(), updated_at=NOW()
                WHERE id=@id",
                new
                {
                    id = leadId, apolloId = candidate.ApolloId,
                    name = string.IsNullOrWhiteSpace(enriched.FullName) ? candidate.Name : enriched.FullName,
                    title = string.IsNullOrWhiteSpace(enriched.Title) ? candidate.Title : enriched.Title,
                    email, linkedin = enriched.LinkedinUrl,
                });
            await _jobs.AddEvent(leadId, "Enriched via Apollo");
            return (true, "Enriched.");
        }

        await _jobs.AddEvent(leadId, "Apollo enrichment found no contact");
        return (false, "No matching contact found at this company.");
    }
}
