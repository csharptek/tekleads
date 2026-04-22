using TEKLead.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();

builder.Services.AddSingleton<SettingsService>();
builder.Services.AddScoped<DbService>();
builder.Services.AddScoped<ApolloService>();
builder.Services.AddScoped<EmailAiService>();
builder.Services.AddScoped<OutreachService>();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors();

// Ensure DB tables exist at startup
var pgConn = app.Configuration["PG_CONNECTION_STRING"] ?? "";
if (!string.IsNullOrEmpty(pgConn))
{
    try
    {
        await using var conn = new Npgsql.NpgsqlConnection(pgConn);
        await TEKLead.Api.Services.SettingsService.EnsureSchema(conn);
        Console.WriteLine("DB schema initialized.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"DB init warning: {ex.Message}");
    }
}

app.MapGet("/health", () => Results.Ok("healthy"));
app.MapControllers();
app.Run();
