using Npgsql;
using TEKLead.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Logging.AddConsole();

builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<GraphEmailService>();
builder.Services.AddSingleton<WhatsAppService>();
builder.Services.AddScoped<DbService>();
builder.Services.AddScoped<ApolloService>();
builder.Services.AddScoped<EmailAiService>();

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors();

// Init schema on startup
var pgConn = app.Configuration["PG_CONNECTION_STRING"] ?? "";
if (!string.IsNullOrEmpty(pgConn))
{
    try
    {
        var normalized = SettingsService.NormalizePg(pgConn);
        await using var conn = new NpgsqlConnection(normalized);
        await conn.OpenAsync();
        await SettingsService.EnsureSchema(conn, app.Logger);
        app.Logger.LogInformation("DB schema initialized.");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "DB init failed");
    }
}
else
{
    app.Logger.LogWarning("PG_CONNECTION_STRING is empty.");
}

app.MapGet("/health", () => Results.Ok(new { status = "healthy", time = DateTime.UtcNow }));
app.MapControllers();
app.Run();
