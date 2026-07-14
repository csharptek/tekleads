using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class JobLeadEmailWorker : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<JobLeadEmailWorker> _log;

    public JobLeadEmailWorker(IServiceProvider sp, ILogger<JobLeadEmailWorker> log)
    {
        _sp = sp;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("JobLeadEmailWorker started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDueJobs(); }
            catch (Exception ex) { _log.LogError(ex, "JobLeadEmailWorker error."); }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    private async Task ProcessDueJobs()
    {
        using var scope = _sp.CreateScope();
        var queue = scope.ServiceProvider.GetRequiredService<JobLeadEmailQueueService>();
        var graphEmail = scope.ServiceProvider.GetRequiredService<GraphEmailService>();
        var jobs = scope.ServiceProvider.GetRequiredService<JobScraperService>();
        var settingsSvc = scope.ServiceProvider.GetRequiredService<SettingsService>();

        var due = await queue.GetDueJobs();
        if (due.Count == 0) return;

        var settings = await settingsSvc.GetAll();
        var sig = settings.GetValueOrDefault(SettingKeys.EmailSignature, "");

        foreach (var job in due)
        {
            try
            {
                var (ok, error) = await graphEmail.SendEmail(job.ToEmail, job.ToName, job.Subject, job.Body,
                    string.IsNullOrWhiteSpace(sig) ? null : sig, string.IsNullOrWhiteSpace(job.FromEmail) ? null : job.FromEmail);

                if (ok)
                {
                    await queue.MarkSent(job.Id);
                    var stageLabel = job.Stage == 0 ? "Sent" : job.Stage == 1 ? "Follow-up 1 sent" : "Follow-up 2 sent";
                    await UpdateLeadOnSend(settingsSvc, job.JobLeadId, job.Stage, job.FromEmail);
                    await jobs.AddEvent(job.JobLeadId, stageLabel);
                    _log.LogInformation("JobLeadEmailWorker: sent stage={stage} to {email}", job.Stage, job.ToEmail);
                }
                else
                {
                    await queue.MarkFailed(job.Id, error);
                    _log.LogWarning("JobLeadEmailWorker: failed stage={stage} {email} — {error}", job.Stage, job.ToEmail, error);
                }
            }
            catch (Exception ex)
            {
                await queue.MarkFailed(job.Id, ex.Message);
                _log.LogError(ex, "JobLeadEmailWorker: exception for job {id}", job.Id);
            }
        }
    }

    private static async Task UpdateLeadOnSend(SettingsService settingsSvc, Guid leadId, int stage, string fromEmail)
    {
        await using var c = new NpgsqlConnection(settingsSvc.ConnectionString);
        await c.OpenAsync();
        if (stage == 0)
            await c.ExecuteAsync("UPDATE job_leads SET status='sent', sent_at=NOW(), sender_email=@from, updated_at=NOW() WHERE id=@id", new { id = leadId, from = fromEmail });
        else if (stage == 1)
            await c.ExecuteAsync("UPDATE job_leads SET fu1_sent_at=NOW(), updated_at=NOW() WHERE id=@id", new { id = leadId });
        else
            await c.ExecuteAsync("UPDATE job_leads SET fu2_sent_at=NOW(), updated_at=NOW() WHERE id=@id", new { id = leadId });
    }
}
