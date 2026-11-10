"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Values = Record<string, string>;
interface UsageRow { calls: number; cost: number; input: number; output: number; cacheRead: number; cacheWrite: number; batchCalls: number; }
interface Usage { today: UsageRow; month: UsageRow; briefs: number; batches: { kind: string; status: string; items: number; createdAt: string }[]; }

const NUMBERS: [string, string][] = [
  ["li_new_per_page", "New contacts per page (Load more adds this many)"],
  ["li_old_per_day", "Round-robin (commented before) per day"],
  ["li_old_gap_days", "Days before someone comes back in round robin"],
];
const TEXTS: [string, string, number][] = [
  ["li_company_pitch", "Company pitch (used in replies/DMs)", 3],
  ["li_proof", "Proof lines (one per line, used only on buying signals)", 4],
  ["li_not_for", "Not for (stop the conversation)", 2],
  ["li_banned_words", "Banned words (comma separated)", 2],
];
const PROMPTS: [string, string][] = [
  ["li_comment_prompt", "Comment prompt"],
  ["li_reply_prompt", "Reply / next step prompt"],
  ["li_brief_prompt", "Person brief prompt (batch)"],
];

export default function LinkedInSettingsView() {
  const [values, setValues] = useState<Values>({});
  const [defaults, setDefaults] = useState<Values>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.get<{ values: Values; defaults: Values }>("/api/linkedin/settings");
      setValues(r.values); setDefaults(r.defaults);
      setUsage(await api.get<Usage>("/api/linkedin/usage"));
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const set = (k: string, v: string) => setValues(x => ({ ...x, [k]: v }));
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const save = async () => {
    setSaving(true); setErr("");
    // Values equal to the built-in default are stored blank, so future default updates still apply.
    const payload = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k === "li_start_at" ? v : (v === defaults[k] ? "" : v)]));
    try { await api.post("/api/linkedin/settings", { values: payload }); flash("Saved"); }
    catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const startLocal = (() => {
    const v = values["li_start_at"];
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  })();

  const row = (u?: UsageRow) => u
    ? `${u.calls} calls · $${u.cost.toFixed(3)} · in ${u.input.toLocaleString()} / out ${u.output.toLocaleString()} · cache read ${u.cacheRead.toLocaleString()} · cache write ${u.cacheWrite.toLocaleString()} · ${u.batchCalls} batch`
    : "";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">LinkedIn Settings</h1>
          <div className="page-sub">Limits, company context and prompts for LinkedIn Comments and Conversations. Uses the Claude API key from Settings.</div>
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>

      <div className="page-content">
        {err && <div className="banner banner-error">{err}</div>}
        {msg && <div className="banner banner-success">{msg}</div>}

        <div className="card">
          <div className="card-title">AI usage (Claude, cached + batch)</div>
          <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
            <div><b>Today:</b> {row(usage?.today)}</div>
            <div><b>This month:</b> {row(usage?.month)}</div>
            <div><b>Person briefs built:</b> {usage?.briefs ?? 0}</div>
          </div>
          {usage && usage.batches.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              Recent batches: {usage.batches.map(b => `${b.kind} ${b.items} (${b.status})`).join(" · ")}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={async () => {
              try { const r = await api.post<{ submitted: number }>("/api/linkedin/briefs/build", {}); flash(`${r.submitted} briefs submitted to batch`); load(); }
              catch (e: any) { setErr(e.message); }
            }}>Build briefs now</button>
            <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Lists</div>
          <div className="grid-2">
            {NUMBERS.map(([k, l]) => (
              <div key={k}>
                <div className="field-label">{l}</div>
                <input className="input" type="number" min={1} value={values[k] ?? ""} onChange={e => set(k, e.target.value)} />
              </div>
            ))}
            <div>
              <div className="field-label">Show Saved Contacts saved after</div>
              <input className="input" type="datetime-local" value={startLocal}
                onChange={e => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) set("li_start_at", d.toISOString()); }} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">AI model and cost</div>
          <div className="grid-3">
            <div>
              <div className="field-label">Claude model (blank = model from Settings)</div>
              <input className="input" placeholder="claude-sonnet-5" value={values["li_claude_model"] ?? ""} onChange={e => set("li_claude_model", e.target.value)} />
            </div>
            <div>
              <div className="field-label">Input price $ / M tokens</div>
              <input className="input" value={values["li_price_in"] ?? ""} onChange={e => set("li_price_in", e.target.value)} />
            </div>
            <div>
              <div className="field-label">Output price $ / M tokens</div>
              <input className="input" value={values["li_price_out"] ?? ""} onChange={e => set("li_price_out", e.target.value)} />
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" checked={(values["li_brief_batch_enabled"] ?? "true") !== "false"}
              onChange={e => set("li_brief_batch_enabled", e.target.checked ? "true" : "false")} />
            Build person briefs automatically every 30 minutes (batch, 50% cheaper)
          </label>
        </div>

        <div className="card">
          <div className="card-title">Company context</div>
          {TEXTS.map(([k, l, rows]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div className="field-label">{l}</div>
              <textarea className="input" rows={rows} value={values[k] ?? ""} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Prompts</div>
          {PROMPTS.map(([k, l]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <div className="field-label">
                <span>{l}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => set(k, defaults[k] ?? "")}>Reset to default</button>
              </div>
              <textarea className="input" rows={10} style={{ fontFamily: "monospace", fontSize: 12 }} value={values[k] ?? ""} onChange={e => set(k, e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
