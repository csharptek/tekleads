using TEKLead.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Information);

var app = builder.Build();

// Bind to PORT env (Railway) if ASPNETCORE_URLS not already set.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
    app.Urls.Add($"http://0.0.0.0:{port}");

app.UseCors();
app.MapGet("/", () => Results.Ok(new { service = "tekleads-api", phase = 1 }));
app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));

// Init schema on startup; do not crash if DB unreachable (so /api/settings/diag still works).
using (var scope = app.Services.CreateScope())
{
    var svc = scope.ServiceProvider.GetRequiredService<SettingsService>();
    try { await svc.EnsureSchema(); }
    catch (Exception ex) { app.Logger.LogError(ex, "Schema init failed"); }
}

app.MapControllers();
app.Run();
