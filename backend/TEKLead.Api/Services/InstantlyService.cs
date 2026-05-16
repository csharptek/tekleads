using System.Net.Http.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class InstantlyService
{
    private readonly HttpClient _http;
    private readonly SettingsService _settings;
    private readonly ILogger<InstantlyService> _log;

    public InstantlyService(HttpClient http, SettingsService settings, ILogger<InstantlyService> log)
    {
        _http = http;
        _settings = settings;
        _log = log;
    }

    private async Task<string> GetApiKey()
    {
        var s = await _settings.GetAll();
        return s.GetValueOrDefault(SettingKeys.InstantlyApiKey, "");
    }

    public async Task<(bool Ok, List<Campaign> Campaigns, string Error)> GetCampaigns()
    {
        try
        {
            var key = await GetApiKey();
            if (string.IsNullOrWhiteSpace(key))
                return (false, new(), "Instantly API key not configured.");

            var req = new HttpRequestMessage(HttpMethod.Get, "https://api.instantly.ai/api/v2/campaigns");
            req.Headers.Add("Authorization", $"Bearer {key}");

            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var err = await res.Content.ReadAsStringAsync();
                return (false, new(), $"Failed to fetch campaigns: {res.StatusCode} {err}");
            }

            var bodyText = await res.Content.ReadAsStringAsync();
            var campaigns = new List<Campaign>();

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
                var root = doc.RootElement;
                
                if (root.TryGetProperty("items", out var itemsElement) && itemsElement.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    foreach (var item in itemsElement.EnumerateArray())
                    {
                        var id = item.TryGetProperty("id", out var idElem) ? idElem.GetString() ?? "" : "";
                        var name = item.TryGetProperty("name", out var nameElem) ? nameElem.GetString() ?? "" : "";
                        if (!string.IsNullOrEmpty(id))
                            campaigns.Add(new Campaign { Id = id, Name = name });
                    }
                }
            }
            catch (System.Text.Json.JsonException ex)
            {
                return (false, new(), $"Failed to parse campaigns response: {ex.Message}");
            }

            return (true, campaigns, "");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "GetCampaigns error");
            return (false, new(), ex.Message);
        }
    }

    public async Task<(bool Ok, int Pushed, int Failed, List<string> Errors)> PushContacts(
        string campaignId,
        List<(string email, string name)> contacts)
    {
        try
        {
            var key = await GetApiKey();
            if (string.IsNullOrWhiteSpace(key))
                return (false, 0, 0, new() { "Instantly API key not configured." });

            if (string.IsNullOrWhiteSpace(campaignId))
                return (false, 0, 0, new() { "Campaign ID required." });

            if (contacts.Count == 0)
                return (false, 0, 0, new() { "No contacts provided." });

            var payload = new
            {
                campaign_id = campaignId,
                leads = contacts.Select(c => new
                {
                    email = c.email,
                    first_name = ExtractFirstName(c.name),
                    last_name = ExtractLastName(c.name)
                }).ToList()
            };

            var req = new HttpRequestMessage(HttpMethod.Post, "https://api.instantly.ai/api/v2/leads")
            {
                Content = JsonContent.Create(payload)
            };
            req.Headers.Add("Authorization", $"Bearer {key}");

            var res = await _http.SendAsync(req);
            var bodyText = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("PushContacts failed: {status} {body}", res.StatusCode, bodyText);
                return (false, 0, 0, new() { $"API error: {res.StatusCode}" });
            }

            int pushed = 0;
            int failed = 0;
            var errors = new List<string>();

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(bodyText);
                var root = doc.RootElement;
                
                if (root.TryGetProperty("leads_uploaded", out var uploadedElem))
                    pushed = uploadedElem.GetInt32();
                
                if (root.TryGetProperty("invalid_email_count", out var invalidElem))
                    failed = invalidElem.GetInt32();

                if (failed > 0)
                    errors.Add($"{failed} invalid emails");

                if (root.TryGetProperty("already_in_campaign", out var alreadyElem))
                {
                    var alreadyIn = alreadyElem.GetInt32();
                    if (alreadyIn > 0)
                        errors.Add($"{alreadyIn} already in campaign");
                }
            }
            catch (System.Text.Json.JsonException ex)
            {
                _log.LogWarning("Failed to parse push response: {error}", ex.Message);
                errors.Add("Could not parse response");
            }

            return (true, pushed, failed, errors);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "PushContacts error");
            return (false, 0, 0, new() { ex.Message });
        }
    }

    private string ExtractFirstName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var parts = name.Trim().Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 ? parts[0] : "";
    }

    private string ExtractLastName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var parts = name.Trim().Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 1 ? string.Join(" ", parts[1..]) : "";
    }
}

public class Campaign
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
}
