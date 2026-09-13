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

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              {[
                flagLabel.duration(data.durationSignal),
                flagLabel.budget(data.budgetMentioned, data.budgetAmount),
                flagLabel.timeline(data.timelinePressure),
                flagLabel.questions(data.hasScreeningQuestions),
                flagLabel.type(data.projectType, data.existingSubtype),
              ].map((label, i) => (
                <span key={i} style={{
                  fontSize: 12, padding: "4px 10px", borderRadius: 999,
                  background: "#f1f5f9", color: "#334155",
                }}>{label}</span>
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
