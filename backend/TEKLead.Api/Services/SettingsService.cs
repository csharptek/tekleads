using System.Text.Json;
using Npgsql;
using Dapper;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class SettingsService
{
    private readonly IConfiguration _config;
    private readonly ILogger<SettingsService> _logger;
    private AppSettings? _cached;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public SettingsService(IConfiguration config, ILogger<SettingsService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private string BootstrapConnStr => NormalizePg(_config["PG_CONNECTION_STRING"] ?? "");

    public static string NormalizePg(string conn)
    {
        if (string.IsNullOrWhiteSpace(conn)) return "";
        conn = conn.Trim();
        if (!conn.StartsWith("postgres://") && !conn.StartsWith("postgresql://")) return conn;
        var uri = new Uri(conn);
        var userInfo = uri.UserInfo.Split(':', 2);
        var user = Uri.UnescapeDataString(userInfo[0]);
        var pass = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "";
        var db = uri.AbsolutePath.TrimStart('/');
        return $"Host={uri.Host};Port={uri.Port};Username={user};Password={pass};Database={db};SSL Mode=Require;Trust Server Certificate=true";
    }

    public async Task<AppSettings> GetSettings()
    {
        if (_cached != null) return _cached;
        await _lock.WaitAsync();
        try
        {
            if (_cached != null) return _cached;

            var boot = BootstrapConnStr;
            if (string.IsNullOrEmpty(boot))
            {
                _logger.LogWarning("PG_CONNECTION_STRING not set. Returning empty settings.");
                return new AppSettings();
            }

            await using var conn = new NpgsqlConnection(boot);
            await conn.OpenAsync();
            await EnsureSchema(conn, _logger);

            var json = await conn.QuerySingleOrDefaultAsync<string>(
                "SELECT value FROM app_settings WHERE key='main'");

            AppSettings s;
            if (!string.IsNullOrEmpty(json))
            {
                s = JsonSerializer.Deserialize<AppSettings>(json, JsonOpts) ?? new AppSettings();
                _logger.LogInformation("Settings loaded from DB. Keys present: OpenAI={0}, Apollo={1}, Graph={2}",
                    !string.IsNullOrEmpty(s.AzureOpenAiKey),
                    !string.IsNullOrEmpty(s.ApolloApiKey),
                    !string.IsNullOrEmpty(s.GraphClientSecret));
            }
            else
            {
                s = new AppSettings();
                _logger.LogInformation("No settings row yet in DB.");
            }

            s.PgConnectionString = boot;
            _cached = s;
            return s;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetSettings failed");
            return new AppSettings { PgConnectionString = BootstrapConnStr };
        }
        finally { _lock.Release(); }
    }

    public async Task SaveSettings(AppSettings incoming)
    {
        var boot = BootstrapConnStr;
        if (string.IsNullOrEmpty(boot))
            throw new InvalidOperationException("PG_CONNECTION_STRING env var is not set.");

        await using var conn = new NpgsqlConnection(boot);
        await conn.OpenAsync();
        await EnsureSchema(conn, _logger);

        // PG connection is always sourced from env; never persisted from UI
        incoming.PgConnectionString = "";

        var json = JsonSerializer.Serialize(incoming, JsonOpts);
        var affected = await conn.ExecuteAsync(
            "INSERT INTO app_settings (key,value,updated_at) VALUES ('main',@json,NOW()) " +
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            new { json });

        _logger.LogInformation("Settings saved. Rows affected: {0}. Payload length: {1}", affected, json.Length);

        _cached = null;
    }

    public void InvalidateCache() => _cached = null;

    public static async Task EnsureSchema(NpgsqlConnection conn, ILogger? logger = null)
    {
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();

        bool hasVector = false;
        try { await conn.ExecuteAsync("CREATE EXTENSION IF NOT EXISTS vector"); hasVector = true; }
        catch (Exception ex) { logger?.LogWarning("pgvector unavailable: {0}", ex.Message); }

        var embeddingCol = hasVector ? "embedding vector(1536)" : "embedding BYTEA";

        var statements = new[]
        {
            "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())",
            "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
            $"CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY, title TEXT, industry TEXT, tags TEXT[], problem TEXT, solution TEXT, tech_stack TEXT, outcomes TEXT, links TEXT, {embeddingCol}, created_at TIMESTAMPTZ DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS leads (id UUID PRIMARY KEY, apollo_id TEXT, name TEXT, title TEXT, company TEXT, industry TEXT, location TEXT, emails TEXT[] DEFAULT '{}', phones TEXT[] DEFAULT '{}', linkedin_url TEXT, saved_at TIMESTAMPTZ DEFAULT NOW())",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS apollo_id TEXT",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS emails TEXT[] DEFAULT '{}'",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS phones TEXT[] DEFAULT '{}'",
            "CREATE TABLE IF NOT EXISTS outreach (id UUID PRIMARY KEY, lead_id UUID, lead_name TEXT, channel TEXT, subject TEXT, body TEXT, status TEXT, sent_at TIMESTAMPTZ DEFAULT NOW())"
        };

        foreach (var sql in statements)
        {
            try { await conn.ExecuteAsync(sql); }
            catch (Exception ex)
            {
                logger?.LogError("Schema statement failed: {0}\nSQL: {1}", ex.Message, sql);
                throw;
            }
        }
    }

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
}
