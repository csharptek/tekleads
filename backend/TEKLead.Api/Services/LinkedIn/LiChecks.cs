using System.Text.RegularExpressions;

namespace TEKLead.Api.Services.LinkedIn;

/// <summary>Deterministic checks on AI drafts. Empty list = passes.</summary>
public static class LiChecks
{
    private const RegexOptions I = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

    private static readonly Regex Opener = new(@"^\s*(that'?s (exactly|so|the right|a great|a good|spot|really|the real)|exactly\b|totally\b|absolutely\b|spot on|great (point|post|take|question)|love (this|that)|well said|so true|100%|agreed,? (and|100)|couldn'?t agree|you'?re (so )?right|this is (so|spot)|brilliant|nailed it)", I);
    private static readonly Regex Filler = new(@"\b(great post|love this|so true|thanks for sharing|insightful|well said|this is gold|is exactly what)\b", I);
    private static readonly Regex Claim = new(@"\b((a lot of|many|most|lots of|several|other) (teams|clients|companies|customers|agencies|founders|studios) (we|i) \w+|(teams|clients|companies|customers|agencies|founders) (we|i) (work|worked|partner|help|talk)\w*|our clients|our customers)\b", I);
    private static readonly Regex Jargon = new(@"\b(flywheel|game[- ]?changer|synergy|unlock(s|ing)?|leverag(e|ing)|paradigm|10x|supercharg\w*|north star|moat)\b", I);
    private static readonly Regex Pricing = new(@"\b(charge|charging|pricing|price|fees?|rates?|billing)\b", I);
    private static readonly Regex CallAsk = new(@"\b(quick (chat|call)|hop on|jump on|a call|20[- ]?min|15[- ]?min|book (a|some) time|calendar|worth a (chat|call))\b", I);
    private static readonly Regex Url = new(@"https?://[^\s)>\]]+|www\.[^\s)>\]]+", I);
    private static readonly Regex Hashtag = new(@"(^|\s)#\w+", I);
    private static readonly Regex Number = new(@"\b\d[\d,.]*%?", I);

    /// <summary>Real buying intent in their own message.</summary>
    public static readonly Regex Buying = new(@"\b(project|budget|timeline|deadline|vendor|partner(s|ing)? (with|for)|quote|proposal|cost|hire|hiring|outsourc\w*|help (us|me|with)|can you|could you|do you (build|do|offer)|what do you (do|build|offer)|looking for|need (someone|a team|help|to build)|rfp|scope)\b", I);

    /// <summary>Post announces news the comment should acknowledge. Narrow on purpose (no bare "joined"/"raised").</summary>
    public static readonly Regex Milestone = new(@"\b(acquired|acquisition|definitive agreement|merg(ed|er) with|raised (a |our |an )?(\$|seed|series|pre-seed|round|funding)|funding round|seed round|series [a-e]\b|closed (our|a) (round|seed)|(i'?m|i am|excited to|happy to|thrilled to) (be )?join(ed|ing)|new role|been promoted|promoted to|stepping into|starting (a|my) new (role|position|chapter)|we('re| are) (launching|live)|just launched)\b", I);

    public static readonly Regex ExitNews = new(@"\b(acquired by|to be acquired|definitive agreement to be acquired|signed a definitive agreement|acquisition by|merg(ed|er) with|shutting down|winding down|we are closing|ceasing operations)\b", I);

    private static readonly Regex Congrats = new(@"\b(congrat\w*|well done|big (news|step|move)|huge (news|milestone))\b", I);

    public static List<string> BannedFound(string text, string banned)
    {
        var lower = text.ToLowerInvariant();
        return banned.Split(new[] { ',', '\n', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(w => w.Length > 0 && Regex.IsMatch(lower, $@"(^|[^a-z0-9]){Regex.Escape(w.ToLowerInvariant())}([^a-z0-9]|$)"))
            .ToList();
    }

    private static List<string> NumbersNotIn(string text, string sources)
    {
        var src = sources.ToLowerInvariant();
        return Number.Matches(text).Select(m => m.Value.TrimEnd('.', ','))
            .Where(n => n.Length > 0 && !src.Contains(n.ToLowerInvariant())).Distinct().ToList();
    }

    private static string FirstChunk(string t)
    {
        var s = Regex.Split(t.Trim(), @"[.,!—–]")[0];
        return s.Length > 40 ? s[..40] : s;
    }

    public static List<string> Comment(string comment, string postText, string banned)
    {
        var o = new List<string>();
        var t = comment.Trim();
        if (t.Length == 0) return new() { "Empty" };
        if (t.Length > 320) o.Add($"{t.Length} characters, keep under 300");
        if (Regex.Matches(t, @"[.!?](\s|$)").Count > 3) o.Add("More than 3 sentences");
        if (Url.IsMatch(t)) o.Add("Contains a link");
        var b = BannedFound(t, banned);
        if (b.Count > 0) o.Add($"Banned words: {string.Join(", ", b)}");
        if (Hashtag.IsMatch(t)) o.Add("Hashtag");
        if (Opener.IsMatch(t) || Filler.IsMatch(t)) o.Add($"Praise or agreement opener/filler (\"{FirstChunk(t)}\"). Start with something real");
        var cl = Claim.Match(t);
        if (cl.Success) o.Add($"Claim about your clients (\"{cl.Value}\")");
        var j = Jargon.Match(t);
        if (j.Success) o.Add($"Jargon \"{j.Value}\"");
        if (Pricing.IsMatch(t)) o.Add("Mentions pricing");
        var nums = NumbersNotIn(t, postText);
        if (nums.Count > 0) o.Add($"Number not in their post ({string.Join(", ", nums)})");
        var ms = Milestone.Match(postText);
        if (ms.Success && !Congrats.IsMatch(t)) o.Add($"Their post announces news (\"{ms.Value}\"). Open by acknowledging it, e.g. \"Congrats …\"");
        if (t.Count(ch => ch == '?') > 1) o.Add("More than one question");
        return o;
    }

    public static List<string> Reply(string reply, string dm, string action, int round, string channel, string banned,
        string sources, string theirText, string reason)
    {
        var o = new List<string>();
        foreach (var (label, t) in new[] { ("Reply", reply), ("DM", dm) })
        {
            if (string.IsNullOrWhiteSpace(t)) continue;
            if (Url.IsMatch(t)) o.Add($"{label}: contains a link");
            var b = BannedFound(t, banned);
            if (b.Count > 0) o.Add($"{label}: banned words {string.Join(", ", b)}");
            if (Hashtag.IsMatch(t)) o.Add($"{label}: hashtag");
            if (Opener.IsMatch(t)) o.Add($"{label}: starts with agreement or praise (\"{FirstChunk(t)}\"). Start with your point instead");
            var cl = Claim.Match(t);
            if (cl.Success) o.Add($"{label}: claim about other clients/teams (\"{cl.Value}\"). Remove it");
            var j = Jargon.Match(t);
            if (j.Success) o.Add($"{label}: jargon \"{j.Value}\". Use plain words");
            if (Pricing.IsMatch(t)) o.Add($"{label}: mentions pricing");
            var nums = NumbersNotIn(t, sources);
            if (nums.Count > 0) o.Add($"{label}: number not from the conversation or proof ({string.Join(", ", nums)}). Say it without the number");
        }
        var buying = Buying.IsMatch(theirText);
        if (channel == "comment" && reply.Length > 350) o.Add($"Reply: {reply.Length} characters, keep under 350");
        if (channel == "comment" && round >= 3 && action == "reply_thread") o.Add("Round 3 or later: close the thread with one short line and use action move_to_dm with a DM");
        if ((action == "ask_call" || Regex.IsMatch(reason, "buying signal", I)) && !buying)
            o.Add("No buying signal in their message (no project, budget, timeline or request for help). Don't claim one and don't use ask_call");
        if (action == "stop" && (reply.Length > 0 || dm.Length > 0) && theirText.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length <= 12)
            o.Add("Stop after a short sign-off: leave reply and dm empty");
        if (action == "move_to_dm" && dm.Length == 0) o.Add("Action move_to_dm needs DM text");
        if (action == "move_to_dm" && dm.Length > 0 && CallAsk.IsMatch(dm) && !buying) o.Add("First DM asks for a call. Ask about their current setup instead");
        if (action == "move_to_dm" && channel == "comment" && reply.Contains('?')) o.Add("Closing thread reply should not ask a question");
        return o;
    }

    /// <summary>A short message that is only a sign-off (no ask, no intent, no question).</summary>
    public static bool IsSignOff(string text)
    {
        var t = text.Trim();
        if (t.Length == 0 || t.Contains('?') || t.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length > 12) return false;
        if (Buying.IsMatch(t)) return false;
        return !Regex.IsMatch(t, @"\b(call|talk|meet|chat|email|dm|message|send|share|show|demo|tell me|let'?s|when|monday|tuesday|wednesday|thursday|friday|next week|tomorrow|interested|keen)\b", I);
    }
}
