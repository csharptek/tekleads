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
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();

            var where = new List<string>();
            var p = new DynamicParameters();

            if (!string.IsNullOrWhiteSpace(name))
            {
                where.Add("name ILIKE @name");
                p.Add("name", $"%{name}%");
            }
            if (!string.IsNullOrWhiteSpace(company))
            {
                where.Add("company ILIKE @company");
                p.Add("company", $"%{company}%");
            }
            if (!string.IsNullOrWhiteSpace(title))
            {
                where.Add("title ILIKE @title");
                p.Add("title", $"%{title}%");
            }
            if (!string.IsNullOrWhiteSpace(industry))
            {
                where.Add("industry ILIKE @industry");
                p.Add("industry", $"%{industry}%");
            }
            if (!string.IsNullOrWhiteSpace(country))
            {
                where.Add("location ILIKE @country");
                p.Add("country", $"%{country}%");
            }
            if (!string.IsNullOrWhiteSpace(state))
            {
                where.Add("location ILIKE @state");
                p.Add("state", $"%{state}%");
            }
            if (hasPhone == "true")
                where.Add("array_length(phones, 1) > 0");
            if (hasPhone == "false")
                where.Add("(phones IS NULL OR array_length(phones, 1) IS NULL)");
            if (hasEmail == "true")
                where.Add("array_length(emails, 1) > 0");
            if (hasEmail == "false")
                where.Add("(emails IS NULL OR array_length(emails, 1) IS NULL)");
            if (!string.IsNullOrWhiteSpace(savedAfter) && DateTime.TryParse(savedAfter, out var after))
            {
                where.Add("saved_at >= @savedAfter");
                p.Add("savedAfter", after);
            }
            if (!string.IsNullOrWhiteSpace(savedBefore) && DateTime.TryParse(savedBefore, out var before))
            {
                where.Add("saved_at <= @savedBefore");
                p.Add("savedBefore", before.AddDays(1));
            }

            var allowedSort = new HashSet<string> { "saved_at", "name", "company", "title", "industry", "location" };
            var col = allowedSort.Contains(sortBy ?? "") ? sortBy : "saved_at";
            var dir = sortDir?.ToLower() == "asc" ? "ASC" : "DESC";

            var whereClause = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";
            var offset = (page - 1) * perPage;

            var total = await c.QuerySingleAsync<int>($"SELECT COUNT(*) FROM saved_leads {whereClause}", p);
            var rows  = await c.QueryAsync<dynamic>($"SELECT * FROM saved_leads {whereClause} ORDER BY {col} {dir} LIMIT @perPage OFFSET @offset", 
                MergeParams(p, new { perPage, offset }));

            var leads = rows.Select(r => new Lead
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
            }).ToList();

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
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            await c.ExecuteAsync("DELETE FROM saved_leads WHERE id=@id", new { id });
            return Ok(new { ok = true });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private static DynamicParameters MergeParams(DynamicParameters existing, object extra)
    {
        var ep = new DynamicParameters(extra);
        foreach (var name in existing.ParameterNames)
            ep.Add(name, existing.Get<object>(name));
        return ep;
    }
}
