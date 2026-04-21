"use client";
import { useState } from "react";
import PageHeader from "../components/PageHeader";

interface OutreachRecord {
  id: string;
  recipient: string;
  company: string;
  channel: "email" | "whatsapp";
  subject?: string;
  status: "sent" | "pending" | "failed";
  time: string;
}

const MOCK_HISTORY: OutreachRecord[] = [
  { id: "1", recipient: "Sarah Chen", company: "Nexora Systems", channel: "email", subject: "Helping Nexora Scale Engineering", status: "sent", time: "2h ago" },
  { id: "2", recipient: "Marcus Webb", company: "HealthBridge", channel: "whatsapp", status: "sent", time: "5h ago" },
  { id: "3", recipient: "James Folarin", company: "ClearBank", channel: "email", subject: "Digital Transformation at ClearBank", status: "pending", time: "1d ago" },
  { id: "4", recipient: "Lena Hoffmann", company: "EuroTech AG", channel: "email", subject: "Manufacturing Intelligence", status: "failed", time: "2d ago" },
];

export default function OutreachPage() {
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [form, setForm] = useState({ to: "", subject: "", body: "", phone: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [history] = useState<OutreachRecord[]>(MOCK_HISTORY);

  const statusColor = { sent: "var(--green)", pending: "var(--orange)", failed: "var(--red)" };
  const statusBg = { sent: "rgba(0,255,136,0.08)", pending: "rgba(255,107,53,0.08)", failed: "rgba(255,68,68,0.08)" };

  const handleSend = async () => {
    setSending(true);
    await new Promise(r => setTimeout(r, 1200));
    setSending(false);
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Outreach"
        subtitle="Send via SendGrid email or Twilio WhatsApp"
        icon="◉"
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Compose */}
        <div style={{
          width: 380,
          borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
        }}>
          {/* Channel toggle */}
          <div style={{
            display: "flex",
            borderBottom: "1px solid var(--border)",
          }}>
            {(["email", "whatsapp"] as const).map(c => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  fontFamily: "DM Mono, monospace",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: channel === c ? "var(--accent)" : "var(--text-muted)",
                  borderBottom: channel === c ? "2px solid var(--accent)" : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                {c === "email" ? "✉ Email" : "◈ WhatsApp"}
              </button>
            ))}
          </div>

          <div className="scroll-y" style={{ flex: 1, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
            {channel === "email" ? (
              <>
                <div>
                  <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>To</div>
                  <input className="input" style={{ fontSize: 11 }} placeholder="recipient@company.com" value={form.to} onChange={e => setForm(p => ({ ...p, to: e.target.value }))} />
                </div>
                <div>
                  <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>Subject</div>
                  <input className="input" style={{ fontSize: 11 }} placeholder="Email subject" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
                </div>
                <div>
                  <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>Body</div>
                  <textarea className="textarea" rows={10} style={{ fontSize: 11 }} placeholder="Email body..." value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
                </div>
              </>
            ) : (
              <>
                <div className="card" style={{ padding: "10px 12px", borderColor: "rgba(0,212,255,0.2)" }}>
                  <div style={{ fontSize: 10, color: "var(--accent)", marginBottom: 3 }}>Twilio WhatsApp</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Sends via Twilio Business API</div>
                </div>
                <div>
                  <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>Phone Number</div>
                  <input className="input" style={{ fontSize: 11 }} placeholder="+1 555 000 0000" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
                </div>
                <div>
                  <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>Message</div>
                  <textarea className="textarea" rows={8} style={{ fontSize: 11 }} placeholder="WhatsApp message..." value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
                </div>
              </>
            )}
          </div>

          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
            {sent && (
              <div className="card fade-in" style={{
                padding: "8px 12px", marginBottom: 10,
                borderColor: "rgba(0,255,136,0.3)",
                background: "rgba(0,255,136,0.05)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span className="status-dot" />
                <span style={{ fontSize: 11, color: "var(--green)" }}>Sent successfully</span>
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? "Sending..." : `Send ${channel === "email" ? "Email" : "WhatsApp"}`}
            </button>
          </div>
        </div>

        {/* History */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="label">Outreach History</div>
            <div style={{ display: "flex", gap: 6 }}>
              {Object.entries({ sent: history.filter(h => h.status === "sent").length, pending: history.filter(h => h.status === "pending").length, failed: history.filter(h => h.status === "failed").length }).map(([status, count]) => (
                <span key={status} className="chip" style={{
                  color: (statusColor as any)[status],
                  borderColor: `${(statusColor as any)[status]}44`,
                  background: (statusBg as any)[status],
                }}>
                  {count} {status}
                </span>
              ))}
            </div>
          </div>

          <div className="scroll-y" style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map(record => (
              <div key={record.id} className="card" style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: "Syne, sans-serif", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {record.recipient}
                      </span>
                      <span className="chip" style={{ fontSize: 9 }}>{record.company}</span>
                      <span className="chip" style={{
                        fontSize: 9,
                        color: record.channel === "email" ? "var(--accent)" : "var(--green)",
                        borderColor: record.channel === "email" ? "rgba(0,212,255,0.3)" : "rgba(0,255,136,0.3)",
                        background: record.channel === "email" ? "rgba(0,212,255,0.05)" : "rgba(0,255,136,0.05)",
                      }}>
                        {record.channel === "email" ? "✉ email" : "◈ whatsapp"}
                      </span>
                    </div>
                    {record.subject && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{record.subject}</div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{record.time}</div>
                  </div>
                  <span className="chip" style={{
                    fontSize: 9,
                    color: (statusColor as any)[record.status],
                    borderColor: `${(statusColor as any)[record.status]}44`,
                    background: (statusBg as any)[record.status],
                  }}>
                    {record.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
