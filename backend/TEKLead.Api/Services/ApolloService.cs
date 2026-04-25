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
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", key);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    /// <summary>
    /// Search people via GET /api/v1/mixed_people/api_search (new endpoint).
    /// Does NOT return emails or phones — use Enrich for that.
    /// </summary>
    public async Task<(List<Lead> Leads, int Total)> Search(
        string? name, string? title, string? company,
        string? industry, string? location,
        int page = 1, int perPage = 25)
    {
        var key = await GetKey();
        var qs = new List<string>
        {
            $"page={page}",
            $"per_page={perPage}",
        };
        if (!string.IsNullOrEmpty(name))     qs.Add($"q_keywords={Uri.EscapeDataString(name)}");
        if (!string.IsNullOrEmpty(title))    qs.Add($"person_titles[]={Uri.EscapeDataString(title)}");
        if (!string.IsNullOrEmpty(company))  qs.Add($"q_organization_name={Uri.EscapeDataString(company)}");
        if (!string.IsNullOrEmpty(location)) qs.Add($"person_locations[]={Uri.EscapeDataString(location)}");
        // industry is not a direct filter in new endpoint — use q_keywords fallback
        if (!string.IsNullOrEmpty(industry) && string.IsNullOrEmpty(name))
            qs.Add($"q_keywords={Uri.EscapeDataString(industry)}");

        var url = $"https://api.apollo.io/api/v1/mixed_people/api_search?{string.Join("&", qs)}";
        var client = MakeClient(key);
        var res = await client.GetAsync(url);
        var body = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            _log.LogError("Apollo search {0}: {1}", res.StatusCode, body);
            throw new Exception($"Apollo API error {(int)res.StatusCode}: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var total = root.TryGetProperty("pagination", out var pg)
            ? (pg.TryGetProperty("total_entries", out var te) ? te.GetInt32() : 0) : 0;

        var leads = new List<Lead>();
        if (root.TryGetProperty("people", out var people))
        {
            foreach (var p in people.EnumerateArray())
            {
                leads.Add(new Lead
                {
                    Id          = Guid.NewGuid(),
                    ApolloId    = p.TryGetProperty("id", out var aid) ? aid.GetString() : null,
                    Name        = p.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                    Title       = p.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                    Company     = p.TryGetProperty("organization", out var org) && org.ValueKind == JsonValueKind.Object && org.TryGetProperty("name", out var on) ? on.GetString() ?? "" : "",
                    Industry    = p.TryGetProperty("organization", out var org2) && org2.ValueKind == JsonValueKind.Object && org2.TryGetProperty("industry", out var ind) ? ind.GetString() ?? "" : "",
                    Location    = p.TryGetProperty("city", out var city) ? city.GetString() ?? "" : "",
                    Emails      = Array.Empty<string>(), // not returned by search endpoint
                    Phones      = Array.Empty<string>(), // not returned by search endpoint
                    LinkedinUrl = p.TryGetProperty("linkedin_url", out var li) ? li.GetString() : null,
                });
            }
        }

        return (leads, total);
    }

    /// <summary>
    /// Enrich a person by Apollo ID to get email.
    /// Phone reveal is async (webhook) — not supported here. Returns email only.
    /// </summary>
    public async Task<(string[] Emails, string[] Phones)> Enrich(string apolloPersonId)
    {
        var key = await GetKey();
        var client = MakeClient(key);

        // Use GET with id param for enrichment (synchronous, no webhook needed for email)
        var url = $"https://api.apollo.io/api/v1/people/match?id={Uri.EscapeDataString(apolloPersonId)}&reveal_personal_emails=false";
        var res = await client.GetAsync(url);
        var body = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            _log.LogError("Apollo enrich {0}: {1}", res.StatusCode, body);
            throw new Exception($"Apollo enrich error {(int)res.StatusCode}: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var emails = new List<string>();
        var phones = new List<string>();

        if (doc.RootElement.TryGetProperty("person", out var person))
        {
            if (person.TryGetProperty("email", out var em) && em.ValueKind == JsonValueKind.String)
            {
                var e = em.GetString();
                if (!string.IsNullOrEmpty(e)) emails.Add(e);
            }

            // phone_numbers may be present without webhook for some accounts
            if (person.TryGetProperty("phone_numbers", out var pns) && pns.ValueKind == JsonValueKind.Array)
            {
                foreach (var pn in pns.EnumerateArray())
                {
                    var num = pn.TryGetProperty("sanitized_number", out var sn) ? sn.GetString()
                            : pn.TryGetProperty("raw_number", out var rn) ? rn.GetString() : null;
                    if (!string.IsNullOrEmpty(num)) phones.Add(num!);
                }
            }
        }

        return (emails.ToArray(), phones.ToArray());
    }
}
