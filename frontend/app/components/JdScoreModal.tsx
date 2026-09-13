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
}

interface Props {
  entityType: "proposal" | "job_lead";
  entityId: string;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}

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

  useEffect(() => {
    (async () => {
      try {
        const res: any = await api.post(`/api/jd/analyze/${entityType}/${entityId}`, { title, description });
        setData(res);
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
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 420, width: "100%" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>JD Quality Score</h3>

        {loading && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b" }}><span className="spinner" /> Analyzing job description…</div>}

        {error && (
          <div>
            <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 16 }}>{error}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={onConfirm}>Proceed Anyway</button>
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

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={onConfirm}>Continue to Generate</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
