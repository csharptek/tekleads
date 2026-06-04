using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/saved-leads")]
public class SavedLeadsController : ControllerBase
{
    private readonly SettingsService _settings;
    private readonly LeadService _leads;
    private readonly ILogger<SavedLeadsController> _log;

    public SavedLeadsController(SettingsService settings, LeadService leads, ILogger<SavedLeadsController> log)
    {
        _settings = settings;
        _leads = leads;
        _log = log;
    }

    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] string? name,
        [FromQuery] string? company,
        [FromQuery] string? title,
        [FromQuery] string? industry,
        [FromQuery] string? country,
        [FromQuery] string? state,
        [FromQuery] string? phone,
        [FromQuery] string? hasPhone,
        [FromQuery] string? hasEmail,
        [FromQuery] string? savedAfter,
        [FromQuery] string? savedBefore,
        [FromQuery] string? sortBy = "saved_at",
        [FromQuery] string? sortDir = "desc",
        [FromQuery] int page = 1,
        [FromQuery] int perPage = 50)
    {
        try
        {
            await using var c = new NpgsqlConnection(_settings.ConnectionString);
            await c.OpenAsync();

            var where = new List<string>();
            var p = new DynamicParameters();

            if (!string.IsNullOrWhiteSpace(name))     { where.Add("name ILIKE @name");         p.Add("name",    $"%{name}%"); }
            if (!string.IsNullOrWhiteSpace(company))  { where.Add("company ILIKE @company");   p.Add("company", $"%{company}%"); }
            if (!string.IsNullOrWhiteSpace(title))    { where.Add("title ILIKE @title");       p.Add("title",   $"%{title}%"); }
            if (!string.IsNullOrWhiteSpace(industry)) { where.Add("industry ILIKE @industry"); p.Add("industry",$"%{industry}%"); }
            if (!string.IsNullOrWhiteSpace(country))  { where.Add("(location ILIKE @country OR country ILIKE @country)"); p.Add("country", $"%{country}%"); }
            if (!string.IsNullOrWhiteSpace(state))    { where.Add("(location ILIKE @state OR state ILIKE @state)");       p.Add("state",   $"%{state}%"); }
            if (!string.IsNullOrWhiteSpace(phone))
            {
                var cleanPhone = new string(phone.Where(char.IsDigit).ToArray());
                where.Add("EXISTS (SELECT 1 FROM unnest(phones) AS ph WHERE regexp_replace(ph, '[^0-9]', '', 'g') LIKE @phone)");
                p.Add("phone", $"%{cleanPhone}%");
            }
            if (hasPhone == "true")  where.Add("array_length(phones, 1) > 0");
            if (hasPhone == "false") where.Add("(phones IS NULL OR array_length(phones, 1) IS NULL)");
            if (hasEmail == "true")  where.Add("array_length(emails, 1) > 0");
            if (hasEmail == "false") where.Add("(emails IS NULL OR array_length(emails, 1) IS NULL)");
            if (!string.IsNullOrWhiteSpace(savedAfter) && DateTime.TryParse(savedAfter, out var after))
                { where.Add("saved_at >= @savedAfter"); p.Add("savedAfter", after); }
            if (!string.IsNullOrWhiteSpace(savedBefore) && DateTime.TryParse(savedBefore, out var before))
                { where.Add("saved_at <= @savedBefore"); p.Add("savedBefore", before.AddDays(1)); }

            var allowedSort = new HashSet<string> { "saved_at", "name", "company", "title", "industry", "location" };
            var col = allowedSort.Contains(sortBy ?? "") ? sortBy : "saved_at";
            var dir = sortDir?.ToLower() == "asc" ? "ASC" : "DESC";
            var whereClause = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";
            var offset = (page - 1) * perPage;

            var total = await c.QuerySingleAsync<int>($"SELECT COUNT(*) FROM saved_leads {whereClause}", p);
            var rows  = await c.QueryAsync<dynamic>($"SELECT * FROM saved_leads {whereClause} ORDER BY {col} {dir} LIMIT @perPage OFFSET @offset",
                MergeParams(p, new { perPage, offset }));

            var leads = rows.Select(LeadService.MapBase).ToList();

            // Hydrate org + employment for this page
            if (leads.Count > 0)
            {
                var ids = leads.Select(l => l.Id).ToArray();

                var orgRows = await c.QueryAsync<dynamic>("SELECT * FROM lead_org_details WHERE lead_id = ANY(@ids)", new { ids });
                var orgMap  = orgRows.ToDictionary(r => (Guid)r.lead_id, r => new LeadOrgDetails
                {
                    Id = r.id, LeadId = r.lead_id,
                    OrgWebsiteUrl = r.org_website_url, OrgEstimatedEmployees = r.org_estimated_employees,
                    OrgAnnualRevenue = r.org_annual_revenue, OrgFoundedYear = r.org_founded_year,
                    OrgLogoUrl = r.org_logo_url, OrgLinkedinUrl = r.org_linkedin_url,
                    OrgPhone = r.org_phone, OrgAddress = r.org_address,
                });

                var empRows = await c.QueryAsync<dynamic>(
                    "SELECT * FROM lead_employment_history WHERE lead_id = ANY(@ids) ORDER BY is_current DESC, start_date DESC", new { ids });
                var empMap = empRows.GroupBy(r => (Guid)r.lead_id)
                    .ToDictionary(g => g.Key, g => g.Select(r => new LeadEmploymentHistory
                    {
                        Id = r.id, LeadId = r.lead_id, JobTitle = r.job_title, OrgName = r.org_name,
                        StartDate = r.start_date, EndDate = r.end_date, IsCurrent = r.is_current,
                    }).ToList());

                foreach (var lead in leads)
                {
                    if (orgMap.TryGetValue(lead.Id, out var org)) lead.OrgDetails = org;
                    if (empMap.TryGetValue(lead.Id, out var emp)) lead.EmploymentHistory = emp;
                }
            }

            return Ok(new { leads, total, page, perPage });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "GET /api/saved-leads failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        try
        {
            await using var c = new NpgsqlConnection(_settings.ConnectionString);
            await c.OpenAsync();
            await c.ExecuteAsync("DELETE FROM saved_leads WHERE id=@id", new { id });
            return Ok(new { ok = true });
        }
        catch (Exception ex) { return StatusCode(500, new { error = ex.Message }); }
    }

    private static DynamicParameters MergeParams(DynamicParameters existing, object extra)
    {
        var ep = new DynamicParameters(extra);
        foreach (var name in existing.ParameterNames)
            ep.Add(name, existing.Get<object>(name));
        return ep;
    }
}
