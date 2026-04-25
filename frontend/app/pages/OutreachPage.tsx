"use client";
import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { get, post } from "../../lib/api";

interface Lead {
  id: string;
  name: string;
  title: string;
  company: string;
  emails: string[];
  phones: string[];
}

interface OutreachRecord {
  id: string;
  leadName: string;
  channel: "email" | "whatsapp";
  subject?: string;
  body: string;
  status: "sent" | "queued" | "failed";
  sentAt: string;
}

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
);

const EmailIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
);

const WhatsAppIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);

export default function OutreachPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "info"; text: string } | null>(null);
  const [history, setHistory] = useState<OutreachRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      const data: Lead[] = await get("/api/leads");
      setLeads(data || []);
    } catch (e: any) { console.error(e.message); }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data: OutreachRecord[] = await get("/api/outreach/history");
      setHistory(data || []);
    } catch (e: any) { console.error(e.message); }
  }, []);

  useEffect(() => { loadLeads(); loadHistory(); }, [loadLeads, loadHistory]);

  const selectedLead = leads.find(l => l.id === selectedLeadId);

  const handleSend = async () => {
    if (!selectedLeadId) { setError("Select a lead first"); return; }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      if (channel === "email") {
        if (!subject || !body) { setError("Subject and body required"); setSending(false); return; }
        await post("/api/outreach/email", { leadId: selectedLeadId, subject, body });
        setResult({ type: "success", text: "Email sent via Microsoft Graph" });
        setSubject(""); setBody("");
      } else {
        if (!body) { setError("Message required"); setSending(false); return; }
        const res: { url: string; number: string } = await post("/api/outreach/whatsapp", {
          leadId: selectedLeadId,
          message: body,
        });
        // Open wa.me in new tab
        window.open(res.url, "_blank", "noopener,noreferrer");
        setResult({ type: "info", text: `WhatsApp opened for +${res.number}` });
        setBody("");
      }
      loadHistory();
      setTimeout(() => setResult(null), 4000);
    } catch (e: any) {
      setError(e.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const statusClass: Record<string, string> = { sent: "chip-green", queued: "chip-orange", failed: "chip-red" };
  const relTime = (iso: string) => {
    try {
      const diff = (Date.now() - new Date(iso).getTime()) / 1000;
      if (diff < 60) return "just now";
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch { return iso; }
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Outreach"
        subtitle="Send email via Microsoft Graph, or open WhatsApp via wa.me"
        icon={ICON}
      />

      {error && (
        <div style={{ margin: "12px 20px 0", padding: "10px 14px", background: "var(--red-light)", border: "1px solid var(--red-light)", borderRadius: 8, fontSize: 12, color: "var(--red)", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Compose */}
        <div style={{ width: 420, borderRight: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", flexDirection: "column" }}>
          <div className="tab-bar">
            <button className={`tab ${channel === "email" ? "tab-active" : ""}`} onClick={() => setChannel("email")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><EmailIcon /> Email</span>
            </button>
            <button className={`tab ${channel === "whatsapp" ? "tab-active" : ""}`} onClick={() => setChannel("whatsapp")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><WhatsAppIcon /> WhatsApp</span>
            </button>
          </div>

          <div className="scroll-y" style={{ flex: 1, padding: "18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div className="label">Lead</div>
              <select className="input" value={selectedLeadId} onChange={e => setSelectedLeadId(e.target.value)}>
                <option value="">— Select a saved lead —</option>
                {leads.map(l => (
                  <option key={l.id} value={l.id}>{l.name} — {l.company}</option>
                ))}
              </select>
              {selectedLead && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
                  {channel === "email"
                    ? (selectedLead.emails?.[0] || "⚠ No email on file")
                    : (selectedLead.phones?.[0] || "⚠ No phone on file")}
                </div>
              )}
            </div>

            {channel === "email" ? (
              <>
                <div>
                  <div className="label">Subject</div>
                  <input className="input" placeholder="Email subject" value={subject} onChange={e => setSubject(e.target.value)} />
                </div>
                <div>
                  <div className="label">Body</div>
                  <textarea className="textarea" rows={12} placeholder="Email body..." value={body} onChange={e => setBody(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="card" style={{ padding: "12px 14px", background: "var(--accent-light)", borderColor: "var(--accent-light)" }}>
                  <div style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 600, marginBottom: 2 }}>wa.me Deep Link</div>
                  <div style={{ fontSize: 11, color: "var(--accent-text)", opacity: 0.8 }}>Opens WhatsApp Web/app with pre-filled message. You click Send inside WhatsApp.</div>
                </div>
                <div>
                  <div className="label">Message</div>
                  <textarea className="textarea" rows={10} placeholder="WhatsApp message..." value={body} onChange={e => setBody(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
            {result && (
              <div className="card fade-in" style={{ padding: "10px 14px", marginBottom: 10, background: "var(--green-light)", borderColor: "var(--green-light)", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="status-dot" />
                <span style={{ fontSize: 12, color: "#166534", fontWeight: 500 }}>{result.text}</span>
              </div>
            )}
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleSend} disabled={sending || !selectedLeadId}>
              {sending ? <span className="spinner" /> : null}
              {sending ? "Processing..." : channel === "email" ? "Send Email" : "Open WhatsApp"}
            </button>
          </div>
        </div>

        {/* History */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Outreach History</h3>
          </div>

          <div className="scroll-y" style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {history.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">{ICON}</div>
                <div className="empty-title">No outreach yet</div>
                <div className="empty-sub">Send your first message to see history here</div>
              </div>
            ) : history.map(r => (
              <div key={r.id} className="card card-hover" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r.leadName}</span>
                      <span className={`chip ${r.channel === "email" ? "chip-accent" : "chip-green"}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {r.channel === "email" ? <EmailIcon /> : <WhatsAppIcon />}
                        {r.channel}
                      </span>
                    </div>
                    {r.subject && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{r.subject}</div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{relTime(r.sentAt)}</div>
                  </div>
                  <span className={`chip ${statusClass[r.status] || "chip"}`}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
