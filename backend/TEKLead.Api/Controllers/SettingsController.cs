using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _settings;
    private readonly ILogger<SettingsController> _logger;

    public SettingsController(SettingsService settings, ILogger<SettingsController> logger)
    {
        _settings = settings;
        _logger = logger;
    }

    /// <summary>
    /// Returns settings with secrets replaced by empty strings.
    /// Frontend must only send non-empty values on save — empty means "leave as-is".
    /// isSet flags tell the UI which secrets are already stored.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var s = await _settings.GetSettings();
        return Ok(new
        {
            // Non-secrets echoed as-is
            azureOpenAiEndpoint = s.AzureOpenAiEndpoint,
            azureOpenAiDeployment = s.AzureOpenAiDeployment,
            sendgridFromEmail = "", // removed
            twilioAccountSid = "",  // removed
            twilioWhatsappFrom = "",// removed
            graphTenantId = s.GraphTenantId,
            graphClientId = s.GraphClientId,
            graphSenderEmail = s.GraphSenderEmail,
            whatsappDefaultCountryCode = string.IsNullOrEmpty(s.WhatsappDefaultCountryCode) ? "+91" : s.WhatsappDefaultCountryCode,

            // Secrets: always empty in payload
            azureOpenAiKey = "",
            azureBlobConnectionString = "",
            apolloApiKey = "",
            graphClientSecret = "",
            pgConnectionString = "",

            // isSet flags (tells UI to show "●●●● set" vs empty)
            isSet = new
            {
                azureOpenAiKey = !string.IsNullOrEmpty(s.AzureOpenAiKey),
                azureBlobConnectionString = !string.IsNullOrEmpty(s.AzureBlobConnectionString),
                apolloApiKey = !string.IsNullOrEmpty(s.ApolloApiKey),
                graphClientSecret = !string.IsNullOrEmpty(s.GraphClientSecret),
                pgConnectionString = !string.IsNullOrEmpty(s.PgConnectionString),
            }
        });
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] AppSettings incoming)
    {
        try
        {
            var existing = await _settings.GetSettings();

            // Merge: empty string from client = keep existing secret
            var merged = new AppSettings
            {
                AzureOpenAiEndpoint = Pick(incoming.AzureOpenAiEndpoint, existing.AzureOpenAiEndpoint),
                AzureOpenAiKey = KeepIfEmpty(incoming.AzureOpenAiKey, existing.AzureOpenAiKey),
                AzureOpenAiDeployment = Pick(incoming.AzureOpenAiDeployment, existing.AzureOpenAiDeployment),
                AzureBlobConnectionString = KeepIfEmpty(incoming.AzureBlobConnectionString, existing.AzureBlobConnectionString),
                ApolloApiKey = KeepIfEmpty(incoming.ApolloApiKey, existing.ApolloApiKey),
                GraphTenantId = Pick(incoming.GraphTenantId, existing.GraphTenantId),
                GraphClientId = Pick(incoming.GraphClientId, existing.GraphClientId),
                GraphClientSecret = KeepIfEmpty(incoming.GraphClientSecret, existing.GraphClientSecret),
                GraphSenderEmail = Pick(incoming.GraphSenderEmail, existing.GraphSenderEmail),
                WhatsappDefaultCountryCode = Pick(incoming.WhatsappDefaultCountryCode, existing.WhatsappDefaultCountryCode),
                PgConnectionString = "" // env only
            };

            await _settings.SaveSettings(merged);
            return Ok(new { ok = true });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Settings save failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Diagnostic endpoint — verifies DB round-trip without exposing secrets.
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        try
        {
            var s = await _settings.GetSettings();
            return Ok(new
            {
                dbReachable = !string.IsNullOrEmpty(s.PgConnectionString),
                azureOpenAi = !string.IsNullOrEmpty(s.AzureOpenAiKey) && !string.IsNullOrEmpty(s.AzureOpenAiEndpoint),
                apollo = !string.IsNullOrEmpty(s.ApolloApiKey),
                graphEmail = !string.IsNullOrEmpty(s.GraphTenantId)
                           && !string.IsNullOrEmpty(s.GraphClientId)
                           && !string.IsNullOrEmpty(s.GraphClientSecret)
                           && !string.IsNullOrEmpty(s.GraphSenderEmail),
                whatsapp = !string.IsNullOrEmpty(s.WhatsappDefaultCountryCode),
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private static string KeepIfEmpty(string? incoming, string? existing) =>
        string.IsNullOrEmpty(incoming) ? (existing ?? "") : incoming;

    private static string Pick(string? incoming, string? existing) =>
        incoming ?? existing ?? "";
}
