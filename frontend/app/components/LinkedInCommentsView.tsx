"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { ContextPanel, CopyButton, LiEngagement, LiPerson, PersonHeader, Problems, daysAgo } from "./linkedin/liShared";

interface CommentsState {
  doneToday: number;
  newTotal: number;
  oldTotal: number;
  newPerPage: number;
  oldPerDay: number;
  inProgress: LiEngagement[];
  inProgressPeople: LiPerson[];
  newPeople: LiPerson[];
  oldPeople: LiPerson[];
}

const REMOVE_REASONS = ["No recent posts", "Not a fit"];

export default function LinkedInCommentsView() {
  const [data, setData] = useState<CommentsState | null>(null);
  const [newPage, setNewPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [posts, setPosts] = useState<Record<string, { text: string; url: string }>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (page = newPage) => {
    try {
      setErr("");
      const d = await api.get<CommentsState>(`/api/linkedin/comments?newPage=${page}`);
      setData(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [newPage]);

  useEffect(() => { load(newPage); }, [newPage, load]);

  // Poll while batch drafts are pending.
  const pending = !!data?.inProgress.some(e => e.status === "queued" || e.status === "batching");
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (pending) timer.current = setInterval(() => load(), 20000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [pending, load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const act = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key); setErr("");
    try { await fn(); if (okMsg) flash(okMsg); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  };

  const setPost = (leadId: string, patch: Partial<{ text: string; url: string }>) =>
    setPosts(p => ({ ...p, [leadId]: { text: p[leadId]?.text ?? "", url: p[leadId]?.url ?? "", ...patch } }));

  const draft = (leadId: string, fallback?: { text: string; url: string }) => {
    const p = posts[leadId] ?? fallback;
    if (!p || p.text.trim().length < 30) { setErr("Paste the post text (at least a few lines)"); return; }
    act(`draft-${leadId}`, async () => {
      await api.postLong("/api/linkedin/comments/draft", { leadId, postText: p.text, postUrl: p.url, source: "comments" });
      setPosts(x => { const n = { ...x }; delete n[leadId]; return n; });
    }, "Comment ready");
  };

  const pastedCount = Object.values(posts).filter(p => p.text.trim().length >= 30).length;
  const draftAll = () => act("draft-all", async () => {
    const items = Object.entries(posts).filter(([, p]) => p.text.trim().length >= 30)
      .map(([leadId, p]) => ({ leadId, postText: p.text, postUrl: p.url, source: "comments" }));
    const r = await api.post<{ queued: number }>("/api/linkedin/comments/draft-all", { items });
    setPosts({});
    flash(`${r.queued} queued. Drafts appear in a few minutes.`);
  });

  if (loading && !data) return <div className="page"><div className="page-content"><div className="spinner spinner-dark" /></div></div>;

  const peopleById = new Map((data?.inProgressPeople ?? []).map(p => [p.leadId, p]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">LinkedIn Comments</h1>
          <div className="page-sub">
            {data?.doneToday ?? 0} posted today · {data?.newTotal ?? 0} new · {data?.oldTotal ?? 0} due again · open activity, paste a recent post, post the comment yourself
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {pastedCount > 0 && (
            <button className="btn btn-primary btn-sm" disabled={busy === "draft-all"} onClick={draftAll}>
              {busy === "draft-all" ? "Queuing…" : `Draft all ${pastedCount} (batch)`}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => load()}>Refresh</button>
        </div>
      </div>

      <div className="page-content">
        {err && <div className="banner banner-error">{err}</div>}
        {msg && <div className="banner banner-success">{msg}</div>}

        {data && data.inProgress.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 8px" }}>In progress ({data.inProgress.length})</h3>
            {data.inProgress.map(e => {
              const p = peopleById.get(e.leadId);
              if (!p) return null;
              return <DraftCard key={e.id} e={e} p={p} busy={busy} act={act} posts={posts} setPost={setPost} draft={draft} />;
            })}
          </>
        )}

        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 8px" }}>New ({data?.newTotal ?? 0})</h3>
        {data && data.newPeople.length === 0 && <div className="empty"><div className="empty-title">No new contacts</div>Contacts saved from now on appear here.</div>}
        {data?.newPeople.map(p => (
          <PersonCard key={p.leadId} p={p} busy={busy} act={act} post={posts[p.leadId]} setPost={setPost} draft={draft} />
        ))}
        {data && data.newPeople.length < data.newTotal && (
          <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
            <button className="btn btn-secondary" onClick={() => setNewPage(n => n + 1)}>
              Load more ({data.newTotal - data.newPeople.length} left)
            </button>
          </div>
        )}

        <h3 style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px" }}>
          Round robin: commented before ({data?.oldPeople.length ?? 0} today, max {data?.oldPerDay ?? 25})
        </h3>
        {data && data.oldPeople.length === 0 && <div className="empty"><div className="empty-title">Nobody due again today</div></div>}
        {data?.oldPeople.map(p => (
          <PersonCard key={p.leadId} p={p} busy={busy} act={act} post={posts[p.leadId]} setPost={setPost} draft={draft} />
        ))}
      </div>
    </div>
  );
}

type ActFn = (key: string, fn: () => Promise<unknown>, okMsg?: string) => Promise<void>;
type SetPostFn = (leadId: string, patch: Partial<{ text: string; url: string }>) => void;

function PersonActions({ p, busy, act }: { p: LiPerson; busy: string; act: ActFn }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8, alignItems: "center" }}>
      <button className="btn btn-green btn-sm" disabled={busy === `acc-${p.leadId}`}
        onClick={() => act(`acc-${p.leadId}`, () => api.post("/api/linkedin/people/accept", { leadId: p.leadId }), "Moved to Conversations")}>
        Mark accepted
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => act(`skip-${p.leadId}`, () => api.post("/api/linkedin/people/skip", { leadId: p.leadId }), "Skipped for 7 days")}>
        Skip 7 days
      </button>
      {REMOVE_REASONS.map(r => (
        <button key={r} className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
          onClick={() => { if (confirm(`Remove ${p.name} from LinkedIn lists for good?`)) act(`rm-${p.leadId}`, () => api.post("/api/linkedin/people/remove", { leadId: p.leadId, reason: r }), "Removed"); }}>
          {r}: remove
        </button>
      ))}
    </div>
  );
}

function PasteForm({ leadId, post, setPost, draft, busy, label = "Write comment" }: {
  leadId: string; post?: { text: string; url: string }; setPost: SetPostFn; draft: (id: string, fallback?: { text: string; url: string }) => void; busy: string; label?: string;
}) {
  return (
    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
      <input className="input" placeholder="Post link (optional)" value={post?.url ?? ""} onChange={e => setPost(leadId, { text: post?.text ?? "", url: e.target.value })} />
      <textarea className="input" rows={3} placeholder="Paste the text of their recent post / activity" value={post?.text ?? ""} onChange={e => setPost(leadId, { url: post?.url ?? "", text: e.target.value })} />
      <div>
        <button className="btn btn-primary btn-sm" disabled={busy === `draft-${leadId}`} onClick={() => draft(leadId, post)}>
          {busy === `draft-${leadId}` ? "Writing…" : label}
        </button>
      </div>
    </div>
  );
}

function PersonCard({ p, busy, act, post, setPost, draft }: {
  p: LiPerson; busy: string; act: ActFn; post?: { text: string; url: string }; setPost: SetPostFn; draft: (id: string, fallback?: { text: string; url: string }) => void;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <PersonHeader p={p}>
        {p.commentCount > 0
          ? <span className="chip chip-blue">{p.commentCount} comment{p.commentCount === 1 ? "" : "s"} · last {daysAgo(p.lastCommentAt)}</span>
          : <span className="chip chip-green">new · saved {daysAgo(p.savedAt)}</span>}
      </PersonHeader>
      <PasteForm leadId={p.leadId} post={post} setPost={setPost} draft={draft} busy={busy} />
      <PersonActions p={p} busy={busy} act={act} />
    </div>
  );
}

function DraftCard({ e, p, busy, act, posts, setPost, draft }: {
  e: LiEngagement; p: LiPerson; busy: string; act: ActFn; posts: Record<string, { text: string; url: string }>; setPost: SetPostFn; draft: (id: string, fallback?: { text: string; url: string }) => void;
}) {
  const [text, setText] = useState(e.comment ?? "");
  useEffect(() => { setText(e.comment ?? ""); }, [e.comment]);
  const waiting = e.status === "queued" || e.status === "batching";

  return (
    <div className="card" style={{ padding: 14, borderColor: "var(--accent)" }}>
      <PersonHeader p={p}>
        {e.postUrl && <a href={e.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>Their post</a>}
        {waiting && <span className="chip chip-orange">Drafting in batch…</span>}
        {e.status === "failed" && <span className="chip chip-red">Failed</span>}
      </PersonHeader>

      {e.postText && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--muted)" }}>Their post</summary>
          <p style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--bg)", padding: 8, borderRadius: 6, marginTop: 4 }}>{e.postText}</p>
        </details>
      )}

      {e.status === "failed" && <div className="banner banner-error" style={{ fontSize: 12, marginTop: 6 }}>{e.error || "Drafting failed"}. Paste again below.</div>}

      {e.status === "drafted" && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <textarea className="input" rows={3} value={text} onChange={ev => setText(ev.target.value)} />
          <Problems text={e.problems} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <CopyButton text={text} label="Copy comment" />
            <button className="btn btn-primary btn-sm" disabled={busy === `done-${e.id}`}
              onClick={() => act(`done-${e.id}`, () => api.post("/api/linkedin/comments/done", { id: e.id, comment: text }), "Logged")}>
              I posted it
            </button>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Edit the box to what you actually posted, then click.</span>
          </div>
          <ContextPanel text={e.contextUsed} />
        </div>
      )}

      {!waiting && (
        <details style={{ marginTop: 8 }} open={e.status === "failed"}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent)" }}>Write another</summary>
          <PasteForm leadId={p.leadId} post={posts[p.leadId] ?? { text: e.postText ?? "", url: e.postUrl ?? "" }} setPost={setPost} draft={draft} busy={busy} />
        </details>
      )}
      <PersonActions p={p} busy={busy} act={act} />
    </div>
  );
}
