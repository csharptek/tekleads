using System.Text.Json;
using Npgsql;
using Dapper;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class SettingsService
{
    private readonly IConfiguration _config;
    private AppSettings? _cached;

    public SettingsService(IConfiguration config) => _config = config;

    private string BootstrapConnStr => _config["PG_CONNECTION_STRING"] ?? "";

    public async Task<AppSettings> GetSettings()
    {
        if (_cached != null) return _cached;
        if (string.IsNullOrEmpty(BootstrapConnStr)) return new AppSettings();

        try
        {
            await using var conn = new NpgsqlConnection(BootstrapConnStr);
            await EnsureSchema(conn);
            var json = await conn.QuerySingleOrDefaultAsync<string>(
                "SELECT value FROM app_settings WHERE key = 'main'");
            if (json != null)
            {
                _cached = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
                _cached.PgConnectionString = BootstrapConnStr;
                return _cached;
            }
        }
        catch { }

        return new AppSettings { PgConnectionString = BootstrapConnStr };
    }

    public async Task SaveSettings(AppSettings settings)
    {
        _cached = null;
        var connStr = string.IsNullOrEmpty(settings.PgConnectionString) ? BootstrapConnStr : settings.PgConnectionString;
        await using var conn = new NpgsqlConnection(connStr);
        await EnsureSchema(conn);
        var json = JsonSerializer.Serialize(settings, JsonOptions);
        await conn.ExecuteAsync(
            "INSERT INTO app_settings (key,value) VALUES ('main',@json) ON CONFLICT (key) DO UPDATE SET value=@json",
            new { json });
    }

    public static async Task EnsureSchema(NpgsqlConnection conn)
    {
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        await conn.ExecuteAsync(
            "CREATE EXTENSION IF NOT EXISTS vector;" +
            "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
            "CREATE TABLE IF NOT EXISTS projects (" +
            "    id UUID PRIMARY KEY, title TEXT, industry TEXT, tags TEXT[]," +
            "    problem TEXT, solution TEXT, tech_stack TEXT, outcomes TEXT, links TEXT," +
            "    embedding vector(1536), created_at TIMESTAMPTZ DEFAULT NOW());" +
            "CREATE TABLE IF NOT EXISTS leads (" +
            "    id UUID PRIMARY KEY, name TEXT, title TEXT, company TEXT," +
            "    industry TEXT, location TEXT," +
            "    emails TEXT[] DEFAULT '{}'," +
            "    phones TEXT[] DEFAULT '{}'," +
            "    linkedin_url TEXT, saved_at TIMESTAMPTZ DEFAULT NOW());" +
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS emails TEXT[] DEFAULT '{}';" +
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS phones TEXT[] DEFAULT '{}';" +
            "CREATE TABLE IF NOT EXISTS outreach (" +
            "    id UUID PRIMARY KEY, lead_id UUID, lead_name TEXT, channel TEXT," +
            "    subject TEXT, body TEXT, status TEXT, sent_at TIMESTAMPTZ DEFAULT NOW());");
    }

    private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
}
