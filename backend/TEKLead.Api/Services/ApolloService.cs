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

    public async Task<(List<Lead> Leads, bool HasMore)> SearchPeople(LeadSearchRequest request)
    {
        var s = await _settings.GetSettings();

        var body = new
        {
            api_key = s.ApolloApiKey,
            q_organization_name = request.Company,
            q_keywords = request.PersonName,
            person_titles = string.IsNullOrEmpty(request.JobTitle) ? null : new[] { request.JobTitle },
            person_locations = string.IsNullOrEmpty(request.Location) ? null : new[] { request.Location },
            page = request.Page,
            per_page = request.PerPage,
        };

        var content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var response = await _http.PostAsync("https://api.apollo.io/v1/mixed_people/search", content);
        var json = await response.Content.ReadAsStringAsync();

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
            if (!string.IsNullOrEmpty(emailVal)) emails.Add(emailVal);
            if (p.TryGetProperty("contact_emails", out var contactEmails))
                foreach (var e in contactEmails.EnumerateArray())
                {
                    var em = Str(e, "email");
                    if (!string.IsNullOrEmpty(em) && !emails.Contains(em)) emails.Add(em);
                }

            return new Lead
            {
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
        var body = new { api_key = s.ApolloApiKey, id = apolloPersonId, reveal_phone_number = true };
        var content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var response = await _http.PostAsync("https://api.apollo.io/v1/people/match", content);
        var json = await response.Content.ReadAsStringAsync();

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("person", out var person))
            return Array.Empty<string>();

        var phones = new List<string>();
        if (person.TryGetProperty("phone_numbers", out var phoneNumbers))
            foreach (var p in phoneNumbers.EnumerateArray())
            {
                var num = Str(p, "sanitized_number");
                if (!string.IsNullOrEmpty(num)) phones.Add(num);
            }
        return phones.ToArray();
    }

    private static string Str(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static string? NullIfEmpty(string s) => string.IsNullOrEmpty(s) ? null : s;
}
