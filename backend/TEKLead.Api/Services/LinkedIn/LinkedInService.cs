using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services.LinkedIn;

/// <summary>
/// LinkedIn comments (daily round robin over Saved Contacts) and Conversations (comment → reply flow).
/// Only reads existing tables (saved_leads etc.); all writes go to li_* tables.
/// </summary>
public class LinkedInService
{
    private readonly SettingsService _settings;
    private readonly LiSettingsService _li;
    private readonly LiClaudeClient _ai;
    private readonly LiContextService _ctx;
    private readonly ILogger<LinkedInService> _log;

    public LinkedInService(SettingsService settings, LiSettingsService li, LiClaudeClient ai, LiContextService ctx, ILogger<LinkedInService> log)
    {
        _settings = settings; _li = li; _ai = ai; _ctx = ctx; _log = log;
    }

    private NpgsqlConnection Conn() => new(_settings.ConnectionString);

    private static readonly string[] OpenStatuses = { "queued", "batching", "drafted", "failed" };
    public static readonly string[] Stages = { "accepted", "replied", "meeting", "nurture", "lost" };
    private static readonly string[] Actions = { "reply_thread", "move_to_dm", "ask_call", "follow_up", "stop" };

    // ── Schema ───────────────────────────────────────────────────────────────

    public async Task EnsureSchema()
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS li_people_state (
                lead_id UUID PRIMARY KEY,
                accepted_at TIMESTAMPTZ,
                stage TEXT NOT NULL DEFAULT '',
                removed BOOLEAN NOT NULL DEFAULT FALSE,
                removed_reason TEXT,
                skip_until TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

            CREATE TABLE IF NOT EXISTS li_engagements (
                id SERIAL PRIMARY KEY,
                lead_id UUID NOT NULL,
                source TEXT NOT NULL DEFAULT 'comments',
                post_url TEXT,
                post_text TEXT,
                comment TEXT,
                status TEXT NOT NULL DEFAULT 'drafted',
                problems TEXT,
                context_used TEXT,
                error TEXT,
                batch_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                done_at TIMESTAMPTZ);
            CREATE INDEX IF NOT EXISTS li_engagements_lead_idx ON li_engagements (lead_id, status, done_at);
            CREATE INDEX IF NOT EXISTS li_engagements_status_idx ON li_engagements (status);

            CREATE TABLE IF NOT EXISTS li_convo_replies (
                id SERIAL PRIMARY KEY,
                lead_id UUID NOT NULL,
                channel TEXT NOT NULL DEFAULT 'comment',
                their_text TEXT NOT NULL,
                suggestion TEXT,
                dm_text TEXT,
                action TEXT,
                reason TEXT,
                my_reply TEXT,
                posted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
            CREATE INDEX IF NOT EXISTS li_convo_replies_lead_idx ON li_convo_replies (lead_id, created_at);

            CREATE TABLE IF NOT EXISTS li_edits (
                id SERIAL PRIMARY KEY,
                kind TEXT NOT NULL,
                lead_id UUID,
                original TEXT NOT NULL DEFAULT '',
                posted TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

            CREATE TABLE IF NOT EXISTS li_reminders (
                id SERIAL PRIMARY KEY,
                lead_id UUID NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                due_at TIMESTAMPTZ NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

            CREATE TABLE IF NOT EXISTS li_batches (
                id SERIAL PRIMARY KEY,
                batch_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress',
                item_count INT NOT NULL DEFAULT 0,
                ref_ids TEXT[] NOT NULL DEFAULT '{}',
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ended_at TIMESTAMPTZ);");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// <summary>Today 00:00 IST, as UTC.</summary>
    private static DateTime IstDayStartUtc()
    {
        var ist = DateTime.UtcNow.AddHours(5.5);
        return new DateTime(ist.Year, ist.Month, ist.Day, 0, 0, 0, DateTimeKind.Utc).AddHours(-5.5);
    }

    private const string PersonCols = @"
        s.id AS ""LeadId"", s.name AS ""Name"", s.title AS ""Title"", s.company AS ""Company"", s.industry AS ""Industry"",
        s.location AS ""Location"", s.linkedin_url AS ""LinkedinUrl"", s.photo_url AS ""PhotoUrl"", s.headline AS ""Headline"",
        s.saved_at AS ""SavedAt"", st.accepted_at AS ""AcceptedAt"", COALESCE(st.stage, '') AS ""Stage"",
        e.last_done AS ""LastCommentAt"", COALESCE(e.n, 0)::int AS ""CommentCount"", (b.lead_id IS NOT NULL) AS ""HasBrief""";

    private const string PersonJoins = @"
        FROM saved_leads s
        LEFT JOIN li_people_state st ON st.lead_id = s.id
        LEFT JOIN LATERAL (SELECT max(x.done_at) AS last_done, count(*) AS n FROM li_engagements x WHERE x.lead_id = s.id AND x.status = 'done') e ON true
        LEFT JOIN li_person_briefs b ON b.lead_id = s.id";

    private const string EngCols = @"id AS ""Id"", lead_id AS ""LeadId"", source AS ""Source"", post_url AS ""PostUrl"", post_text AS ""PostText"",
        comment AS ""Comment"", status AS ""Status"", problems AS ""Problems"", context_used AS ""ContextUsed"", error AS ""Error"",
        created_at AS ""CreatedAt"", done_at AS ""DoneAt""";

    private const string ReplyCols = @"id AS ""Id"", lead_id AS ""LeadId"", channel AS ""Channel"", their_text AS ""TheirText"", suggestion AS ""Suggestion"",
        dm_text AS ""DmText"", action AS ""Action"", reason AS ""Reason"", my_reply AS ""MyReply"", posted_at AS ""PostedAt"", created_at AS ""CreatedAt""";

    private static string CompanyBlock(Dictionary<string, string> s, bool withProof)
    {
        var sb = new StringBuilder();
        sb.AppendLine("COMPANY (Csharptek):");
        sb.AppendLine(s.GetValueOrDefault(LiSettingsService.CompanyPitch, ""));
        sb.AppendLine();
        sb.AppendLine("NOT FOR:");
        sb.AppendLine(s.GetValueOrDefault(LiSettingsService.NotFor, ""));
        if (withProof && !string.IsNullOrWhiteSpace(s.GetValueOrDefault(LiSettingsService.Proof)))
        {
            sb.AppendLine();
            sb.AppendLine("PROOF (general):");
            sb.AppendLine(s[LiSettingsService.Proof]);
        }
        sb.AppendLine();
        sb.Append("BANNED WORDS: ").Append(s.GetValueOrDefault(LiSettingsService.BannedWords, ""));
        return sb.ToString();
    }

    private async Task<string> EditsBlock(NpgsqlConnection c, string kind, Guid leadId)
    {
        var rows = (await c.QueryAsync<(string Original, string Posted)>(@"SELECT original AS ""Original"", posted AS ""Posted"" FROM li_edits
            WHERE kind = @kind AND (lead_id IS NULL OR lead_id <> @leadId) ORDER BY created_at DESC LIMIT 5", new { kind, leadId })).ToList();
        if (rows.Count == 0) return "";
        return "EDITS — STYLE ONLY (other people, other topics). Copy how Bhanu rewrites (length, tone, what he cuts); never reuse their topics:\n" +
            string.Join("\n---\n", rows.Select(r => $"SUGGESTED: {Cut(r.Original, 350)}\nPOSTED: {Cut(r.Posted, 350)}"));
    }

    private static string Cut(string? s, int n) => string.IsNullOrEmpty(s) ? "" : (s.Length > n ? s[..n] : s);

    private async Task UpsertState(NpgsqlConnection c, Guid leadId, string setSql, object args)
    {
        await c.ExecuteAsync($@"INSERT INTO li_people_state (lead_id) VALUES (@leadId) ON CONFLICT (lead_id) DO NOTHING;
            UPDATE li_people_state SET {setSql}, updated_at = NOW() WHERE lead_id = @leadId;", args);
    }

    // ── Comments page ────────────────────────────────────────────────────────

    public async Task<LiCommentsState> CommentsState(int newPage)
    {
        var s = await _li.GetAll();
        var start = LiSettingsService.StartAtUtc(s);
        var perPage = LiSettingsService.Int(s, LiSettingsService.NewPerPage, 25, 1, 200);
        var oldPerDay = LiSettingsService.Int(s, LiSettingsService.OldPerDay, 25, 0, 200);
        var gap = LiSettingsService.Int(s, LiSettingsService.OldGapDays, 7, 1, 90);
        var dayStart = IstDayStartUtc();
        newPage = Math.Max(1, newPage);

        await using var c = Conn();
        await c.OpenAsync();

        var res = new LiCommentsState { NewPerPage = perPage, OldPerDay = oldPerDay };
        res.DoneToday = await c.ExecuteScalarAsync<int>(
            "SELECT count(*)::int FROM li_engagements WHERE status = 'done' AND source = 'comments' AND done_at >= @dayStart", new { dayStart });

        // Old already done today: their first done comment was before today.
        var oldDoneToday = await c.ExecuteScalarAsync<int>(@"SELECT count(DISTINCT x.lead_id)::int FROM li_engagements x
            WHERE x.status = 'done' AND x.source = 'comments' AND x.done_at >= @dayStart
              AND EXISTS (SELECT 1 FROM li_engagements y WHERE y.lead_id = x.lead_id AND y.status = 'done' AND y.done_at < @dayStart)", new { dayStart });

        res.InProgress = (await c.QueryAsync<LiEngagement>($@"SELECT {EngCols} FROM li_engagements en
            WHERE en.source = 'comments' AND en.status = ANY(@open)
              AND NOT EXISTS (SELECT 1 FROM li_people_state st WHERE st.lead_id = en.lead_id AND (st.accepted_at IS NOT NULL OR st.removed))
            ORDER BY en.created_at DESC", new { open = OpenStatuses })).ToList();

        var ids = res.InProgress.Select(e => e.LeadId).Distinct().ToArray();
        if (ids.Length > 0)
            res.InProgressPeople = (await c.QueryAsync<LiPerson>($"SELECT {PersonCols} {PersonJoins} WHERE s.id = ANY(@ids)", new { ids })).ToList();

        const string eligible = @"
            WHERE s.saved_at >= @start
              AND COALESCE(s.linkedin_url, '') <> ''
              AND st.accepted_at IS NULL
              AND COALESCE(st.removed, FALSE) = FALSE
              AND (st.skip_until IS NULL OR st.skip_until < NOW())
              AND NOT EXISTS (SELECT 1 FROM li_engagements o WHERE o.lead_id = s.id AND o.status = ANY(@open))";

        res.NewTotal = await c.ExecuteScalarAsync<int>($"SELECT count(*)::int {PersonJoins} {eligible} AND COALESCE(e.n, 0) = 0",
            new { start, open = OpenStatuses });
        res.NewPeople = (await c.QueryAsync<LiPerson>($@"SELECT {PersonCols} {PersonJoins} {eligible} AND COALESCE(e.n, 0) = 0
            ORDER BY s.saved_at DESC LIMIT @lim", new { start, open = OpenStatuses, lim = perPage * newPage })).ToList();

        var gapCut = DateTime.UtcNow.AddDays(-gap);
        res.OldTotal = await c.ExecuteScalarAsync<int>($"SELECT count(*)::int {PersonJoins} {eligible} AND COALESCE(e.n, 0) > 0 AND e.last_done < @gapCut",
            new { start, open = OpenStatuses, gapCut });
        var oldLimit = Math.Max(0, oldPerDay - oldDoneToday);
        if (oldLimit > 0)
            res.OldPeople = (await c.QueryAsync<LiPerson>($@"SELECT {PersonCols} {PersonJoins} {eligible} AND COALESCE(e.n, 0) > 0 AND e.last_done < @gapCut
                ORDER BY e.last_done ASC LIMIT @lim", new { start, open = OpenStatuses, gapCut, lim = oldLimit })).ToList();

        return res;
    }

    // ── Comment drafting (sync) ──────────────────────────────────────────────

    private (LiCall call, string postText) CommentCall(Dictionary<string, string> s, LiPersonContext ctx, string postText, string edits)
    {
        var prompt = string.Join("\n\n", new[]
        {
            edits,
            $"THEIR POST:\n{Cut(postText, 3500)}",
        }.Where(x => !string.IsNullOrWhiteSpace(x)));
        var call = new LiCall
        {
            Kind = "li_comment",
            Rules = s.GetValueOrDefault(LiSettingsService.CommentPrompt, LiPrompts.Comment),
            CompanyBlock = CompanyBlock(s, false),
            PersonBlock = ctx.Block,
            Turns = new() { ("user", prompt) },
            MaxTokens = 400,
        };
        return (call, postText);
    }

    /// <summary>Runs checks, asks Claude to fix up to 2 times (same cached prefix). Returns (comment, problems).</summary>
    private async Task<(string comment, List<string> problems)> FixComment(LiCall call, string first, string postText, string banned)
    {
        var comment = LiClaudeClient.Str(LiClaudeClient.ParseJson(first), "comment");
        if (string.IsNullOrWhiteSpace(comment)) comment = first.Trim().Trim('"');
        var bad = LiChecks.Comment(comment, postText, banned);
        for (var i = 0; i < 2 && bad.Count > 0; i++)
        {
            call.Turns.Add(("assistant", JsonSerializer.Serialize(new { comment })));
            call.Turns.Add(("user", "The checker rejected it. Fix every problem and return the same JSON:\n- " + string.Join("\n- ", bad)));
            var fixedText = await _ai.Send(call);
            var nc = LiClaudeClient.Str(LiClaudeClient.ParseJson(fixedText), "comment");
            if (!string.IsNullOrWhiteSpace(nc))
            {
                comment = nc;
                bad = LiChecks.Comment(comment, postText, banned);
            }
        }
        return (comment, bad);
    }

    public async Task<LiEngagement> DraftComment(LiDraftCommentReq req)
    {
        var postText = (req.PostText ?? "").Trim();
        if (postText.Length < 30) throw new Exception("Paste the post text (at least a few lines)");
        var source = req.Source == "conversations" ? "conversations" : "comments";
        var ctx = await _ctx.Build(req.LeadId) ?? throw new Exception("Contact not found");
        var s = await _li.GetAll();
        var banned = s.GetValueOrDefault(LiSettingsService.BannedWords, "");

        await using var c = Conn();
        await c.OpenAsync();
        var edits = await EditsBlock(c, "comment", req.LeadId);
        var (call, _) = CommentCall(s, ctx, postText, edits);
        var first = await _ai.Send(call);
        var (comment, problems) = await FixComment(call, first, postText, banned);
        if (string.IsNullOrWhiteSpace(comment)) throw new Exception("No comment returned, try again");

        // One open draft per person per page.
        await c.ExecuteAsync("DELETE FROM li_engagements WHERE lead_id = @leadId AND source = @source AND status = ANY(@open)",
            new { leadId = req.LeadId, source, open = OpenStatuses });
        var id = await c.ExecuteScalarAsync<int>(@"INSERT INTO li_engagements (lead_id, source, post_url, post_text, comment, status, problems, context_used)
            VALUES (@leadId, @source, @postUrl, @postText, @comment, 'drafted', @problems, @ctxUsed) RETURNING id",
            new
            {
                leadId = req.LeadId, source, postUrl = string.IsNullOrWhiteSpace(req.PostUrl) ? null : req.PostUrl!.Trim(), postText, comment,
                problems = problems.Count > 0 ? string.Join("; ", problems) : null, ctxUsed = ctx.Block,
            });
        return await c.QueryFirstAsync<LiEngagement>($"SELECT {EngCols} FROM li_engagements WHERE id = @id", new { id });
    }

    /// <summary>Queue many pasted posts for one Claude batch (worker submits within a minute).</summary>
    public async Task<int> QueueDraftAll(LiDraftAllReq req)
    {
        var n = 0;
        await using var c = Conn();
        await c.OpenAsync();
        foreach (var it in req.Items)
        {
            var post = (it.PostText ?? "").Trim();
            if (post.Length < 30) continue;
            var source = it.Source == "conversations" ? "conversations" : "comments";
            await c.ExecuteAsync("DELETE FROM li_engagements WHERE lead_id = @leadId AND source = @source AND status = ANY(@open)",
                new { leadId = it.LeadId, source, open = OpenStatuses });
            await c.ExecuteAsync(@"INSERT INTO li_engagements (lead_id, source, post_url, post_text, status) VALUES (@leadId, @source, @postUrl, @post, 'queued')",
                new { leadId = it.LeadId, source, postUrl = string.IsNullOrWhiteSpace(it.PostUrl) ? null : it.PostUrl!.Trim(), post });
            n++;
        }
        return n;
    }

    public async Task MarkDone(LiDoneReq req)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<LiEngagement>($"SELECT {EngCols} FROM li_engagements WHERE id = @id", new { id = req.Id })
            ?? throw new Exception("Not found");
        if (row.Status != "drafted") throw new Exception("Already logged");
        var posted = (req.Comment ?? "").Trim();
        var edited = posted.Length > 0 && posted != (row.Comment ?? "").Trim();
        await c.ExecuteAsync("UPDATE li_engagements SET status = 'done', done_at = NOW(), comment = @comment WHERE id = @id AND status = 'drafted'",
            new { id = req.Id, comment = edited ? posted : row.Comment });
        if (edited)
            await c.ExecuteAsync("INSERT INTO li_edits (kind, lead_id, original, posted) VALUES ('comment', @leadId, @original, @posted)",
                new { leadId = row.LeadId, original = row.Comment ?? "", posted });
    }

    public async Task SkipLead(Guid leadId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE li_engagements SET status = 'skipped', done_at = NOW() WHERE lead_id = @leadId AND source = 'comments' AND status = ANY(@open)",
            new { leadId, open = OpenStatuses });
        await UpsertState(c, leadId, "skip_until = NOW() + interval '7 days'", new { leadId });
    }

    public async Task RemoveLead(Guid leadId, string? reason)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE li_engagements SET status = 'removed', done_at = NOW() WHERE lead_id = @leadId AND status = ANY(@open)",
            new { leadId, open = OpenStatuses });
        await UpsertState(c, leadId, "removed = TRUE, removed_reason = @reason", new { leadId, reason = Cut(reason, 120) });
    }

    public async Task Accept(Guid leadId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await UpsertState(c, leadId, "accepted_at = COALESCE(accepted_at, NOW()), stage = CASE WHEN stage = '' THEN 'accepted' ELSE stage END, skip_until = NULL", new { leadId });
        // Open comment draft follows them to Conversations.
        await c.ExecuteAsync("DELETE FROM li_engagements WHERE lead_id = @leadId AND source = 'conversations' AND status = ANY(@open)", new { leadId, open = OpenStatuses });
        await c.ExecuteAsync("UPDATE li_engagements SET source = 'conversations' WHERE lead_id = @leadId AND source = 'comments' AND status = ANY(@open)", new { leadId, open = OpenStatuses });
    }

    public async Task Unaccept(Guid leadId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await UpsertState(c, leadId, "accepted_at = NULL, stage = CASE WHEN stage = 'accepted' THEN '' ELSE stage END", new { leadId });
    }

    // ── Conversations page ───────────────────────────────────────────────────

    public async Task<LiConvoPage> Conversations(string? filter, string? q, int page)
    {
        const int per = 20;
        page = Math.Max(1, page);
        filter = filter is "needs" or "waiting" ? filter : "all";
        var like = string.IsNullOrWhiteSpace(q) ? null : $"%{q.Trim().Replace("%", "").Replace("_", "")}%";

        await using var c = Conn();
        await c.OpenAsync();

        var where = new StringBuilder(@"
            WHERE (st.accepted_at IS NOT NULL OR EXISTS (SELECT 1 FROM li_convo_replies r WHERE r.lead_id = s.id))
              AND COALESCE(st.removed, FALSE) = FALSE");
        if (like != null) where.Append(" AND (s.name ILIKE @like OR s.company ILIKE @like OR s.title ILIKE @like)");
        if (filter == "needs") where.Append(" AND EXISTS (SELECT 1 FROM li_convo_replies r WHERE r.lead_id = s.id AND r.posted_at IS NULL)");
        if (filter == "waiting") where.Append(" AND NOT EXISTS (SELECT 1 FROM li_convo_replies r WHERE r.lead_id = s.id)");

        const string activity = @"GREATEST(COALESCE(st.accepted_at, 'epoch'::timestamptz), COALESCE(e.last_done, 'epoch'::timestamptz),
            COALESCE((SELECT max(r.created_at) FROM li_convo_replies r WHERE r.lead_id = s.id), 'epoch'::timestamptz))";

        var total = await c.ExecuteScalarAsync<int>($"SELECT count(*)::int {PersonJoins} {where}", new { like });
        var rows = (await c.QueryAsync<LiPersonActivity>(
            $@"SELECT {PersonCols}, {activity} AS ""Activity"" {PersonJoins} {where}
               ORDER BY {activity} DESC LIMIT @per OFFSET @off",
            new { like, per, off = (page - 1) * per })).ToList();

        var res = new LiConvoPage { Total = total, Page = page, Pages = Math.Max(1, (int)Math.Ceiling(total / (double)per)) };
        var ids = rows.Select(r => r.LeadId).ToArray();
        if (ids.Length > 0)
        {
            var engs = (await c.QueryAsync<LiEngagement>($@"SELECT {EngCols} FROM li_engagements
                WHERE lead_id = ANY(@ids) AND (status = 'done' OR (source = 'conversations' AND status = ANY(@open)))
                ORDER BY created_at ASC", new { ids, open = OpenStatuses })).ToList();
            var replies = (await c.QueryAsync<LiConvoReply>($"SELECT {ReplyCols} FROM li_convo_replies WHERE lead_id = ANY(@ids) ORDER BY created_at ASC", new { ids })).ToList();
            var rems = (await c.QueryAsync<LiReminder>(@"SELECT id AS ""Id"", lead_id AS ""LeadId"", note AS ""Note"", due_at AS ""DueAt"", status AS ""Status""
                FROM li_reminders WHERE lead_id = ANY(@ids) AND status = 'open'", new { ids })).ToList();

            foreach (var p in rows)
            {
                var thread = replies.Where(r => r.LeadId == p.LeadId).ToList();
                var last = thread.LastOrDefault();
                res.Cards.Add(new LiConvoCard
                {
                    Person = p,
                    Activity = p.Activity,
                    Comments = engs.Where(e => e.LeadId == p.LeadId && e.Status == "done").ToList(),
                    Draft = engs.LastOrDefault(e => e.LeadId == p.LeadId && e.Status != "done"),
                    Thread = thread,
                    Reminder = rems.FirstOrDefault(r => r.LeadId == p.LeadId),
                    NeedsReply = thread.Any(t => t.PostedAt == null),
                });
            }
        }

        res.DueReminders = (await c.QueryAsync<LiReminder>(@"SELECT r.id AS ""Id"", r.lead_id AS ""LeadId"", r.note AS ""Note"", r.due_at AS ""DueAt"", r.status AS ""Status"", s.name AS ""Name""
            FROM li_reminders r JOIN saved_leads s ON s.id = r.lead_id
            WHERE r.status = 'open' AND r.due_at < @tomorrow ORDER BY r.due_at", new { tomorrow = IstDayStartUtc().AddDays(1) })).ToList();
        return res;
    }

    private record Suggestion(string Reply, string Action, string Reason, string Dm, List<string> Problems);

    private async Task<Suggestion> BuildSuggestion(NpgsqlConnection c, Guid leadId, string theirText, string channel, (int Id, DateTime CreatedAt)? before)
    {
        var ctx = await _ctx.Build(leadId) ?? throw new Exception("Contact not found");
        var s = await _li.GetAll();
        var banned = s.GetValueOrDefault(LiSettingsService.BannedWords, "");

        var eng = await c.QueryFirstOrDefaultAsync<LiEngagement>($@"SELECT {EngCols} FROM li_engagements
            WHERE lead_id = @leadId AND status = 'done' ORDER BY done_at DESC NULLS LAST LIMIT 1", new { leadId });

        var histRaw = before is { } b
            ? await c.QueryAsync<LiConvoReply>($"SELECT {ReplyCols} FROM li_convo_replies WHERE lead_id = @leadId AND created_at < @at ORDER BY created_at DESC LIMIT 12", new { leadId, at = b.CreatedAt })
            : await c.QueryAsync<LiConvoReply>($"SELECT {ReplyCols} FROM li_convo_replies WHERE lead_id = @leadId ORDER BY created_at DESC LIMIT 12", new { leadId });
        var history = histRaw.Reverse().ToList();
        history = history.Where((h, i) => i == 0 || h.TheirText.Trim() != history[i - 1].TheirText.Trim()).ToList();
        var round = history.Count(h => h.Channel == channel) + 1;

        var lastMine = history.LastOrDefault(h => !string.IsNullOrWhiteSpace(h.MyReply))?.MyReply ?? "";
        if (history.Count > 0 && lastMine.Length > 0 && !lastMine.Contains('?') && LiChecks.IsSignOff(theirText))
            return new Suggestion("", "stop", "Polite closure after you closed the thread. Like it, no reply.", "", new());

        var portfolio = await _ctx.MatchPortfolio($"{ctx.Raw}\n{theirText}");
        var personBlock = ctx.Block + (portfolio.Count > 0 ? "\n\nPROOF (matching portfolio projects, use only by name and only if they asked or there is a buying signal):\n" + string.Join("\n", portfolio) : "");

        var edits = await EditsBlock(c, "reply", leadId);
        var prompt = string.Join("\n\n", new[]
        {
            $"STAGE: {(await c.ExecuteScalarAsync<string?>("SELECT stage FROM li_people_state WHERE lead_id = @leadId", new { leadId })) ?? "new"}",
            eng?.PostText != null ? $"THEIR POST:\n{Cut(eng.PostText, 1500)}" : "",
            eng?.Comment != null ? $"MY COMMENT:\n{eng.Comment}" : "",
            history.Count > 0 ? "EARLIER IN THIS CONVERSATION:\n" + string.Join("\n", history.Select((h, i) =>
                $"#{i + 1} ({h.Channel}) THEY: {Cut(h.TheirText, 500)}{(string.IsNullOrWhiteSpace(h.MyReply) ? "" : $"\nME: {Cut(h.MyReply, 500)}")}")) : "",
            edits,
            $"CHANNEL: {channel}",
            $"ROUND: {round}",
            $"THEIR NEW MESSAGE:\n{Cut(theirText, 2500)}",
        }.Where(x => !string.IsNullOrWhiteSpace(x)));

        var sources = string.Join("\n", new[] { theirText, eng?.PostText ?? "", eng?.Comment ?? "", ctx.Raw, s.GetValueOrDefault(LiSettingsService.Proof, ""), string.Join("\n", portfolio) }
            .Concat(history.Select(h => $"{h.TheirText} {h.MyReply}")));

        var call = new LiCall
        {
            Kind = "li_reply",
            Rules = s.GetValueOrDefault(LiSettingsService.ReplyPrompt, LiPrompts.Reply),
            CompanyBlock = CompanyBlock(s, true),
            PersonBlock = personBlock,
            Turns = new() { ("user", prompt) },
            MaxTokens = 700,
        };

        JsonElement? Parse(string t) => LiClaudeClient.ParseJson(t);
        List<string> Check(JsonElement? o) => LiChecks.Reply(LiClaudeClient.Str(o, "reply"), LiClaudeClient.Str(o, "dm"), LiClaudeClient.Str(o, "action"),
            round, channel, banned, sources, theirText, LiClaudeClient.Str(o, "reason"));

        var text = await _ai.Send(call);
        var outp = Parse(text);
        var bad = Check(outp);
        for (var i = 0; i < 2 && bad.Count > 0; i++)
        {
            call.Turns.Add(("assistant", text));
            call.Turns.Add(("user", "The checker rejected it. Fix every problem and return the same JSON:\n- " + string.Join("\n- ", bad)));
            var t2 = await _ai.Send(call);
            var n = Parse(t2);
            if (n != null && (LiClaudeClient.Str(n, "reply").Length > 0 || LiClaudeClient.Str(n, "action") == "stop"))
            {
                text = t2; outp = n; bad = Check(outp);
            }
        }
        var action = LiClaudeClient.Str(outp, "action");
        if (!Actions.Contains(action)) action = "reply_thread";
        return new Suggestion(LiClaudeClient.Str(outp, "reply"), action, Cut(LiClaudeClient.Str(outp, "reason"), 300), LiClaudeClient.Str(outp, "dm"), bad);
    }

    private static string? ReasonText(Suggestion sg)
    {
        var r = ((sg.Problems.Count > 0 ? $"Check before posting: {string.Join("; ", sg.Problems)}. " : "") + sg.Reason).Trim();
        return r.Length > 0 ? r : null;
    }

    public async Task LogReply(LiLogReplyReq req)
    {
        var theirText = (req.TheirText ?? "").Trim();
        if (theirText.Length < 2) throw new Exception("Paste what they wrote");
        var channel = req.Channel is "comment" or "dm" or "other" ? req.Channel : "comment";

        await using var c = Conn();
        await c.OpenAsync();
        var dup = await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM li_convo_replies WHERE lead_id = @leadId AND trim(their_text) = @theirText",
            new { leadId = req.LeadId, theirText });
        if (dup > 0) throw new Exception("Already logged: same text as an earlier message from them");

        var sg = await BuildSuggestion(c, req.LeadId, theirText, channel, null);
        if (sg.Reply.Length == 0 && sg.Action != "stop") throw new Exception("No answer returned, try again");
        var autoClose = sg.Action == "stop" && sg.Reply.Length == 0;

        await c.ExecuteAsync(@"INSERT INTO li_convo_replies (lead_id, channel, their_text, suggestion, dm_text, action, reason, my_reply, posted_at)
            VALUES (@leadId, @channel, @theirText, @suggestion, @dm, @action, @reason, @myReply, @postedAt)",
            new
            {
                leadId = req.LeadId, channel, theirText, suggestion = sg.Reply.Length > 0 ? sg.Reply : null, dm = sg.Dm.Length > 0 ? sg.Dm : null,
                action = sg.Action, reason = ReasonText(sg),
                myReply = autoClose ? "No reply needed (they closed the thread)" : null,
                postedAt = autoClose ? DateTime.UtcNow : (DateTime?)null,
            });
        await UpsertState(c, req.LeadId, "stage = CASE WHEN stage IN ('', 'accepted') THEN 'replied' ELSE stage END", new { leadId = req.LeadId });
    }

    public async Task Regenerate(int id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<LiConvoReply>($"SELECT {ReplyCols} FROM li_convo_replies WHERE id = @id", new { id })
            ?? throw new Exception("Not found");
        if (row.PostedAt != null) throw new Exception("Already replied");
        var sg = await BuildSuggestion(c, row.LeadId, row.TheirText, row.Channel, (row.Id, row.CreatedAt));
        var autoClose = sg.Action == "stop" && sg.Reply.Length == 0;
        await c.ExecuteAsync(@"UPDATE li_convo_replies SET suggestion = @suggestion, dm_text = @dm, action = @action, reason = @reason,
            my_reply = CASE WHEN @autoClose THEN 'No reply needed (they closed the thread)' ELSE my_reply END,
            posted_at = CASE WHEN @autoClose THEN NOW() ELSE posted_at END WHERE id = @id",
            new { id, suggestion = sg.Reply.Length > 0 ? sg.Reply : null, dm = sg.Dm.Length > 0 ? sg.Dm : null, action = sg.Action, reason = ReasonText(sg), autoClose });
    }

    public async Task Posted(LiPostedReq req)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<LiConvoReply>($"SELECT {ReplyCols} FROM li_convo_replies WHERE id = @id", new { id = req.Id })
            ?? throw new Exception("Not found");
        if (row.PostedAt != null) throw new Exception("Already logged");
        var text = (req.MyReply ?? "").Trim();
        var final = text.Length > 0 ? text : (row.Suggestion ?? row.DmText ?? "");
        if (final.Length == 0) throw new Exception("Nothing to log");
        await c.ExecuteAsync("UPDATE li_convo_replies SET my_reply = @final, posted_at = NOW() WHERE id = @id", new { id = req.Id, final });
        var original = row.Suggestion ?? "";
        if (original.Length > 0 && text.Length > 0 && text != original.Trim())
            await c.ExecuteAsync("INSERT INTO li_edits (kind, lead_id, original, posted) VALUES ('reply', @leadId, @original, @text)",
                new { leadId = row.LeadId, original, text });
    }

    public async Task DeleteReply(int id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM li_convo_replies WHERE id = @id", new { id });
    }

    public async Task SetStage(LiStageReq req)
    {
        if (!Stages.Contains(req.Stage)) throw new Exception("Bad stage");
        await using var c = Conn();
        await c.OpenAsync();
        await UpsertState(c, req.LeadId, "stage = @stage", new { leadId = req.LeadId, stage = req.Stage });
    }

    public async Task Remind(LiRemindReq req)
    {
        if (req.Days is not (1 or 3 or 7)) throw new Exception("Bad request");
        var due = IstDayStartUtc().AddDays(req.Days).AddHours(9); // 09:00 IST
        var note = Cut((req.Note ?? "").Trim(), 140);
        if (note.Length == 0) note = "Follow up";
        await using var c = Conn();
        await c.OpenAsync();
        var ex = await c.ExecuteScalarAsync<int?>("SELECT id FROM li_reminders WHERE lead_id = @leadId AND status = 'open' LIMIT 1", new { leadId = req.LeadId });
        if (ex is { } rid) await c.ExecuteAsync("UPDATE li_reminders SET due_at = @due, note = @note WHERE id = @rid", new { due, note, rid });
        else await c.ExecuteAsync("INSERT INTO li_reminders (lead_id, note, due_at) VALUES (@leadId, @note, @due)", new { leadId = req.LeadId, note, due });
    }

    public async Task CancelRemind(int id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE li_reminders SET status = 'cancelled' WHERE id = @id AND status = 'open'", new { id });
    }

    public async Task DoneRemind(int id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("UPDATE li_reminders SET status = 'done' WHERE id = @id AND status = 'open'", new { id });
    }

    // ── Usage ────────────────────────────────────────────────────────────────

    public async Task<object> Usage()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var day = IstDayStartUtc();
        var month = new DateTime(day.AddHours(5.5).Year, day.AddHours(5.5).Month, 1, 0, 0, 0, DateTimeKind.Utc).AddHours(-5.5);
        const string q = @"SELECT count(*)::int AS ""Calls"", COALESCE(sum(cost_usd), 0)::float8 AS ""Cost"",
            COALESCE(sum(input_tokens), 0)::bigint AS ""Input"", COALESCE(sum(output_tokens), 0)::bigint AS ""Output"",
            COALESCE(sum(cache_read_tokens), 0)::bigint AS ""CacheRead"", COALESCE(sum(cache_write_tokens), 0)::bigint AS ""CacheWrite"",
            COALESCE(sum(CASE WHEN is_batch THEN 1 ELSE 0 END), 0)::int AS ""BatchCalls""
            FROM li_ai_usage WHERE created_at >= @from";
        var today = await c.QueryFirstAsync<LiUsageRow>(q, new { from = day });
        var mon = await c.QueryFirstAsync<LiUsageRow>(q, new { from = month });
        var batches = await c.QueryAsync<(string Kind, string Status, int Items, DateTime CreatedAt)>(
            @"SELECT kind AS ""Kind"", status AS ""Status"", item_count AS ""Items"", created_at AS ""CreatedAt"" FROM li_batches ORDER BY created_at DESC LIMIT 10");
        var briefs = await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM li_person_briefs");
        return new
        {
            today, month = mon, briefs,
            batches = batches.Select(b => new { kind = b.Kind, status = b.Status, items = b.Items, createdAt = b.CreatedAt }),
        };
    }

    // ── Batch worker steps ───────────────────────────────────────────────────

    /// <summary>Submits all queued comment drafts as one Claude batch.</summary>
    public async Task<int> SubmitQueuedComments()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var queued = (await c.QueryAsync<LiEngagement>($"SELECT {EngCols} FROM li_engagements WHERE status = 'queued' ORDER BY created_at LIMIT 500")).ToList();
        if (queued.Count == 0) return 0;
        var s = await _li.GetAll();
        var items = new List<(string, LiCall)>();
        var ctxById = new Dictionary<int, string>();
        foreach (var e in queued)
        {
            var ctx = await _ctx.Build(e.LeadId);
            if (ctx == null)
            {
                await c.ExecuteAsync("UPDATE li_engagements SET status = 'failed', error = 'Contact not found' WHERE id = @id", new { id = e.Id });
                continue;
            }
            var edits = await EditsBlock(c, "comment", e.LeadId);
            var (call, _) = CommentCall(s, ctx, e.PostText ?? "", edits);
            items.Add(($"c_{e.Id}", call));
            ctxById[e.Id] = ctx.Block;
        }
        if (items.Count == 0) return 0;

        var batchId = await _ai.CreateBatch(items);
        var ids = ctxById.Keys.ToArray();
        await c.ExecuteAsync("INSERT INTO li_batches (batch_id, kind, item_count, ref_ids) VALUES (@batchId, 'comment', @n, @refs)",
            new { batchId, n = items.Count, refs = ids.Select(i => i.ToString()).ToArray() });
        foreach (var (id, block) in ctxById)
            await c.ExecuteAsync("UPDATE li_engagements SET status = 'batching', batch_id = @batchId, context_used = @block WHERE id = @id AND status = 'queued'",
                new { id, batchId, block });
        return items.Count;
    }

    /// <summary>Builds AI briefs for people on the lists who have none (or stale data). Batch, 50% cheaper.</summary>
    public async Task<int> SubmitBriefs(int limit = 100)
    {
        var s = await _li.GetAll();
        var start = LiSettingsService.StartAtUtc(s);
        await using var c = Conn();
        await c.OpenAsync();
        var inflight = (await c.QueryAsync<string>("SELECT unnest(ref_ids) FROM li_batches WHERE kind = 'brief' AND status = 'in_progress'")).ToHashSet();
        var leads = (await c.QueryAsync<Guid>(@"SELECT s.id FROM saved_leads s
            LEFT JOIN li_people_state st ON st.lead_id = s.id
            LEFT JOIN li_person_briefs b ON b.lead_id = s.id
            WHERE s.saved_at >= @start AND COALESCE(s.linkedin_url, '') <> '' AND COALESCE(st.removed, FALSE) = FALSE
              AND (b.lead_id IS NULL OR b.built_at < NOW() - interval '30 days')
            ORDER BY s.saved_at DESC LIMIT @lim", new { start, lim = limit * 2 })).Where(id => !inflight.Contains(id.ToString())).Take(limit).ToList();
        if (leads.Count == 0) return 0;

        var rules = s.GetValueOrDefault(LiSettingsService.BriefPrompt, LiPrompts.Brief);
        var items = new List<(string, LiCall)>();
        foreach (var id in leads)
        {
            var ctx = await _ctx.Build(id);
            if (ctx == null || ctx.Raw.Length < 20) continue;
            items.Add(($"b_{id:N}", new LiCall { Kind = "li_brief", Rules = rules, Turns = new() { ("user", ctx.Raw) }, MaxTokens = 300 }));
        }
        if (items.Count == 0) return 0;
        var batchId = await _ai.CreateBatch(items);
        await c.ExecuteAsync("INSERT INTO li_batches (batch_id, kind, item_count, ref_ids) VALUES (@batchId, 'brief', @n, @refs)",
            new { batchId, n = items.Count, refs = leads.Select(l => l.ToString()).ToArray() });
        return items.Count;
    }

    /// <summary>Checks in-progress batches; applies results when ended.</summary>
    public async Task PollBatches()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var open = (await c.QueryAsync<(int Id, string BatchId, string Kind)>(
            @"SELECT id AS ""Id"", batch_id AS ""BatchId"", kind AS ""Kind"" FROM li_batches WHERE status = 'in_progress' ORDER BY created_at")).ToList();
        if (open.Count == 0) return;
        var s = await _li.GetAll();
        var banned = s.GetValueOrDefault(LiSettingsService.BannedWords, "");

        foreach (var b in open)
        {
            try
            {
                var (status, url) = await _ai.GetBatch(b.BatchId);
                if (status != "ended") continue;
                var results = string.IsNullOrEmpty(url) ? new List<LiBatchResult>() : await _ai.GetBatchResults(url, b.Kind == "brief" ? "li_brief" : "li_comment");

                if (b.Kind == "brief")
                {
                    foreach (var r in results.Where(r => r.Ok && r.CustomId.StartsWith("b_")))
                    {
                        if (!Guid.TryParseExact(r.CustomId[2..], "N", out var leadId)) continue;
                        var ctx = await _ctx.Build(leadId);
                        await _ctx.SaveBrief(leadId, r.Text, ctx?.Hash ?? "");
                    }
                }
                else
                {
                    var seen = new HashSet<int>();
                    foreach (var r in results.Where(r => r.CustomId.StartsWith("c_")))
                    {
                        if (!int.TryParse(r.CustomId[2..], out var engId)) continue;
                        seen.Add(engId);
                        await ApplyCommentResult(c, engId, r, s, banned);
                    }
                    // Anything in this batch with no result: mark failed so the user can redo it.
                    await c.ExecuteAsync("UPDATE li_engagements SET status = 'failed', error = 'No result from batch' WHERE batch_id = @bid AND status = 'batching'",
                        new { bid = b.BatchId });
                }
                await c.ExecuteAsync("UPDATE li_batches SET status = 'ended', ended_at = NOW() WHERE id = @id", new { id = b.Id });
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "LinkedIn batch {Batch} poll failed", b.BatchId);
                await c.ExecuteAsync(@"UPDATE li_batches SET error = @err,
                    status = CASE WHEN created_at < NOW() - interval '26 hours' THEN 'failed' ELSE status END WHERE id = @id",
                    new { id = b.Id, err = Cut(ex.Message, 300) });
                await c.ExecuteAsync(@"UPDATE li_engagements SET status = 'failed', error = 'Batch expired, write again'
                    WHERE batch_id = @bid AND status = 'batching' AND EXISTS (SELECT 1 FROM li_batches WHERE id = @id AND status = 'failed')",
                    new { bid = b.BatchId, id = b.Id });
            }
        }
    }

    private async Task ApplyCommentResult(NpgsqlConnection c, int engId, LiBatchResult r, Dictionary<string, string> s, string banned)
    {
        var e = await c.QueryFirstOrDefaultAsync<LiEngagement>($"SELECT {EngCols} FROM li_engagements WHERE id = @id", new { id = engId });
        if (e == null || e.Status != "batching") return;
        if (!r.Ok)
        {
            await c.ExecuteAsync("UPDATE li_engagements SET status = 'failed', error = @err WHERE id = @id", new { id = engId, err = Cut(r.Error, 300) });
            return;
        }
        try
        {
            var ctx = await _ctx.Build(e.LeadId);
            var edits = await EditsBlock(c, "comment", e.LeadId);
            var (call, _) = CommentCall(s, ctx ?? new LiPersonContext(), e.PostText ?? "", edits);
            var (comment, problems) = await FixComment(call, r.Text, e.PostText ?? "", banned);
            await c.ExecuteAsync("UPDATE li_engagements SET status = 'drafted', comment = @comment, problems = @problems, error = NULL WHERE id = @id",
                new { id = engId, comment, problems = problems.Count > 0 ? string.Join("; ", problems) : null });
        }
        catch (Exception ex)
        {
            await c.ExecuteAsync("UPDATE li_engagements SET status = 'failed', error = @err WHERE id = @id", new { id = engId, err = Cut(ex.Message, 300) });
        }
    }
}

public class LiPersonActivity : LiPerson
{
    public DateTime Activity { get; set; }
}

public class LiUsageRow
{
    public int Calls { get; set; }
    public double Cost { get; set; }
    public long Input { get; set; }
    public long Output { get; set; }
    public long CacheRead { get; set; }
    public long CacheWrite { get; set; }
    public int BatchCalls { get; set; }
}
