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
        var normalized = NormalizePgConn(pgConn);
        await using var conn = new Npgsql.NpgsqlConnection(normalized);
        await TEKLead.Api.Services.SettingsService.EnsureSchema(conn);
        Console.WriteLine("DB schema initialized.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"DB init warning: {ex.Message}");
    }
}
else
{
    Console.WriteLine("PG_CONNECTION_STRING is empty.");
}

app.MapGet("/health", () => Results.Ok("healthy"));
app.MapControllers();
app.Run();

static string NormalizePgConn(string conn)
{
    if (!conn.StartsWith("postgres://") && !conn.StartsWith("postgresql://")) return conn;
    var uri = new Uri(conn);
    var userInfo = uri.UserInfo.Split(':', 2);
    var db = uri.AbsolutePath.TrimStart('/');
    return $"Host={uri.Host};Port={uri.Port};Username={userInfo[0]};Password={userInfo[1]};Database={db};SSL Mode=Require;Trust Server Certificate=true";
}
