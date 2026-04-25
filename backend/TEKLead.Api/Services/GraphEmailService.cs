using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace TEKLead.Api.Services;

public class GraphEmailService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<GraphEmailService> _logger;

    // Token cache (simple in-memory, per tenant/client)
    private string? _token;
    private DateTime _tokenExpiry = DateTime.MinValue;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    public GraphEmailService(SettingsService settings, IHttpClientFactory http, ILogger<GraphEmailService> logger)
    {
        _settings = settings;
        _http = http;
        _logger = logger;
    }

    public async Task SendEmail(string toEmail, string toName, string subject, string body)
    {
        var s = await _settings.GetSettings();
        if (string.IsNullOrEmpty(s.GraphTenantId) || string.IsNullOrEmpty(s.GraphClientId)
            || string.IsNullOrEmpty(s.GraphClientSecret) || string.IsNullOrEmpty(s.GraphSenderEmail))
            throw new InvalidOperationException("Microsoft Graph credentials not configured in Settings.");

        var token = await GetToken(s.GraphTenantId, s.GraphClientId, s.GraphClientSecret);

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var url = $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(s.GraphSenderEmail)}/sendMail";

        var payload = new
        {
            message = new
            {
                subject,
                body = new { contentType = "HTML", content = body.Replace("\n", "<br/>") },
                toRecipients = new[]
                {
                    new { emailAddress = new { address = toEmail, name = toName } }
                }
            },
            saveToSentItems = true
        };

        var res = await client.PostAsJsonAsync(url, payload);
        if (!res.IsSuccessStatusCode)
        {
            var err = await res.Content.ReadAsStringAsync();
            _logger.LogError("Graph sendMail failed: {0} {1}", res.StatusCode, err);
            throw new Exception($"Graph sendMail {(int)res.StatusCode}: {err}");
        }
    }

    private async Task<string> GetToken(string tenant, string clientId, string clientSecret)
    {
        if (_token != null && DateTime.UtcNow < _tokenExpiry) return _token;

        await _tokenLock.WaitAsync();
        try
        {
            if (_token != null && DateTime.UtcNow < _tokenExpiry) return _token;

            var client = _http.CreateClient();
            var tokenUrl = $"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
            var form = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string,string>("client_id", clientId),
                new KeyValuePair<string,string>("client_secret", clientSecret),
                new KeyValuePair<string,string>("scope", "https://graph.microsoft.com/.default"),
                new KeyValuePair<string,string>("grant_type", "client_credentials"),
            });

            var res = await client.PostAsync(tokenUrl, form);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
                throw new Exception($"Graph token {(int)res.StatusCode}: {body}");

            using var doc = JsonDocument.Parse(body);
            _token = doc.RootElement.GetProperty("access_token").GetString()!;
            var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();
            _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 60);
            return _token;
        }
        finally { _tokenLock.Release(); }
    }
}
