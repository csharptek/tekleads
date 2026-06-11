"use client";
import React, { useState, useEffect } from "react";
import { api } from "../../lib/api";

type UsedPortfolioItem = { title: string; industry: string; youtubeLinks: string; hasYoutubeLink: boolean; id?: string; };
type AllPortfolioItem = { id: string; title: string; industry: string; youtubeLinks: string; embeddingIndexed: boolean; };

type Artifacts = {
  coverLetter?: string;
  whatsappMessage?: string;
  emailSubject?: string;
  emailBody?: string;
  followUp1Subject?: string;
  followUp1Body?: string;
  followUp2Subject?: string;
  followUp2Body?: string;
  generatedAt?: string;
};

type GeneratingState = { coverLetter: boolean; whatsapp: boolean; email: boolean; followUp1: boolean; followUp2: boolean };
type ErrorState = { coverLetter: string; whatsapp: string; email: string; followUp1: string; followUp2: string };

type DefaultPrompts = { coverLetter: string; whatsapp: string; email: string; followUp1: string; followUp2: string };

type PromptModal = {
  type: "coverLetter" | "whatsapp" | "email" | "followUp1" | "followUp2";
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
  const [generating, setGenerating] = useState<GeneratingState>({ coverLetter: false, whatsapp: false, email: false, followUp1: false, followUp2: false });
  const [errors, setErrors] = useState<ErrorState>({ coverLetter: "", whatsapp: "", email: "", followUp1: "", followUp2: "" });
  const [usedProjects, setUsedProjects] = useState<UsedPortfolioItem[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false);
  const [allPortfolio, setAllPortfolio] = useState<AllPortfolioItem[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [defaultPrompts, setDefaultPrompts] = useState<DefaultPrompts>({ coverLetter: "", whatsapp: "", email: "", followUp1: "", followUp2: "" });
  const [customPrompts, setCustomPrompts] = useState<DefaultPrompts>({ coverLetter: "", whatsapp: "", email: "", followUp1: "", followUp2: "" });
  const [promptModal, setPromptModal] = useState<PromptModal | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [emailSignature, setEmailSignature] = useState("");

  // Send to All state
  const [sendInterval, setSendInterval] = useState(5);
  const [sendAllQueued, setSendAllQueued] = useState(false);
  const [sendAllJobs, setSendAllJobs] = useState<{ id: string; toEmail: string; toName: string; scheduledAt: string; sentAt?: string; status: string; error?: string; followUpStage?: number; subject?: string; body?: string }[]>([]);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Follow-up delays (subject/body now in artifacts state, AI-generated)
  const [fu1Delay, setFu1Delay] = useState(6);
  const [fu2Delay, setFu2Delay] = useState(12);

  // Push to Instantly state
  const [instantlyCampaigns, setInstantlyCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [instantlyError, setInstantlyError] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [pushingToInstantly, setPushingToInstantly] = useState(false);
  const [instantlyResult, setInstantlyResult] = useState<{ ok: boolean; pushed: number; failed: number; errors: string[] } | null>(null);

  useEffect(() => {
    api.get<{ values: Record<string, string> }>("/api/settings")
      .then(d => { if (d.values?.email_signature) setEmailSignature(d.values.email_signature); })
      .catch(() => {});
    
    // Load Instantly campaigns
    api.get<{ id: string; name: string }[]>("/api/instantly/campaigns")
      .then(campaigns => { setInstantlyCampaigns(campaigns); setInstantlyError(""); })
      .catch(err => { setInstantlyError(err.message); setInstantlyCampaigns([]); });
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
      const [defaults, saved] = await Promise.all([
        api.get<any>("/api/artifacts/prompts"),
        api.get<{ values: Record<string, string> }>("/api/settings"),
      ]);
      setDefaultPrompts(defaults);
      // Use saved DB prompts if set, otherwise fall back to code defaults
      const s = saved.values || {};
      setCustomPrompts({
        coverLetter: s["artifact_cover_letter_prompt"] || defaults.coverLetter,
        whatsapp:    s["artifact_whatsapp_prompt"]     || defaults.whatsapp,
        email:       s["artifact_email_prompt"]        || defaults.email,
        followUp1:   s["artifact_followup1_prompt"]    || defaults.followUp1,
        followUp2:   s["artifact_followup2_prompt"]    || defaults.followUp2,
      });
    } catch { /* non-critical */ }
  };

  const savePromptToDb = async (type: "coverLetter" | "whatsapp" | "email" | "followUp1" | "followUp2", value: string) => {
    const keyMap = {
      coverLetter: "artifact_cover_letter_prompt",
      whatsapp:    "artifact_whatsapp_prompt",
      email:       "artifact_email_prompt",
      followUp1:   "artifact_followup1_prompt",
      followUp2:   "artifact_followup2_prompt",
    };
    try {
      await api.post("/api/settings", { values: { [keyMap[type]]: value } });
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
          followUp1Subject: res.followUp1Subject,
          followUp1Body: res.followUp1Body,
          followUp2Subject: res.followUp2Subject,
          followUp2Body: res.followUp2Body,
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
    type: "coverLetter" | "whatsapp" | "email" | "followUp1" | "followUp2",
    endpoint: string,
    resKey: string,
    stateKey: keyof Artifacts,
    resKey2?: string,
    stateKey2?: keyof Artifacts,
    customPrompt?: string,
    portfolioIds?: string[]
  ) => {
    setGenerating(g => ({ ...g, [type]: true }));
    setErrors(e => ({ ...e, [type]: '' }));
    const body: any = {};
    if (customPrompt) body.customPrompt = customPrompt;
    if (portfolioIds && portfolioIds.length > 0) body.portfolioIds = portfolioIds;
    try {
      const res: any = await (api as any).postLong(`/api/artifacts/${proposalId}/generate/${endpoint}`, body);
      setArtifacts(a => {
        const u: Artifacts = { ...a, [stateKey]: res[resKey] };
        if (stateKey2 && resKey2) u[stateKey2] = res[resKey2];
        return u;
      });
      if (res.usedProjects?.length) {
        setUsedProjects(res.usedProjects);
        setCheckedIds(new Set(res.usedProjects.map((p: any) => p.id).filter(Boolean)));
      }
    } catch (e: any) {
      setErrors(er => ({ ...er, [type]: (e as any).message }));
    } finally {
      setGenerating(g => ({ ...g, [type]: false }));
    }
  };

  const openPortfolioPicker = async () => {
    setShowPortfolioPicker(true);
    setLoadingPortfolio(true);
    try {
      const res = await (api as any).get("/api/portfolio");
      setAllPortfolio(res || []);
      setPickerSelected(new Set(checkedIds));
    } catch { } finally { setLoadingPortfolio(false); }
  };

  const regenerateSelected = async (ids: string[]) => {
    const pids = ids.length > 0 ? ids : undefined;
    await generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter", undefined, undefined, undefined, pids);
    await generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage", undefined, undefined, undefined, pids);
    await generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody", undefined, pids);
  };

  const generateAll = async () => {
    await generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter");
    await generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage");
    await generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody");
  };

  const openPromptModal = (type: "coverLetter" | "whatsapp" | "email" | "followUp1" | "followUp2") => {
    const titles = { coverLetter: "Cover Letter Prompt", whatsapp: "WhatsApp Prompt", email: "Upwork Proposal Prompt", followUp1: "Follow-up Email 1 Prompt", followUp2: "Follow-up Email 2 Prompt" };
    const current = customPrompts[type] || defaultPrompts[type];
    setPromptDraft(current);
    setPromptModal({ type, title: titles[type], prompt: current });
  };

  const handlePromptRegenerate = () => {
    if (!promptModal) return;
    const { type } = promptModal;
    setCustomPrompts(p => ({ ...p, [type]: promptDraft }));
    savePromptToDb(type, promptDraft);
    setPromptModal(null);
    if (type === "coverLetter") generateOne("coverLetter", "cover-letter", "coverLetter", "coverLetter", undefined, undefined, promptDraft);
    if (type === "whatsapp")    generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage", undefined, undefined, promptDraft);
    if (type === "email")       generateOne("email", "email", "emailSubject", "emailSubject", "emailBody", "emailBody", promptDraft);
    if (type === "followUp1")   generateOne("followUp1", "followup1", "followUp1Subject", "followUp1Subject", "followUp1Body", "followUp1Body", promptDraft);
    if (type === "followUp2")   generateOne("followUp2", "followup2", "followUp2Subject", "followUp2Subject", "followUp2Body", "followUp2Body", promptDraft);
  };

  const handlePromptSaveOnly = () => {
    if (!promptModal) return;
    setCustomPrompts(p => ({ ...p, [promptModal.type]: promptDraft }));
    savePromptToDb(promptModal.type, promptDraft);
    setPromptModal(null);
  };

  const resetPrompt = (type: "coverLetter" | "whatsapp" | "email" | "followUp1" | "followUp2") => {
    setPromptDraft(defaultPrompts[type]);
    savePromptToDb(type, ""); // empty = backend falls back to code default
  };

  const sendWhatsapp = (phone?: string, name?: string) => {
    const targetPhone = (phone || clientPhone)?.replace(/\D/g, "") || "";
    const firstName = (name || clientName || "").split(/[\s-]+/)[0];
    const base = (artifacts.whatsappMessage || "").replace(/^Hi\s+[^,\n]+,?/i, `Hi ${firstName},`);
    const plainSig = buildPlainSig();
    const msg = encodeURIComponent(plainSig ? base + "\n\n" + plainSig : base);
    window.open(targetPhone ? `https://wa.me/${targetPhone}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
  };

  const [cloudSending, setCloudSending] = useState(false);
  const [cloudResult, setCloudResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const sendWhatsappCloud = async (mode: "template" | "text", phone?: string, name?: string) => {
    const targetPhone = (phone || clientPhone)?.replace(/\D/g, "") || "";
    if (!targetPhone) { setCloudResult({ ok: false, msg: "No recipient phone." }); return; }
    setCloudSending(true);
    setCloudResult(null);
    try {
      const firstName = (name || clientName || "").split(/[\s-]+/)[0];
      const base = (artifacts.whatsappMessage || "").replace(/^Hi\s+[^,\n]+,?/i, `Hi ${firstName},`);
      const plainSig = buildPlainSig();
      const body = plainSig ? base + "\n\n" + plainSig : base;

      if (mode === "template") {
        const res = await api.post<any>("/api/whatsapp/send-template", {
          to: targetPhone,
          proposalId,

          languageCode: "en",
          bodyVariables: [
            firstName || "there",
            proposalHeadline || "your project"
          ],
        });
        if (res?.ok) setCloudResult({ ok: true, msg: `Sent (wamid: ${res.wamid || "n/a"})` });
        else setCloudResult({ ok: false, msg: res?.error || "Send failed" });
      } else {
        const res = await api.post<any>("/api/whatsapp/send-text", { to: targetPhone, body, proposalId });
        if (res?.ok) setCloudResult({ ok: true, msg: `Sent (wamid: ${res.wamid || "n/a"})` });
        else setCloudResult({ ok: false, msg: res?.error || "Send failed (free-form only works within 24hr reply window)" });
      }
    } catch (e: any) {
      setCloudResult({ ok: false, msg: e?.message || "Send error" });
    } finally {
      setCloudSending(false);
    }
  };

  const openEmail = (email?: string, name?: string) => {
    const to = email || clientEmail || "";
    const resolvedName = (name || "").trim() || "";
    const firstName = resolvedName.split(/[\s-]+/)[0];
    const body = buildMailtoBody(
      firstName
        ? (artifacts.emailBody || "").replace(/^Hi\s+[^,\n]+,?/i, `Hi ${firstName},`)
        : (artifacts.emailBody || "")
    );
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

    const followUp1 = (artifacts.followUp1Subject?.trim() && artifacts.followUp1Body?.trim())
      ? { subject: artifacts.followUp1Subject, body: artifacts.followUp1Body, delayHours: fu1Delay > 0 ? fu1Delay : 6 }
      : null;
    const followUp2 = (artifacts.followUp2Subject?.trim() && artifacts.followUp2Body?.trim())
      ? { subject: artifacts.followUp2Subject, body: artifacts.followUp2Body, delayHours: fu2Delay > 0 ? fu2Delay : 12 }
      : null;

    await api.post(`/api/artifacts/${proposalId}/send-bulk`, {
      recipients,
      intervalMinutes: sendInterval,
      followUp1,
      followUp2,
    });
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

  const cancelJob = async (jobId: string) => {
    await api.post(`/api/artifacts/send-job/${jobId}/cancel`, {});
    pollStatus();
  };

  const cancelFollowUps = async (contactEmail?: string, stage?: number) => {
    await api.post(`/api/artifacts/${proposalId}/send-bulk/cancel-followups`, {
      contactEmail: contactEmail ?? null,
      stage: stage ?? null,
    });
    pollStatus();
  };

  const sendJobNow = async (jobId: string) => {
    await api.post(`/api/artifacts/send-job/${jobId}/send-now`, {});
    pollStatus();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollStatus, 5000);
  };

  const pushToInstantly = async () => {
    if (!selectedCampaignId || !allEmails || allEmails.length === 0) return;
    setPushingToInstantly(true);
    try {
      const contacts = allEmails.map((email, i) => ({ email, name: allEmailNames?.[i] || "" }));
      const result = await api.post<{ ok: boolean; pushed: number; failed: number; errors: string[] }>(
        "/api/instantly/push",
        { campaignId: selectedCampaignId, contacts }
      );
      setInstantlyResult(result);
      setTimeout(() => setInstantlyResult(null), 4000);
    } catch (err: any) {
      setInstantlyResult({ ok: false, pushed: 0, failed: 0, errors: [err.message] });
      setTimeout(() => setInstantlyResult(null), 4000);
    } finally {
      setPushingToInstantly(false);
    }
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

  const isCustomized = (type: "coverLetter" | "whatsapp" | "email" | "followUp1" | "followUp2") =>
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

      {/* Portfolio used in artifacts */}
      {usedProjects.length > 0 && (
        <div style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--card)" }}>
          <div style={{ padding: "10px 16px", background: "var(--accent-light)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-text)" }}>📁 Portfolio projects used — select to regenerate</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={openPortfolioPicker}>+ Add / Change Projects</button>
              <button className="btn btn-primary btn-sm"
                disabled={checkedIds.size === 0 || Object.values(generating).some(Boolean)}
                onClick={() => regenerateSelected(Array.from(checkedIds))}>
                ↺ Regenerate ({checkedIds.size} selected)
              </button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  <th style={{ padding: "8px 10px", width: 32, borderBottom: "1px solid var(--border)" }}></th>
                  <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Project</th>
                  <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Industry</th>
                  <th style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>YouTube Demo</th>
                </tr>
              </thead>
              <tbody>
                {usedProjects.map((p, i) => (
                  <tr key={i} style={{ borderBottom: i < usedProjects.length - 1 ? "1px solid var(--border)" : "none", background: p.id && checkedIds.has(p.id) ? "var(--accent-light)" : "transparent" }}>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <input type="checkbox" checked={!!(p.id && checkedIds.has(p.id))}
                        onChange={e => {
                          if (!p.id) return;
                          setCheckedIds(prev => { const s = new Set(prev); e.target.checked ? s.add(p.id!) : s.delete(p.id!); return s; });
                        }} />
                    </td>
                    <td style={{ padding: "8px 14px", fontWeight: 500 }}>{p.title}</td>
                    <td style={{ padding: "8px 14px", color: "var(--muted)" }}>{p.industry || "—"}</td>
                    <td style={{ padding: "8px 14px" }}>
                      {p.hasYoutubeLink
                        ? <a href={p.youtubeLinks} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline", wordBreak: "break-all" }}>{p.youtubeLinks}</a>
                        : <span style={{ color: "var(--red)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            No YouTube link — update in Portfolio
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {usedProjects.some(p => !p.hasYoutubeLink) && (
            <div style={{ padding: "10px 16px", background: "#fff7ed", borderTop: "1px solid #fed7aa", color: "#c2410c", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Missing YouTube links — go to Portfolio to add them.
            </div>
          )}
        </div>
      )}

      {/* Portfolio picker modal */}
      {showPortfolioPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--card)", borderRadius: 12, width: "100%", maxWidth: 640, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Select Portfolio Projects</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Max 3 — all selected projects will be included in artifacts with their YouTube links</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPortfolioPicker(false)}>✕</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {loadingPortfolio ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}><span className="spinner" /></div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {allPortfolio.map((p, i) => {
                      const checked = pickerSelected.has(p.id);
                      const disabled = !checked && pickerSelected.size >= 3;
                      return (
                        <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", background: checked ? "var(--accent-light)" : "transparent", opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                          onClick={() => {
                            if (disabled) return;
                            setPickerSelected(prev => { const s = new Set(prev); checked ? s.delete(p.id) : s.add(p.id); return s; });
                          }}>
                          <td style={{ padding: "10px 14px", width: 36 }}>
                            <input type="checkbox" checked={checked} readOnly style={{ pointerEvents: "none" }} />
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <div style={{ fontWeight: 600 }}>{p.title}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.industry}</div>
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "right" }}>
                            {p.youtubeLinks
                              ? <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>▶ Demo</span>
                              : <span style={{ fontSize: 11, color: "var(--muted)" }}>No demo</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowPortfolioPicker(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={pickerSelected.size === 0}
                onClick={() => {
                  const ids = Array.from(pickerSelected) as string[];
                  const selected = allPortfolio.filter(p => ids.includes(p.id));
                  setUsedProjects(selected.map(p => ({ id: p.id, title: p.title, industry: p.industry, youtubeLinks: p.youtubeLinks, hasYoutubeLink: !!p.youtubeLinks })));
                  setCheckedIds(new Set(ids));
                  setShowPortfolioPicker(false);
                  regenerateSelected(ids);
                }}>
                Generate with {pickerSelected.size} project{pickerSelected.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
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
          <button className="btn btn-sm" onClick={() => sendWhatsappCloud("template")} disabled={cloudSending} style={{ background: "#128C7E", color: "white", border: "none" }} title="Send approved template via Meta Cloud API (works for cold outreach)">
            {cloudSending ? "Sending…" : "Send Template (API)"}
          </button>
          {artifacts.whatsappMessage && <>
            <CopyBtn text={artifacts.whatsappMessage} />
            <button className="btn btn-sm" onClick={() => sendWhatsapp()} style={{ background: "#25D366", color: "white", border: "none" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Send (wa.me)
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => sendWhatsappCloud("text")} disabled={cloudSending} title="Send free-form text via Cloud API (only works within 24hr reply window)">
              Send Text (API)
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage", undefined, undefined, customPrompts.whatsapp !== defaultPrompts.whatsapp ? customPrompts.whatsapp : undefined)} disabled={generating.whatsapp}>↺ Redo</button>
          </>}
          {!artifacts.whatsappMessage && <button className="btn btn-ghost btn-sm" onClick={() => generateOne("whatsapp", "whatsapp", "whatsappMessage", "whatsappMessage")} disabled={generating.whatsapp}>Generate</button>}
        </>}
      >
        {errors.whatsapp && <div className="banner banner-error">{errors.whatsapp}</div>}
        {cloudResult && (
          <div className={`banner ${cloudResult.ok ? "banner-success" : "banner-error"}`} style={{ marginBottom: 8 }}>
            {cloudResult.ok ? "✓ " : "✗ "}{cloudResult.msg}
          </div>
        )}
        {artifacts.whatsappMessage
          ? <pre style={preStyle}>{artifacts.whatsappMessage}</pre>
          : !generating.whatsapp && <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0" }}>Not generated yet</div>}
      </CardShell>

      {/* Email */}
      <CardShell
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
        title="Upwork Proposal"
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

      {/* Follow-up Email 1 */}
      {artifacts.emailSubject && allEmails && allEmails.length > 0 && (
        <CardShell
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/><circle cx="18" cy="18" r="3" fill="var(--accent)"/></svg>}
          title="Follow-up Email 1"
          subtitle={<>AI-generated nudge sent after initial. Supports {"{{name}}"}, {"{{first_name}}"}, {"{{email}}"}.{isCustomized("followUp1") && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>● custom prompt</span>}</>}
          loading={generating.followUp1}
          actions={<>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 4 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>Delay (hrs):</label>
              <input
                type="number" min={1} value={fu1Delay}
                onChange={e => setFu1Delay(Number(e.target.value))}
                disabled={sendAllJobs.some(j => j.status === "pending")}
                style={{ width: 60, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
              />
            </div>
            <PromptBtn onClick={() => openPromptModal("followUp1")} />
            {artifacts.followUp1Subject && <>
              <CopyBtn text={`Subject: ${artifacts.followUp1Subject}\n\n${artifacts.followUp1Body}`} />
              <button className="btn btn-ghost btn-sm" onClick={() => generateOne("followUp1", "followup1", "followUp1Subject", "followUp1Subject", "followUp1Body", "followUp1Body", customPrompts.followUp1 !== defaultPrompts.followUp1 ? customPrompts.followUp1 : undefined)} disabled={generating.followUp1}>↺ Redo</button>
            </>}
            {!artifacts.followUp1Subject && <button className="btn btn-ghost btn-sm" onClick={() => generateOne("followUp1", "followup1", "followUp1Subject", "followUp1Subject", "followUp1Body", "followUp1Body")} disabled={generating.followUp1}>Generate</button>}
          </>}
        >
          {errors.followUp1 && <div className="banner banner-error">{errors.followUp1}</div>}
          {artifacts.followUp1Subject ? <>
            <div style={{ marginBottom: 8 }}>
              <div className="field-label">Subject</div>
              <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                {artifacts.followUp1Subject}
              </div>
            </div>
            <div>
              <div className="field-label">Body</div>
              <pre style={preStyle}>{artifacts.followUp1Body}</pre>
            </div>
          </> : !generating.followUp1 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0" }}>Not generated yet</div>}
        </CardShell>
      )}

      {/* Follow-up Email 2 */}
      {artifacts.emailSubject && allEmails && allEmails.length > 0 && (
        <CardShell
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/><circle cx="18" cy="18" r="3" fill="var(--accent)"/><circle cx="14" cy="18" r="3" fill="var(--accent)"/></svg>}
          title="Follow-up Email 2"
          subtitle={<>AI-generated final nudge. Supports {"{{name}}"}, {"{{first_name}}"}, {"{{email}}"}.{isCustomized("followUp2") && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>● custom prompt</span>}</>}
          loading={generating.followUp2}
          actions={<>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 4 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>Delay (hrs):</label>
              <input
                type="number" min={1} value={fu2Delay}
                onChange={e => setFu2Delay(Number(e.target.value))}
                disabled={sendAllJobs.some(j => j.status === "pending")}
                style={{ width: 60, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
              />
            </div>
            <PromptBtn onClick={() => openPromptModal("followUp2")} />
            {artifacts.followUp2Subject && <>
              <CopyBtn text={`Subject: ${artifacts.followUp2Subject}\n\n${artifacts.followUp2Body}`} />
              <button className="btn btn-ghost btn-sm" onClick={() => generateOne("followUp2", "followup2", "followUp2Subject", "followUp2Subject", "followUp2Body", "followUp2Body", customPrompts.followUp2 !== defaultPrompts.followUp2 ? customPrompts.followUp2 : undefined)} disabled={generating.followUp2}>↺ Redo</button>
            </>}
            {!artifacts.followUp2Subject && <button className="btn btn-ghost btn-sm" onClick={() => generateOne("followUp2", "followup2", "followUp2Subject", "followUp2Subject", "followUp2Body", "followUp2Body")} disabled={generating.followUp2}>Generate</button>}
          </>}
        >
          {errors.followUp2 && <div className="banner banner-error">{errors.followUp2}</div>}
          {artifacts.followUp2Subject ? <>
            <div style={{ marginBottom: 8 }}>
              <div className="field-label">Subject</div>
              <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                {artifacts.followUp2Subject}
              </div>
            </div>
            <div>
              <div className="field-label">Body</div>
              <pre style={preStyle}>{artifacts.followUp2Body}</pre>
            </div>
          </> : !generating.followUp2 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0" }}>Not generated yet</div>}
        </CardShell>
      )}

      {/* Multi-contact Send Panel */}
      {((allEmails && allEmails.length > 0 && artifacts.emailSubject) || (allPhones && allPhones.length > 0)) && (
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
                  <>
                    <button className="btn btn-sm" style={{ background: "#0078d4", color: "white", border: "none" }} onClick={sendToAll}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                      Send to All
                    </button>
                    {instantlyCampaigns.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <select
                          value={selectedCampaignId}
                          onChange={e => setSelectedCampaignId(e.target.value)}
                          disabled={pushingToInstantly}
                          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}
                        >
                          <option value="">Campaign...</option>
                          {instantlyCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button 
                          className="btn btn-sm" 
                          style={{ background: "#22c55e", color: "white", border: "none" }} 
                          onClick={pushToInstantly}
                          disabled={!selectedCampaignId || pushingToInstantly}
                        >
                          {pushingToInstantly ? "..." : "→ Instantly"}
                        </button>
                      </div>
                    )}
                    {instantlyCampaigns.length === 0 && (
                      <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>No campaigns found - Create in Instantly first</span>
                    )}
                    {instantlyError && (
                      <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>Instantly error: {instantlyError}</span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {sendAllQueued && sendAllJobs.length > 0 && (() => {
            // Group jobs by contact email
            const contactEmails = Array.from(new Set(sendAllJobs.map(j => j.toEmail)));
            const grouped = contactEmails.map(email => ({
              email,
              name: sendAllJobs.find(j => j.toEmail === email)?.toName || email,
              initial: sendAllJobs.find(j => j.toEmail === email && (j.followUpStage ?? 0) === 0),
              fu1:     sendAllJobs.find(j => j.toEmail === email && j.followUpStage === 1),
              fu2:     sendAllJobs.find(j => j.toEmail === email && j.followUpStage === 2),
            }));

            const totalSent    = sendAllJobs.filter(j => j.status === "sent").length;
            const totalJobs    = sendAllJobs.length;
            const anyPending   = sendAllJobs.some(j => j.status === "pending");
            const anyFuPending = sendAllJobs.some(j => j.status === "pending" && (j.followUpStage ?? 0) > 0);
            const allDone      = sendAllJobs.every(j => j.status === "sent" || j.status === "failed" || j.status === "cancelled");

            const statusIcon = (status: string) => {
              if (status === "sent")      return <span style={{ color: "#22c55e", fontSize: 13 }}>✓</span>;
              if (status === "failed")    return <span style={{ color: "#ef4444", fontSize: 13 }}>✕</span>;
              if (status === "cancelled") return <span style={{ color: "var(--muted)", fontSize: 13 }}>–</span>;
              return <span style={{ color: "#f59e0b", fontSize: 13 }}>⏳</span>;
            };

            const stageChip = (label: string, color: string) => (
              <span style={{ background: color, color: "white", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, minWidth: 40, textAlign: "center" as const, display: "inline-block" }}>{label}</span>
            );

            const scheduledLabel = (job?: { scheduledAt: string; status: string }) =>
              job && job.status === "pending"
                ? <span style={{ color: "var(--muted)", fontSize: 10 }}>due {new Date(job.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                : null;

            return (
              <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      {allDone ? "✓ Queue complete" : "📤 Outreach queue"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {totalSent}/{totalJobs} sent
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {anyFuPending && (
                      <button
                        className="btn btn-sm"
                        style={{ background: "#f59e0b", color: "white", border: "none", fontSize: 11, padding: "3px 8px" }}
                        onClick={() => cancelFollowUps()}
                        title="Stop all pending FU1 and FU2 for all contacts"
                      >
                        ⏹ Stop All Follow-ups
                      </button>
                    )}
                    {anyPending && (
                      <button
                        className="btn btn-sm"
                        style={{ background: "#dc3545", color: "white", border: "none", fontSize: 11, padding: "3px 8px" }}
                        onClick={cancelSendAll}
                        title="Cancel everything including initial emails"
                      >
                        ✕ Cancel All
                      </button>
                    )}
                  </div>
                </div>

                {/* Per-contact rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {grouped.map(({ email, name, initial, fu1, fu2 }) => {
                    const hasPendingFu = (fu1 && fu1.status === "pending") || (fu2 && fu2.status === "pending");
                    return (
                      <div key={email} style={{ background: "var(--surface2, var(--surface))", borderRadius: 6, border: "1px solid var(--border)", padding: "8px 10px" }}>
                        {/* Contact name row */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{name}</span>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>{email}</span>
                          </div>
                          {hasPendingFu && (
                            <button
                              className="btn btn-sm"
                              style={{ background: "#f59e0b", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }}
                              onClick={() => cancelFollowUps(email)}
                              title="Stop FU1 + FU2 for this contact"
                            >
                              ⏹ Stop FU
                            </button>
                          )}
                        </div>

                        {/* Stage rows */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {/* Initial */}
                          {initial && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                              {statusIcon(initial.status)}
                              {stageChip("Initial", "#0078d4")}
                              {scheduledLabel(initial)}
                              {initial.status === "pending" && (
                                <button
                                  className="btn btn-sm"
                                  style={{ background: "#0078d4", color: "white", border: "none", fontSize: 10, padding: "2px 6px", marginLeft: "auto" }}
                                  onClick={() => sendJobNow(initial.id)}
                                >Send Now</button>
                              )}
                              {initial.status === "sent" && initial.sentAt && (
                                <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>
                                  sent {new Date(initial.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                              {initial.status === "failed" && initial.error && (
                                <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>{initial.error}</span>
                              )}
                            </div>
                          )}

                          {/* FU1 */}
                          {fu1 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                              {statusIcon(fu1.status)}
                              {stageChip("FU1", "#a855f7")}
                              {scheduledLabel(fu1)}
                              {fu1.status === "pending" && (
                                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                                  <button
                                    className="btn btn-sm"
                                    style={{ background: "#0078d4", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }}
                                    onClick={() => sendJobNow(fu1!.id)}
                                  >Send Now</button>
                                  <button
                                    className="btn btn-sm"
                                    style={{ background: "#dc3545", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }}
                                    onClick={() => cancelJob(fu1!.id)}
                                    title="Stop this follow-up"
                                  >⏹ Stop</button>
                                </div>
                              )}
                              {fu1.status === "sent" && fu1.sentAt && (
                                <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>
                                  sent {new Date(fu1.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                              {fu1.status === "cancelled" && <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>stopped</span>}
                              {fu1.status === "failed" && fu1.error && (
                                <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>{fu1.error}</span>
                              )}
                            </div>
                          )}

                          {/* FU2 */}
                          {fu2 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                              {statusIcon(fu2.status)}
                              {stageChip("FU2", "#ec4899")}
                              {scheduledLabel(fu2)}
                              {fu2.status === "pending" && (
                                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                                  <button
                                    className="btn btn-sm"
                                    style={{ background: "#0078d4", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }}
                                    onClick={() => sendJobNow(fu2!.id)}
                                  >Send Now</button>
                                  <button
                                    className="btn btn-sm"
                                    style={{ background: "#dc3545", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }}
                                    onClick={() => cancelJob(fu2!.id)}
                                    title="Stop this follow-up"
                                  >⏹ Stop</button>
                                </div>
                              )}
                              {fu2.status === "sent" && fu2.sentAt && (
                                <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>
                                  sent {new Date(fu2.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                              {fu2.status === "cancelled" && <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>stopped</span>}
                              {fu2.status === "failed" && fu2.error && (
                                <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>{fu2.error}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {instantlyResult && (
            <div style={{
              marginBottom: 12,
              padding: "12px 14px",
              background: instantlyResult.ok ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
              borderRadius: 8,
              border: `1px solid ${instantlyResult.ok ? "#22c55e" : "#ef4444"}`,
              fontSize: 12,
              color: instantlyResult.ok ? "#16a34a" : "#991b1b"
            }}>
              {instantlyResult.ok ? (
                <>✓ {instantlyResult.pushed} pushed to Instantly{instantlyResult.errors.length > 0 && ` • ${instantlyResult.errors.join(", ")}`}</>
              ) : (
                <>✕ Failed: {instantlyResult.errors.join(", ")}</>
              )}
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
          {allPhones && allPhones.length > 0 && (
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
                      <button className="btn btn-sm" style={{ background: "#128C7E", color: "white", border: "none" }} disabled={cloudSending}
                        onClick={() => sendWhatsappCloud("template", phone, name)} title="Send approved template via Meta Cloud API">
                        Template (API)
                      </button>
                      {artifacts.whatsappMessage && <>
                        <button className="btn btn-sm" style={{ background: "#25D366", color: "white", border: "none" }}
                          onClick={() => sendWhatsapp(phone, name)}>
                          Send (wa.me)
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={cloudSending}
                          onClick={() => sendWhatsappCloud("text", phone, name)} title="Send free-form text (24hr reply window only)">
                          Text (API)
                        </button>
                      </>}
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
