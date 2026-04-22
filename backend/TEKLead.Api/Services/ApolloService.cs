using System.Text;
using System.Text.Json;
using TEKLead.Api.DTOs;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ApolloService
{
    private readonly SettingsService _settings;
    private readonly HttpClient _http;

    public ApolloService(SettingsService settings, IHttpClientFactory factory)
    {
        _settings = settings;
        _http = factory.CreateClient();
    }

    private HttpRequestMessage BuildRequest(HttpMethod method, string url, string apiKey, object? body = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Add("X-Api-Key", apiKey);
        req.Headers.Add("Cache-Control", "no-cache");
        req.Headers.Add("accept", "application/json");
        if (body != null)
            req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return req;
    }

    public async Task<(List<Lead> Leads, bool HasMore)> SearchPeople(LeadSearchRequest request)
    {
        var s = await _settings.GetSettings();
        if (string.IsNullOrEmpty(s.ApolloApiKey))
            throw new InvalidOperationException("Apollo API key not configured. Go to Settings and save it.");

        var body = new Dictionary<string, object?>
        {
            ["page"] = request.Page,
            ["per_page"] = request.PerPage,
        };
        if (!string.IsNullOrWhiteSpace(request.Company)) body["q_organization_name"] = request.Company;
        if (!string.IsNullOrWhiteSpace(request.PersonName)) body["q_keywords"] = request.PersonName;
        if (!string.IsNullOrWhiteSpace(request.JobTitle)) body["person_titles"] = new[] { request.JobTitle };
        if (!string.IsNullOrWhiteSpace(request.Location)) body["person_locations"] = new[] { request.Location };

        var req = BuildRequest(HttpMethod.Post, "https://api.apollo.io/api/v1/mixed_people/search", s.ApolloApiKey, body);
        var response = await _http.SendAsync(req);
        var json = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Apollo error {(int)response.StatusCode}: {json}");

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("people", out var people))
            return (new List<Lead>(), false);

        var hasMore = false;
        if (doc.RootElement.TryGetProperty("pagination", out var pagination))
        {
            var total = pagination.TryGetProperty("total_entries", out var t) ? t.GetInt32() : 0;
            hasMore = request.Page * request.PerPage < total;
        }

        var leads = people.EnumerateArray().Select(p =>
        {
            var orgName = p.TryGetProperty("organization", out var org) ? Str(org, "name") : "";
            var orgIndustry = p.TryGetProperty("organization", out var org2) ? Str(org2, "industry") : "";

            var emails = new List<string>();
            var emailVal = Str(p, "email");
            if (!string.IsNullOrEmpty(emailVal) && emailVal != "email_not_unlocked@domain.com") emails.Add(emailVal);
            if (p.TryGetProperty("contact_emails", out var contactEmails))
                foreach (var e in contactEmails.EnumerateArray())
                {
                    var em = Str(e, "email");
                    if (!string.IsNullOrEmpty(em) && !emails.Contains(em)) emails.Add(em);
                }

            return new Lead
            {
                ApolloId = Str(p, "id"),
                Name = Str(p, "name"),
                Title = Str(p, "title"),
                Company = orgName,
                Industry = string.IsNullOrEmpty(orgIndustry) ? (request.Industry ?? "") : orgIndustry,
                Location = Str(p, "city"),
                Emails = emails.ToArray(),
                Phones = Array.Empty<string>(),
                LinkedinUrl = NullIfEmpty(Str(p, "linkedin_url")),
            };
        }).ToList();

        return (leads, hasMore);
    }

    public async Task<string[]> RevealPhones(string apolloPersonId)
    {
        var s = await _settings.GetSettings();
        if (string.IsNullOrEmpty(s.ApolloApiKey))
            throw new InvalidOperationException("Apollo API key not configured.");

        var url = $"https://api.apollo.io/api/v1/people/match?id={apolloPersonId}&reveal_phone_number=true";
        var req = BuildRequest(HttpMethod.Post, url, s.ApolloApiKey);
        var response = await _http.SendAsync(req);
        var json = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Apollo reveal error {(int)response.StatusCode}: {json}");

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("person", out var person))
            return Array.Empty<string>();

        var phones = new List<string>();
        if (person.TryGetProperty("phone_numbers", out var phoneNumbers))
            foreach (var p in phoneNumbers.EnumerateArray())
            {
                var num = Str(p, "sanitized_number");
                if (string.IsNullOrEmpty(num)) num = Str(p, "raw_number");
                if (!string.IsNullOrEmpty(num)) phones.Add(num);
            }
        return phones.ToArray();
    }

    private static string Str(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static string? NullIfEmpty(string s) => string.IsNullOrEmpty(s) ? null : s;
}
