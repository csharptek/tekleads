using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _settings;
    public SettingsController(SettingsService settings) => _settings = settings;

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var s = await _settings.GetSettings();
        return Ok(new
        {
            s.AzureOpenAiEndpoint,
            AzureOpenAiKey = Mask(s.AzureOpenAiKey),
            s.AzureOpenAiDeployment,
            AzureBlobConnectionString = Mask(s.AzureBlobConnectionString),
            ApolloApiKey = Mask(s.ApolloApiKey),
            SendgridApiKey = Mask(s.SendgridApiKey),
            s.SendgridFromEmail,
            s.TwilioAccountSid,
            TwilioAuthToken = Mask(s.TwilioAuthToken),
            s.TwilioWhatsappFrom,
            PgConnectionString = Mask(s.PgConnectionString),
        });
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] AppSettings settings)
    {
        try
        {
            var existing = await _settings.GetSettings();
            settings.AzureOpenAiKey = PreserveIfMasked(settings.AzureOpenAiKey, existing.AzureOpenAiKey);
            settings.AzureBlobConnectionString = PreserveIfMasked(settings.AzureBlobConnectionString, existing.AzureBlobConnectionString);
            settings.ApolloApiKey = PreserveIfMasked(settings.ApolloApiKey, existing.ApolloApiKey);
            settings.SendgridApiKey = PreserveIfMasked(settings.SendgridApiKey, existing.SendgridApiKey);
            settings.TwilioAuthToken = PreserveIfMasked(settings.TwilioAuthToken, existing.TwilioAuthToken);
            settings.PgConnectionString = PreserveIfMasked(settings.PgConnectionString, existing.PgConnectionString);

            await _settings.SaveSettings(settings);
            return Ok(new { ok = true });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[SettingsController.Save] {ex}");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private static bool IsMasked(string? v) => !string.IsNullOrEmpty(v) && v.Contains("****");
    private static string PreserveIfMasked(string? incoming, string? existing) =>
        IsMasked(incoming) ? (existing ?? "") : (incoming ?? "");

    private static string Mask(string? v) =>
        string.IsNullOrEmpty(v) ? "" : v.Length <= 8 ? "****" : v[..4] + new string('*', v.Length - 8) + v[^4..];
}
