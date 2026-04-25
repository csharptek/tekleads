using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

/// <summary>
/// Settings persistence. One row per setting key in `app_settings`.
/// No JSON blob, no in-memory cache — every read hits DB. Slow but trivially debuggable.
/// </summary>
public class SettingsService
{
    private readonly IConfiguration _config;
    private readonly ILogger<SettingsService> _log;

    public SettingsService(IConfiguration config, ILogger<SettingsService> log)
    {
        _config = config;
        _log = log;
    }

    public string ConnectionString
    {
        get
        {
            var raw = _config["PG_CONNECTION_STRING"]
                   ?? Environment.GetEnvironmentVariable("PG_CONNECTION_STRING")
                   ?? "";
            return NormalizePg(raw);
        }
    }

    /// <summary>Convert Railway-style URL into Npgsql key=value format.</summary>
    public static string NormalizePg(string conn)
    {
        if (string.IsNullOrWhiteSpace(conn)) return "";
        conn = conn.Trim();
        if (!conn.StartsWith("postgres://") && !conn.StartsWith("postgresql://")) return conn;
        var uri = new Uri(conn);
        var ui = uri.UserInfo.Split(':', 2);
        var user = Uri.UnescapeDataString(ui[0]);
        var pass = ui.Length > 1 ? Uri.UnescapeDataString(ui[1]) : "";
        var db = uri.AbsolutePath.TrimStart('/');
        var port = uri.Port > 0 ? uri.Port : 5432;
        return $"Host={uri.Host};Port={port};Username={user};Password={pass};Database={db};SSL Mode=Require;Trust Server Certificate=true";
    }

    public async Task EnsureSchema()
    {
        var cs = ConnectionString;
        if (string.IsNullOrEmpty(cs))
        {
            _log.LogError("PG_CONNECTION_STRING is not set. Cannot init schema.");
            return;
        }

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");
        _log.LogInformation("Schema OK. app_settings table ready.");
    }

    /// <summary>Returns all known keys. Missing keys default to empty.</summary>
    public async Task<Dictionary<string, string>> GetAll()
    {
        var cs = ConnectionString;
        var dict = SettingKeys.AllKnown.ToDictionary(k => k, _ => "");

        if (string.IsNullOrEmpty(cs))
        {
            _log.LogWarning("GetAll: connection string empty.");
            return dict;
        }

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();
        var rows = await c.QueryAsync<SettingItem>("SELECT key, value FROM app_settings");
        foreach (var r in rows)
            dict[r.Key] = r.Value ?? "";

        _log.LogInformation("GetAll: loaded {0} rows from DB.", dict.Count(kv => !string.IsNullOrEmpty(kv.Value)));
        return dict;
    }

    /// <summary>
    /// Upsert each non-null incoming key. Empty string = explicit clear.
    /// To "leave as-is", caller must omit the key entirely.
    /// </summary>
    public async Task<int> SaveMany(IDictionary<string, string?> incoming)
    {
        var cs = ConnectionString;
        if (string.IsNullOrEmpty(cs))
            throw new InvalidOperationException("PG_CONNECTION_STRING is not set on the backend.");

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var changed = 0;
        foreach (var kv in incoming)
        {
            if (kv.Value is null) continue; // "leave as-is"
            if (!SettingKeys.AllKnown.Contains(kv.Key))
            {
                _log.LogWarning("SaveMany: ignoring unknown key '{0}'", kv.Key);
                continue;
            }

            var rows = await c.ExecuteAsync(@"
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (@k, @v, NOW())
                ON CONFLICT (key) DO UPDATE
                SET value = EXCLUDED.value, updated_at = NOW()",
                new { k = kv.Key, v = kv.Value });
            changed += rows;
        }

        _log.LogInformation("SaveMany: upserted {0} rows.", changed);
        return changed;
    }

    public async Task<DiagInfo> Diagnose()
    {
        var info = new DiagInfo
        {
            ConnStringSet = !string.IsNullOrEmpty(_config["PG_CONNECTION_STRING"] ?? Environment.GetEnvironmentVariable("PG_CONNECTION_STRING")),
            ConnStringNormalized = !string.IsNullOrEmpty(ConnectionString),
        };

        if (!info.ConnStringNormalized) return info;

        try
        {
            await using var c = new NpgsqlConnection(ConnectionString);
            await c.OpenAsync();
            info.DbReachable = true;

            var exists = await c.QuerySingleOrDefaultAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='app_settings')");
            info.TableExists = exists;

            if (exists)
            {
                info.RowCount = await c.QuerySingleOrDefaultAsync<int>("SELECT COUNT(*) FROM app_settings");
                info.KeysStored = await c.QuerySingleOrDefaultAsync<int>(
                    "SELECT COUNT(*) FROM app_settings WHERE value <> ''");
            }
        }
        catch (Exception ex)
        {
            info.Error = ex.Message;
            _log.LogError(ex, "Diagnose failed");
        }

        return info;
    }
}

public class DiagInfo
{
    public bool ConnStringSet { get; set; }
    public bool ConnStringNormalized { get; set; }
    public bool DbReachable { get; set; }
    public bool TableExists { get; set; }
    public int RowCount { get; set; }
    public int KeysStored { get; set; }
    public string? Error { get; set; }
}
