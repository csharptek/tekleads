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
        await _settings.SaveSettings(settings);
        return Ok();
    }

    private static string Mask(string? v) =>
        string.IsNullOrEmpty(v) ? "" : v.Length <= 8 ? "****" : v[..4] + new string('*', v.Length - 8) + v[^4..];
}
