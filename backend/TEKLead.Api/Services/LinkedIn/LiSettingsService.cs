using Dapper;
using Npgsql;

namespace TEKLead.Api.Services.LinkedIn;

/// <summary>
/// LinkedIn module settings. Own key/value table (li_settings) so existing app_settings
/// code is untouched. Every key has a built-in default; nothing needs seeding.
/// </summary>
public class LiSettingsService
{
    private readonly SettingsService _settings;
    public LiSettingsService(SettingsService settings) => _settings = settings;

    public const string StartAt = "li_start_at";
    public const string NewPerPage = "li_new_per_page";
    public const string OldPerDay = "li_old_per_day";
    public const string OldGapDays = "li_old_gap_days";
    public const string Model = "li_claude_model";
    public const string CompanyPitch = "li_company_pitch";
    public const string Proof = "li_proof";
    public const string NotFor = "li_not_for";
    public const string BannedWords = "li_banned_words";
    public const string CommentPrompt = "li_comment_prompt";
    public const string ReplyPrompt = "li_reply_prompt";
    public const string BriefPrompt = "li_brief_prompt";
    public const string PriceIn = "li_price_in";
    public const string PriceOut = "li_price_out";
    public const string BriefBatchEnabled = "li_brief_batch_enabled";

    public static readonly Dictionary<string, string> Defaults = new()
    {
        [StartAt] = "",
        [NewPerPage] = "25",
        [OldPerDay] = "25",
        [OldGapDays] = "7",
        [Model] = "",
        [CompanyPitch] = "Csharptek is a senior AI and full-stack engineering team (Azure, .NET, Next.js, AI/ML). We build AI features, SaaS products and integrations for companies that need senior engineers fast.",
        [Proof] = "",
        [NotFor] = "Job seekers, recruiters, students, competitors (other dev agencies), people asking us for work.",
        [BannedWords] = "synergy, leverage, game-changer, revolutionize, cutting-edge, delve, unlock, supercharge, seamless",
        [CommentPrompt] = LiPrompts.Comment,
        [ReplyPrompt] = LiPrompts.Reply,
        [BriefPrompt] = LiPrompts.Brief,
        [PriceIn] = "3",
        [PriceOut] = "15",
        [BriefBatchEnabled] = "true",
    };

    private NpgsqlConnection Conn() => new(_settings.ConnectionString);

    public async Task EnsureSchema()
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS li_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        // Feature start: only Saved Contacts saved after this moment appear. Set once, never overwritten.
        await c.ExecuteAsync(@"INSERT INTO li_settings (key, value) VALUES (@k, @v) ON CONFLICT (key) DO NOTHING",
            new { k = StartAt, v = DateTime.UtcNow.ToString("o") });
    }

    public async Task<Dictionary<string, string>> GetAll()
    {
        var dict = new Dictionary<string, string>(Defaults);
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<(string Key, string Value)>("SELECT key AS \"Key\", value AS \"Value\" FROM li_settings");
        foreach (var r in rows)
            if (Defaults.ContainsKey(r.Key) && !string.IsNullOrWhiteSpace(r.Value)) dict[r.Key] = r.Value;
        return dict;
    }

    public async Task Save(Dictionary<string, string?> values)
    {
        await using var c = Conn();
        await c.OpenAsync();
        foreach (var kv in values)
        {
            if (kv.Value is null || !Defaults.ContainsKey(kv.Key)) continue;
            await c.ExecuteAsync(@"INSERT INTO li_settings (key, value, updated_at) VALUES (@k, @v, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
                new { k = kv.Key, v = kv.Value });
        }
    }

    public static int Int(Dictionary<string, string> s, string key, int fallback, int min, int max)
        => int.TryParse(s.GetValueOrDefault(key), out var v) ? Math.Clamp(v, min, max) : fallback;

    public static decimal Dec(Dictionary<string, string> s, string key, decimal fallback)
        => decimal.TryParse(s.GetValueOrDefault(key), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : fallback;

    public static DateTime StartAtUtc(Dictionary<string, string> s)
        => DateTime.TryParse(s.GetValueOrDefault(StartAt), System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d)
            ? d : DateTime.UtcNow;
}
