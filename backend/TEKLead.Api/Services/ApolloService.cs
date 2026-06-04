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
        string? industry, string? location, string? domain,
        int page = 1, int perPage = 25)
    {
        var key = await GetKey();

        var payload = new Dictionary<string, object>
        {
            ["page"] = page,
            ["per_page"] = perPage,
        };

        var kw = string.Join(" ", new[] { name, company, industry }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
        if (!string.IsNullOrEmpty(kw))
            payload["q_keywords"] = kw;
        if (!string.IsNullOrEmpty(title))
            payload["person_titles"] = new[] { title };
        if (!string.IsNullOrEmpty(location))
            payload["person_locations"] = new[] { location };
        if (!string.IsNullOrEmpty(domain))
            payload["q_organization_domains_list"] = new[] { domain.Trim().ToLower().Replace("https://", "").Replace("http://", "").TrimEnd('/') };

        var url = "https://api.apollo.io/api/v1/mixed_people/api_search";
        _log.LogInformation("Apollo search: {0}", url);

        var res = await MakeClient(key).PostAsJsonAsync(url, payload);
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
                var firstName = Str(p, "first_name");
                var lastName  = Str(p, "last_name");
                if (string.IsNullOrEmpty(lastName)) lastName = Str(p, "last_name_obfuscated");
                var fullName = $"{firstName} {lastName}".Trim();

                var orgName = ""; var orgIndustry = "";
                if (p.TryGetProperty("organization", out var org) && org.ValueKind == JsonValueKind.Object)
                {
                    orgName     = Str(org, "name");
                    orgIndustry = Str(org, "industry");
                }

                var city    = Str(p, "city");
                var state   = Str(p, "state");
                var country = Str(p, "country");
                var locParts = new[] { city, state, country }.Where(s => !string.IsNullOrEmpty(s));

                leads.Add(new Lead
                {
                    Id          = Guid.NewGuid(),
                    ApolloId    = Str(p, "id"),
                    Name        = fullName,
                    Title       = Str(p, "title"),
                    Company     = orgName,
                    Industry    = orgIndustry,
                    Location    = string.Join(", ", locParts),
                    City        = city,
                    State       = state,
                    Country     = country,
                    Emails      = Array.Empty<string>(),
                    Phones      = Array.Empty<string>(),
                    LinkedinUrl = Str(p, "linkedin_url"),
                    Headline    = Str(p, "headline"),
                    Seniority   = Str(p, "seniority"),
                });
            }
        }

        return (leads, total);
    }

    // Full enrich — returns complete Lead with all fields populated
    public async Task<EnrichResult> EnrichFull(string apolloPersonId, string webhookUrl)
    {
        var key = await GetKey();
        var payload = new
        {
            id = apolloPersonId,
            reveal_personal_emails = false,
            reveal_phone_number = true,
            webhook_url = webhookUrl
        };

        _log.LogInformation("Apollo EnrichFull webhookUrl={0}", webhookUrl);
        var res = await MakeClient(key).PostAsJsonAsync("https://api.apollo.io/api/v1/people/match", payload);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new Exception($"Apollo enrich error {(int)res.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        // Log phone_numbers and request_id specifically
        var phoneSection = "";
        var requestId = "";
        if (doc.RootElement.TryGetProperty("person", out var personEl))
        {
            if (personEl.TryGetProperty("phone_numbers", out var pnEl)) phoneSection = pnEl.GetRawText();
            if (personEl.TryGetProperty("request_id", out var rid)) requestId = rid.GetRawText();
        }
        if (doc.RootElement.TryGetProperty("request_id", out var rootRid)) requestId = rootRid.GetRawText();
        _log.LogInformation("Apollo enrich phone_numbers={0} request_id={1}", phoneSection, requestId);
        var enrichResult = ParsePersonFull(doc.RootElement, includePhones: true);
        _log.LogInformation("Apollo enrich parsed: emails={0} phones={1}", enrichResult.Emails.Count, enrichResult.Phones.Count);
        return enrichResult;
    }

    public async Task<EnrichResult> EnrichEmailOnly(string apolloPersonId)
    {
        var key = await GetKey();
        var payload = new { id = apolloPersonId, reveal_personal_emails = false, reveal_phone_number = false };
        var res = await MakeClient(key).PostAsJsonAsync("https://api.apollo.io/api/v1/people/match", payload);
        var body = await res.Content.ReadAsStringAsync();
        _log.LogInformation("Apollo enrich-email {0}: {1}", res.StatusCode, body[..Math.Min(1000, body.Length)]);
        if (!res.IsSuccessStatusCode)
            throw new Exception($"Apollo enrich-email error {(int)res.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        return ParsePersonFull(doc.RootElement, includePhones: false);
    }

    public async Task<EnrichResult> EnrichPhoneOnly(string apolloPersonId, string webhookUrl)
    {
        var key = await GetKey();
        var payload = new { id = apolloPersonId, reveal_personal_emails = false, reveal_phone_number = true, webhook_url = webhookUrl };
        var res = await MakeClient(key).PostAsJsonAsync("https://api.apollo.io/api/v1/people/match", payload);
        var body = await res.Content.ReadAsStringAsync();
        _log.LogInformation("Apollo enrich-phone {0}: {1}", res.StatusCode, body[..Math.Min(1000, body.Length)]);
        if (!res.IsSuccessStatusCode)
            throw new Exception($"Apollo enrich-phone error {(int)res.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        return ParsePersonFull(doc.RootElement, includePhones: true);
    }

    private static EnrichResult ParsePersonFull(JsonElement root, bool includePhones)
    {
        var result = new EnrichResult();
        if (!root.TryGetProperty("person", out var person) || person.ValueKind == JsonValueKind.Null)
            return result;

        var fn = Str(person, "first_name");
        var ln = Str(person, "last_name");
        result.FullName    = $"{fn} {ln}".Trim();
        result.Title       = Str(person, "title");
        result.Headline    = Str(person, "headline");
        result.Seniority   = Str(person, "seniority");
        result.EmailStatus = Str(person, "email_status");
        result.LinkedinUrl = Str(person, "linkedin_url");
        result.TwitterUrl  = Str(person, "twitter_url");
        result.GithubUrl   = Str(person, "github_url");
        result.FacebookUrl = Str(person, "facebook_url");
        result.PhotoUrl    = Str(person, "photo_url");
        result.City        = Str(person, "city");
        result.State       = Str(person, "state");
        result.Country     = Str(person, "country");
        result.Location    = string.Join(", ", new[] { result.City, result.State, result.Country }.Where(s => !string.IsNullOrEmpty(s)));

        // Departments
        if (person.TryGetProperty("departments", out var depts) && depts.ValueKind == JsonValueKind.Array)
            result.Departments = depts.EnumerateArray().Select(d => d.GetString() ?? "").Where(s => s.Length > 0).ToArray();

        // Primary email
        var email = Str(person, "email");
        if (!string.IsNullOrEmpty(email)) result.Emails.Add(email);

        // All email addresses
        if (person.TryGetProperty("email_addresses", out var eas) && eas.ValueKind == JsonValueKind.Array)
            foreach (var ea in eas.EnumerateArray())
            {
                var e = Str(ea, "email");
                if (!string.IsNullOrEmpty(e) && !result.Emails.Contains(e, StringComparer.OrdinalIgnoreCase))
                    result.Emails.Add(e);
            }

        // Phones
        if (includePhones && person.TryGetProperty("phone_numbers", out var pns) && pns.ValueKind == JsonValueKind.Array)
            foreach (var pn in pns.EnumerateArray())
            {
                var num = Str(pn, "sanitized_number") is { Length: > 0 } s ? s : Str(pn, "raw_number");
                if (!string.IsNullOrEmpty(num)) result.Phones.Add(num);
            }

        // Employment history
        if (person.TryGetProperty("employment_history", out var empHistory) && empHistory.ValueKind == JsonValueKind.Array)
            foreach (var e in empHistory.EnumerateArray())
                result.EmploymentHistory.Add(new LeadEmploymentHistory
                {
                    JobTitle  = Str(e, "title"),
                    OrgName   = Str(e, "organization_name"),
                    StartDate = Str(e, "start_date"),
                    EndDate   = Str(e, "end_date"),
                    IsCurrent = e.TryGetProperty("current", out var cur) && cur.ValueKind == JsonValueKind.True,
                });

        // Org details
        if (person.TryGetProperty("organization", out var org) && org.ValueKind == JsonValueKind.Object)
        {
            result.OrgDetails = new LeadOrgDetails
            {
                OrgWebsiteUrl         = Str(org, "website_url"),
                OrgLinkedinUrl        = Str(org, "linkedin_url"),
                OrgAddress            = Str(org, "raw_address"),
                OrgLogoUrl            = Str(org, "logo_url"),
                OrgFoundedYear        = org.TryGetProperty("founded_year", out var fy) && fy.ValueKind != JsonValueKind.Null ? fy.ToString() : null,
                OrgEstimatedEmployees = org.TryGetProperty("estimated_num_employees", out var emp) && emp.ValueKind != JsonValueKind.Null ? emp.ToString() : null,
                OrgAnnualRevenue      = Str(org, "annual_revenue_printed"),
                OrgPhone              = org.TryGetProperty("primary_phone", out var pp) && pp.ValueKind == JsonValueKind.Object ? Str(pp, "number") : null,
            };
            // Company name from org if not on person
            if (string.IsNullOrEmpty(result.Company))
                result.Company = Str(org, "name");
            if (string.IsNullOrEmpty(result.Industry))
                result.Industry = Str(org, "industry");
        }

        return result;
    }

    public static void LogWebhookReceived(ILogger log, string json)
    {
        log.LogInformation("Apollo phone webhook received: {0}", json[..Math.Min(2000, json.Length)]);
    }

    public static string[] ParsePhonesFromWebhook(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            var phones = new List<string>();
            var root = doc.RootElement;

            if (root.TryGetProperty("people", out var people) && people.ValueKind == JsonValueKind.Array)
                foreach (var person in people.EnumerateArray())
                    ExtractPhones(person, phones);

            if (phones.Count == 0 && root.TryGetProperty("person", out var personEl))
                ExtractPhones(personEl, phones);

            if (phones.Count == 0)
                ExtractPhones(root, phones);

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

    public async Task<Lead?> SearchByLinkedIn(string linkedinUrl)
    {
        var key = await GetKey();
        var payload = new { linkedin_url = linkedinUrl, reveal_personal_emails = false };
        var client = MakeClient(key);
        var res = await client.PostAsJsonAsync("https://api.apollo.io/api/v1/people/match", payload);
        var body = await res.Content.ReadAsStringAsync();
        _log.LogInformation("Apollo LinkedIn match {0}: {1}", res.StatusCode, body[..Math.Min(500, body.Length)]);
        if (!res.IsSuccessStatusCode) throw new Exception($"Apollo API error {(int)res.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        var result = ParsePersonFull(doc.RootElement, includePhones: false);
        if (string.IsNullOrEmpty(result.FullName)) return null;

        return new Lead
        {
            Id              = Guid.NewGuid(),
            ApolloId        = ExtractApolloId(doc.RootElement),
            Name            = result.FullName,
            Title           = result.Title,
            Company         = result.Company,
            Industry        = result.Industry,
            Location        = result.Location,
            City            = result.City,
            State           = result.State,
            Country         = result.Country,
            Emails          = result.Emails.ToArray(),
            Phones          = Array.Empty<string>(),
            LinkedinUrl     = result.LinkedinUrl,
            Headline        = result.Headline,
            Seniority       = result.Seniority,
            EmailStatus     = result.EmailStatus,
            Departments     = result.Departments,
            OrgDetails      = result.OrgDetails,
            EmploymentHistory = result.EmploymentHistory,
        };
    }

    private static string ExtractApolloId(JsonElement root)
    {
        if (root.TryGetProperty("person", out var p) && p.ValueKind != JsonValueKind.Null)
            return Str(p, "id");
        return "";
    }

    private static string Str(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
}

public class EnrichResult
{
    public string FullName    { get; set; } = "";
    public string Title       { get; set; } = "";
    public string Company     { get; set; } = "";
    public string Industry    { get; set; } = "";
    public string Location    { get; set; } = "";
    public string City        { get; set; } = "";
    public string State       { get; set; } = "";
    public string Country     { get; set; } = "";
    public string Headline    { get; set; } = "";
    public string Seniority   { get; set; } = "";
    public string EmailStatus { get; set; } = "";
    public string LinkedinUrl { get; set; } = "";
    public string TwitterUrl  { get; set; } = "";
    public string GithubUrl   { get; set; } = "";
    public string FacebookUrl { get; set; } = "";
    public string PhotoUrl    { get; set; } = "";
    public string[] Departments { get; set; } = Array.Empty<string>();
    public List<string> Emails { get; set; } = new();
    public List<string> Phones { get; set; } = new();
    public LeadOrgDetails? OrgDetails { get; set; }
    public List<LeadEmploymentHistory> EmploymentHistory { get; set; } = new();
}
