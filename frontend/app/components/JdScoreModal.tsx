"use client";

import { useState, useEffect } from "react";
import { api } from "../../lib/api";

export interface JdScoreData {
  score: number;
  durationSignal: string;
  budgetMentioned: boolean;
  budgetAmount: number | null;
  timelinePressure: string;
  hasScreeningQuestions: boolean;
  projectType: string;
  existingSubtype: string | null;
  recommendation: string;
  estimatedHoursMin: number | null;
  estimatedHoursMax: number | null;
  estimateNotes: string;
  extractedClientName: string | null;
  extractedCompanyName: string | null;
  clientNameCandidates: string[];
  companyNameCandidates: string[];
  extractionSource: string;
  extractionConfidence: string;
  contactLinkedinUrl: string | null;
  contactLinkedinSource: string;
  apolloCandidates: ContactCandidate[];
  webSearchCandidates: ContactCandidate[];
}

interface ContactCandidate {
  name: string;
  title?: string | null;
  company?: string | null;
  linkedinUrl?: string | null;
  snippet?: string | null;
}

interface Props {
  entityType: "proposal" | "job_lead";
  entityId: string;
  title: string;
  description: string;
  onConfirm: (extracted: { clientName: string; companyName: string; linkedinUrl: string }) => void;
  onCancel: () => void;
}

const sourceLabel = (s: string) => {
  if (s === "jd_text") return "found in job post";
  if (s === "comment") return "found in a comment";
  if (s === "signature") return "found in sign-off";
  if (s === "testimonial") return "found in client review";
  return "not found";
};

const scoreColor = (score: number) => {
  if (score >= 4) return "#16a34a";
  if (score === 3) return "#ca8a04";
  return "#dc2626";
};

const flagLabel = {
  duration: (v: string) => v === "long_term" ? "Long-term" : v === "short_term" ? "Short-term / one-time" : "Duration unclear",
  budget: (mentioned: boolean, amt: number | null) =>
    mentioned && amt != null ? `Budget: $${amt.toLocaleString()}` : "Budget not mentioned",
  timeline: (v: string) => v === "urgent" ? "Urgent timeline" : v === "flexible" ? "Flexible timeline" : "Timeline unclear",
  questions: (v: boolean) => v ? "Has screening questions" : "No screening questions",
  type: (t: string, sub: string | null) => {
    if (t === "new_build") return "New build";
    if (t === "existing" && sub === "troubleshooting") return "Existing — Troubleshooting";
    if (t === "existing" && sub === "feature_add") return "Existing — Feature add";
    if (t === "existing") return "Existing project";
    return "Project type unclear";
  },
};

const flagReason = {
  duration: (v: string) => v === "long_term"
    ? "JD signals an ongoing/long-term engagement — raises score."
    : v === "short_term"
    ? "JD reads as a one-off or short-term job — lowers score."
    : "Couldn't tell if this is short-term or ongoing work.",
  budget: (mentioned: boolean, amt: number | null) =>
    mentioned && amt != null
      ? "Client stated a budget — raises score."
      : "No budget figure found in the JD — lowers score.",
  timeline: (v: string) => v === "urgent"
    ? "Client wants this done fast — can mean less negotiation room."
    : v === "flexible"
    ? "No pressure on timeline — usually a good sign."
    : "JD doesn't say how urgent this is.",
  questions: (v: boolean) => v
    ? "Client added screening questions — signals a serious, filtered post."
    : "No screening questions — often means a lower-effort post.",
  type: (t: string, sub: string | null) => {
    if (t === "new_build") return "Greenfield build — bigger scope, usually higher value.";
    if (t === "existing" && sub === "troubleshooting") return "Bug-fix/support work — typically small, low budget.";
    if (t === "existing" && sub === "feature_add") return "Adding a feature to an existing app — moderate scope.";
    if (t === "existing") return "Work on an existing codebase.";
    return "Couldn't tell if this is new or existing work.";
  },
};

export default function JdScoreModal({ entityType, entityId, title, description, onConfirm, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<JdScoreData | null>(null);
  const [hourlyRate, setHourlyRate] = useState(25);
  const [clientName, setClientName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [res, settings]: any[] = await Promise.all([
          api.post(`/api/jd/analyze/${entityType}/${entityId}`, { title, description }),
          api.get(`/api/settings`).catch(() => null),
        ]);
        setData(res);
        setClientName(res?.extractedClientName || "");
        setCompanyName(res?.extractedCompanyName || "");
        setLinkedinUrl(res?.contactLinkedinUrl || "");
        const rate = Number(settings?.values?.jd_hourly_rate_usd);
        if (rate > 0) setHourlyRate(rate);
      } catch (e: any) {
        setError(e.message || "Failed to analyze job description.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "white", borderRadius: 12, padding: 24,
        maxWidth: data && !loading ? 920 : 420, width: "100%",
        display: "flex", gap: 24, alignItems: "flex-start",
        maxHeight: "90vh", overflowY: "auto",
      }}>
      <div style={{ flex: "1 1 380px", minWidth: 320 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>JD Quality Score</h3>

        {loading && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b" }}><span className="spinner" /> Analyzing job description…</div>}

        {error && (
          <div>
            <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 16 }}>{error}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={() => onConfirm({ clientName: "", companyName: "", linkedinUrl: "" })}>Proceed Anyway</button>
            </div>
          </div>
        )}

        {data && !loading && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%", background: scoreColor(data.score),
                color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 700,
              }}>{data.score}</div>
              <div style={{ fontSize: 13, color: "#334155" }}>{data.recommendation}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {[
                { label: flagLabel.duration(data.durationSignal), reason: flagReason.duration(data.durationSignal) },
                { label: flagLabel.budget(data.budgetMentioned, data.budgetAmount), reason: flagReason.budget(data.budgetMentioned, data.budgetAmount) },
                { label: flagLabel.timeline(data.timelinePressure), reason: flagReason.timeline(data.timelinePressure) },
                { label: flagLabel.questions(data.hasScreeningQuestions), reason: flagReason.questions(data.hasScreeningQuestions) },
                { label: flagLabel.type(data.projectType, data.existingSubtype), reason: flagReason.type(data.projectType, data.existingSubtype) },
              ].map(({ label, reason }, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span title={reason} style={{
                    fontSize: 12, padding: "4px 10px", borderRadius: 999, alignSelf: "flex-start",
                    background: "#f1f5f9", color: "#334155", cursor: "default",
                  }}>{label}</span>
                  <span style={{ fontSize: 11, color: "#64748b", paddingLeft: 4 }}>{reason}</span>
                </div>
              ))}
            </div>

            {data.estimatedHoursMin != null && data.estimatedHoursMax != null && (
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                  Est. effort: {data.estimatedHoursMin}–{data.estimatedHoursMax} hrs · ${Math.round(data.estimatedHoursMin * hourlyRate).toLocaleString()}–${Math.round(data.estimatedHoursMax * hourlyRate).toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{data.estimateNotes}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                  Assumes 1 freelancer using AI dev/design tools · @ ${hourlyRate}/hr (Settings → JD Hourly Rate)
                </div>
              </div>
            )}

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 8 }}>
                Client / company found — {sourceLabel(data.extractionSource)}
                {data.extractionSource !== "none" && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 999,
                    background: data.extractionConfidence === "high" ? "#dcfce7" : "#fef3c7",
                    color: data.extractionConfidence === "high" ? "#166534" : "#92400e",
                  }}>{data.extractionConfidence === "high" ? "high confidence" : "low confidence"}</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input className="input" placeholder="Client name (edit if wrong)" value={clientName}
                  onChange={e => setClientName(e.target.value)} style={{ fontSize: 13 }} />
                <input className="input" placeholder="Company name (edit if wrong)" value={companyName}
                  onChange={e => setCompanyName(e.target.value)} style={{ fontSize: 13 }} />
              </div>

              {(() => {
                const otherNames = (data.clientNameCandidates || []).filter(n => n && n !== clientName);
                const otherCompanies = (data.companyNameCandidates || []).filter(n => n && n !== companyName);
                if (otherNames.length === 0 && otherCompanies.length === 0) return null;
                return (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {otherNames.map(n => (
                      <span key={`n-${n}`} onClick={() => setClientName(n)} title="Also mentioned — click to use"
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#f1f5f9", color: "#334155", cursor: "pointer" }}>
                        also: {n}
                      </span>
                    ))}
                    {otherCompanies.map(n => (
                      <span key={`c-${n}`} onClick={() => setCompanyName(n)} title="Also mentioned — click to use"
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#f1f5f9", color: "#334155", cursor: "pointer" }}>
                        also: {n}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 8 }}>
                LinkedIn profile{data.contactLinkedinSource === "apollo" && (
                  <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#dcfce7", color: "#166534" }}>found via Apollo</span>
                )}
              </div>
              <input className="input" placeholder="https://linkedin.com/in/..." value={linkedinUrl}
                onChange={e => setLinkedinUrl(e.target.value)} style={{ fontSize: 13 }} />
              {!data.contactLinkedinUrl && clientName && (
                <a href={`https://www.google.com/search?q=${encodeURIComponent(`${clientName} ${companyName} linkedin`)}`}
                  target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, fontSize: 11, color: "#2563eb" }}>
                  Search manually →
                </a>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={() => onConfirm({ clientName, companyName, linkedinUrl })}>Continue to Generate</button>
            </div>
          </div>
        )}
      </div>

      {data && !loading && (
        <div style={{ flex: "1 1 320px", minWidth: 280, borderLeft: "1px solid #e2e8f0", paddingLeft: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 4 }}>Contact research</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>Guesswork only — nothing here is auto-applied. Click "Use" to fill the fields on the left.</div>

          <CandidateSection
            title="Apollo matches"
            badge="0 credits used"
            badgeColor={{ bg: "#dcfce7", fg: "#166534" }}
            candidates={data.apolloCandidates}
            emptyText="No Apollo matches (free discovery search only)."
            onUse={c => { setClientName(c.name); if (c.linkedinUrl) setLinkedinUrl(c.linkedinUrl); if (c.company) setCompanyName(c.company); }}
          />

          <div style={{ height: 16 }} />

          <CandidateSection
            title="Web search matches"
            badge={data.webSearchCandidates.length === 0 ? "not configured" : undefined}
            badgeColor={{ bg: "#f1f5f9", fg: "#64748b" }}
            candidates={data.webSearchCandidates}
            emptyText="No web search matches. Add a Serper.dev key in Settings to enable this panel."
            onUse={c => { if (c.linkedinUrl) setLinkedinUrl(c.linkedinUrl); }}
          />
        </div>
      )}
    </div>
    </div>
  );
}

function CandidateSection({ title, badge, badgeColor, candidates, emptyText, onUse }: {
  title: string;
  badge?: string;
  badgeColor?: { bg: string; fg: string };
  candidates: ContactCandidate[];
  emptyText: string;
  onUse: (c: ContactCandidate) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: badgeColor?.bg || "#f1f5f9", color: badgeColor?.fg || "#64748b" }}>
            {badge}
          </span>
        )}
      </div>
      {candidates.length === 0 ? (
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {candidates.map((c, i) => (
            <div key={i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                  {(c.title || c.company) && (
                    <div style={{ fontSize: 11, color: "#64748b" }}>{[c.title, c.company].filter(Boolean).join(" · ")}</div>
                  )}
                  {c.snippet && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{c.snippet}</div>}
                  {c.linkedinUrl && (
                    <a href={c.linkedinUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#2563eb" }}>{c.linkedinUrl}</a>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => onUse(c)}>Use</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
