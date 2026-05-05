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

function CardShell({ icon, title, subtitle, actions, children, loading }: {
  icon: React.ReactNode; title: string; subtitle?: string;
  actions?: React.ReactNode; children?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>{icon} {title}</div>
          {subtitle && <div style={{ fontSize: 12, color: "var(--muted)" }}>{subtitle}</div>}
        </div>
        {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
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
  onBack?: () => void;
  autoGenerate?: boolean;
};

export default function ArtifactsView({
  proposalId, proposalHeadline, clientName, clientEmail, clientPhone, onBack, autoGenerate = false,
}: ArtifactsViewProps) {
  const [artifacts, setArtifacts] = useState<Artifacts>({});
  const [generating, setGenerating] = useState<GeneratingState>({ coverLetter: false, whatsapp: false, email: false });
  const [errors, setErrors] = useState<ErrorState>({ coverLetter: "", whatsapp: "", email: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { loadExisting(); }, [proposalId]);

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
    stateKey2?: keyof Artifacts
  ) => {
    setGenerating(g => ({ ...g, [type]: true }));
    setErrors(e => ({ ...e, [type]: '' }));
    try {
      const res: any = await (api as any).postLong(`/api/artifacts/${proposalId}/generate/${endpoint}`, {});
      console.log("artifact response:", JSON.stringify(res));
      console.log("resKey:", resKey, "value:", res[resKey]);
      setArtifacts(a => {
        const u: Artifacts = { ...a, [stateKey]: res[resKey] };
        if (stateKey2 && resKey2) u[stateKey2] = res[resKey2];
        console.log("updated artifacts:", JSON.stringify(u));
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

  const sendWhatsapp = () => {
    const phone = clientPhone?.replace(/\D/g, "") || "";
    const msg = encodeURIComponent(artifacts.whatsappMessage || "");
    window.open(phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
  };

  const openEmail = () => {
    const to = clientEmail || "";
    const subject = encodeURIComponent(artifacts.emailSubject || "");
    const body = encodeURIComponent(artifacts.emailBody || "");
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank");
  };

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
        subtitle="Professional cover letter for the proposal"
        loading={generating.coverLetter}
        actions={artifacts.coverLetter ? <>
          <CopyBtn text={artifacts.coverLetter} />
          <button className="btn btn-ghost btn-sm" onClick={downloadCoverLetter}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter")} disabled={generating.coverLetter}>↺ Redo</button>
        </> : <button className="btn btn-ghost btn-sm" onClick={() => generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter")} disabled={generating.coverLetter}>Generate</button>}
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
        subtitle={clientPhone ? `Will send to ${clientPhone}` : "No phone — opens WhatsApp to enter manually"}
        loading={generating.whatsapp}
        actions={artifacts.whatsappMessage ? <>
          <CopyBtn text={artifacts.whatsappMessage} />
          <button className="btn btn-sm" onClick={sendWhatsapp} style={{ background: "#25D366", color: "white", border: "none" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Send
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage")} disabled={generating.whatsapp}>↺ Redo</button>
        </> : <button className="btn btn-ghost btn-sm" onClick={() => generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage")} disabled={generating.whatsapp}>Generate</button>}
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
        subtitle={clientEmail ? `Opens Outlook with ${clientEmail} in To field` : "Opens mail client — no email on file"}
        loading={generating.email}
        actions={artifacts.emailSubject ? <>
          <CopyBtn text={`Subject: ${artifacts.emailSubject}\n\n${artifacts.emailBody}`} />
          <button className="btn btn-sm" onClick={openEmail} style={{ background: "#0078d4", color: "white", border: "none" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Open in Outlook
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody")} disabled={generating.email}>↺ Redo</button>
        </> : <button className="btn btn-ghost btn-sm" onClick={() => generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody")} disabled={generating.email}>Generate</button>}
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
    </div>
  );
}
