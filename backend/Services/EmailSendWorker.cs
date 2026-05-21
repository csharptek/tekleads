using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class EmailSendWorker : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<EmailSendWorker> _log;

    public EmailSendWorker(IServiceProvider sp, ILogger<EmailSendWorker> log)
    {
        _sp = sp;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("EmailSendWorker started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessDueJobs();
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "EmailSendWorker error.");
            }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    private async Task ProcessDueJobs()
    {
        using var scope = _sp.CreateScope();
        var queue = scope.ServiceProvider.GetRequiredService<EmailSendQueueService>();
        var graphEmail = scope.ServiceProvider.GetRequiredService<GraphEmailService>();
        var artifactsSvc = scope.ServiceProvider.GetRequiredService<ArtifactsService>();
        var settingsSvc = scope.ServiceProvider.GetRequiredService<SettingsService>();

        var jobs = await queue.GetDueJobs();
        if (jobs.Count == 0) return;

        _log.LogInformation("EmailSendWorker: {count} due jobs.", jobs.Count);

        var artifactsCache = new Dictionary<Guid, ArtifactsResult>();
        string? sig = null;

        foreach (var job in jobs)
        {
            try
            {
                string subject;
                string bodyText;

                if (job.FollowUpStage == 0)
                {
                    // Initial — use artifact
                    if (!artifactsCache.TryGetValue(job.ProposalId, out var artifacts))
                    {
                        artifacts = await artifactsSvc.GetExisting(job.ProposalId);
                        artifactsCache[job.ProposalId] = artifacts;
                    }

                    if (!artifacts.Ok || string.IsNullOrWhiteSpace(artifacts.EmailSubject))
                    {
                        await queue.MarkFailed(job.Id, "Email artifact not generated for this proposal.");
                        continue;
                    }

                    subject = artifacts.EmailSubject ?? "";
                    bodyText = artifacts.EmailBody ?? "";
                }
                else
                {
                    // Follow-up — use stored subject/body
                    if (string.IsNullOrWhiteSpace(job.Subject) || string.IsNullOrWhiteSpace(job.Body))
                    {
                        await queue.MarkFailed(job.Id, $"Follow-up {job.FollowUpStage} subject/body missing.");
                        continue;
                    }
                    subject = job.Subject!;
                    bodyText = job.Body!;
                }

                // Interpolate variables — supports {{name}}, {{first_name}}, {{email}}
                var firstName = (job.ToName ?? "").Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? job.ToName ?? "";

                subject = subject
                    .Replace("{{name}}", job.ToName ?? "", StringComparison.OrdinalIgnoreCase)
                    .Replace("{{first_name}}", firstName, StringComparison.OrdinalIgnoreCase)
                    .Replace("{{email}}", job.ToEmail ?? "", StringComparison.OrdinalIgnoreCase);

                bodyText = bodyText
                    .Replace("{{name}}", job.ToName ?? "", StringComparison.OrdinalIgnoreCase)
                    .Replace("{{first_name}}", firstName, StringComparison.OrdinalIgnoreCase)
                    .Replace("{{email}}", job.ToEmail ?? "", StringComparison.OrdinalIgnoreCase);

                // Existing "Hi <name>," replacement (initial email pattern)
                if (job.FollowUpStage == 0)
                {
                    var match = System.Text.RegularExpressions.Regex.Match(bodyText, @"^Hi\s+[^,\n]+,?", System.Text.RegularExpressions.RegexOptions.Multiline);
                    if (match.Success && !string.IsNullOrWhiteSpace(firstName))
                        bodyText = bodyText[..match.Index] + $"Hi {firstName}," + bodyText[(match.Index + match.Length)..];
                }

                // Load signature once per cycle
                if (sig == null)
                {
                    var settings = await settingsSvc.GetAll();
                    sig = settings.GetValueOrDefault("email_signature", "");
                }

                var (ok, error) = await graphEmail.SendEmail(job.ToEmail, job.ToName, subject, bodyText, string.IsNullOrWhiteSpace(sig) ? null : sig);

                if (ok)
                {
                    await queue.MarkSent(job.Id);
                    _log.LogInformation("EmailSendWorker: sent stage={stage} to {email}", job.FollowUpStage, job.ToEmail);
                }
                else
                {
                    await queue.MarkFailed(job.Id, error);
                    _log.LogWarning("EmailSendWorker: failed stage={stage} {email} — {error}", job.FollowUpStage, job.ToEmail, error);
                }
            }
            catch (Exception ex)
            {
                await queue.MarkFailed(job.Id, ex.Message);
                _log.LogError(ex, "EmailSendWorker: exception for job {id}", job.Id);
            }
        }
    }
}
