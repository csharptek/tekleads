using System.Net.Http.Headers;
using System.Text.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ApolloService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ApolloService> _log;

    public ApolloService(SettingsService settings, IHttpClientFactory http, ILogger<ApolloService> log)
    {
        _settings = settings;
        _http = http;
        _log = log;
    }

    private async Task<string> GetKey()
    {
        var all = await _settings.GetAll();
        var key = all.GetValueOrDefault("apollo_api_key", "");
        if (string.IsNullOrEmpty(key))
            throw new InvalidOperationException("Apollo API key not configured in Settings.");
        return key;
    }

    private HttpClient MakeClient(string key)
    {
        var c = _http.CreateClient();
        c.DefaultRequestHeaders.Add("X-Api-Key", key);
        c.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return c;
    }

    public async Task<(List<Lead> Leads, int Total)> Search(
        string? name, string? title, string? company,
        string? industry, string? location,
        int page = 1, int perPage = 25)
    {
        var key = await GetKey();

        var kw = string.Join(" ", new[] { name, company, industry }
            .Where(s => !string.IsNullOrWhiteSpace(s)));

        var qs = new List<string> { $"page={page}", $"per_page={perPage}" };
        if (!string.IsNullOrEmpty(kw))       qs.Add($"q_keywords={Uri.EscapeDataString(kw)}");
        if (!string.IsNullOrEmpty(title))    qs.Add($"person_titles[]={Uri.EscapeDataString(title)}");
        if (!string.IsNullOrEmpty(location)) qs.Add($"person_locations[]={Uri.EscapeDataString(location)}");

        var url = $"https://api.apollo.io/api/v1/mixed_people/api_search?{string.Join("&", qs)}";
        _log.LogInformation("Apollo search: {0}", url);

        var res = await MakeClient(key).PostAsync(url, null);
        var body = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            _log.LogError("Apollo search {0}: {1}", res.StatusCode, body);
            throw new Exception($"Apollo API error {(int)res.StatusCode}: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var total = root.TryGetProperty("pagination", out var pg) && pg.TryGetProperty("total_entries", out var te)
            ? te.GetInt32() : 0;

        var leads = new List<Lead>();
        if (root.TryGetProperty("people", out var people))
        {
            foreach (var p in people.EnumerateArray())
            {
                // Apollo returns last_name_obfuscated (e.g. "Wr***t") on free/basic plans
                var firstName = Str(p, "first_name");
                var lastNameObf = Str(p, "last_name_obfuscated");
                var fullName = $"{firstName} {lastNameObf}".Trim();

                // Location flags only — actual values need enrichment
                // Build hint from has_city/has_state/has_country flags
                var locHints = new List<string>();
                if (BoolFlag(p, "has_city"))    locHints.Add("city");
                if (BoolFlag(p, "has_state"))   locHints.Add("state");
                if (BoolFlag(p, "has_country")) locHints.Add("country");
                var loc = locHints.Count > 0 ? $"[{string.Join(", ", locHints)} available — enrich]" : "";

                var orgName = "";
                var orgIndustry = "";
                if (p.TryGetProperty("organization", out var org) && org.ValueKind == JsonValueKind.Object)
                {
                    orgName     = Str(org, "name");
                    orgIndustry = Str(org, "industry");
                }

                // Direct phone availability hint
                var phoneHint = Str(p, "has_direct_phone");

                leads.Add(new Lead
                {
                    Id          = Guid.NewGuid(),
                    ApolloId    = Str(p, "id"),
                    Name        = fullName,
                    Title       = Str(p, "title"),
                    Company     = orgName,
                    Industry    = orgIndustry,
                    Location    = loc,
                    Emails      = Array.Empty<string>(),
                    Phones      = Array.Empty<string>(),
                    LinkedinUrl = Str(p, "linkedin_url"),
                });
            }
        }

        return (leads, total);
    }

    public async Task<(string[] Emails, string[] Phones)> Enrich(string apolloPersonId, string webhookUrl)
    {
        var key = await GetKey();

        var payload = new
        {
            id = apolloPersonId,
            reveal_personal_emails = false,
            reveal_phone_number = true,
            webhook_url = webhookUrl
        };

        var client = MakeClient(key);
        var res = await client.PostAsJsonAsync("https://api.apollo.io/api/v1/people/match", payload);
        var body = await res.Content.ReadAsStringAsync();

        _log.LogInformation("Apollo enrich {0}: {1}", res.StatusCode, body[..Math.Min(1000, body.Length)]);

        if (!res.IsSuccessStatusCode)
            throw new Exception($"Apollo enrich error {(int)res.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        var emails = new List<string>();
        var phones = new List<string>();

        if (doc.RootElement.TryGetProperty("person", out var person))
        {
            var email = Str(person, "email");
            if (!string.IsNullOrEmpty(email)) emails.Add(email);

            if (person.TryGetProperty("phone_numbers", out var pns) && pns.ValueKind == JsonValueKind.Array)
                foreach (var pn in pns.EnumerateArray())
                {
                    var num = Str(pn, "sanitized_number") is { Length: > 0 } s ? s : Str(pn, "raw_number");
                    if (!string.IsNullOrEmpty(num)) phones.Add(num);
                }
        }

        return (emails.ToArray(), phones.ToArray());
    }

    public static string[] ParsePhonesFromWebhook(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            var phones = new List<string>();
            var root = doc.RootElement;

            if (root.TryGetProperty("person", out var person)) ExtractPhones(person, phones);
            if (phones.Count == 0) ExtractPhones(root, phones);
            if (phones.Count == 0 && root.TryGetProperty("phones", out var ph) && ph.ValueKind == JsonValueKind.Array)
                foreach (var p in ph.EnumerateArray())
                {
                    var num = p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                    if (!string.IsNullOrEmpty(num)) phones.Add(num!);
                }

            return phones.ToArray();
        }
        catch { return Array.Empty<string>(); }
    }

    private static void ExtractPhones(JsonElement el, List<string> phones)
    {
        if (!el.TryGetProperty("phone_numbers", out var pns) || pns.ValueKind != JsonValueKind.Array) return;
        foreach (var pn in pns.EnumerateArray())
        {
            var num = Str(pn, "sanitized_number") is { Length: > 0 } s ? s : Str(pn, "raw_number");
            if (!string.IsNullOrEmpty(num)) phones.Add(num);
        }
    }

    private static string Str(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static bool BoolFlag(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;
}
