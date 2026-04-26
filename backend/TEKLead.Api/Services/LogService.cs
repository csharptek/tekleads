using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class LogService
{
    private readonly SettingsService _settings;
    private readonly ILogger<LogService> _log;

    public LogService(SettingsService settings, ILogger<LogService> log)
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
            CREATE TABLE IF NOT EXISTS api_logs (
                id BIGSERIAL PRIMARY KEY,
                method TEXT NOT NULL DEFAULT '',
                path TEXT NOT NULL DEFAULT '',
                query_string TEXT,
                request_body TEXT,
                status_code INT NOT NULL DEFAULT 0,
                response_body TEXT,
                duration_ms BIGINT NOT NULL DEFAULT 0,
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        // Index for common filters
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_logs(created_at DESC)");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS idx_api_logs_status ON api_logs(status_code)");
        _log.LogInformation("api_logs table OK");
    }

    public async Task InsertAsync(ApiLog entry)
    {
        try
        {
            await using var c = Conn();
            await c.OpenAsync();
            await c.ExecuteAsync(@"
                INSERT INTO api_logs (method, path, query_string, request_body, status_code, response_body, duration_ms, error, created_at)
                VALUES (@Method, @Path, @QueryString, @RequestBody, @StatusCode, @ResponseBody, @DurationMs, @Error, @CreatedAt)",
                entry);
        }
        catch (Exception ex)
        {
            _log.LogWarning("Failed to write api_log: {0}", ex.Message);
        }
    }

    public async Task<(List<ApiLog> Items, int Total)> GetPagedAsync(
        int page, int pageSize,
        string? method, string? pathFilter,
        int? statusCode, DateTime? from, DateTime? to)
    {
        await using var c = Conn();
        await c.OpenAsync();

        var where = new List<string>();
        var p = new DynamicParameters();

        if (!string.IsNullOrWhiteSpace(method)) { where.Add("method = @method"); p.Add("method", method.ToUpper()); }
        if (!string.IsNullOrWhiteSpace(pathFilter)) { where.Add("path ILIKE @path"); p.Add("path", $"%{pathFilter}%"); }
        if (statusCode.HasValue) { where.Add("status_code = @status"); p.Add("status", statusCode.Value); }
        if (from.HasValue) { where.Add("created_at >= @from"); p.Add("from", from.Value); }
        if (to.HasValue) { where.Add("created_at <= @to"); p.Add("to", to.Value); }

        var clause = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";

        p.Add("offset", (page - 1) * pageSize);
        p.Add("limit", pageSize);

        var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM api_logs {clause}", p);
        var rows = await c.QueryAsync<dynamic>($"SELECT * FROM api_logs {clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset", p);

        var items = rows.Select(r => new ApiLog
        {
            Id = r.id,
            Method = r.method ?? "",
            Path = r.path ?? "",
            QueryString = r.query_string,
            RequestBody = r.request_body,
            StatusCode = r.status_code,
            ResponseBody = r.response_body,
            DurationMs = r.duration_ms,
            Error = r.error,
            CreatedAt = r.created_at,
        }).ToList();

        return (items, total);
    }

    public async Task<ApiLog?> GetByIdAsync(long id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var r = await c.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM api_logs WHERE id=@id", new { id });
        if (r == null) return null;
        return new ApiLog
        {
            Id = r.id, Method = r.method ?? "", Path = r.path ?? "",
            QueryString = r.query_string, RequestBody = r.request_body,
            StatusCode = r.status_code, ResponseBody = r.response_body,
            DurationMs = r.duration_ms, Error = r.error, CreatedAt = r.created_at,
        };
    }

    public async Task ClearAsync()
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("TRUNCATE api_logs RESTART IDENTITY");
    }
}
