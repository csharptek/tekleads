"use client";
import { useState } from "react";
import PageHeader from "../components/PageHeader";

const TONES = ["Professional", "Casual", "Consultative", "Direct", "Curious"];
const CONTEXTS = ["Cold Outreach", "Follow-up", "Demo Request", "Partnership", "Re-engagement"];

export default function EmailGenPage() {
  const [form, setForm] = useState({
    recipientName: "",
    recipientTitle: "",
    company: "",
    industry: "",
    tone: "Professional",
    context: "Cold Outreach",
    customContext: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ subject: string; body: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 1500));
    setResult({
      subject: `Helping ${form.company || "Your Company"} Accelerate Digital Transformation`,
      body: `Hi ${form.recipientName || "[Name]"},

I came across ${form.company || "your company"} and was genuinely impressed by what you're building in the ${form.industry || "industry"} space.

At TEK, we've helped companies like yours solve [specific pain point] — reducing operational overhead by 40% while scaling their engineering capacity without proportional headcount growth.

Given your role as ${form.recipientTitle || "a leader"}, I imagine you're navigating [relevant challenge] right now. We recently helped [similar company] go from manual processes to fully automated pipelines in under 8 weeks.

Would a 20-minute call next week make sense? I'd love to share what we've built and see if there's a fit.

Best,
[Your Name]`,
    });
    setLoading(false);
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
        icon="◆"
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Config Panel */}
        <div style={{
          width: 300,
          borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
        }}>
          <div className="scroll-y" style={{ flex: 1, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="label">Recipient Info</div>

            {[
              { key: "recipientName", label: "Name", placeholder: "Sarah Chen" },
              { key: "recipientTitle", label: "Job Title", placeholder: "VP of Engineering" },
              { key: "company", label: "Company", placeholder: "Nexora Systems" },
              { key: "industry", label: "Industry", placeholder: "SaaS / Healthcare..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>{label}</div>
                <input
                  className="input"
                  style={{ fontSize: 11 }}
                  placeholder={placeholder}
                  value={(form as any)[key]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}

            <div className="divider" />
            <div className="label">Email Configuration</div>

            <div>
              <div className="label" style={{ fontSize: 9, marginBottom: 6 }}>Tone</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {TONES.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm(p => ({ ...p, tone: t }))}
                    className="chip"
                    style={{
                      cursor: "pointer",
                      ...(form.tone === t ? {
                        borderColor: "rgba(0,212,255,0.5)",
                        color: "var(--accent)",
                        background: "rgba(0,212,255,0.08)",
                      } : {}),
                    }}
                  >{t}</button>
                ))}
              </div>
            </div>

            <div>
              <div className="label" style={{ fontSize: 9, marginBottom: 6 }}>Context</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {CONTEXTS.map(c => (
                  <button
                    key={c}
                    onClick={() => setForm(p => ({ ...p, context: c }))}
                    className="chip"
                    style={{
                      cursor: "pointer",
                      ...(form.context === c ? {
                        borderColor: "rgba(0,212,255,0.5)",
                        color: "var(--accent)",
                        background: "rgba(0,212,255,0.08)",
                      } : {}),
                    }}
                  >{c}</button>
                ))}
              </div>
            </div>

            <div>
              <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>Additional Context</div>
              <textarea
                className="textarea"
                rows={3}
                style={{ fontSize: 11 }}
                placeholder="Any specific pain points, recent news about the company, or talking points..."
                value={form.customContext}
                onChange={e => setForm(p => ({ ...p, customContext: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
            <button
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ animation: "pulse-glow 1s infinite" }}>◆</span>
                  Generating...
                </span>
              ) : "◆ Generate Email"}
            </button>
          </div>
        </div>

        {/* Output */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {loading ? (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 16,
            }}>
              <div style={{ position: "relative" }}>
                <div style={{
                  width: 48, height: 48,
                  border: "2px solid var(--border)",
                  borderTop: "2px solid var(--accent)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }} />
              </div>
              <div style={{ fontFamily: "Syne, sans-serif", fontSize: 14, color: "var(--text-muted)" }}>
                Retrieving portfolio context...
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>RAG · Azure AI Search · OpenAI</div>
            </div>
          ) : result ? (
            <div className="fade-in scroll-y" style={{ flex: 1, padding: 28 }}>
              <div style={{ maxWidth: 680 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div className="label">Generated Email</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" style={{ fontSize: 10 }} onClick={copyToClipboard}>
                      {copied ? "✓ Copied" : "Copy"}
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 10 }} onClick={handleGenerate}>
                      ↻ Regenerate
                    </button>
                  </div>
                </div>

                <div className="card" style={{ padding: "14px 18px", marginBottom: 12 }}>
                  <div className="label" style={{ fontSize: 9, marginBottom: 6 }}>Subject Line</div>
                  <div style={{
                    fontFamily: "Syne, sans-serif",
                    fontSize: 14, fontWeight: 600,
                    color: "var(--text)",
                  }}>{result.subject}</div>
                </div>

                <div className="card" style={{ padding: "16px 18px" }}>
                  <div className="label" style={{ fontSize: 9, marginBottom: 12 }}>Email Body</div>
                  <pre style={{
                    fontFamily: "DM Mono, monospace",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    lineHeight: 1.9,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}>{result.body}</pre>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button className="btn btn-primary" style={{ fontSize: 10 }}>
                    ◉ Send via Outreach
                  </button>
                  <button className="btn" style={{ fontSize: 10 }}>Edit Draft</button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              color: "var(--text-dim)",
            }}>
              <div style={{ fontSize: 36, marginBottom: 12, color: "var(--border-bright)" }}>◆</div>
              <div style={{ fontFamily: "Syne, sans-serif", fontSize: 14, marginBottom: 6, color: "var(--text-muted)" }}>
                Configure & Generate
              </div>
              <div style={{ fontSize: 11, maxWidth: 260, textAlign: "center", lineHeight: 1.6 }}>
                Fill in recipient details and click generate to create a personalized email using your portfolio context
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
