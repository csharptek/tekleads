using System.Text.Json;

namespace TEKLead.Api.Services;

public class WaScheduleWorker : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<WaScheduleWorker> _log;

    public WaScheduleWorker(IServiceProvider sp, ILogger<WaScheduleWorker> log)
    {
        _sp  = sp;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("WaScheduleWorker started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessDue(); }
            catch (Exception ex) { _log.LogError(ex, "WaScheduleWorker error."); }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    private async Task ProcessDue()
    {
        using var scope = _sp.CreateScope();
        var svc  = scope.ServiceProvider.GetRequiredService<WaScheduleService>();
        var waSvc = scope.ServiceProvider.GetRequiredService<WhatsAppCloudService>();

        var jobs = await svc.GetDueJobs();
        if (jobs.Count == 0) return;

        _log.LogInformation("WaScheduleWorker: {count} due jobs.", jobs.Count);

        foreach (var job in jobs)
        {
            try
            {
                (bool ok, string wamid, string error, string _) result;

                if (job.Mode == "template")
                {
                    List<string>? vars = null;
                    if (!string.IsNullOrEmpty(job.BodyJson))
                    {
                        try { vars = JsonSerializer.Deserialize<List<string>>(job.BodyJson); } catch { }
                    }
                    result = await waSvc.SendTemplate(
                        job.Phone, job.TemplateName, job.TemplateLang ?? "en",
                        vars, inboxType: "contacts");
                }
                else
                {
                    result = await waSvc.SendText(
                        job.Phone, job.Body ?? "", inboxType: "contacts");
                }

                if (result.ok)
                    await svc.MarkSent(job.Id);
                else
                    await svc.MarkFailed(job.Id, result.error);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "WaScheduleWorker: job {id} failed.", job.Id);
                await svc.MarkFailed(job.Id, ex.Message);
            }
        }
    }
}
