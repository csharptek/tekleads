"use client";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface Project {
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
  createdAt: string;
}

const empty = (): Omit<Project, "id" | "embeddingIndexed" | "createdAt"> => ({
  title: "", industry: "", tags: [], problem: "",
  solution: "", techStack: "", outcomes: "", links: "",
});

function Banner({ b, onClose }: { b: { kind: "error"|"success"|"info"; text: string }; onClose: () => void }) {
  return (
    <div className={`banner banner-${b.kind}`}>
      <span>{b.text}</span>
      <button className="icon-btn" onClick={onClose}>✕</button>
    </div>
  );
}

export default function PortfolioView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState(empty());
  const [tagInput, setTagInput] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "error"|"success"|"info"; text: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    try { setProjects(await api.get<Project[]>("/api/portfolio")); } catch {}
  }

  const f = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  function addTag() {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) setForm(p => ({ ...p, tags: [...p.tags, t] }));
    setTagInput("");
  }

  function removeTag(t: string) {
    setForm(p => ({ ...p, tags: p.tags.filter(x => x !== t) }));
  }

  function startEdit(p: Project) {
    setEditId(p.id);
    setForm({ title: p.title, industry: p.industry, tags: p.tags, problem: p.problem,
               solution: p.solution, techStack: p.techStack, outcomes: p.outcomes, links: p.links });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelForm() {
    setShowForm(false); setEditId(null); setForm(empty()); setTagInput("");
  }

  async function handleSubmit() {
    if (!form.title.trim()) { setBanner({ kind: "error", text: "Title is required." }); return; }
    setLoading(true);
    try {
      if (editId) {
        await api.put(`/api/portfolio/${editId}`, form);
        setBanner({ kind: "success", text: "Project updated." });
      } else {
        await api.post("/api/portfolio", form);
        setBanner({ kind: "success", text: "Project saved." });
      }
      cancelForm();
      loadProjects();
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this project?")) return;
    try {
      await api.delete(`/api/portfolio/${id}`);
      loadProjects();
    } catch (e: any) { setBanner({ kind: "error", text: e.message }); }
  }

  async function handleIndex(id: string) {
    setIndexingId(id);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/api/portfolio/${id}/index`, {});
      setBanner({ kind: res.ok ? "success" : "error", text: res.message });
      if (res.ok) loadProjects();
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setIndexingId(null); }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Portfolio</div>
          <div className="page-sub">Projects used as RAG context for AI email generation</div>
        </div>
        <button className="btn btn-primary" onClick={() => { cancelForm(); setShowForm(s => !s); }}>
          + Add Project
        </button>
      </div>

      {banner && <Banner b={banner} onClose={() => setBanner(null)} />}

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">{editId ? "Edit Project" : "New Project"}</div>
          <div style={{ marginBottom: 16 }} />

          <div className="grid-2">
            <div>
              <div className="field-label">Project Title *</div>
              <input className="input" value={form.title} onChange={e => f("title")(e.target.value)} placeholder="e.g. AI Invoice Processor" />
            </div>
            <div>
              <div className="field-label">Industry</div>
              <input className="input" value={form.industry} onChange={e => f("industry")(e.target.value)} placeholder="e.g. Fintech" />
            </div>
            <div className="full">
              <div className="field-label">Tags</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                {form.tags.map(t => (
                  <span key={t} className="chip chip-blue" style={{ cursor: "pointer" }} onClick={() => removeTag(t)}>
                    {t} ✕
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" style={{ flex: 1 }} value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="Type tag and press Enter" />
                <button className="btn btn-ghost btn-sm" onClick={addTag}>Add</button>
              </div>
            </div>
            <div className="full">
              <div className="field-label">Problem Statement</div>
              <textarea className="input" rows={3} value={form.problem} onChange={e => f("problem")(e.target.value)} placeholder="What problem did you solve?" />
            </div>
            <div className="full">
              <div className="field-label">Solution</div>
              <textarea className="input" rows={3} value={form.solution} onChange={e => f("solution")(e.target.value)} placeholder="How did you solve it?" />
            </div>
            <div>
              <div className="field-label">Tech Stack</div>
              <input className="input" value={form.techStack} onChange={e => f("techStack")(e.target.value)} placeholder="React, .NET, Azure..." />
            </div>
            <div>
              <div className="field-label">Outcomes</div>
              <input className="input" value={form.outcomes} onChange={e => f("outcomes")(e.target.value)} placeholder="e.g. 40% cost reduction" />
            </div>
            <div className="full">
              <div className="field-label">Links</div>
              <input className="input" value={form.links} onChange={e => f("links")(e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" disabled={loading} onClick={handleSubmit}>
              {loading ? <span className="spinner" /> : null} {editId ? "Update" : "Save Project"}
            </button>
            <button className="btn btn-ghost" onClick={cancelForm}>Cancel</button>
          </div>
        </div>
      )}

      {projects.length === 0 && !showForm && (
        <div className="card">
          <div className="empty">
            <div className="empty-title">No projects yet</div>
            <div style={{ fontSize: 13, color: "var(--dim)", marginTop: 4 }}>Add your first project to enable AI email personalisation</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
        {projects.map(p => (
          <div key={p.id} className="card" style={{ position: "relative" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                {p.industry && <span className="chip">{p.industry}</span>}
              </div>
              <div style={{ display: "flex", gap: 6, marginLeft: 10, flexShrink: 0 }}>
                <span className={`chip ${p.embeddingIndexed ? "chip-green" : "chip-orange"}`}>
                  {p.embeddingIndexed ? "✓ Indexed" : "Not indexed"}
                </span>
              </div>
            </div>

            {/* Tags */}
            {p.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {p.tags.map(t => <span key={t} className="chip chip-blue">{t}</span>)}
              </div>
            )}

            {/* Problem */}
            {p.problem && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
                {p.problem.slice(0, 120)}{p.problem.length > 120 ? "…" : ""}
              </div>
            )}

            {/* Outcomes */}
            {p.outcomes && (
              <div style={{ padding: "7px 10px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.15)", marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>🎯 {p.outcomes}</span>
              </div>
            )}

            {/* Tech */}
            {p.techStack && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                <strong>Stack:</strong> {p.techStack}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>Edit</button>
              <button
                className="btn btn-sm"
                style={{ background: p.embeddingIndexed ? "var(--border)" : "var(--accent)", color: p.embeddingIndexed ? "var(--muted)" : "white" }}
                disabled={indexingId === p.id}
                onClick={() => handleIndex(p.id)}>
                {indexingId === p.id ? <><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /> Indexing…</> : p.embeddingIndexed ? "Re-index" : "Index for AI"}
              </button>
              {p.links && (
                <a href={p.links} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>
                  ↗ View
                </a>
              )}
              <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", marginLeft: "auto" }} onClick={() => handleDelete(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
