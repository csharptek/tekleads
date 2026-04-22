"use client";
import { useState } from "react";
import PageHeader from "../components/PageHeader";
import { post } from "../../lib/api";

const TONES = ["Professional", "Casual", "Consultative", "Direct", "Curious"];
const CONTEXTS = ["Cold Outreach", "Follow-up", "Demo Request", "Partnership", "Re-engagement"];

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
);

export default function EmailGenPage() {
  const [form, setForm] = useState({
    recipientName: "", recipientTitle: "", company: "", industry: "",
    tone: "Professional", context: "Cold Outreach", customContext: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ subject: string; body: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data: { subject: string; body: string } = await post("/api/email/generate", form);
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!result) return;
    navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="AI Email Generator"
        subtitle="RAG-powered personalized outreach using your portfolio"
        icon={ICON}
      />

      {error && (
        <div style={{ margin: "12px 20px 0", padding: "10px 14px", background: "var(--red-light)", border: "1px solid var(--red-light)", borderRadius: 8, fontSize: 12, color: "var(--red)", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Config */}
        <div style={{ width: 320, borderRight: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", flexDirection: "column" }}>
          <div className="scroll-y" style={{ flex: 1, padding: "18px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Recipient</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { key: "recipientName", label: "Name", placeholder: "Sarah Chen" },
                  { key: "recipientTitle", label: "Job Title", placeholder: "VP of Engineering" },
                  { key: "company", label: "Company", placeholder: "Nexora Systems" },
                  { key: "industry", label: "Industry", placeholder: "SaaS / Healthcare" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <div className="label">{label}</div>
                    <input
                      className="input"
                      placeholder={placeholder}
                      value={(form as any)[key]}
                      onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="divider" />

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Configuration</div>

              <div style={{ marginBottom: 14 }}>
                <div className="label">Tone</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {TONES.map(t => (
                    <button
                      key={t}
                      onClick={() => setForm(p => ({ ...p, tone: t }))}
                      className={`chip chip-interactive ${form.tone === t ? "chip-selected" : ""}`}
                    >{t}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div className="label">Context</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CONTEXTS.map(c => (
                    <button
                      key={c}
                      onClick={() => setForm(p => ({ ...p, context: c }))}
                      className={`chip chip-interactive ${form.context === c ? "chip-selected" : ""}`}
                    >{c}</button>
                  ))}
                </div>
              </div>

              <div>
                <div className="label">Additional Context</div>
                <textarea
                  className="textarea"
                  rows={4}
                  placeholder="Any pain points, recent news, or talking points..."
                  value={form.customContext}
                  onChange={e => setForm(p => ({ ...p, customContext: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleGenerate} disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {loading ? "Generating..." : "Generate Email"}
            </button>
          </div>
        </div>

        {/* Output */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {loading ? (
            <div className="empty">
              <div style={{ marginBottom: 20 }}>
                <span className="spinner spinner-dark" style={{ width: 36, height: 36, borderWidth: 3 }} />
              </div>
              <div className="empty-title">Retrieving portfolio context...</div>
              <div className="empty-sub mono" style={{ marginTop: 6 }}>RAG · Azure AI Search · OpenAI</div>
            </div>
          ) : result ? (
            <div className="fade-in scroll-y" style={{ flex: 1, padding: 32 }}>
              <div style={{ maxWidth: 760 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>Generated Email</h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-sm" onClick={copyToClipboard}>
                      {copied ? "✓ Copied" : "Copy"}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleGenerate}>Regenerate</button>
                  </div>
                </div>

                <div className="card" style={{ padding: "18px 20px", marginBottom: 14 }}>
                  <div className="label" style={{ marginBottom: 8 }}>Subject</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{result.subject}</div>
                </div>

                <div className="card" style={{ padding: "20px 22px" }}>
                  <div className="label" style={{ marginBottom: 14 }}>Body</div>
                  <pre style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--text)",
                    lineHeight: 1.8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}>{result.body}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">{ICON}</div>
              <div className="empty-title">Configure & Generate</div>
              <div className="empty-sub" style={{ maxWidth: 280, lineHeight: 1.6 }}>
                Fill in recipient details and click generate to create a personalized email using your portfolio context
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
