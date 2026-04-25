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

    public async Task<(List<Lead> Leads, int Total)> Search(
        string? name, string? title, string? company,
        string? industry, string? location,
        int page = 1, int perPage = 25)
    {
        var all = await _settings.GetAll();
        var key = all.GetValueOrDefault("apollo_api_key", "");
        if (string.IsNullOrEmpty(key))
            throw new InvalidOperationException("Apollo API key not configured in Settings.");

        var payload = new Dictionary<string, object> { ["page"] = page, ["per_page"] = perPage };
        if (!string.IsNullOrEmpty(name))     payload["person_name"] = name;
        if (!string.IsNullOrEmpty(title))    payload["person_titles"] = new[] { title };
        if (!string.IsNullOrEmpty(company))  payload["q_organization_name"] = company;
        if (!string.IsNullOrEmpty(industry)) payload["organization_industry_tag_ids"] = new[] { industry };
        if (!string.IsNullOrEmpty(location)) payload["person_locations"] = new[] { location };

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", key);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var res = await client.PostAsJsonAsync("https://api.apollo.io/api/v1/mixed_people/search", payload);
        var body = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            _log.LogError("Apollo search {0}: {1}", res.StatusCode, body);
            throw new Exception($"Apollo API error {(int)res.StatusCode}: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var total = root.TryGetProperty("pagination", out var pg)
            ? pg.GetProperty("total_entries").GetInt32() : 0;

        var leads = new List<Lead>();
        if (root.TryGetProperty("people", out var people))
        {
            foreach (var p in people.EnumerateArray())
            {
                var emails = new List<string>();
                if (p.TryGetProperty("email", out var em) && em.ValueKind == JsonValueKind.String)
                    emails.Add(em.GetString()!);

                leads.Add(new Lead
                {
                    Id          = Guid.NewGuid(),
                    ApolloId    = p.TryGetProperty("id", out var aid) ? aid.GetString() : null,
                    Name        = p.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                    Title       = p.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                    Company     = p.TryGetProperty("organization", out var org) && org.TryGetProperty("name", out var on) ? on.GetString() ?? "" : "",
                    Industry    = p.TryGetProperty("organization", out var org2) && org2.TryGetProperty("industry", out var ind) ? ind.GetString() ?? "" : "",
                    Location    = p.TryGetProperty("city", out var city) ? city.GetString() ?? "" : "",
                    Emails      = emails.ToArray(),
                    Phones      = Array.Empty<string>(),
                    LinkedinUrl = p.TryGetProperty("linkedin_url", out var li) ? li.GetString() : null,
                });
            }
        }

        return (leads, total);
    }

    /// <summary>
    /// Reveal phone for an Apollo person ID.
    /// Returns phone numbers or empty list if none available.
    /// </summary>
    public async Task<string[]> RevealPhone(string apolloPersonId)
    {
        var all = await _settings.GetAll();
        var key = all.GetValueOrDefault("apollo_api_key", "");
        if (string.IsNullOrEmpty(key))
            throw new InvalidOperationException("Apollo API key not configured.");

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", key);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var payload = new { reveal_personal_emails = false, reveal_phone_number = true, id = apolloPersonId };
        var res = await client.PostAsJsonAsync("https://api.apollo.io/api/v1/people/match", payload);
        var body = await res.Content.ReadAsStringAsync();

        if (!res.IsSuccessStatusCode)
        {
            _log.LogError("Apollo reveal {0}: {1}", res.StatusCode, body);
            throw new Exception($"Apollo reveal error {(int)res.StatusCode}: {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var phones = new List<string>();

        if (doc.RootElement.TryGetProperty("person", out var person))
        {
            if (person.TryGetProperty("phone_numbers", out var pns))
            {
                foreach (var pn in pns.EnumerateArray())
                {
                    if (pn.TryGetProperty("sanitized_number", out var sn) && sn.ValueKind == JsonValueKind.String)
                        phones.Add(sn.GetString()!);
                    else if (pn.TryGetProperty("raw_number", out var rn) && rn.ValueKind == JsonValueKind.String)
                        phones.Add(rn.GetString()!);
                }
            }
        }

        return phones.ToArray();
    }
}
