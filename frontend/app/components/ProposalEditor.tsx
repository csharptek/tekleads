"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type PortfolioItem = {
  id: string;
  title: string;
  industry: string;
  tags: string[];
  problem: string;
  solution: string;
  techStack: string;
  outcomes: string;
  links: string;
  embeddingIndexed: boolean;
};

type ProposalVersion = {
  id: string;
  label: string;
  content: string;
  createdAt: string;
  prompt?: string;
};

type AIMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type SectionLock = {
  id: string;
  label: string;
  locked: boolean;
};

type QualityScore = {
  score: number;
  reason: string;
};

type ProposalEditorProps = {
  proposalId: string;
  proposalHeadline?: string;
  clientName?: string;
  clientCompany?: string;
  onBack?: () => void;
};

// ── Mock data for UI-only phase ───────────────────────────────────────────────

const DEFAULT_SECTIONS: SectionLock[] = [
  { id: "executive", label: "Executive Summary", locked: false },
  { id: "scope", label: "Project Scope", locked: false },
  { id: "stack", label: "Technical Stack", locked: false },
  { id: "timeline", label: "Timeline & Budget", locked: false },
  { id: "portfolio", label: "Portfolio References", locked: false },
  { id: "terms", label: "Terms & Conditions", locked: true },
  { id: "whycsharptek", label: "Why CSharpTek", locked: true },
];

const DEFAULT_PROMPT = `You are a professional proposal writer for CSharpTek, a specialist software development company.

Generate a compelling, personalized proposal based on:
1. The client's job post and requirements
2. Relevant portfolio projects (provided as context)
3. CSharpTek's expertise in AI, .NET, React, and cloud platforms

Guidelines:
- Write in a professional but approachable tone
- Always reference specific portfolio projects with links
- Include a clear project scope breakdown
- Add a sprint-based timeline table
- Mention HIPAA compliance if healthcare-related
- End with "Why CSharpTek" section
- Use markdown formatting with tables where appropriate
- Keep total length between 800-1200 words`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProposalEditor({ proposalId, proposalHeadline, clientName, clientCompany, onBack }: ProposalEditorProps) {
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [rightPanel, setRightPanel] = useState<"portfolio" | "prompt" | "versions" | "sections" | null>("portfolio");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Portfolio selector
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<Set<string>>(new Set());

  // Prompt
  const [defaultPrompt, setDefaultPrompt] = useState(DEFAULT_PROMPT);
  const [customPrompt, setCustomPrompt] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);

  // AI refinement chat
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [refining, setRefining] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Versions
  const [versions, setVersions] = useState<ProposalVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState("");

  // Section locks
  const [sections, setSections] = useState<SectionLock[]>(DEFAULT_SECTIONS);

  // Quality score
  const [quality, setQuality] = useState<QualityScore | null>(null);

  // Tone
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Load real data on mount
  useEffect(() => {
    loadPortfolio();
    loadProposal();
    loadVersions();
  }, [proposalId]);

  const loadPortfolio = async () => {
    try {
      const items = await api.get<PortfolioItem[]>("/api/portfolio");
      setPortfolioItems(items || []);
    } catch { /* keep mock */ }
  };

  const loadProposal = async () => {
    try {
      const p: any = await api.get(`/api/proposals/${proposalId}`);
      if (p.generatedResponse) {
        setContent(p.generatedResponse);
      }
      if (p.selectedPortfolioIds?.length > 0) {
        setSelectedPortfolioIds(new Set(p.selectedPortfolioIds));
      }
      if (p.customPrompt) {
        setCustomPrompt(p.customPrompt);
        setPromptEdited(true);
      }
    } catch (e: any) {
      setLoadError(e.message);
    }
  };

  const loadVersions = async () => {
    try {
      const vlist = await api.get<any[]>(`/api/proposals/${proposalId}/versions`);
      if (vlist?.length > 0) {
        const mapped = vlist.map(v => ({
          id: v.id,
          label: v.label,
          content: v.content,
          createdAt: v.createdAt,
          prompt: v.prompt,
        }));
        setVersions(mapped);
        setActiveVersion(mapped[mapped.length - 1].id);
      }
    } catch { /* no versions yet */ }
  };

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true); setSaved(false);
    try {
      await api.post(, { content });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportWord = async () => {
    if (!content.trim()) { setLoadError("No content to export. Generate the proposal first."); return; }
    setExporting(true);
    try {
      const BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch();
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      a.download = match?.[1] || "proposal.docx";
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const activePrompt = promptEdited ? customPrompt : defaultPrompt;
  const lockedSections = sections.filter(s => s.locked).map(s => s.label);

  const handleGenerate = async () => {
    setGenerating(true);
    setLoadError("");
    try {
      const res: any = await api.post(`/api/proposals/${proposalId}/generate`, {
        selectedPortfolioIds: selectedPortfolioIds.size > 0 ? Array.from(selectedPortfolioIds) : null,
        customPrompt: promptEdited ? customPrompt : null,
      });
      if (!res.ok) { setLoadError(res.error || "Generation failed."); return; }
      setContent(res.generatedText || "");
      if (res.qualityScore) setQuality({ score: res.qualityScore.score, reason: res.qualityScore.reason });
      // Add to versions list
      const newV: ProposalVersion = {
        id: `v${versions.length + 1}`,
        label: res.versionLabel || `v${versions.length + 1} — Generated`,
        content: res.generatedText || "",
        createdAt: new Date().toISOString(),
      };
      setVersions(v => [...v, newV]);
      setActiveVersion(newV.id);
      // Also refresh versions from server
      await loadVersions();
      // Update selected portfolio from response
      if (res.portfolioItemsUsed?.length > 0) {
        setSelectedPortfolioIds(new Set(res.portfolioItemsUsed.map((p: any) => p.id)));
      }
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRefine = async () => {
    if (!aiInstruction.trim()) return;
    setRefining(true);
    const userMsg: AIMessage = { role: "user", content: aiInstruction, timestamp: new Date().toISOString() };
    setAiMessages(m => [...m, userMsg]);
    const instruction = aiInstruction;
    setAiInstruction("");
    try {
      const res: any = await api.post(`/api/proposals/${proposalId}/refine`, {
        instruction,
        lockedSections: sections.filter(s => s.locked).map(s => s.label),
        conversationHistory: aiMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      });
      if (!res.ok) {
        const errMsg: AIMessage = { role: "assistant", content: `Error: ${res.error}`, timestamp: new Date().toISOString() };
        setAiMessages(m => [...m, errMsg]);
        return;
      }
      const assistantMsg: AIMessage = { role: "assistant", content: `Applied: "${instruction}". Proposal updated.`, timestamp: new Date().toISOString() };
      setAiMessages(m => [...m, assistantMsg]);
      setContent(res.generatedText || "");
      if (res.qualityScore) setQuality({ score: res.qualityScore.score, reason: res.qualityScore.reason });
      const newV: ProposalVersion = {
        id: `v${versions.length + 1}`,
        label: res.versionLabel || `v${versions.length + 1} — Refined`,
        content: res.generatedText || "",
        createdAt: new Date().toISOString(),
      };
      setVersions(v => [...v, newV]);
      setActiveVersion(newV.id);
      await loadVersions();
    } catch (e: any) {
      const errMsg: AIMessage = { role: "assistant", content: `Error: ${e.message}`, timestamp: new Date().toISOString() };
      setAiMessages(m => [...m, errMsg]);
    } finally {
      setRefining(false);
    }
  };

  const togglePortfolio = (id: string) => {
    setSelectedPortfolioIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const restoreVersion = (v: ProposalVersion) => {
    setContent(v.content);
    setActiveVersion(v.id);
  };

  const toggleSection = (id: string) => {
    setSections(s => s.map(sec => sec.id === id ? { ...sec, locked: !sec.locked } : sec));
  };

  const fmt = (d: string) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const panelLabel = rightPanel === "portfolio" ? `Portfolio (${selectedPortfolioIds.size}/${portfolioItems.length})`
    : rightPanel === "prompt" ? "Prompt Settings"
    : rightPanel === "versions" ? `Versions (${versions.length})`
    : rightPanel === "sections" ? "Section Locks"
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f1f5f9", overflow: "hidden" }}>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "0 20px",
        height: 54, background: "white", borderBottom: "1px solid #e2e8f0",
        flexShrink: 0, zIndex: 10,
      }}>
        {onBack && (
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
        )}
        <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {proposalHeadline || "Proposal Editor"}
          </div>
          {(clientName || clientCompany) && (
            <div style={{ fontSize: 11, color: "#64748b" }}>{[clientName, clientCompany].filter(Boolean).join(" · ")}</div>
          )}
        </div>

        {/* Quality badge */}
        {quality && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
            borderRadius: 20, background: quality.score >= 8 ? "#dcfce7" : quality.score >= 6 ? "#fffbeb" : "#fee2e2",
            color: quality.score >= 8 ? "#166534" : quality.score >= 6 ? "#92400e" : "#991b1b",
            fontSize: 12, fontWeight: 600, cursor: "help", flexShrink: 0,
          }} title={quality.reason}>
            ★ {quality.score}/10
          </div>
        )}

        {/* Generate */}
        <button onClick={handleGenerate} disabled={generating}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 16px",
            background: generating ? "#93c5fd" : "#2563eb", color: "white",
            border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600,
            cursor: generating ? "not-allowed" : "pointer", flexShrink: 0,
          }}>
          {generating ? (
            <><span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "white", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />Generating…</>
          ) : (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Generate Proposal</>
          )}
        </button>

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          style={{ padding: "7px 14px", background: saving ? "#e2e8f0" : "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: saving ? "not-allowed" : "pointer", color: "#0f172a", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {saving && <span style={{ width: 10, height: 10, border: "2px solid #cbd5e1", borderTopColor: "#64748b", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
          {saved ? "✓ Saved" : "Save"}
        </button>
      </div>

      {/* Error banner */}
      {loadError && (
        <div style={{ padding: "10px 20px", background: "#fee2e2", color: "#dc2626", fontSize: 13, borderBottom: "1px solid #fecaca", flexShrink: 0 }}>
          ⚠ {loadError}
          <button onClick={() => setLoadError("")} style={{ marginLeft: 12, background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: 700 }}>✕</button>
        </div>
      )}
      {/* ── Main area ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left: Editor ─────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

          {/* AI Instruction bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
            background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            <input
              value={aiInstruction}
              onChange={e => setAiInstruction(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleRefine()}
              placeholder='Refine with AI: "make it shorter", "add more about our HIPAA experience", "change tone to friendly"…'
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "white", fontSize: 13, fontFamily: "inherit",
              }}
            />
            {aiMessages.length > 0 && (
              <button onClick={() => setShowHistory(h => !h)}
                style={{ fontSize: 11, background: "none", border: "1px solid #475569", borderRadius: 6, padding: "3px 8px", color: "#94a3b8", cursor: "pointer", flexShrink: 0 }}>
                History ({aiMessages.length})
              </button>
            )}
            <button onClick={handleRefine} disabled={refining || !aiInstruction.trim()}
              style={{
                padding: "5px 14px", background: "#2563eb", color: "white", border: "none",
                borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: refining || !aiInstruction.trim() ? "not-allowed" : "pointer",
                opacity: refining || !aiInstruction.trim() ? 0.5 : 1, flexShrink: 0,
              }}>
              {refining ? "Applying…" : "Apply"}
            </button>
          </div>

          {/* AI History panel */}
          {showHistory && aiMessages.length > 0 && (
            <div style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "10px 16px", maxHeight: 180, overflowY: "auto", flexShrink: 0 }}>
              {aiMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, color: m.role === "user" ? "#60a5fa" : "#4ade80", fontWeight: 700, flexShrink: 0, paddingTop: 2 }}>
                    {m.role === "user" ? "YOU" : "AI"}
                  </span>
                  <span style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.5 }}>{m.content}</span>
                  <span style={{ fontSize: 10, color: "#475569", flexShrink: 0, paddingTop: 2 }}>{fmt(m.timestamp)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Editor */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {!content && !generating && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#94a3b8", pointerEvents: "none" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{ marginBottom: 12 }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>No proposal generated yet</div>
                <div style={{ fontSize: 12 }}>Click "Generate Proposal" to start</div>
              </div>
            )}
            <textarea
              ref={editorRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              style={{
                width: "100%", height: "100%", padding: "24px 32px",
                border: "none", outline: "none", resize: "none",
                fontFamily: "'Georgia', serif", fontSize: 14, lineHeight: 1.8,
                color: "#0f172a", background: "white",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Status bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 16, padding: "6px 16px",
            background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: 11,
            color: "#94a3b8", flexShrink: 0,
          }}>
            <span>{content.split(/\s+/).filter(Boolean).length} words</span>
            <span>{content.length} chars</span>
            <span>Version: {versions.find(v => v.id === activeVersion)?.label || activeVersion}</span>
            <span style={{ marginLeft: "auto" }}>
              {lockedSections.length > 0 && `🔒 ${lockedSections.length} section${lockedSections.length > 1 ? "s" : ""} locked`}
            </span>
          </div>
        </div>

        {/* ── Right: Panel ──────────────────────────────────────────── */}
        <div style={{ width: 320, display: "flex", flexDirection: "column", borderLeft: "1px solid #e2e8f0", background: "white", flexShrink: 0, overflow: "hidden" }}>

          {/* Panel tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", flexShrink: 0, overflowX: "auto" }}>
            {(["portfolio", "prompt", "sections", "versions"] as const).map(tab => (
              <button key={tab} onClick={() => setRightPanel(p => p === tab ? null : tab)}
                style={{
                  flex: 1, padding: "10px 4px", fontSize: 11, fontWeight: 600,
                  border: "none", background: "none", cursor: "pointer",
                  borderBottom: rightPanel === tab ? "2px solid #2563eb" : "2px solid transparent",
                  color: rightPanel === tab ? "#2563eb" : "#64748b",
                  textTransform: "uppercase", letterSpacing: "0.4px", whiteSpace: "nowrap",
                }}>
                {tab === "portfolio" ? `Projects (${selectedPortfolioIds.size})` :
                 tab === "versions" ? `v${versions.length}` :
                 tab === "sections" ? "Locks" : "Prompt"}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflowY: "auto" }}>

            {/* Portfolio selector */}
            {rightPanel === "portfolio" && (
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12, lineHeight: 1.5 }}>
                  Select portfolio items to include. Auto-selected based on AI matching.
                </div>
                {portfolioItems.map(item => {
                  const selected = selectedPortfolioIds.has(item.id);
                  return (
                    <div key={item.id} onClick={() => togglePortfolio(item.id)}
                      style={{
                        padding: "10px 12px", borderRadius: 8, border: `1px solid ${selected ? "#2563eb" : "#e2e8f0"}`,
                        background: selected ? "#eff6ff" : "white", cursor: "pointer", marginBottom: 8,
                        transition: "all 0.15s",
                      }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: selected ? "#1d4ed8" : "#0f172a", flex: 1, paddingRight: 8 }}>
                          {item.title}
                        </div>
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, border: `2px solid ${selected ? "#2563eb" : "#cbd5e1"}`,
                          background: selected ? "#2563eb" : "white", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}>
                          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{item.industry}</div>
                      {item.outcomes && (
                        <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 500 }}>🎯 {item.outcomes}</div>
                      )}
                      {item.tags.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
                          {item.tags.slice(0, 3).map(t => (
                            <span key={t} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#f1f5f9", color: "#64748b" }}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button onClick={handleGenerate} disabled={generating}
                  style={{
                    width: "100%", padding: "9px", marginTop: 4, background: "#2563eb", color: "white",
                    border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>
                  Regenerate with Selection
                </button>
              </div>
            )}

            {/* Prompt settings */}
            {rightPanel === "prompt" && (
              <div style={{ padding: 14 }}>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>Default System Prompt</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>Applies to all proposals. Edit in Proposal Settings.</div>
                  <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 11, color: "#64748b", lineHeight: 1.6, maxHeight: 120, overflowY: "auto" }}>
                    {defaultPrompt.slice(0, 200)}…
                  </div>
                </div>
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>Override for this Proposal</div>
                    {promptEdited && (
                      <button onClick={() => { setPromptEdited(false); setCustomPrompt(""); }}
                        style={{ fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}>
                        Reset
                      </button>
                    )}
                  </div>
                  <textarea
                    value={promptEdited ? customPrompt : defaultPrompt}
                    onChange={e => { setCustomPrompt(e.target.value); setPromptEdited(true); }}
                    rows={10}
                    style={{
                      width: "100%", fontSize: 12, lineHeight: 1.6, padding: "10px 12px",
                      border: `1px solid ${promptEdited ? "#2563eb" : "#e2e8f0"}`, borderRadius: 6,
                      outline: "none", resize: "vertical", fontFamily: "inherit", color: "#0f172a",
                      background: promptEdited ? "#eff6ff" : "#f8fafc",
                    }}
                  />
                  {promptEdited && (
                    <div style={{ fontSize: 11, color: "#2563eb", marginTop: 4 }}>✓ Custom prompt active for this proposal</div>
                  )}
                </div>
                <button onClick={handleGenerate} disabled={generating}
                  style={{ width: "100%", padding: "9px", marginTop: 12, background: "#2563eb", color: "white", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Regenerate with this Prompt
                </button>
              </div>
            )}

            {/* Section locks */}
            {rightPanel === "sections" && (
              <div style={{ padding: 14 }}>
                <div style={{ padding: "10px 12px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8", marginBottom: 4 }}>What are section locks?</div>
                  <div style={{ fontSize: 12, color: "#1e40af", lineHeight: 1.6 }}>
                    When you regenerate the proposal, locked sections are kept exactly as-is — only unlocked sections get rewritten by AI. Use this to protect finalised content like your Terms & Conditions or "Why CSharpTek" while still refining the scope or timeline.
                  </div>
                </div>
                {sections.map(sec => (
                  <div key={sec.id} onClick={() => toggleSection(sec.id)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 12px", borderRadius: 7, border: "1px solid #e2e8f0",
                      background: sec.locked ? "#fffbeb" : "white", cursor: "pointer", marginBottom: 6,
                    }}>
                    <div style={{ fontSize: 13, color: sec.locked ? "#92400e" : "#0f172a", fontWeight: sec.locked ? 600 : 400 }}>
                      {sec.label}
                    </div>
                    <div style={{ fontSize: 16 }}>{sec.locked ? "🔒" : "🔓"}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Versions */}
            {rightPanel === "versions" && (
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                  Click any version to preview and restore.
                </div>
                {[...versions].reverse().map(v => (
                  <div key={v.id} onClick={() => restoreVersion(v)}
                    style={{
                      padding: "10px 12px", borderRadius: 7,
                      border: `1px solid ${activeVersion === v.id ? "#2563eb" : "#e2e8f0"}`,
                      background: activeVersion === v.id ? "#eff6ff" : "white",
                      cursor: "pointer", marginBottom: 6,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: activeVersion === v.id ? "#1d4ed8" : "#0f172a" }}>
                        {v.label}
                      </div>
                      {activeVersion === v.id && (
                        <span style={{ fontSize: 10, background: "#2563eb", color: "white", padding: "2px 6px", borderRadius: 999, fontWeight: 600 }}>Active</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{fmt(v.createdAt)}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                      {v.content.slice(0, 80)}…
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Collapsed state */}
            {rightPanel === null && (
              <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12, paddingTop: 40 }}>
                Select a panel above
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ padding: "12px 14px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={handleExportWord} disabled={exporting || !content}
              style={{ flex: 1, padding: "7px", background: exporting ? "#e2e8f0" : "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, cursor: exporting || !content ? "not-allowed" : "pointer", color: exporting ? "#94a3b8" : "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              {exporting && <span style={{ width: 10, height: 10, border: "2px solid #cbd5e1", borderTopColor: "#64748b", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
              {exporting ? "Exporting…" : "Export Word"}
            </button>
            <button disabled style={{ flex: 1, padding: "7px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, cursor: "not-allowed", color: "#cbd5e1" }}>
              Export PDF
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        textarea:focus { outline: none; }
      `}</style>
    </div>
  );
}
