using Azure.Identity;
using Microsoft.Graph;
using Microsoft.Graph.Models;
using Microsoft.Graph.Users.Item.SendMail;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class GraphEmailService
{
    private readonly SettingsService _settings;

    public GraphEmailService(SettingsService settings)
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
            var tenantId = s.GetValueOrDefault(SettingKeys.GraphTenantId, "");
            var clientId = s.GetValueOrDefault(SettingKeys.GraphClientId, "");
            var clientSecret = s.GetValueOrDefault(SettingKeys.GraphClientSecret, "");
            var senderEmail = s.GetValueOrDefault(SettingKeys.GraphSenderEmail, "");

            if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) ||
                string.IsNullOrWhiteSpace(clientSecret) || string.IsNullOrWhiteSpace(senderEmail))
                return (false, "Microsoft Graph credentials not configured in Settings.");

            var credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
            var graphClient = new GraphServiceClient(credential);

            var fullBody = body;
            if (!string.IsNullOrWhiteSpace(signature))
                fullBody = body + "\n\n" + signature;

            var message = new Message
            {
                Subject = subject,
                Body = new ItemBody
                {
                    ContentType = BodyType.Text,
                    Content = fullBody,
                },
                ToRecipients = new List<Recipient>
                {
                    new Recipient
                    {
                        EmailAddress = new EmailAddress
                        {
                            Address = toEmail,
                            Name = string.IsNullOrWhiteSpace(toName) ? toEmail : toName,
                        }
                    }
                }
            };

            await graphClient.Users[senderEmail].SendMail.PostAsync(new SendMailPostRequestBody
            {
                Message = message,
                SaveToSentItems = true,
            });

            return (true, "");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }
}
