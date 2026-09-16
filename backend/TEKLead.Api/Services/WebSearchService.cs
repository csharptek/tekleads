using System.Text.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class WebSearchResult
{
    public string Title { get; set; } = "";
    public string Link { get; set; } = "";
    public string Snippet { get; set; } = "";
}

/// <summary>
/// Thin wrapper around Serper.dev (google.serper.dev) for the JD Quality contact-research
/// panel. Optional integration: if serper_api_key isn't set in Settings, Search() just
/// returns an empty list — callers never need to null-check or branch on "configured".
/// </summary>
public class WebSearchService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<WebSearchService> _log;

    public WebSearchService(SettingsService settings, IHttpClientFactory http, ILogger<WebSearchService> log)
    {
        _settings = settings;
        _http = http;
        _log = log;
    }

    public async Task<bool> IsConfigured()
    {
        var all = await _settings.GetAll();
        return !string.IsNullOrWhiteSpace(all.GetValueOrDefault(SettingKeys.SerperApiKey, ""));
    }

    public async Task<List<WebSearchResult>> Search(string query, int count = 5)
    {
        var all = await _settings.GetAll();
        var key = all.GetValueOrDefault(SettingKeys.SerperApiKey, "");
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(query))
            return new List<WebSearchResult>();

        try
        {
            var client = _http.CreateClient();
            client.DefaultRequestHeaders.Add("X-API-KEY", key);
            var res = await client.PostAsJsonAsync("https://google.serper.dev/search", new { q = query, num = count });
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Serper search {0}: {1}", res.StatusCode, body[..Math.Min(300, body.Length)]);
                return new List<WebSearchResult>();
            }

            using var doc = JsonDocument.Parse(body);
            var results = new List<WebSearchResult>();
            if (doc.RootElement.TryGetProperty("organic", out var organic) && organic.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in organic.EnumerateArray())
                {
                    results.Add(new WebSearchResult
                    {
                        Title = Str(item, "title"),
                        Link = Str(item, "link"),
                        Snippet = Str(item, "snippet"),
                    });
                    if (results.Count >= count) break;
                }
            }
            return results;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Serper search failed for query: {0}", query);
            return new List<WebSearchResult>();
        }
    }

    private static string Str(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
}
