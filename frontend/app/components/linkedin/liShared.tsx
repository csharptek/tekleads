"use client";
import { useState } from "react";

export interface LiPerson {
  leadId: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  linkedinUrl?: string | null;
  photoUrl?: string | null;
  headline?: string | null;
  savedAt: string;
  acceptedAt?: string | null;
  stage: string;
  lastCommentAt?: string | null;
  commentCount: number;
  hasBrief: boolean;
}

export interface LiEngagement {
  id: number;
  leadId: string;
  source: string;
  postUrl?: string | null;
  postText?: string | null;
  comment?: string | null;
  status: string;
  problems?: string | null;
  contextUsed?: string | null;
  error?: string | null;
  createdAt: string;
  doneAt?: string | null;
}

export interface LiConvoReply {
  id: number;
  leadId: string;
  channel: string;
  theirText: string;
  suggestion?: string | null;
  dmText?: string | null;
  action?: string | null;
  reason?: string | null;
  myReply?: string | null;
  postedAt?: string | null;
  createdAt: string;
}

export interface LiReminder {
  id: number;
  leadId: string;
  note: string;
  dueAt: string;
  status: string;
  name?: string | null;
}

export function absUrl(u?: string | null): string {
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`;
}

/** LinkedIn profile → recent activity page. */
export function activityUrl(u?: string | null): string {
  const a = absUrl(u);
  if (!a) return "";
  if (!/linkedin\.com\/in\//i.test(a)) return a;
  return a.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/recent-activity/all/";
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function daysAgo(iso?: string | null): string {
  if (!iso) return "";
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-secondary btn-sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? "Copied" : label}
    </button>
  );
}

export function ContextPanel({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--muted)" }}>Context used</summary>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, background: "var(--bg)", padding: 8, borderRadius: 6, marginTop: 4, maxHeight: 240, overflow: "auto" }}>{text}</pre>
    </details>
  );
}

export function PersonHeader({ p, children }: { p: LiPerson; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {p.photoUrl
        ? <img src={p.photoUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent-light)", color: "var(--accent-text)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13, flexShrink: 0 }}>{(p.name || "?").charAt(0)}</div>}
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{[p.title, p.company].filter(Boolean).join(" · ")}</div>
      </div>
      {p.linkedinUrl && (
        <a href={activityUrl(p.linkedinUrl)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open activity</a>
      )}
      {p.linkedinUrl && (
        <a href={absUrl(p.linkedinUrl)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>Profile</a>
      )}
      {children}
    </div>
  );
}

export function Problems({ text }: { text?: string | null }) {
  if (!text) return null;
  return <div className="banner banner-error" style={{ fontSize: 12, marginTop: 6 }}>Check before posting: {text}</div>;
}
