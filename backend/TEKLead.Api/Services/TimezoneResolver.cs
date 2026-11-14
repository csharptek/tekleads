using System.Text.Json;

namespace TEKLead.Api.Services;

/// <summary>
/// Resolves a recipient's IANA time zone from country / state / city and computes
/// the next moment inside their local send window (port of tekgrowth lib/schedule.ts).
/// </summary>
public static class TimezoneResolver
{
    public const string Fallback = "America/New_York";

    private static readonly Dictionary<string, string> CountryAlias = new(StringComparer.OrdinalIgnoreCase)
    {
        ["united states"] = "US", ["usa"] = "US", ["united states of america"] = "US", ["us"] = "US", ["america"] = "US",
        ["united kingdom"] = "GB", ["uk"] = "GB", ["england"] = "GB", ["scotland"] = "GB", ["wales"] = "GB", ["great britain"] = "GB",
        ["australia"] = "AU", ["canada"] = "CA", ["germany"] = "DE", ["france"] = "FR", ["netherlands"] = "NL",
        ["the netherlands"] = "NL", ["ireland"] = "IE", ["india"] = "IN", ["spain"] = "ES", ["sweden"] = "SE",
        ["denmark"] = "DK", ["norway"] = "NO", ["finland"] = "FI", ["switzerland"] = "CH", ["new zealand"] = "NZ",
        ["singapore"] = "SG", ["israel"] = "IL", ["united arab emirates"] = "AE", ["uae"] = "AE",
        ["italy"] = "IT", ["portugal"] = "PT", ["belgium"] = "BE", ["austria"] = "AT", ["poland"] = "PL",
        ["saudi arabia"] = "SA", ["qatar"] = "QA", ["south africa"] = "ZA", ["japan"] = "JP", ["hong kong"] = "HK",
        ["malaysia"] = "MY", ["philippines"] = "PH", ["brazil"] = "BR", ["mexico"] = "MX", ["luxembourg"] = "LU",
        ["czech republic"] = "CZ", ["czechia"] = "CZ", ["romania"] = "RO", ["greece"] = "GR", ["estonia"] = "EE",
    };

    private static readonly Dictionary<string, string> CountryTz = new(StringComparer.OrdinalIgnoreCase)
    {
        ["US"] = "America/New_York", ["CA"] = "America/Toronto", ["GB"] = "Europe/London", ["IE"] = "Europe/Dublin",
        ["AU"] = "Australia/Sydney", ["NZ"] = "Pacific/Auckland", ["DE"] = "Europe/Berlin", ["FR"] = "Europe/Paris",
        ["NL"] = "Europe/Amsterdam", ["ES"] = "Europe/Madrid", ["SE"] = "Europe/Stockholm", ["DK"] = "Europe/Copenhagen",
        ["NO"] = "Europe/Oslo", ["FI"] = "Europe/Helsinki", ["CH"] = "Europe/Zurich", ["IN"] = "Asia/Kolkata",
        ["SG"] = "Asia/Singapore", ["IL"] = "Asia/Jerusalem", ["AE"] = "Asia/Dubai", ["IT"] = "Europe/Rome",
        ["PT"] = "Europe/Lisbon", ["BE"] = "Europe/Brussels", ["AT"] = "Europe/Vienna", ["PL"] = "Europe/Warsaw",
        ["SA"] = "Asia/Riyadh", ["QA"] = "Asia/Qatar", ["ZA"] = "Africa/Johannesburg", ["JP"] = "Asia/Tokyo",
        ["HK"] = "Asia/Hong_Kong", ["MY"] = "Asia/Kuala_Lumpur", ["PH"] = "Asia/Manila", ["BR"] = "America/Sao_Paulo",
        ["MX"] = "America/Mexico_City", ["LU"] = "Europe/Luxembourg", ["CZ"] = "Europe/Prague", ["RO"] = "Europe/Bucharest",
        ["GR"] = "Europe/Athens", ["EE"] = "Europe/Tallinn",
    };

    // US states (full name + code) → zone
    private static readonly Dictionary<string, string> UsStateTz = BuildUs();
    private static Dictionary<string, string> BuildUs()
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void Add(string zone, params string[] keys) { foreach (var k in keys) d[k] = zone; }
        Add("America/New_York",
            "CT", "Connecticut", "DE", "Delaware", "DC", "District of Columbia", "Washington DC", "Washington D.C.",
            "FL", "Florida", "GA", "Georgia", "IN", "Indiana", "KY", "Kentucky", "ME", "Maine", "MD", "Maryland",
            "MA", "Massachusetts", "MI", "Michigan", "NH", "New Hampshire", "NJ", "New Jersey", "NY", "New York",
            "NC", "North Carolina", "OH", "Ohio", "PA", "Pennsylvania", "RI", "Rhode Island", "SC", "South Carolina",
            "VT", "Vermont", "VA", "Virginia", "WV", "West Virginia");
        Add("America/Chicago",
            "AL", "Alabama", "AR", "Arkansas", "IL", "Illinois", "IA", "Iowa", "KS", "Kansas", "LA", "Louisiana",
            "MN", "Minnesota", "MS", "Mississippi", "MO", "Missouri", "NE", "Nebraska", "ND", "North Dakota",
            "OK", "Oklahoma", "SD", "South Dakota", "TN", "Tennessee", "TX", "Texas", "WI", "Wisconsin");
        Add("America/Denver", "CO", "Colorado", "ID", "Idaho", "MT", "Montana", "NM", "New Mexico", "UT", "Utah", "WY", "Wyoming");
        Add("America/Phoenix", "AZ", "Arizona");
        Add("America/Los_Angeles", "CA", "California", "NV", "Nevada", "OR", "Oregon", "WA", "Washington");
        Add("America/Anchorage", "AK", "Alaska");
        Add("Pacific/Honolulu", "HI", "Hawaii");
        return d;
    }

    private static readonly Dictionary<string, string> CaProvTz = new(StringComparer.OrdinalIgnoreCase)
    {
        ["BC"] = "America/Vancouver", ["British Columbia"] = "America/Vancouver",
        ["AB"] = "America/Edmonton", ["Alberta"] = "America/Edmonton",
        ["SK"] = "America/Regina", ["Saskatchewan"] = "America/Regina",
        ["MB"] = "America/Winnipeg", ["Manitoba"] = "America/Winnipeg",
        ["ON"] = "America/Toronto", ["Ontario"] = "America/Toronto",
        ["QC"] = "America/Toronto", ["Quebec"] = "America/Toronto", ["Québec"] = "America/Toronto",
        ["NS"] = "America/Halifax", ["Nova Scotia"] = "America/Halifax",
        ["NB"] = "America/Halifax", ["New Brunswick"] = "America/Halifax",
        ["PE"] = "America/Halifax", ["Prince Edward Island"] = "America/Halifax",
        ["NL"] = "America/St_Johns", ["Newfoundland and Labrador"] = "America/St_Johns", ["Newfoundland"] = "America/St_Johns",
    };

    private static readonly Dictionary<string, string> AuStateTz = new(StringComparer.OrdinalIgnoreCase)
    {
        ["NSW"] = "Australia/Sydney", ["New South Wales"] = "Australia/Sydney",
        ["ACT"] = "Australia/Sydney", ["Australian Capital Territory"] = "Australia/Sydney",
        ["VIC"] = "Australia/Melbourne", ["Victoria"] = "Australia/Melbourne",
        ["QLD"] = "Australia/Brisbane", ["Queensland"] = "Australia/Brisbane",
        ["SA"] = "Australia/Adelaide", ["South Australia"] = "Australia/Adelaide",
        ["WA"] = "Australia/Perth", ["Western Australia"] = "Australia/Perth",
        ["TAS"] = "Australia/Hobart", ["Tasmania"] = "Australia/Hobart",
        ["NT"] = "Australia/Darwin", ["Northern Territory"] = "Australia/Darwin",
    };

    public static string? CountryCode(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var s = input.Trim();
        // "City, State, Country" → last part
        if (s.Contains(',')) s = s.Split(',').Last().Trim();
        if (CountryAlias.TryGetValue(s, out var cc)) return cc;
        if (s.Length == 2 && s.All(char.IsLetter)) return s.ToUpperInvariant();
        return null;
    }

    public static string Resolve(string? country, string? state, string? city = null)
    {
        var cc = CountryCode(country);
        var st = (state ?? "").Trim();

        if (cc == null && !string.IsNullOrEmpty(st) && UsStateTz.TryGetValue(st, out var guessUs) && st.Length > 2)
            return Valid(guessUs);

        if (cc == "US" && !string.IsNullOrEmpty(st) && UsStateTz.TryGetValue(st, out var us)) return Valid(us);
        if (cc == "CA" && !string.IsNullOrEmpty(st) && CaProvTz.TryGetValue(st, out var ca)) return Valid(ca);
        if (cc == "AU" && !string.IsNullOrEmpty(st) && AuStateTz.TryGetValue(st, out var au)) return Valid(au);

        if (cc != null && CountryTz.TryGetValue(cc, out var tz)) return Valid(tz);
        return Fallback;
    }

    private static string Valid(string tz)
    {
        try { TimeZoneInfo.FindSystemTimeZoneById(tz); return tz; }
        catch { return Fallback; }
    }

    private static TimeZoneInfo Zone(string tz)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(tz); }
        catch { return TimeZoneInfo.FindSystemTimeZoneById(Fallback); }
    }

    /// <summary>ISO day (Mon=1..Sun=7) and hour in the zone.</summary>
    private static (int day, int hour) LocalParts(DateTime utc, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
        var d = (int)local.DayOfWeek;
        return (d == 0 ? 7 : d, local.Hour);
    }

    public static bool InWindow(DateTime utc, string tz, SendWindow w)
    {
        var (day, hour) = LocalParts(utc, Zone(tz));
        return w.Days.Contains(day) && hour >= w.StartHour && hour < w.EndHour;
    }

    /// <summary>Earliest moment at/after `fromUtc` inside the recipient's window, plus optional random offset.</summary>
    public static DateTime NextWindow(DateTime fromUtc, string tz, SendWindow w, bool jitter = true)
    {
        var zone = Zone(tz);
        var step = TimeSpan.FromMinutes(15);
        var t = new DateTime((long)Math.Ceiling(fromUtc.Ticks / (double)step.Ticks) * step.Ticks, DateTimeKind.Utc);
        for (int i = 0; i < 4 * 24 * 21; i++)
        {
            var (day, hour) = LocalParts(t, zone);
            if (w.Days.Contains(day) && hour >= w.StartHour && hour < w.EndHour) break;
            t = t.Add(step);
        }
        if (!jitter) return t;
        var span = Math.Max(0, (w.EndHour - w.StartHour) * 60 - 30);
        var startHour = LocalParts(t, zone).hour;
        var room = Math.Max(0, span - (startHour - w.StartHour) * 60);
        var max = Math.Min(room, 120);
        return max > 0 ? t.AddMinutes(Random.Shared.Next(0, max)) : t;
    }

    /// <summary>
    /// Builds email → (country, state, city) map from a proposal's contacts_json.
    /// Handles both flat contacts ({email, emails, country, state, city}) and
    /// nested ({lead:{...}, checkedEmails:[...]}) shapes.
    /// </summary>
    public static Dictionary<string, (string? country, string? state, string? city)> LocationsFromContactsJson(string? json)
    {
        var map = new Dictionary<string, (string?, string?, string?)>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json)) return map;
        try
        {
            using var doc = JsonDocument.Parse(json);
            Walk(doc.RootElement, map);
        }
        catch { }
        return map;
    }

    private static void Walk(JsonElement el, Dictionary<string, (string?, string?, string?)> map)
    {
        if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var x in el.EnumerateArray()) Walk(x, map);
            return;
        }
        if (el.ValueKind != JsonValueKind.Object) return;

        var src = el;
        if (el.TryGetProperty("lead", out var lead) && lead.ValueKind == JsonValueKind.Object) src = lead;

        var country = Str(src, "country");
        var state = Str(src, "state");
        var city = Str(src, "city");
        if (string.IsNullOrEmpty(country) && string.IsNullOrEmpty(state))
        {
            var loc = Str(src, "location");
            if (!string.IsNullOrEmpty(loc)) country = loc;
        }

        var emails = new List<string>();
        foreach (var o in new[] { el, src })
        {
            var e = Str(o, "email"); if (!string.IsNullOrEmpty(e)) emails.Add(e);
            foreach (var key in new[] { "emails", "checkedEmails" })
                if (o.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
                    foreach (var x in arr.EnumerateArray())
                        if (x.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(x.GetString())) emails.Add(x.GetString()!);
        }

        if (!string.IsNullOrEmpty(country) || !string.IsNullOrEmpty(state))
            foreach (var e in emails.Distinct(StringComparer.OrdinalIgnoreCase))
                if (!map.ContainsKey(e)) map[e] = (country, state, city);
    }

    private static string? Str(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in o.EnumerateObject())
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase) && p.Value.ValueKind == JsonValueKind.String)
                return p.Value.GetString()?.Trim();
        return null;
    }
}

public class SendWindow
{
    public int StartHour { get; set; } = 9;
    public int EndHour { get; set; } = 11;
    public HashSet<int> Days { get; set; } = new() { 1, 2, 3, 4, 5 };

    public static SendWindow FromSettings(IDictionary<string, string> s)
    {
        var w = new SendWindow();
        if (s.TryGetValue("send_window_start_hour", out var a) && int.TryParse(a, out var ai) && ai is >= 0 and <= 23) w.StartHour = ai;
        if (s.TryGetValue("send_window_end_hour", out var b) && int.TryParse(b, out var bi) && bi is >= 1 and <= 24) w.EndHour = bi;
        if (w.EndHour <= w.StartHour) { w.StartHour = 9; w.EndHour = 11; }
        if (s.TryGetValue("send_allowed_days", out var d) && !string.IsNullOrWhiteSpace(d))
        {
            var days = d.Split(',').Select(x => int.TryParse(x.Trim(), out var n) ? n : 0).Where(n => n is >= 1 and <= 7).ToHashSet();
            if (days.Count > 0) w.Days = days;
        }
        return w;
    }
}
