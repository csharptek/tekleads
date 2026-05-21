using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class FollowUpSpec
{
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public int DelayHours { get; set; } = 24;
}

public class EmailSendQueueService
{
    private readonly SettingsService _settings;

    public EmailSendQueueService(SettingsService settings)
    {
        _settings = settings;
    }

    public async Task EnsureSchema()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS email_send_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                proposal_id UUID NOT NULL,
                to_email TEXT NOT NULL,
                to_name TEXT NOT NULL DEFAULT '',
                scheduled_at TIMESTAMPTZ NOT NULL,
                sent_at TIMESTAMPTZ,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_esj_status ON email_send_jobs(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_esj_proposal ON email_send_jobs(proposal_id);

            ALTER TABLE email_send_jobs ADD COLUMN IF NOT EXISTS follow_up_stage INT NOT NULL DEFAULT 0;
            ALTER TABLE email_send_jobs ADD COLUMN IF NOT EXISTS subject TEXT;
            ALTER TABLE email_send_jobs ADD COLUMN IF NOT EXISTS body TEXT;
            CREATE INDEX IF NOT EXISTS idx_esj_stage ON email_send_jobs(proposal_id, follow_up_stage);
        ");
    }

    /// <summary>
    /// Enqueues initial email for each recipient + optional FU1/FU2.
    /// Cancels all existing pending jobs for this proposal first.
    /// </summary>
    public async Task EnqueueBulk(
        Guid proposalId,
        List<(string email, string name)> recipients,
        int intervalMinutes,
        FollowUpSpec? fu1,
        FollowUpSpec? fu2)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();

        await c.ExecuteAsync(
            "DELETE FROM email_send_jobs WHERE proposal_id=@pid AND status='pending'",
            new { pid = proposalId });

        var now = DateTime.UtcNow;
        for (int i = 0; i < recipients.Count; i++)
        {
            var initialAt = now.AddMinutes(i * intervalMinutes);

            // initial
            await c.ExecuteAsync(@"
                INSERT INTO email_send_jobs (proposal_id, to_email, to_name, scheduled_at, status, follow_up_stage)
                VALUES (@pid, @email, @name, @scheduledAt, 'pending', 0)",
                new { pid = proposalId, email = recipients[i].email, name = recipients[i].name, scheduledAt = initialAt });

            // FU1
            if (fu1 != null && !string.IsNullOrWhiteSpace(fu1.Subject) && !string.IsNullOrWhiteSpace(fu1.Body))
            {
                var fu1At = initialAt.AddHours(fu1.DelayHours);
                await c.ExecuteAsync(@"
                    INSERT INTO email_send_jobs (proposal_id, to_email, to_name, scheduled_at, status, follow_up_stage, subject, body)
                    VALUES (@pid, @email, @name, @scheduledAt, 'pending', 1, @subject, @body)",
                    new { pid = proposalId, email = recipients[i].email, name = recipients[i].name, scheduledAt = fu1At, subject = fu1.Subject, body = fu1.Body });
            }

            // FU2
            if (fu2 != null && !string.IsNullOrWhiteSpace(fu2.Subject) && !string.IsNullOrWhiteSpace(fu2.Body))
            {
                var fu2At = initialAt.AddHours(fu2.DelayHours);
                await c.ExecuteAsync(@"
                    INSERT INTO email_send_jobs (proposal_id, to_email, to_name, scheduled_at, status, follow_up_stage, subject, body)
                    VALUES (@pid, @email, @name, @scheduledAt, 'pending', 2, @subject, @body)",
                    new { pid = proposalId, email = recipients[i].email, name = recipients[i].name, scheduledAt = fu2At, subject = fu2.Subject, body = fu2.Body });
            }
        }
    }

    public async Task<List<EmailSendJob>> GetDueJobs()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM email_send_jobs WHERE status='pending' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 20");
        return rows.Select(MapJob).ToList();
    }

    public async Task<List<EmailSendJob>> GetByProposal(Guid proposalId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM email_send_jobs WHERE proposal_id=@pid ORDER BY scheduled_at",
            new { pid = proposalId });
        return rows.Select(MapJob).ToList();
    }

    public async Task<EmailSendJob?> GetById(Guid jobId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT * FROM email_send_jobs WHERE id=@id", new { id = jobId });
        return row == null ? null : MapJob(row);
    }

    public async Task MarkSent(Guid jobId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE email_send_jobs SET status='sent', sent_at=NOW() WHERE id=@id",
            new { id = jobId });
    }

    public async Task MarkFailed(Guid jobId, string error)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE email_send_jobs SET status='failed', error=@error WHERE id=@id",
            new { id = jobId, error });
    }

    public async Task CancelPending(Guid proposalId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE email_send_jobs SET status='cancelled' WHERE proposal_id=@pid AND status='pending'",
            new { pid = proposalId });
    }

    /// <summary>
    /// Advances ScheduledAt to NOW for a specific pending job so the worker picks it up immediately.
    /// </summary>
    public async Task<bool> SendNow(Guid jobId)
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        var rows = await c.ExecuteAsync(
            "UPDATE email_send_jobs SET scheduled_at=NOW() WHERE id=@id AND status='pending'",
            new { id = jobId });
        return rows > 0;
    }

    private static EmailSendJob MapJob(dynamic r) => new()
    {
        Id = r.id,
        ProposalId = r.proposal_id,
        ToEmail = r.to_email ?? "",
        ToName = r.to_name ?? "",
        ScheduledAt = r.scheduled_at,
        SentAt = r.sent_at,
        Status = r.status ?? "pending",
        Error = r.error,
        CreatedAt = r.created_at,
        FollowUpStage = (int)(r.follow_up_stage ?? 0),
        Subject = r.subject,
        Body = r.body,
    };
}
