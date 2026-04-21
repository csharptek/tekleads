using SendGrid;
using SendGrid.Helpers.Mail;
using Twilio;
using Twilio.Rest.Api.V2010.Account;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class OutreachService
{
    private readonly SettingsService _settings;
    public OutreachService(SettingsService settings) => _settings = settings;

    public async Task SendEmail(string toEmail, string toName, string subject, string body)
    {
        var s = await _settings.GetSettings();
        var client = new SendGridClient(s.SendgridApiKey);
        var msg = MailHelper.CreateSingleEmail(
            new EmailAddress(s.SendgridFromEmail),
            new EmailAddress(toEmail, toName),
            subject, body, body.Replace("\n", "<br/>"));
        var response = await client.SendEmailAsync(msg);
        if ((int)response.StatusCode >= 400)
            throw new Exception($"SendGrid {response.StatusCode}: {await response.Body.ReadAsStringAsync()}");
    }

    public async Task SendWhatsApp(string to, string message)
    {
        var s = await _settings.GetSettings();
        TwilioClient.Init(s.TwilioAccountSid, s.TwilioAuthToken);
        await MessageResource.CreateAsync(
            to: new Twilio.Types.PhoneNumber($"whatsapp:{to}"),
            from: new Twilio.Types.PhoneNumber(s.TwilioWhatsappFrom),
            body: message);
    }
}
