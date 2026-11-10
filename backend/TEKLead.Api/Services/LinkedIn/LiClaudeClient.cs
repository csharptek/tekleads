using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services.LinkedIn;

/// <summary>One Claude request: rules + cached company block + cached person block + turns.</summary>
public class LiCall
{
    public string Kind { get; set; } = "";
    public string Rules { get; set; } = "";          // system, cached (layer 1)
    public string CompanyBlock { get; set; } = "";   // system, cached (layer 2)
    public string PersonBlock { get; set; } = "";    // first user block, cached (layer 3)
    /// <summary>Turns after the person block. First must be user. Alternating user/assistant.</summary>
    public List<(string Role, string Text)> Turns { get; set; } = new();
    public int MaxTokens { get; set; } = 600;
}

public class LiBatchResult
{
    public string CustomId { get; set; } = "";
    public bool Ok { get; set; }
    public string Text { get; set; } = "";
    public string Error { get; set; } = "";
}

/// <summary>
/// Claude Messages API with prompt caching + Message Batches API. Separate from the shared
/// LlmClient on purpose so artifact generation is never affected.
/// </summary>
public class LiClaudeClient
{
    private const string ApiVersion = "2023-06-01";
    private const string Base = "https://api.anthropic.com/v1";

    private readonly IHttpClientFactory _http;
    private readonly SettingsService _settings;
    private readonly LiSettingsService _li;
    private readonly ILogger<LiClaudeClient> _log;

    public LiClaudeClient(IHttpClientFactory http, SettingsService settings, LiSettingsService li, ILogger<LiClaudeClient> log)
    {
        _http = http; _settings = settings; _li = li; _log = log;
    }

    public async Task EnsureSchema()
    {
        await using var c = new NpgsqlConnection(_settings.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS li_ai_usage (
            id SERIAL PRIMARY KEY,
            kind TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            input_tokens INT NOT NULL DEFAULT 0,
            output_tokens INT NOT NULL DEFAULT 0,
            cache_write_tokens INT NOT NULL DEFAULT 0,
            cache_read_tokens INT NOT NULL DEFAULT 0,
            is_batch BOOLEAN NOT NULL DEFAULT FALSE,
            cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        await c.ExecuteAsync("CREATE INDEX IF NOT EXISTS li_ai_usage_created_idx ON li_ai_usage (created_at)");
    }

    private async Task<(string key, string model, Dictionary<string, string> li)> Config()
    {
        var all = await _settings.GetAll();
        var li = await _li.GetAll();
        var key = all.GetValueOrDefault(SettingKeys.ClaudeApiKey, "");
        if (string.IsNullOrWhiteSpace(key)) throw new Exception("Claude API key not configured in Settings.");
        var model = li.GetValueOrDefault(LiSettingsService.Model, "");
        if (string.IsNullOrWhiteSpace(model)) model = all.GetValueOrDefault(SettingKeys.ClaudeModel, "");
        if (string.IsNullOrWhiteSpace(model)) model = "claude-sonnet-5";
        return (key, model, li);
    }

    private HttpClient Client(string key, int timeoutSec = 120)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("x-api-key", key);
        client.DefaultRequestHeaders.Add("anthropic-version", ApiVersion);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        client.Timeout = TimeSpan.FromSeconds(timeoutSec);
        return client;
    }

    /// <summary>Request body (also used as batch "params").</summary>
    public static Dictionary<string, object> BuildParams(LiCall call, string model)
    {
        var ephemeral = new Dictionary<string, string> { ["type"] = "ephemeral" };
        var system = new List<object> { new Dictionary<string, object> { ["type"] = "text", ["text"] = call.Rules } };
        if (!string.IsNullOrWhiteSpace(call.CompanyBlock))
            system.Add(new Dictionary<string, object> { ["type"] = "text", ["text"] = call.CompanyBlock, ["cache_control"] = ephemeral });
        else
            ((Dictionary<string, object>)system[0])["cache_control"] = ephemeral;

        var messages = new List<object>();
        for (var i = 0; i < call.Turns.Count; i++)
        {
            var (role, text) = call.Turns[i];
            if (i == 0)
            {
                var content = new List<object>();
                if (!string.IsNullOrWhiteSpace(call.PersonBlock))
                    content.Add(new Dictionary<string, object> { ["type"] = "text", ["text"] = call.PersonBlock, ["cache_control"] = ephemeral });
                content.Add(new Dictionary<string, object> { ["type"] = "text", ["text"] = text });
                messages.Add(new Dictionary<string, object> { ["role"] = "user", ["content"] = content });
            }
            else
            {
                messages.Add(new Dictionary<string, object> { ["role"] = role, ["content"] = text });
            }
        }

        return new Dictionary<string, object>
        {
            ["model"] = model,
            ["max_tokens"] = call.MaxTokens,
            ["system"] = system,
            ["messages"] = messages,
        };
    }

    /// <summary>Synchronous call with retries on 429/529/5xx. Logs usage.</summary>
    public async Task<string> Send(LiCall call)
    {
        var (key, model, li) = await Config();
        var client = Client(key);
        var body = JsonSerializer.Serialize(BuildParams(call, model));
        string json = "";
        const int maxRetries = 4;
        for (var attempt = 0; attempt <= maxRetries; attempt++)
        {
            var resp = await client.PostAsync($"{Base}/messages", new StringContent(body, Encoding.UTF8, "application/json"));
            var retry = (int)resp.StatusCode == 429 || (int)resp.StatusCode == 529 || (int)resp.StatusCode >= 500;
            if (retry && attempt < maxRetries)
            {
                await Task.Delay(resp.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(Math.Pow(2, attempt + 1)));
                continue;
            }
            json = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode) throw new Exception($"Claude {(int)resp.StatusCode}: {Trim(json)}");
            break;
        }

        using var doc = JsonDocument.Parse(json);
        var text = ExtractText(doc.RootElement);
        await LogUsage(call.Kind, model, doc.RootElement, false, li);
        if (string.IsNullOrWhiteSpace(text)) throw new Exception("Claude returned empty output. Try again.");
        return text;
    }

    // ── Batches ──────────────────────────────────────────────────────────────

    public async Task<string> CreateBatch(List<(string CustomId, LiCall Call)> items)
    {
        var (key, model, _) = await Config();
        var client = Client(key);
        var requests = items.Select(i => new Dictionary<string, object>
        {
            ["custom_id"] = i.CustomId,
            ["params"] = BuildParams(i.Call, model),
        }).ToList();
        var body = JsonSerializer.Serialize(new Dictionary<string, object> { ["requests"] = requests });
        var resp = await client.PostAsync($"{Base}/messages/batches", new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) throw new Exception($"Claude batch {(int)resp.StatusCode}: {Trim(json)}");
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("id").GetString() ?? throw new Exception("Batch id missing");
    }

    /// <summary>Returns (processing_status, results_url).</summary>
    public async Task<(string Status, string? ResultsUrl)> GetBatch(string batchId)
    {
        var (key, _, _) = await Config();
        var client = Client(key);
        var resp = await client.GetAsync($"{Base}/messages/batches/{batchId}");
        var json = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) throw new Exception($"Claude batch {(int)resp.StatusCode}: {Trim(json)}");
        using var doc = JsonDocument.Parse(json);
        var status = doc.RootElement.GetProperty("processing_status").GetString() ?? "";
        string? url = doc.RootElement.TryGetProperty("results_url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
        return (status, url);
    }

    public async Task<List<LiBatchResult>> GetBatchResults(string resultsUrl, string kind)
    {
        var (key, model, li) = await Config();
        var client = Client(key, 300);
        var resp = await client.GetAsync(resultsUrl);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) throw new Exception($"Claude batch results {(int)resp.StatusCode}: {Trim(body)}");
        var list = new List<LiBatchResult>();
        foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var r = new LiBatchResult { CustomId = root.GetProperty("custom_id").GetString() ?? "" };
                var result = root.GetProperty("result");
                var type = result.GetProperty("type").GetString();
                if (type == "succeeded")
                {
                    var msg = result.GetProperty("message");
                    r.Text = ExtractText(msg);
                    r.Ok = !string.IsNullOrWhiteSpace(r.Text);
                    if (!r.Ok) r.Error = "Empty output";
                    await LogUsage(kind, model, msg, true, li);
                }
                else
                {
                    r.Error = type == "errored" && result.TryGetProperty("error", out var e) ? Trim(e.ToString()) : (type ?? "failed");
                }
                list.Add(r);
            }
            catch (Exception ex) { _log.LogWarning(ex, "LiClaudeClient: bad batch result line"); }
        }
        return list;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string ExtractText(JsonElement msg)
    {
        var sb = new StringBuilder();
        if (msg.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
            foreach (var block in content.EnumerateArray())
                if (block.TryGetProperty("type", out var t) && t.GetString() == "text")
                    sb.Append(block.GetProperty("text").GetString());
        return sb.ToString();
    }

    private static int UsageInt(JsonElement u, string name) =>
        u.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;

    private async Task LogUsage(string kind, string model, JsonElement msg, bool batch, Dictionary<string, string> li)
    {
        try
        {
            if (!msg.TryGetProperty("usage", out var u)) return;
            int inp = UsageInt(u, "input_tokens"), outp = UsageInt(u, "output_tokens");
            int cw = UsageInt(u, "cache_creation_input_tokens"), cr = UsageInt(u, "cache_read_input_tokens");
            var pin = LiSettingsService.Dec(li, LiSettingsService.PriceIn, 3m);
            var pout = LiSettingsService.Dec(li, LiSettingsService.PriceOut, 15m);
            var cost = (inp * pin + cw * pin * 1.25m + cr * pin * 0.1m + outp * pout) / 1_000_000m;
            if (batch) cost *= 0.5m;
            await using var c = new NpgsqlConnection(_settings.ConnectionString);
            await c.OpenAsync();
            await c.ExecuteAsync(@"INSERT INTO li_ai_usage (kind, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, is_batch, cost_usd)
                VALUES (@kind, @model, @inp, @outp, @cw, @cr, @batch, @cost)",
                new { kind, model, inp, outp, cw, cr, batch, cost });
        }
        catch (Exception ex) { _log.LogWarning(ex, "LiClaudeClient: usage log failed"); }
    }

    private static string Trim(string s) => s.Length > 400 ? s[..400] : s;

    /// <summary>Pulls the first JSON object out of model text (handles ```json fences).</summary>
    public static JsonElement? ParseJson(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try
        {
            using var doc = JsonDocument.Parse(text[start..(end + 1)]);
            return doc.RootElement.Clone();
        }
        catch { return null; }
    }

    public static string Str(JsonElement? el, string name) =>
        el is { } e && e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? (v.GetString() ?? "").Trim() : "";
}
