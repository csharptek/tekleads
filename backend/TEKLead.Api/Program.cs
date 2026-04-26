using TEKLead.Api.Middleware;
using TEKLead.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddScoped<LeadService>();
builder.Services.AddScoped<ApolloService>();
builder.Services.AddScoped<PortfolioService>();
builder.Services.AddScoped<ProposalService>();
builder.Services.AddScoped<ProposalGenerationService>();
builder.Services.AddScoped<BlobService>();
builder.Services.AddScoped<LogService>();
builder.Services.AddScoped<ProposalExportService>();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()
     .WithExposedHeaders("Access-Control-Allow-Private-Network")));

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Information);

var app = builder.Build();

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
    app.Urls.Add($"http://0.0.0.0:{port}");

app.UseCors();

// Chrome 130+ Private Network Access — required for newer Android devices
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Headers.ContainsKey("Access-Control-Request-Private-Network"))
        ctx.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
    await next();
});
app.UseRequestLogging();
app.MapGet("/", () => Results.Ok(new { service = "tekleads-api", phase = 2 }));
app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));

using (var scope = app.Services.CreateScope())
{
    var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
    var leadSvc  = scope.ServiceProvider.GetRequiredService<LeadService>();
    try { await settings.EnsureSchema(); } catch (Exception ex) { app.Logger.LogError(ex, "Settings schema failed"); }
    try { await leadSvc.EnsureSchema();  } catch (Exception ex) { app.Logger.LogError(ex, "Leads schema failed"); }
    try { var portSvc = scope.ServiceProvider.GetRequiredService<PortfolioService>(); await portSvc.EnsureSchema(); } catch (Exception ex) { app.Logger.LogError(ex, "Portfolio schema failed"); }
    try { var propSvc = scope.ServiceProvider.GetRequiredService<ProposalService>(); await propSvc.EnsureSchema(); } catch (Exception ex) { app.Logger.LogError(ex, "Proposal schema failed"); }
    try { var logSvc = scope.ServiceProvider.GetRequiredService<LogService>(); await logSvc.EnsureSchema(); } catch (Exception ex) { app.Logger.LogError(ex, "Log schema failed"); }
    try { var genSvc = scope.ServiceProvider.GetRequiredService<ProposalGenerationService>(); await genSvc.EnsureSchema(); } catch (Exception ex) { app.Logger.LogError(ex, "ProposalGeneration schema failed"); }
}

app.MapControllers();
app.Run();
