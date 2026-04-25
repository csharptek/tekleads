using System.Text.RegularExpressions;

namespace TEKLead.Api.Services;

public class WhatsAppService
{
    private readonly SettingsService _settings;
    public WhatsAppService(SettingsService settings) => _settings = settings;

    public async Task<(string Url, string Number)> BuildLink(string? rawPhone, string message)
    {
        var s = await _settings.GetSettings();
        var cc = string.IsNullOrEmpty(s.WhatsappDefaultCountryCode) ? "+91" : s.WhatsappDefaultCountryCode;

        var number = NormalizeNumber(rawPhone ?? "", cc);
        if (string.IsNullOrEmpty(number))
            throw new InvalidOperationException("No valid phone number available.");

        var url = $"https://wa.me/{number}?text={Uri.EscapeDataString(message)}";
        return (url, number);
    }

    private static string NormalizeNumber(string raw, string defaultCc)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        // Strip all non-digits and non-plus
        var cleaned = Regex.Replace(raw, @"[^\d+]", "");
        if (cleaned.StartsWith("+")) return cleaned.Substring(1); // wa.me wants digits only
        if (cleaned.Length >= 11) return cleaned; // likely has country code
        // Prepend default country code (strip +)
        var cc = defaultCc.StartsWith("+") ? defaultCc.Substring(1) : defaultCc;
        return cc + cleaned;
    }
}
