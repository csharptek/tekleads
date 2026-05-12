"use client";
import React, { useState, useEffect } from "react";
import { api } from "../../lib/api";

type Artifacts = {
  coverLetter?: string;
  whatsappMessage?: string;
  emailSubject?: string;
  emailBody?: string;
  generatedAt?: string;
};

type GeneratingState = { coverLetter: boolean; whatsapp: boolean; email: boolean };
type ErrorState = { coverLetter: string; whatsapp: string; email: string };

type DefaultPrompts = { coverLetter: string; whatsapp: string; email: string };

type PromptModal = {
  type: "coverLetter" | "whatsapp" | "email";
  title: string;
  prompt: string;
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      {copied
        ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> Copied</>
        : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</>}
    </button>
  );
}

function PromptBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-ghost btn-sm" onClick={onClick} title="View / edit prompt">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      Prompt
    </button>
  );
}

function CardShell({ icon, title, subtitle, actions, children, loading }: {
  icon: React.ReactNode; title: string; subtitle?: React.ReactNode;
  actions?: React.ReactNode; children?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>{icon} {title}</div>
          {subtitle && <div style={{ fontSize: 12, color: "var(--muted)" }}>{subtitle}</div>}
        </div>
        {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>{actions}</div>}
      </div>
      {loading ? (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <span className="spinner spinner-dark" />
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>Generating...</div>
        </div>
      ) : children}
    </div>
  );
}

type ArtifactsViewProps = {
  proposalId: string;
  proposalHeadline?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  allEmails?: string[];
  allPhones?: string[];
  allEmailNames?: string[];
  allPhoneNames?: string[];
  onBack?: () => void;
  autoGenerate?: boolean;
};

export default function ArtifactsView({
  proposalId, proposalHeadline, clientName, clientEmail, clientPhone, allEmails, allPhones, allEmailNames, allPhoneNames, onBack, autoGenerate = false,
}: ArtifactsViewProps) {
  const [artifacts, setArtifacts] = useState<Artifacts>({});
  const [generating, setGenerating] = useState<GeneratingState>({ coverLetter: false, whatsapp: false, email: false });
  const [errors, setErrors] = useState<ErrorState>({ coverLetter: "", whatsapp: "", email: "" });
  const [loaded, setLoaded] = useState(false);
  const [defaultPrompts, setDefaultPrompts] = useState<DefaultPrompts>({ coverLetter: "", whatsapp: "", email: "" });
  const [customPrompts, setCustomPrompts] = useState<DefaultPrompts>({ coverLetter: "", whatsapp: "", email: "" });
  const [promptModal, setPromptModal] = useState<PromptModal | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [emailSignature, setEmailSignature] = useState("");

  // Send to All state
  const [sendInterval, setSendInterval] = useState(5);
  const [sendAllQueued, setSendAllQueued] = useState(false);
  const [sendAllJobs, setSendAllJobs] = useState<{ toEmail: string; toName: string; scheduledAt: string; sentAt?: string; status: string; error?: string }[]>([]);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get<{ values: Record<string, string> }>("/api/settings")
      .then(d => { if (d.values?.email_signature) setEmailSignature(d.values.email_signature); })
      .catch(() => {});
  }, []);

  const buildPlainSig = () => {
    const sig = emailSignature.trim();
    if (!sig) return "";
    if (sig.includes("<")) {
      // HTML: preserve href, strip tags
      return sig
        .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_m, href, text) => {
          const t = text.replace(/<[^>]+>/g, "").trim();
          return t && t !== href ? `${t}: ${href}` : href;
        })
        .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    }
    // Plain text / markdown: convert [text](url) to "text: url"
    return sig.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2").trim();
  };

  const buildMailtoBody = (body: string) => {
    const plainSig = buildPlainSig();
    return plainSig ? body + "\n\n" + plainSig : body;
  };

  useEffect(() => {
    loadExisting();
    loadDefaultPrompts();
  }, [proposalId]);

  const loadDefaultPrompts = async () => {
    try {
      const res: any = await api.get("/api/artifacts/prompts");
      setDefaultPrompts(res);
      setCustomPrompts(res); // init custom = default
    } catch { /* non-critical */ }
  };

  const loadExisting = async () => {
    let hasExisting = false;
    try {
      const res: any = await api.get(`/api/artifacts/${proposalId}`);
      if (res.coverLetter || res.whatsappMessage || res.emailSubject) {
        setArtifacts({
          coverLetter: res.coverLetter,
          whatsappMessage: res.whatsappMessage,
          emailSubject: res.emailSubject,
          emailBody: res.emailBody,
          generatedAt: res.generatedAt,
        });
        hasExisting = true;
      }
    } catch { /* none yet */ }
    setLoaded(true);
    if (autoGenerate && !hasExisting) {
      generateAll();
    }
  };

  const generateOne = async (
    type: "coverLetter" | "whatsapp" | "email",
    endpoint: string,
    resKey: string,
    stateKey: keyof Artifacts,
    resKey2?: string,
    stateKey2?: keyof Artifacts,
    customPrompt?: string
  ) => {
    setGenerating(g => ({ ...g, [type]: true }));
    setErrors(e => ({ ...e, [type]: '' }));
    const body: any = {};
    if (customPrompt) body.customPrompt = customPrompt;
    try {
      const res: any = await (api as any).postLong(`/api/artifacts/${proposalId}/generate/${endpoint}`, body);
      setArtifacts(a => {
        const u: Artifacts = { ...a, [stateKey]: res[resKey] };
        if (stateKey2 && resKey2) u[stateKey2] = res[resKey2];
        return u;
      });
    } catch (e: any) {
      setErrors(er => ({ ...er, [type]: (e as any).message }));
    } finally {
      setGenerating(g => ({ ...g, [type]: false }));
    }
  };

  const generateAll = async () => {
    await generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter");
    await generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage");
    await generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody");
  };

  const openPromptModal = (type: "coverLetter" | "whatsapp" | "email") => {
    const titles = { coverLetter: "Cover Letter Prompt", whatsapp: "WhatsApp Prompt", email: "Email Prompt" };
    const current = customPrompts[type] || defaultPrompts[type];
    setPromptDraft(current);
    setPromptModal({ type, title: titles[type], prompt: current });
  };

  const handlePromptRegenerate = () => {
    if (!promptModal) return;
    const { type } = promptModal;
    // Save custom prompt
    setCustomPrompts(p => ({ ...p, [type]: promptDraft }));
    setPromptModal(null);
    if (type === "coverLetter") generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter", undefined, undefined, promptDraft);
    if (type === "whatsapp")    generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage", undefined, undefined, promptDraft);
    if (type === "email")       generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody", promptDraft);
  };

  const handlePromptSaveOnly = () => {
    if (!promptModal) return;
    setCustomPrompts(p => ({ ...p, [promptModal.type]: promptDraft }));
    setPromptModal(null);
  };

  const resetPrompt = (type: "coverLetter" | "whatsapp" | "email") => {
    setPromptDraft(defaultPrompts[type]);
  };

  const sendWhatsapp = (phone?: string, name?: string) => {
    const targetPhone = (phone || clientPhone)?.replace(/\D/g, "") || "";
    const firstName = (name || clientName || "").split(/[\s-]+/)[0];
    const base = (artifacts.whatsappMessage || "").replace(/^Hi\s+[^,\n]+,?/i, `Hi ${firstName},`);
    const plainSig = buildPlainSig();
    const msg = encodeURIComponent(plainSig ? base + "\n\n" + plainSig : base);
    window.open(targetPhone ? `https://wa.me/${targetPhone}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
  };

  const openEmail = (email?: string, name?: string) => {
    const to = email || clientEmail || "";
    const firstName = (name || clientName || "").split(/[\s-]+/)[0];
    const body = buildMailtoBody((artifacts.emailBody || "").replace(/^Hi\s+[^,\n]+,?/i, `Hi ${firstName},`));
    const subject = encodeURIComponent(artifacts.emailSubject || "");
    const bodyEnc = encodeURIComponent(body);
    window.open(`mailto:${to}?subject=${subject}&body=${bodyEnc}`, "_blank");
  };

  const pollStatus = () => {
    api.get<any[]>(`/api/artifacts/${proposalId}/send-bulk/status`)
      .then(jobs => {
        setSendAllJobs(jobs);
        const allDone = jobs.every(j => j.status === "sent" || j.status === "failed" || j.status === "cancelled");
        if (allDone && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      })
      .catch(() => {});
  };

  const sendToAll = async () => {
    if (!allEmails || allEmails.length === 0) return;
    const recipients = allEmails.map((email, i) => ({ email, name: allEmailNames?.[i] || "" }));
    await api.post(`/api/artifacts/${proposalId}/send-bulk`, { recipients, intervalMinutes: sendInterval });
    setSendAllQueued(true);
    pollStatus();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollStatus, 5000);
  };

  const cancelSendAll = async () => {
    await api.post(`/api/artifacts/${proposalId}/send-bulk/cancel`, {});
    pollStatus();
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  React.useEffect(() => {
    // On mount, load any existing queue for this proposal
    api.get<any[]>(`/api/artifacts/${proposalId}/send-bulk/status`)
      .then(jobs => {
        if (jobs && jobs.length > 0) {
          setSendAllJobs(jobs);
          setSendAllQueued(true);
          const hasPending = jobs.some(j => j.status === "pending");
          if (hasPending) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(pollStatus, 5000);
          }
        }
      }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [proposalId]);
  const downloadCoverLetter = () => {
    const blob = new Blob([artifacts.coverLetter || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cover-letter-${proposalId.slice(0, 8)}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const preStyle: React.CSSProperties = {
    whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.7,
    color: "var(--text)", background: "var(--surface)", padding: 16,
    borderRadius: 8, border: "1px solid var(--border)", maxHeight: 380, overflowY: "auto",
  };

  const anyGenerating = generating.coverLetter || generating.whatsapp || generating.email;
  const nothingGenerated = loaded && !anyGenerating && !artifacts.coverLetter && !artifacts.whatsappMessage && !artifacts.emailSubject;

  const isCustomized = (type: "coverLetter" | "whatsapp" | "email") =>
    customPrompts[type] && customPrompts[type] !== defaultPrompts[type];

  return (
    <div className="page" style={{ paddingBottom: 40 }}>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onBack && (
              <button className="btn btn-ghost btn-sm" onClick={onBack}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                Back
              </button>
            )}
            <div className="page-title">Generated Artifacts</div>
          </div>
          <div className="page-sub">
            {proposalHeadline || `Proposal ${proposalId.slice(0, 8)}`}
            {clientName && <span> · {clientName}</span>}
          </div>
        </div>
        <button className="btn btn-primary" onClick={generateAll} disabled={anyGenerating}>
          {anyGenerating
            ? <><span className="spinner" /> Generating...</>
            : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> {loaded && (artifacts.coverLetter || artifacts.whatsappMessage || artifacts.emailSubject) ? "Regenerate All" : "Generate All"}</>}
        </button>
      </div>

      {nothingGenerated && (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" style={{ marginBottom: 12 }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>No artifacts generated yet for this proposal</div>
          <button className="btn btn-primary" onClick={generateAll}>Generate All Artifacts</button>
        </div>
      )}

      {/* Cover Letter */}
      <CardShell
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        title="Cover Letter"
        subtitle={<>Professional cover letter for the proposal{isCustomized("coverLetter") && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>● custom prompt</span>}</>}
        loading={generating.coverLetter}
        actions={<>
          <PromptBtn onClick={() => openPromptModal("coverLetter")} />
          {artifacts.coverLetter && <>
            <CopyBtn text={artifacts.coverLetter} />
            <button className="btn btn-ghost btn-sm" onClick={downloadCoverLetter}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter", undefined, undefined, customPrompts.coverLetter !== defaultPrompts.coverLetter ? customPrompts.coverLetter : undefined)} disabled={generating.coverLetter}>↺ Redo</button>
          </>}
          {!artifacts.coverLetter && <button className="btn btn-ghost btn-sm" onClick={() => generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter")} disabled={generating.coverLetter}>Generate</button>}
        </>}
      >
        {errors.coverLetter && <div className="banner banner-error">{errors.coverLetter}</div>}
        {artifacts.coverLetter
          ? <pre style={preStyle}>{artifacts.coverLetter}</pre>
          : !generating.coverLetter && <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0" }}>Not generated yet</div>}
      </CardShell>

      {/* WhatsApp */}
      <CardShell
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>}
        title="WhatsApp Message"
        subtitle={<>{clientPhone ? `Will send to ${clientPhone}` : "No phone — opens WhatsApp to enter manually"}{isCustomized("whatsapp") && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>● custom prompt</span>}</>}
        loading={generating.whatsapp}
        actions={<>
          <PromptBtn onClick={() => openPromptModal("whatsapp")} />
          {artifacts.whatsappMessage && <>
            <CopyBtn text={artifacts.whatsappMessage} />
            <button className="btn btn-sm" onClick={() => sendWhatsapp()} style={{ background: "#25D366", color: "white", border: "none" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Send
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage", undefined, undefined, customPrompts.whatsapp !== defaultPrompts.whatsapp ? customPrompts.whatsapp : undefined)} disabled={generating.whatsapp}>↺ Redo</button>
          </>}
          {!artifacts.whatsappMessage && <button className="btn btn-ghost btn-sm" onClick={() => generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage")} disabled={generating.whatsapp}>Generate</button>}
        </>}
      >
        {errors.whatsapp && <div className="banner banner-error">{errors.whatsapp}</div>}
        {artifacts.whatsappMessage
          ? <pre style={preStyle}>{artifacts.whatsappMessage}</pre>
          : !generating.whatsapp && <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0" }}>Not generated yet</div>}
      </CardShell>

      {/* Email */}
      <CardShell
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
        title="Email"
        subtitle={<>{clientEmail ? `Opens Outlook with ${clientEmail} in To field` : "Opens mail client — no email on file"}{isCustomized("email") && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>● custom prompt</span>}</>}
        loading={generating.email}
        actions={<>
          <PromptBtn onClick={() => openPromptModal("email")} />
          {artifacts.emailSubject && <>
            <CopyBtn text={`Subject: ${artifacts.emailSubject}\n\n${artifacts.emailBody}`} />
            <button className="btn btn-sm" onClick={() => openEmail()} style={{ background: "#0078d4", color: "white", border: "none" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Open in Outlook
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody", customPrompts.email !== defaultPrompts.email ? customPrompts.email : undefined)} disabled={generating.email}>↺ Redo</button>
          </>}
          {!artifacts.emailSubject && <button className="btn btn-ghost btn-sm" onClick={() => generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody")} disabled={generating.email}>Generate</button>}
        </>}
      >
        {errors.email && <div className="banner banner-error">{errors.email}</div>}
        {artifacts.emailSubject ? <>
          <div style={{ marginBottom: 8 }}>
            <div className="field-label">Subject</div>
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
              {artifacts.emailSubject}
            </div>
          </div>
          <div>
            <div className="field-label">Body</div>
            <pre style={preStyle}>{artifacts.emailBody}</pre>
          </div>
        </> : !generating.email && <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0" }}>Not generated yet</div>}
      </CardShell>

      {/* Multi-contact Send Panel */}
      {((allEmails && allEmails.length > 0) || (allPhones && allPhones.length > 0)) && (artifacts.emailSubject || artifacts.whatsappMessage) && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div className="card-title">Send to Contacts</div>
              <div className="card-sub">Open email / WhatsApp for each contact</div>
            </div>
            {allEmails && allEmails.length > 0 && artifacts.emailSubject && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Interval (min):</label>
                <select
                  value={sendInterval}
                  onChange={e => setSendInterval(Number(e.target.value))}
                  disabled={sendAllJobs.some(j => j.status === "pending")}
                  style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}
                >
                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                {sendAllJobs.some(j => j.status === "pending") ? (
                  <button className="btn btn-sm" style={{ background: "#dc3545", color: "white", border: "none" }} onClick={cancelSendAll}>
                    ✕ Cancel
                  </button>
                ) : (
                  <button className="btn btn-sm" style={{ background: "#0078d4", color: "white", border: "none" }} onClick={sendToAll}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Send to All
                  </button>
                )}
              </div>
            )}
          </div>
          {sendAllQueued && sendAllJobs.length > 0 && (
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  {sendAllJobs.every(j => j.status === "sent" || j.status === "failed" || j.status === "cancelled")
                    ? "✓ Queue complete"
                    : `Queued — backend sending every ${sendInterval} min`}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                  {sendAllJobs.filter(j => j.status === "sent").length}/{sendAllJobs.length} sent
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {sendAllJobs.map((job, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    {job.status === "pending" && <span style={{ color: "var(--muted)" }}>○</span>}
                    {job.status === "sent" && <span style={{ color: "#22c55e" }}>✓</span>}
                    {job.status === "failed" && <span style={{ color: "#ef4444" }}>✕</span>}
                    {job.status === "cancelled" && <span style={{ color: "var(--muted)" }}>–</span>}
                    <span style={{ color: "var(--text)" }}>{job.toName || job.toEmail}</span>
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>{job.toEmail}</span>
                    {job.status === "pending" && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        due {new Date(job.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {job.status === "failed" && job.error && <span style={{ color: "#ef4444", fontSize: 11 }}>{job.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {allEmails && allEmails.length > 0 && artifacts.emailSubject && (
            <div style={{ marginBottom: 12 }}>
              <div className="field-label" style={{ marginBottom: 6 }}>Email</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {allEmails.map((email, i) => {
                  const name = allEmailNames?.[i] || "";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ flex: 1 }}>
                        {name && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{name}</div>}
                        <span className="chip chip-blue" style={{ fontSize: 12 }}>{email}</span>
                      </div>
                      <button className="btn btn-sm" style={{ background: "#0078d4", color: "white", border: "none", textDecoration: "none" }}
                        onClick={() => openEmail(email, name)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        Open
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {allPhones && allPhones.length > 0 && artifacts.whatsappMessage && (
            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>WhatsApp</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {allPhones.map((phone, i) => {
                  const name = allPhoneNames?.[i] || "";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ flex: 1 }}>
                        {name && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{name}</div>}
                        <span className="chip chip-green" style={{ fontSize: 12 }}>💬 {phone}</span>
                      </div>
                      <button className="btn btn-sm" style={{ background: "#25D366", color: "white", border: "none" }}
                        onClick={() => sendWhatsapp(phone, name)}>
                        Send
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Prompt Modal */}
      {promptModal && (
        <>
          <div onClick={() => setPromptModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 300 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "min(700px, 94vw)", background: "white", borderRadius: 12,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)", zIndex: 301, display: "flex", flexDirection: "column", maxHeight: "90vh",
          }}>
            {/* Modal header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{promptModal.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Edit the system prompt sent to AI. The job post + portfolio context is appended automatically.
                </div>
              </div>
              <button className="icon-btn" onClick={() => setPromptModal(null)}>✕</button>
            </div>
            {/* Modal body */}
            <div style={{ padding: "16px 24px", flex: 1, overflowY: "auto" }}>
              <textarea
                value={promptDraft}
                onChange={e => setPromptDraft(e.target.value)}
                style={{
                  width: "100%", minHeight: 320, fontFamily: "monospace", fontSize: 13, lineHeight: 1.6,
                  padding: 14, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)",
                  color: "var(--text)", resize: "vertical", boxSizing: "border-box",
                }}
              />
              {promptDraft !== defaultPrompts[promptModal.type] && (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>● Custom prompt active</span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => resetPrompt(promptModal.type)}>
                    Reset to default
                  </button>
                </div>
              )}
            </div>
            {/* Modal footer */}
            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPromptModal(null)}>Cancel</button>
              <button className="btn btn-ghost btn-sm" onClick={handlePromptSaveOnly}>Save (no regenerate)</button>
              <button className="btn btn-primary btn-sm" onClick={handlePromptRegenerate}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                Save & Regenerate
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
