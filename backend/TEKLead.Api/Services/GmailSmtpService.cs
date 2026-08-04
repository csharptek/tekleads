using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class GmailSmtpService
{
    private readonly SettingsService _settings;

    public GmailSmtpService(SettingsService settings)
    {
        _settings = settings;
    }

    public async Task<(bool Ok, string Error)> SendEmail(
        string toEmail,
        string toName,
        string subject,
        string body,
        string? signature = null)
    {
        try
        {
            var s = await _settings.GetAll();
            var user = s.GetValueOrDefault(SettingKeys.GmailSmtpUser, "");
            var appPassword = s.GetValueOrDefault(SettingKeys.GmailSmtpAppPassword, "");

            if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(appPassword))
                return (false, "Gmail SMTP credentials not configured in Settings.");

            var fullBody = string.IsNullOrWhiteSpace(signature) ? body : $"{body}\n\n{signature}";

            var msg = new MimeMessage();
            msg.From.Add(MailboxAddress.Parse(user));
            msg.To.Add(string.IsNullOrWhiteSpace(toName) ? MailboxAddress.Parse(toEmail) : new MailboxAddress(toName, toEmail));
            msg.Subject = subject;
            msg.Body = new TextPart("plain") { Text = fullBody };

            using var client = new SmtpClient();
            await client.ConnectAsync("smtp.gmail.com", 587, SecureSocketOptions.StartTls);
            await client.AuthenticateAsync(user, appPassword);
            await client.SendAsync(msg);
            await client.DisconnectAsync(true);

            return (true, "");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }
}
