using Dapper;
using Npgsql;

namespace TEKLead.Api.Services;

public class JobLeadEmailJob
{
    public Guid Id { get; set; }
    public Guid JobLeadId { get; set; }
    public int Stage { get; set; } // 0 initial, 1 fu1, 2 fu2
    public string ToEmail { get; set; } = "";
    public string ToName { get; set; } = "";
    public string FromEmail { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTime ScheduledAt { get; set; }
    public DateTime? SentAt { get; set; }
    public string Status { get; set; } = "pending";
    public string? Error { get; set; }
}

public class JobLeadEmailQueueService
{
    private readonly SettingsService _settings;

    public JobLeadEmailQueueService(SettingsService settings)
    {
        _settings = settings;
    }

    public async Task EnsureSchema()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS job_lead_email_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_lead_id UUID NOT NULL,
                stage INT NOT NULL DEFAULT 0,
                to_email TEXT NOT NULL,
                to_name TEXT NOT NULL DEFAULT '',
                from_email TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                scheduled_at TIMESTAMPTZ NOT NULL,
                sent_at TIMESTAMPTZ,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_jlej_status ON job_lead_email_jobs(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_jlej_lead ON job_lead_email_jobs(job_lead_id);
        ");
    }

    /// <summary>Enqueues one send job. Pass scheduledAt = null for "send now".</summary>
    public async Task<Guid> Enqueue(Guid jobLeadId, int stage, string toEmail, string toName, string fromEmail, string subject, string body, DateTime? scheduledAt)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM job_lead_email_jobs WHERE job_lead_id=@id AND stage=@stage AND status='pending'", new { id = jobLeadId, stage });
        return await c.QuerySingleAsync<Guid>(@"
            INSERT INTO job_lead_email_jobs (job_lead_id, stage, to_email, to_name, from_email, subject, body, scheduled_at, status)
            VALUES (@leadId, @stage, @toEmail, @toName, @fromEmail, @subject, @body, @scheduledAt, 'pending') RETURNING id",
            new { leadId = jobLeadId, stage, toEmail, toName, fromEmail, subject, body, scheduledAt = scheduledAt ?? DateTime.UtcNow });
    }

    public async Task<List<JobLeadEmailJob>> GetDueJobs()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>("SELECT * FROM job_lead_email_jobs WHERE status='pending' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 20");
        return rows.Select(Map).ToList();
    }

    public async Task MarkSent(Guid jobId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE job_lead_email_jobs SET status='sent', sent_at=NOW() WHERE id=@id", new { id = jobId });
    }

    public async Task MarkFailed(Guid jobId, string error)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE job_lead_email_jobs SET status='failed', error=@error WHERE id=@id", new { id = jobId, error });
    }

    public async Task CancelPending(Guid jobLeadId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE job_lead_email_jobs SET status='cancelled' WHERE job_lead_id=@id AND status='pending'", new { id = jobLeadId });
    }

    private static JobLeadEmailJob Map(dynamic r) => new()
    {
        Id = r.id, JobLeadId = r.job_lead_id, Stage = (int)r.stage, ToEmail = r.to_email ?? "", ToName = r.to_name ?? "",
        FromEmail = r.from_email ?? "", Subject = r.subject ?? "", Body = r.body ?? "", ScheduledAt = r.scheduled_at,
        SentAt = r.sent_at, Status = r.status ?? "pending", Error = r.error,
    };
}
