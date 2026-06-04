using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/phone-webhook-logs")]
public class PhoneWebhookLogsController : ControllerBase
{
    private readonly SettingsService _settings;

    public PhoneWebhookLogsController(SettingsService settings)
    {
        _settings = settings;
    }

    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? source = null,
        [FromQuery] string? waResult = null,
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] string? sortBy = "created_at",
        [FromQuery] string? sortDir = "desc")
    {
        try
        {
            await using var c = new NpgsqlConnection(_settings.ConnectionString);
            await c.OpenAsync();

            var where = new List<string>();
            var p = new DynamicParameters();

            if (!string.IsNullOrWhiteSpace(source))  { where.Add("e.source = @source"); p.Add("source", source); }
            if (!string.IsNullOrWhiteSpace(waResult)) { where.Add("e.wa_result ILIKE @waResult"); p.Add("waResult", $"%{waResult}%"); }
            if (!string.IsNullOrWhiteSpace(from) && DateTime.TryParse(from, out var fromDt)) { where.Add("e.created_at >= @from"); p.Add("from", fromDt); }
            if (!string.IsNullOrWhiteSpace(to)   && DateTime.TryParse(to,   out var toDt))   { where.Add("e.created_at <= @to");   p.Add("to",   toDt.AddDays(1)); }

            var whereClause = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";
            var allowed = new HashSet<string> { "created_at", "wa_picked_at", "processed_at", "wa_result", "source" };
            var col = allowed.Contains(sortBy ?? "") ? sortBy : "created_at";
            var dir = sortDir?.ToLower() == "asc" ? "ASC" : "DESC";
            var offset = (page - 1) * pageSize;

            // Join with leads table to get contact name
            var sql = $@"
                SELECT
                    e.id,
                    e.source,
                    e.entity_id        AS EntityId,
                    e.phones,
                    e.wa_sent          AS WaSent,
                    e.wa_result        AS WaResult,
                    e.processed_at     AS ProcessedAt,
                    e.created_at       AS CreatedAt,
                    COALESCE(l.name, '') AS ContactName,
                    COALESCE(l.company, '') AS ContactCompany
                FROM phone_webhook_events e
                LEFT JOIN leads l ON l.id = e.entity_id
                {whereClause}
                ORDER BY e." + col + " " + dir + @"
                LIMIT @pageSize OFFSET @offset";

            var countSql = $@"
                SELECT COUNT(*) FROM phone_webhook_events e
                {whereClause}";

            p.Add("pageSize", pageSize);
            p.Add("offset", offset);

            var total = await c.QuerySingleAsync<int>(countSql, p);
            var rows  = await c.QueryAsync<dynamic>(sql, p);

            var items = rows.Select(r => new
            {
                id           = (Guid)r.id,
                source       = (string)r.source,
                entityId     = (Guid)r.entityid,
                phones       = (string[])(r.phones ?? Array.Empty<string>()),
                waSent       = (bool)r.wasent,
                waResult     = (string?)r.waresult,
                processedAt  = (DateTime?)r.processedat,
                createdAt    = (DateTime)r.createdat,
                contactName  = (string)r.contactname,
                contactCompany = (string)r.contactcompany,
            }).ToList();

            return Ok(new
            {
                items,
                total,
                page,
                pageSize,
                totalPages = (int)Math.Ceiling((double)total / pageSize)
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}
