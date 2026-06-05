using Dapper;
using Npgsql;

namespace TEKLead.Api.Services;

public class WaScheduledJob
{
    public Guid   Id            { get; set; }
    public Guid   ListId        { get; set; }
    public string ListName      { get; set; } = "";
    public string ContactId     { get; set; } = "";
    public string ContactName   { get; set; } = "";
    public string Phone         { get; set; } = "";
    public string Mode          { get; set; } = "template"; // template | text
    public string? TemplateName { get; set; }
    public string? TemplateLang { get; set; }
    public string? BodyJson     { get; set; } // JSON array of variables
    public string? Body         { get; set; } // for text mode
    public DateTime ScheduledAt { get; set; } // UTC
    public string Status        { get; set; } = "pending"; // pending | sent | failed | cancelled
    public string? Error        { get; set; }
    public DateTime? SentAt     { get; set; }
    public DateTime CreatedAt   { get; set; }
}

public class WaScheduleService
{
    private readonly SettingsService _settings;

    public WaScheduleService(SettingsService settings) => _settings = settings;

    public async Task EnsureSchema()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS wa_scheduled_sends (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                list_id      UUID NOT NULL,
                list_name    TEXT NOT NULL DEFAULT '',
                contact_id   TEXT NOT NULL DEFAULT '',
                contact_name TEXT NOT NULL DEFAULT '',
                phone        TEXT NOT NULL,
                mode         TEXT NOT NULL DEFAULT 'template',
                template_name TEXT,
                template_lang TEXT,
                body_json    TEXT,
                body         TEXT,
                scheduled_at TIMESTAMPTZ NOT NULL,
                status       TEXT NOT NULL DEFAULT 'pending',
                error        TEXT,
                sent_at      TIMESTAMPTZ,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_wass_status ON wa_scheduled_sends(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_wass_list   ON wa_scheduled_sends(list_id);
        ");
    }

    public async Task<List<Guid>> EnqueueBatch(List<WaScheduledJob> jobs, int intervalSeconds = 0)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var ids = new List<Guid>();
        for (int idx = 0; idx < jobs.Count; idx++)
        {
            var j = jobs[idx];
            if (intervalSeconds > 0 && idx > 0)
                j.ScheduledAt = j.ScheduledAt.AddSeconds(intervalSeconds * idx);
            var id = await c.ExecuteScalarAsync<Guid>(@"
                INSERT INTO wa_scheduled_sends
                    (list_id, list_name, contact_id, contact_name, phone, mode,
                     template_name, template_lang, body_json, body, scheduled_at, status)
                VALUES
                    (@ListId, @ListName, @ContactId, @ContactName, @Phone, @Mode,
                     @TemplateName, @TemplateLang, @BodyJson, @Body, @ScheduledAt, 'pending')
                RETURNING id",
                new {
                    j.ListId, j.ListName, j.ContactId, j.ContactName, j.Phone, j.Mode,
                    j.TemplateName, j.TemplateLang, j.BodyJson, j.Body, j.ScheduledAt
                });
            ids.Add(id);
        }
        return ids;
    }

    public async Task<List<WaScheduledJob>> GetDueJobs()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<WaScheduledJob>(@"
            SELECT id AS Id, list_id AS ListId, list_name AS ListName,
                   contact_id AS ContactId, contact_name AS ContactName,
                   phone AS Phone, mode AS Mode,
                   template_name AS TemplateName, template_lang AS TemplateLang,
                   body_json AS BodyJson, body AS Body,
                   scheduled_at AS ScheduledAt, status AS Status,
                   error AS Error, sent_at AS SentAt, created_at AS CreatedAt
            FROM wa_scheduled_sends
            WHERE status = 'pending' AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC
            LIMIT 50");
        return rows.ToList();
    }

    public async Task<List<WaScheduledJob>> GetByList(Guid listId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<WaScheduledJob>(@"
            SELECT id AS Id, list_id AS ListId, list_name AS ListName,
                   contact_id AS ContactId, contact_name AS ContactName,
                   phone AS Phone, mode AS Mode,
                   template_name AS TemplateName, template_lang AS TemplateLang,
                   body_json AS BodyJson, body AS Body,
                   scheduled_at AS ScheduledAt, status AS Status,
                   error AS Error, sent_at AS SentAt, created_at AS CreatedAt
            FROM wa_scheduled_sends
            WHERE list_id = @listId
            ORDER BY scheduled_at DESC
            LIMIT 200",
            new { listId });
        return rows.ToList();
    }

    public async Task MarkSent(Guid id)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE wa_scheduled_sends SET status='sent', sent_at=NOW() WHERE id=@id",
            new { id });
    }

    public async Task MarkFailed(Guid id, string error)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE wa_scheduled_sends SET status='failed', error=@error WHERE id=@id",
            new { id, error });
    }

    public async Task Cancel(Guid id)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE wa_scheduled_sends SET status='cancelled' WHERE id=@id AND status='pending'",
            new { id });
    }
}
