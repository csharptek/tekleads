"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ContextPanel, CopyButton, LiConvoReply, LiEngagement, LiPerson, LiReminder, PersonHeader, Problems, fmtDate } from "./linkedin/liShared";

interface ConvoCard {
  person: LiPerson;
  comments: LiEngagement[];
  draft?: LiEngagement | null;
  thread: LiConvoReply[];
  reminder?: LiReminder | null;
  needsReply: boolean;
  activity: string;
}
interface ConvoPage { total: number; page: number; pages: number; cards: ConvoCard[]; dueReminders: LiReminder[]; }

const ACTION_LABEL: Record<string, string> = {
  reply_thread: "Reply in thread",
  move_to_dm: "Move to DM",
  ask_call: "Ask for a call",
  follow_up: "Follow up later",
  stop: "Stop, no further push",
};
const STAGES: [string, string][] = [["replied", "Replied"], ["meeting", "Call booked"], ["nurture", "Nurture"], ["lost", "Lost"]];

type ActFn = (key: string, fn: () => Promise<unknown>, okMsg?: string) => Promise<void>;

export default function LinkedInConversationsView() {
  const [data, setData] = useState<ConvoPage | null>(null);
  const [filter, setFilter] = useState<"all" | "needs" | "waiting">("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [openAll, setOpenAll] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setErr("");
      const d = await api.get<ConvoPage>(`/api/linkedin/conversations?f=${filter}&q=${encodeURIComponent(query)}&page=${page}`);
      setData(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [filter, query, page]);

  useEffect(() => { load(); }, [load]);

  const pending = !!data?.cards.some(c => c.draft && (c.draft.status === "queued" || c.draft.status === "batching"));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [pending, load]);

  const act: ActFn = async (key, fn, okMsg) => {
    setBusy(key); setErr("");
    try { await fn(); if (okMsg) { setMsg(okMsg); setTimeout(() => setMsg(""), 2500); } await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">LinkedIn Conversations</h1>
          <div className="page-sub">Accepted connections. Paste their activity to get a comment, paste their reply to get an answer and the next step.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpenAll(o => !o)}>{openAll ? "Collapse all" : "Expand all"}</button>
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className="page-content">
        {err && <div className="banner banner-error">{err}</div>}
        {msg && <div className="banner banner-success">{msg}</div>}

        {data && data.dueReminders.length > 0 && (
          <div className="card" style={{ padding: 12, borderColor: "var(--orange)" }}>
            <div className="card-title" style={{ fontSize: 13 }}>Reminders due</div>
            {data.dueReminders.map(r => (
              <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13, marginTop: 6 }}>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span>{r.note}</span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(r.dueAt)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => act(`rd-${r.id}`, () => api.post("/api/linkedin/reminders/done", { id: r.id }), "Done")}>Done</button>
              </div>
            ))}
          </div>
        )}

        <div className="card" style={{ padding: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(q); }} style={{ display: "flex", gap: 6, flex: "1 1 240px" }}>
            <input className="input" placeholder="Search name, company, title" value={q} onChange={e => setQ(e.target.value)} />
            <button className="btn btn-secondary btn-sm" type="submit">Search</button>
          </form>
          <div style={{ display: "flex", gap: 4 }}>
            {([["all", "All"], ["needs", "Needs reply"], ["waiting", "Waiting for them"]] as const).map(([k, l]) => (
              <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : "btn-ghost"}`} onClick={() => { setFilter(k); setPage(1); }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 8px" }}>{data?.total ?? 0} {data?.total === 1 ? "person" : "people"}</div>

        {loading && !data && <div className="spinner spinner-dark" />}
        {data && data.cards.length === 0 && (
          <div className="empty"><div className="empty-title">Nobody here yet</div>People appear after you mark them accepted on LinkedIn Comments.</div>
        )}

        {data?.cards.map(c => <Card key={c.person.leadId} c={c} busy={busy} act={act} openAll={openAll} />)}

        {data && data.pages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, margin: "12px 0" }}>
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
            <span style={{ fontSize: 13 }}>Page {data.page} of {data.pages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ c, busy, act, openAll }: { c: ConvoCard; busy: string; act: ActFn; openAll: boolean | null }) {
  const p = c.person;
  const [open, setOpen] = useState(c.needsReply || c.thread.length === 0);
  useEffect(() => { if (openAll !== null) setOpen(openAll); }, [openAll]);
  const last = c.thread[c.thread.length - 1];

  return (
    <div className="card" style={{ padding: 14, borderColor: c.needsReply ? "var(--orange)" : undefined }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}>
        <PersonHeader p={p}>
          {p.stage && <span className="chip">{p.stage}</span>}
          {c.needsReply && <span className="chip chip-orange">needs your reply</span>}
          {c.reminder && <span className="chip chip-blue">reminder {fmtDate(c.reminder.dueAt)}</span>}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{c.thread.length} msg · {fmtDate(c.activity)}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
        </PersonHeader>
        {!open && last && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Last from them: {last.theirText}</div>}
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <CommentBlock c={c} busy={busy} act={act} />

          {c.thread.map(t => <ThreadItem key={t.id} t={t} busy={busy} act={act} />)}

          <ReplyForm leadId={p.leadId} busy={busy} act={act} />

          <ReminderRow c={c} busy={busy} act={act} />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8, fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>Stage:</span>
            {STAGES.map(([s, l]) => (
              <button key={s} className={`btn btn-sm ${p.stage === s ? "btn-primary" : "btn-secondary"}`}
                onClick={() => { if (s !== "lost" || confirm(`Mark ${p.name} as lost?`)) act(`st-${p.leadId}-${s}`, () => api.post("/api/linkedin/people/stage", { leadId: p.leadId, stage: s }), `Stage: ${l}`); }}>
                {l}
              </button>
            ))}
            {p.acceptedAt && (
              <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
                onClick={() => { if (confirm("Not actually connected? They go back to the comment list.")) act(`un-${p.leadId}`, () => api.post("/api/linkedin/people/unaccept", { leadId: p.leadId }), "Moved back to Comments"); }}>
                Not actually connected
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** First option for each person: paste LinkedIn activity → comment. Repeatable. */
function CommentBlock({ c, busy, act }: { c: ConvoCard; busy: string; act: ActFn }) {
  const p = c.person;
  const d = c.draft;
  const [post, setPost] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState(d?.comment ?? "");
  useEffect(() => { setText(d?.comment ?? ""); }, [d?.comment]);
  const waiting = d && (d.status === "queued" || d.status === "batching");

  return (
    <div style={{ background: "var(--bg)", borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Comment on their activity</div>

      {c.comments.length > 0 && (
        <details style={{ marginBottom: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Your comments ({c.comments.length})</summary>
          {c.comments.slice().reverse().map(e => (
            <div key={e.id} style={{ fontSize: 13, background: "white", padding: 8, borderRadius: 6, marginTop: 4 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {fmtDate(e.doneAt)} {e.postUrl && <a href={e.postUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>their post</a>}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{e.comment}</div>
            </div>
          ))}
        </details>
      )}

      {waiting && <span className="chip chip-orange">Drafting in batch…</span>}
      {d?.status === "failed" && <div className="banner banner-error" style={{ fontSize: 12 }}>{d.error || "Drafting failed"}. Paste again.</div>}

      {d?.status === "drafted" && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          <textarea className="input" rows={3} value={text} onChange={e => setText(e.target.value)} />
          <Problems text={d.problems} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <CopyButton text={text} label="Copy comment" />
            <button className="btn btn-primary btn-sm" disabled={busy === `done-${d.id}`}
              onClick={() => act(`done-${d.id}`, () => api.post("/api/linkedin/comments/done", { id: d.id, comment: text }), "Logged")}>
              I posted it
            </button>
          </div>
          <ContextPanel text={d.contextUsed} />
        </div>
      )}

      {!waiting && (
        <div style={{ display: "grid", gap: 6 }}>
          <input className="input" placeholder="Post link (optional)" value={url} onChange={e => setUrl(e.target.value)} />
          <textarea className="input" rows={3} placeholder="Paste their LinkedIn activity / post text" value={post} onChange={e => setPost(e.target.value)} />
          <div>
            <button className="btn btn-primary btn-sm" disabled={busy === `cd-${p.leadId}`}
              onClick={() => {
                if (post.trim().length < 30) { alert("Paste the post text (at least a few lines)"); return; }
                act(`cd-${p.leadId}`, async () => {
                  await api.postLong("/api/linkedin/comments/draft", { leadId: p.leadId, postText: post, postUrl: url, source: "conversations" });
                  setPost(""); setUrl("");
                }, "Comment ready");
              }}>
              {busy === `cd-${p.leadId}` ? "Writing…" : "Get comment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadItem({ t, busy, act }: { t: LiConvoReply; busy: string; act: ActFn }) {
  const [text, setText] = useState(t.suggestion ?? t.dmText ?? "");
  useEffect(() => { setText(t.suggestion ?? t.dmText ?? ""); }, [t.suggestion, t.dmText]);

  return (
    <div style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--muted)" }}>
        <span>They wrote ({t.channel}) {fmtDate(t.createdAt)}</span>
        <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", fontSize: 11 }}
          onClick={() => { if (confirm("Remove this message and its reply from the log?")) act(`del-${t.id}`, () => api.post("/api/linkedin/conversations/delete", { id: t.id }), "Removed"); }}>
          remove
        </button>
      </div>
      <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{t.theirText}</div>

      {t.postedAt ? (
        <div style={{ background: "var(--green-light)", borderRadius: 6, padding: 8, marginTop: 6, fontSize: 13 }}>
          <div style={{ fontSize: 11, color: "var(--green)" }}>You replied {fmtDate(t.postedAt)}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{t.myReply}</div>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--accent-light)", background: "white", borderRadius: 6, padding: 8, marginTop: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 12, marginBottom: 4 }}>
            {t.action && <span className="chip chip-blue">{ACTION_LABEL[t.action] ?? t.action}</span>}
            {t.reason && <span style={{ color: "var(--muted)" }}>{t.reason}</span>}
          </div>
          {(t.suggestion || t.dmText) && (
            <div style={{ display: "grid", gap: 6 }}>
              <textarea className="input" rows={3} value={text} onChange={e => setText(e.target.value)} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <CopyButton text={text} label="Copy reply" />
                <button className="btn btn-primary btn-sm" disabled={busy === `p-${t.id}`}
                  onClick={() => act(`p-${t.id}`, () => api.post("/api/linkedin/conversations/posted", { id: t.id, myReply: text }), "Logged")}>
                  I replied
                </button>
              </div>
            </div>
          )}
          {t.suggestion && t.dmText && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Suggested DM</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg)", padding: 8, borderRadius: 6, marginTop: 2 }}>{t.dmText}</div>
              <div style={{ marginTop: 4 }}><CopyButton text={t.dmText} label="Copy DM" /></div>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} disabled={busy === `rg-${t.id}`}
            onClick={() => act(`rg-${t.id}`, () => api.postLong("/api/linkedin/conversations/regenerate", { id: t.id }), "New suggestion")}>
            {busy === `rg-${t.id}` ? "Thinking…" : "New suggestion"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReplyForm({ leadId, busy, act }: { leadId: string; busy: string; act: ActFn }) {
  const [channel, setChannel] = useState("comment");
  const [text, setText] = useState("");
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>They replied</summary>
      <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
        <select className="input" style={{ width: "auto" }} value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="comment">Comment reply</option>
          <option value="dm">DM</option>
          <option value="other">Other (call, email, WhatsApp)</option>
        </select>
        <textarea className="input" rows={3} placeholder="Paste what they wrote" value={text} onChange={e => setText(e.target.value)} />
        <div>
          <button className="btn btn-primary btn-sm" disabled={busy === `rep-${leadId}`}
            onClick={() => act(`rep-${leadId}`, async () => {
              await api.postLong("/api/linkedin/conversations/reply", { leadId, channel, theirText: text });
              setText("");
            }, "Suggestion ready")}>
            {busy === `rep-${leadId}` ? "Thinking…" : "Get reply"}
          </button>
        </div>
      </div>
    </details>
  );
}

function ReminderRow({ c, busy, act }: { c: ConvoCard; busy: string; act: ActFn }) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState("1");
  const r = c.reminder;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10, fontSize: 12 }}>
      {r ? (
        <>
          <span className="chip chip-blue">Reminder {fmtDate(r.dueAt)}: {r.note}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => act(`rc-${r.id}`, () => api.post("/api/linkedin/reminders/cancel", { id: r.id }), "Reminder removed")}>Remove</button>
        </>
      ) : (
        <>
          <input className="input" style={{ width: 220, padding: "4px 8px", fontSize: 12 }} placeholder="Remind me to… (e.g. Send DM)" maxLength={140} value={note} onChange={e => setNote(e.target.value)} />
          <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={days} onChange={e => setDays(e.target.value)}>
            <option value="1">Tomorrow</option>
            <option value="3">In 3 days</option>
            <option value="7">In 7 days</option>
          </select>
          <button className="btn btn-secondary btn-sm" disabled={busy === `rm-${c.person.leadId}`}
            onClick={() => act(`rm-${c.person.leadId}`, async () => {
              await api.post("/api/linkedin/reminders", { leadId: c.person.leadId, days: Number(days), note });
              setNote("");
            }, "Reminder set")}>
            Remind me
          </button>
        </>
      )}
    </div>
  );
}
