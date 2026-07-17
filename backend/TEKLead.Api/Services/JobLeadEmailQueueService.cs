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

    /// <summary>
    /// Enqueues initial email for each recipient + optional FU1/FU2, staggered by intervalMinutes.
    /// Cancels all existing pending jobs for this lead first.
    /// </summary>
    public async Task EnqueueBulk(
        Guid jobLeadId,
        List<(string email, string name)> recipients,
        string fromEmail,
        string initialSubject,
        string initialBody,
        int intervalMinutes,
        FollowUpSpec? fu1,
        FollowUpSpec? fu2)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();

        await c.ExecuteAsync(
            "DELETE FROM job_lead_email_jobs WHERE job_lead_id=@id AND status IN ('pending','cancelled','failed')",
            new { id = jobLeadId });

        var now = DateTime.UtcNow;
        for (int i = 0; i < recipients.Count; i++)
        {
            var initialAt = now.AddMinutes(i * intervalMinutes);

            await c.ExecuteAsync(@"
                INSERT INTO job_lead_email_jobs (job_lead_id, stage, to_email, to_name, from_email, subject, body, scheduled_at, status)
                VALUES (@leadId, 0, @email, @name, @fromEmail, @subject, @body, @scheduledAt, 'pending')",
                new { leadId = jobLeadId, email = recipients[i].email, name = recipients[i].name, fromEmail, subject = initialSubject, body = initialBody, scheduledAt = initialAt });

            if (fu1 != null && !string.IsNullOrWhiteSpace(fu1.Subject) && !string.IsNullOrWhiteSpace(fu1.Body))
            {
                var fu1At = initialAt.AddHours(fu1.DelayHours);
                await c.ExecuteAsync(@"
                    INSERT INTO job_lead_email_jobs (job_lead_id, stage, to_email, to_name, from_email, subject, body, scheduled_at, status)
                    VALUES (@leadId, 1, @email, @name, @fromEmail, @subject, @body, @scheduledAt, 'pending')",
                    new { leadId = jobLeadId, email = recipients[i].email, name = recipients[i].name, fromEmail, subject = fu1.Subject, body = fu1.Body, scheduledAt = fu1At });
            }

            if (fu2 != null && !string.IsNullOrWhiteSpace(fu2.Subject) && !string.IsNullOrWhiteSpace(fu2.Body))
            {
                var fu2At = initialAt.AddHours(fu2.DelayHours);
                await c.ExecuteAsync(@"
                    INSERT INTO job_lead_email_jobs (job_lead_id, stage, to_email, to_name, from_email, subject, body, scheduled_at, status)
                    VALUES (@leadId, 2, @email, @name, @fromEmail, @subject, @body, @scheduledAt, 'pending')",
                    new { leadId = jobLeadId, email = recipients[i].email, name = recipients[i].name, fromEmail, subject = fu2.Subject, body = fu2.Body, scheduledAt = fu2At });
            }
        }
    }

    public async Task<List<JobLeadEmailJob>> GetByLead(Guid jobLeadId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM job_lead_email_jobs WHERE job_lead_id=@id AND status != 'cancelled' ORDER BY stage, scheduled_at",
            new { id = jobLeadId });
        return rows.Select(Map).ToList();
    }

    public async Task<bool> CancelJob(Guid jobId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.ExecuteAsync(
            "UPDATE job_lead_email_jobs SET status='cancelled' WHERE id=@id AND status='pending'",
            new { id = jobId });
        return rows > 0;
    }

    /// <summary>
    /// Cancels pending follow-up jobs for a lead.
    /// If contactEmail is provided, only for that contact. If stage is provided (1 or 2), only that stage; otherwise stages 1+2.
    /// </summary>
    public async Task<int> CancelFollowUps(Guid jobLeadId, string? contactEmail = null, int? stage = null)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();

        var sql = new System.Text.StringBuilder(
            "UPDATE job_lead_email_jobs SET status='cancelled' WHERE job_lead_id=@id AND status='pending'");

        if (stage.HasValue) sql.Append(" AND stage=@stage");
        else sql.Append(" AND stage > 0");

        if (!string.IsNullOrWhiteSpace(contactEmail)) sql.Append(" AND to_email=@email");

        return await c.ExecuteAsync(sql.ToString(), new { id = jobLeadId, stage, email = contactEmail });
    }

    /// <summary>Advances ScheduledAt to NOW for a specific pending job so the worker picks it up immediately.</summary>
    public async Task<bool> SendNow(Guid jobId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.ExecuteAsync(
            "UPDATE job_lead_email_jobs SET scheduled_at=NOW() WHERE id=@id AND status='pending'",
            new { id = jobId });
        return rows > 0;
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
