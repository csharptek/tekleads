"use client";
import React, { useState, useEffect } from "react";
import { api } from "../../lib/api";

type Artifacts = {
  coverLetter: string;
  whatsappMessage: string;
  emailSubject: string;
  emailBody: string;
  generatedAt: string;
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={copy}>
      {copied ? (
        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> Copied</>
      ) : (
        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</>
      )}
    </button>
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
  proposalId,
  proposalHeadline,
  clientName,
  clientEmail,
  clientPhone,
  onBack,
  autoGenerate = false,
}: ArtifactsViewProps) {
  const [artifacts, setArtifacts] = useState<Artifacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadOrGenerate();
  }, [proposalId]);

  const loadOrGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const res: any = await api.get(`/api/artifacts/${proposalId}`);
      setArtifacts(res);
    } catch {
      // No existing artifacts
      if (autoGenerate) {
        await generate();
      } else {
        setArtifacts(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res: any = await api.post(`/api/artifacts/${proposalId}/generate`, {});
      setArtifacts(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  };

  const sendWhatsapp = () => {
    if (!artifacts) return;
    const phone = clientPhone?.replace(/\D/g, "") || "";
    const msg = encodeURIComponent(artifacts.whatsappMessage);
    const url = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(url, "_blank");
  };

  const openEmail = () => {
    if (!artifacts) return;
    const to = clientEmail || "";
    const subject = encodeURIComponent(artifacts.emailSubject);
    const body = encodeURIComponent(artifacts.emailBody);
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank");
  };

  const downloadCoverLetter = () => {
    if (!artifacts) return;
    const blob = new Blob([artifacts.coverLetter], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cover-letter-${proposalId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page" style={{ paddingBottom: 40 }}>
      {/* Header */}
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
            {artifacts && (
              <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>
                Generated {new Date(artifacts.generatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={generate}
          disabled={generating || loading}
        >
          {generating ? (
            <><span className="spinner" /> Generating...</>
          ) : (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> {artifacts ? "Regenerate" : "Generate"}</>
          )}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Loading */}
      {(loading || generating) && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <span className="spinner spinner-dark" style={{ width: 24, height: 24 }} />
          <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>
            {generating ? "Generating cover letter, WhatsApp message & email..." : "Loading..."}
          </div>
        </div>
      )}

      {/* No artifacts yet */}
      {!loading && !generating && !artifacts && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" style={{ marginBottom: 12 }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>No artifacts generated yet</div>
          <button className="btn btn-primary" onClick={generate}>Generate Artifacts</button>
        </div>
      )}

      {/* Cards */}
      {!loading && !generating && artifacts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Cover Letter */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 2 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ marginRight: 6, verticalAlign: "middle" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Cover Letter
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Professional cover letter for the proposal</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <CopyBtn text={artifacts.coverLetter} />
                <button className="btn btn-ghost btn-sm" onClick={downloadCoverLetter}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </button>
              </div>
            </div>
            <pre style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--text)",
              background: "var(--surface)",
              padding: "16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              maxHeight: 400,
              overflowY: "auto",
            }}>
              {artifacts.coverLetter}
            </pre>
          </div>

          {/* WhatsApp */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 2 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="2" style={{ marginRight: 6, verticalAlign: "middle" }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                  WhatsApp Message
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {clientPhone ? `Will send to ${clientPhone}` : "No phone number — opens WhatsApp to enter manually"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <CopyBtn text={artifacts.whatsappMessage} />
                <button
                  className="btn btn-sm"
                  onClick={sendWhatsapp}
                  style={{ background: "#25D366", color: "white", border: "none" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                  Send on WhatsApp
                </button>
              </div>
            </div>
            <pre style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--text)",
              background: "var(--surface)",
              padding: "16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}>
              {artifacts.whatsappMessage}
            </pre>
          </div>

          {/* Email */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 2 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ marginRight: 6, verticalAlign: "middle" }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  Email
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {clientEmail ? `Opens Outlook/Mail with ${clientEmail} in To field` : "Opens mail client — no email on file"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <CopyBtn text={`Subject: ${artifacts.emailSubject}\n\n${artifacts.emailBody}`} />
                <button
                  className="btn btn-sm"
                  onClick={openEmail}
                  style={{ background: "#0078d4", color: "white", border: "none" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  Open in Outlook
                </button>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div className="field-label">Subject</div>
              <div style={{
                padding: "10px 12px",
                background: "var(--surface)",
                borderRadius: 6,
                border: "1px solid var(--border)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
              }}>
                {artifacts.emailSubject}
              </div>
            </div>
            <div>
              <div className="field-label">Body</div>
              <pre style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--text)",
                background: "var(--surface)",
                padding: "16px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                maxHeight: 300,
                overflowY: "auto",
              }}>
                {artifacts.emailBody}
              </pre>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
