"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { ContextPanel, CopyButton, LiConvoReply, LiEngagement, LiPerson, PersonHeader, Problems, daysAgo, fmtDate } from "./linkedin/liShared";

interface LiCard {
  person: LiPerson;
  draft?: LiEngagement | null;
  comments: LiEngagement[];
  thread: LiConvoReply[];
  needsReply: boolean;
}

interface PageState {
  doneToday: number;
  newTotal: number;
  oldTotal: number;
  newPerPage: number;
  oldPerDay: number;
  needsReply: LiCard[];
  inProgress: LiCard[];
  new: LiCard[];
  old: LiCard[];
}

type Post = { text: string; url: string };
type ActFn = (key: string, fn: () => Promise<unknown>, okMsg?: string) => Promise<void>;

const ACTION_LABEL: Record<string, string> = {
  reply_thread: "Reply in thread",
  move_to_dm: "Close thread, move to DM",
  ask_call: "Ask for a call",
  follow_up: "Follow up later",
  stop: "Stop, no further push",
};
const REMOVE_REASONS = ["No recent posts", "Not a fit"];

/** One LinkedIn page: comment on Saved Contacts' activity (daily round robin), then answer replies to your comments. */
export default function LinkedInCommentsView() {
  const [data, setData] = useState<PageState | null>(null);
  const [newPage, setNewPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [posts, setPosts] = useState<Record<string, Post>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (page = newPage) => {
    try {
      setErr("");
      setData(await api.get<PageState>(`/api/linkedin/comments?newPage=${page}`));
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [newPage]);

  useEffect(() => { load(newPage); }, [newPage, load]);

  const all = data ? [...data.needsReply, ...data.inProgress, ...data.new, ...data.old] : [];
  const pending = all.some(c => c.draft && (c.draft.status === "queued" || c.draft.status === "batching"));
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (pending) timer.current = setInterval(() => load(), 20000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [pending, load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const act: ActFn = async (key, fn, okMsg) => {
    setBusy(key); setErr("");
    try { await fn(); if (okMsg) flash(okMsg); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  };

  const setPost = (leadId: string, p: Post) => setPosts(x => ({ ...x, [leadId]: p }));
  const clearPost = (leadId: string) => setPosts(x => { const n = { ...x }; delete n[leadId]; return n; });

  const pasted = Object.entries(posts).filter(([, p]) => p.text.trim().length >= 30);
  const draftAll = () => act("draft-all", async () => {
    const items = pasted.map(([leadId, p]) => ({ leadId, postText: p.text, postUrl: p.url }));
    const r = await api.post<{ queued: number }>("/api/linkedin/comments/draft-all", { items });
    setPosts({});
    flash(`${r.queued} queued. Drafts appear in a few minutes.`);
  });

  if (loading && !data) return <div className="page"><div className="page-content"><div className="spinner spinner-dark" /></div></div>;

  const section = (title: string, cards: LiCard[], kind: string, empty?: string) => (
    <>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>{title}</h3>
      {cards.length === 0 && empty && <div className="empty"><div className="empty-title">{empty}</div></div>}
      {cards.map(c => (
        <Card key={c.person.leadId} c={c} kind={kind} busy={busy} act={act}
          post={posts[c.person.leadId]} setPost={setPost} clearPost={clearPost} />
      ))}
    </>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">LinkedIn</h1>
          <div className="page-sub">
            {data?.doneToday ?? 0} comments posted today · {data?.needsReply.length ?? 0} need a reply · {data?.newTotal ?? 0} new · {data?.oldTotal ?? 0} due again.
            Open activity, paste a post, post the comment yourself. Mark accepted when they connect.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {pasted.length > 0 && (
            <button className="btn btn-primary btn-sm" disabled={busy === "draft-all"} onClick={draftAll}>
              {busy === "draft-all" ? "Queuing…" : `Draft all ${pasted.length} (batch)`}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => load()}>Refresh</button>
        </div>
      </div>

      <div className="page-content">
        {err && <div className="banner banner-error">{err}</div>}
        {msg && <div className="banner banner-success">{msg}</div>}

        {data && data.needsReply.length > 0 && section(`Needs your reply (${data.needsReply.length})`, data.needsReply, "needs")}
        {data && data.inProgress.length > 0 && section(`Comment in progress (${data.inProgress.length})`, data.inProgress, "progress")}

        {section(`New (${data?.newTotal ?? 0})`, data?.new ?? [], "new", "No new contacts. Contacts saved from now on appear here.")}
        {data && data.new.length < data.newTotal && (
          <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
            <button className="btn btn-secondary" onClick={() => setNewPage(n => n + 1)}>Load more ({data.newTotal - data.new.length} left)</button>
          </div>
        )}

        {section(`Round robin: commented before (${data?.old.length ?? 0} today, max ${data?.oldPerDay ?? 25})`, data?.old ?? [], "old", "Nobody due again today")}
      </div>
    </div>
  );
}

function Card({ c, kind, busy, act, post, setPost, clearPost }: {
  c: LiCard; kind: string; busy: string; act: ActFn; post?: Post;
  setPost: (leadId: string, p: Post) => void; clearPost: (leadId: string) => void;
}) {
  const p = c.person;
  const d = c.draft;
  const waiting = !!d && (d.status === "queued" || d.status === "batching");
  const [text, setText] = useState(d?.comment ?? "");
  useEffect(() => { setText(d?.comment ?? ""); }, [d?.comment]);
  const pv = post ?? { text: "", url: "" };
  const hasHistory = c.comments.length > 0 || c.thread.length > 0;

  return (
    <div className="card" style={{ padding: 14, borderColor: c.needsReply ? "var(--orange)" : d ? "var(--accent)" : undefined }}>
      <PersonHeader p={p}>
        {c.needsReply && <span className="chip chip-orange">needs your reply</span>}
        {kind === "new" && <span className="chip chip-green">new · saved {daysAgo(p.savedAt)}</span>}
        {p.commentCount > 0 && <span className="chip chip-blue">{p.commentCount} comment{p.commentCount === 1 ? "" : "s"} · last {daysAgo(p.lastCommentAt)}</span>}
        {waiting && <span className="chip chip-orange">Drafting in batch…</span>}
      </PersonHeader>

      {/* History: past comments + replies */}
      {hasHistory && (
        <details style={{ marginTop: 8 }} open={c.needsReply}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
            History ({c.comments.length} comment{c.comments.length === 1 ? "" : "s"}, {c.thread.length} repl{c.thread.length === 1 ? "y" : "ies"})
          </summary>
          {c.comments.map(e => (
            <div key={e.id} style={{ fontSize: 13, background: "var(--bg)", padding: 8, borderRadius: 6, marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Your comment {fmtDate(e.doneAt)} {e.postUrl && <a href={e.postUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>their post</a>}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{e.comment}</div>
            </div>
          ))}
          {c.thread.map(t => <ThreadItem key={t.id} t={t} busy={busy} act={act} />)}
        </details>
      )}

      {/* 1. Comment on their activity */}
      {d?.status === "failed" && <div className="banner banner-error" style={{ fontSize: 12, marginTop: 8 }}>{d.error || "Drafting failed"}. Paste again.</div>}
      {d?.status === "drafted" && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {d.postText && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--muted)" }}>Their post</summary>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--bg)", padding: 8, borderRadius: 6, marginTop: 4 }}>{d.postText}</p>
            </details>
          )}
          <textarea className="input" rows={3} value={text} onChange={e => setText(e.target.value)} />
          <Problems text={d.problems} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <CopyButton text={text} label="Copy comment" />
            <button className="btn btn-primary btn-sm" disabled={busy === `done-${d.id}`}
              onClick={() => act(`done-${d.id}`, () => api.post("/api/linkedin/comments/done", { id: d.id, comment: text }), "Logged")}>
              I posted it
            </button>
            {d.postUrl && <a href={d.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>Open post</a>}
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Edit to what you actually posted, then click.</span>
          </div>
          <ContextPanel text={d.contextUsed} />
        </div>
      )}

      {!waiting && (
        <details style={{ marginTop: 8 }} open={!d && !c.needsReply}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{d?.status === "drafted" ? "Write another comment" : "Comment on their activity"}</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            <input className="input" placeholder="Post link (optional)" value={pv.url} onChange={e => setPost(p.leadId, { ...pv, url: e.target.value })} />
            <textarea className="input" rows={3} placeholder="Paste the text of their recent post / activity" value={pv.text} onChange={e => setPost(p.leadId, { ...pv, text: e.target.value })} />
            <div>
              <button className="btn btn-primary btn-sm" disabled={busy === `draft-${p.leadId}`}
                onClick={() => {
                  if (pv.text.trim().length < 30) { alert("Paste the post text (at least a few lines)"); return; }
                  act(`draft-${p.leadId}`, async () => {
                    await api.postLong("/api/linkedin/comments/draft", { leadId: p.leadId, postText: pv.text, postUrl: pv.url });
                    clearPost(p.leadId);
                  }, "Comment ready");
                }}>
                {busy === `draft-${p.leadId}` ? "Writing…" : "Get comment"}
              </button>
            </div>
          </div>
        </details>
      )}

      {/* 2. They replied to my comment */}
      {p.commentCount > 0 && <ReplyForm leadId={p.leadId} busy={busy} act={act} open={false} />}

      {/* Actions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, alignItems: "center" }}>
        <button className="btn btn-green btn-sm" disabled={busy === `acc-${p.leadId}`}
          onClick={() => { if (confirm(`${p.name} accepted? They leave this list and you handle them yourself.`)) act(`acc-${p.leadId}`, () => api.post("/api/linkedin/people/accept", { leadId: p.leadId }), "Marked accepted"); }}>
          Mark accepted
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => act(`skip-${p.leadId}`, () => api.post("/api/linkedin/people/skip", { leadId: p.leadId }), "Skipped for 7 days")}>
          Skip 7 days
        </button>
        {REMOVE_REASONS.map(r => (
          <button key={r} className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
            onClick={() => { if (confirm(`Remove ${p.name} for good?`)) act(`rm-${p.leadId}`, () => api.post("/api/linkedin/people/remove", { leadId: p.leadId, reason: r }), "Removed"); }}>
            {r}: remove
          </button>
        ))}
      </div>
    </div>
  );
}

function ThreadItem({ t, busy, act }: { t: LiConvoReply; busy: string; act: ActFn }) {
  const [text, setText] = useState(t.suggestion ?? "");
  useEffect(() => { setText(t.suggestion ?? ""); }, [t.suggestion]);

  return (
    <div style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--muted)" }}>
        <span>They replied {fmtDate(t.createdAt)}</span>
        <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", fontSize: 11 }}
          onClick={() => { if (confirm("Remove this reply and its answer from the log?")) act(`del-${t.id}`, () => api.post("/api/linkedin/conversations/delete", { id: t.id }), "Removed"); }}>
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
          {t.suggestion && (
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
          {!t.suggestion && t.action === "stop" && (
            <button className="btn btn-secondary btn-sm" disabled={busy === `p-${t.id}`}
              onClick={() => act(`p-${t.id}`, () => api.post("/api/linkedin/conversations/posted", { id: t.id, myReply: "No reply needed" }), "Closed")}>
              No reply needed
            </button>
          )}
          {t.dmText && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Suggested DM (send it yourself)</div>
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

function ReplyForm({ leadId, busy, act, open }: { leadId: string; busy: string; act: ActFn; open: boolean }) {
  const [text, setText] = useState("");
  return (
    <details style={{ marginTop: 8 }} open={open}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>They replied to my comment</summary>
      <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
        <textarea className="input" rows={3} placeholder="Paste their reply" value={text} onChange={e => setText(e.target.value)} />
        <div>
          <button className="btn btn-primary btn-sm" disabled={busy === `rep-${leadId}`}
            onClick={() => act(`rep-${leadId}`, async () => {
              await api.postLong("/api/linkedin/conversations/reply", { leadId, theirText: text });
              setText("");
            }, "Suggestion ready")}>
            {busy === `rep-${leadId}` ? "Thinking…" : "Get reply"}
          </button>
        </div>
      </div>
    </details>
  );
}
