using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

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
        ");
    }

    public async Task EnqueueBulk(Guid proposalId, List<(string email, string name)> recipients, int intervalMinutes)
    {
        // Cancel any existing pending jobs for this proposal first
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(
            "DELETE FROM email_send_jobs WHERE proposal_id=@pid AND status='pending'",
            new { pid = proposalId });

        var now = DateTime.UtcNow;
        for (int i = 0; i < recipients.Count; i++)
        {
            var scheduled = now.AddMinutes(i * intervalMinutes);
            await c.ExecuteAsync(@"
                INSERT INTO email_send_jobs (proposal_id, to_email, to_name, scheduled_at, status)
                VALUES (@pid, @email, @name, @scheduledAt, 'pending')",
                new { pid = proposalId, email = recipients[i].email, name = recipients[i].name, scheduledAt = scheduled });
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
    };
}
