namespace TEKLead.Api.Services.LinkedIn;

/// <summary>
/// Every 60s: submit queued comment drafts as one Claude batch, poll open batches.
/// Every 30 min: batch-build person briefs (if enabled).
/// </summary>
public class LiBatchWorker : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<LiBatchWorker> _log;
    private DateTime _lastBriefs = DateTime.MinValue;

    public LiBatchWorker(IServiceProvider sp, ILogger<LiBatchWorker> log)
    {
        _sp = sp; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("LiBatchWorker started.");
        try { await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken); } catch { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Tick(); }
            catch (Exception ex) { _log.LogError(ex, "LiBatchWorker error."); }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); } catch { return; }
        }
    }

    private async Task Tick()
    {
        using var scope = _sp.CreateScope();
        var svc = scope.ServiceProvider.GetRequiredService<LinkedInService>();
        var li = scope.ServiceProvider.GetRequiredService<LiSettingsService>();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        if (string.IsNullOrEmpty(settings.ConnectionString)) return;

        var all = await settings.GetAll();
        if (string.IsNullOrWhiteSpace(all.GetValueOrDefault(Models.SettingKeys.ClaudeApiKey))) return;

        try
        {
            var n = await svc.SubmitQueuedComments();
            if (n > 0) _log.LogInformation("LiBatchWorker: submitted {n} comment drafts.", n);
        }
        catch (Exception ex) { _log.LogWarning(ex, "LiBatchWorker: comment batch submit failed."); }

        await svc.PollBatches();

        if (DateTime.UtcNow - _lastBriefs > TimeSpan.FromMinutes(30))
        {
            _lastBriefs = DateTime.UtcNow;
            var s = await li.GetAll();
            if (!string.Equals(s.GetValueOrDefault(LiSettingsService.BriefBatchEnabled), "false", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var n = await svc.SubmitBriefs();
                    if (n > 0) _log.LogInformation("LiBatchWorker: submitted {n} briefs.", n);
                }
                catch (Exception ex) { _log.LogWarning(ex, "LiBatchWorker: brief batch submit failed."); }
            }
        }
    }
}
