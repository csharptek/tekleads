"use client";
import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { get, post, del } from "../../lib/api";

interface Project {
  id: string;
  title: string;
  industry: string;
  tags: string[];
  problem: string;
  solution: string;
  techStack: string[];
  outcomes: string;
  links: string;
}

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/></svg>
);

export default function PortfolioPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", industry: "", tags: "", problem: "",
    solution: "", techStack: "", outcomes: "", links: "",
  });

  const load = useCallback(async () => {
    try {
      const data: Project[] = await get("/api/portfolio");
      setProjects(data || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    setLoading(true);
    try {
      const p = {
        title: form.title,
        industry: form.industry,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
        problem: form.problem,
        solution: form.solution,
        techStack: form.techStack.split(",").map(t => t.trim()).filter(Boolean),
        outcomes: form.outcomes,
        links: form.links,
      };
      const created: Project = await post("/api/portfolio", p);
      setProjects(prev => [created, ...prev]);
      setShowForm(false);
      setForm({ title: "", industry: "", tags: "", problem: "", solution: "", techStack: "", outcomes: "", links: "" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await del(`/api/portfolio/${id}`);
      setProjects(prev => prev.filter(p => p.id !== id));
      setSelected(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const filtered = projects.filter(p =>
    !search ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.industry.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Portfolio Intelligence"
        subtitle="Manage project data used for AI email generation"
        icon={ICON}
        actions={
          <button className="btn btn-primary" onClick={() => { setShowForm(!showForm); setSelected(null); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5v14"/></svg>
            Add Project
          </button>
        }
      />

      {error && (
        <div style={{ margin: "12px 20px 0", padding: "10px 14px", background: "var(--red-light)", border: "1px solid var(--red-light)", borderRadius: 8, fontSize: 12, color: "var(--red)", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* List */}
        <div style={{ width: 340, borderRight: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <input className="input" placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="scroll-y" style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">{ICON}</div>
                <div className="empty-title">No projects yet</div>
                <div className="empty-sub">Add your first project to get started</div>
              </div>
            ) : filtered.map(p => (
              <div
                key={p.id}
                className={`card card-hover ${selected?.id === p.id ? "card-active" : ""}`}
                style={{ padding: "14px 16px", cursor: "pointer" }}
                onClick={() => { setSelected(p); setShowForm(false); }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 8, lineHeight: 1.3 }}>{p.title}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {p.industry && <span className="chip chip-accent">{p.industry}</span>}
                  {p.tags.slice(0, 2).map(t => <span key={t} className="chip">{t}</span>)}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {(p.outcomes || "").substring(0, 70)}{p.outcomes && p.outcomes.length > 70 ? "..." : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail / Form */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showForm ? (
            <div className="scroll-y" style={{ flex: 1, padding: 32 }}>
              <div style={{ maxWidth: 720 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>New Project</h2>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 24 }}>Add project details to feed RAG-based email generation</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="label">Project Title</div>
                    <input className="input" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="AI-Powered Fleet Management" />
                  </div>
                  <div>
                    <div className="label">Industry</div>
                    <input className="input" value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} placeholder="Logistics" />
                  </div>
                  <div>
                    <div className="label">Tags</div>
                    <input className="input" value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} placeholder="AI, IoT, Real-time" />
                  </div>
                  <div>
                    <div className="label">Tech Stack</div>
                    <input className="input" value={form.techStack} onChange={e => setForm(p => ({ ...p, techStack: e.target.value }))} placeholder="Azure, Python, React" />
                  </div>
                  <div>
                    <div className="label">Links</div>
                    <input className="input" value={form.links} onChange={e => setForm(p => ({ ...p, links: e.target.value }))} placeholder="https://..." />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="label">Problem Statement</div>
                    <textarea className="textarea" rows={3} value={form.problem} onChange={e => setForm(p => ({ ...p, problem: e.target.value }))} placeholder="Describe the business problem" />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="label">Solution</div>
                    <textarea className="textarea" rows={3} value={form.solution} onChange={e => setForm(p => ({ ...p, solution: e.target.value }))} placeholder="Describe the solution" />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="label">Outcomes & Results</div>
                    <textarea className="textarea" rows={3} value={form.outcomes} onChange={e => setForm(p => ({ ...p, outcomes: e.target.value }))} placeholder="42% reduction in downtime, $2M savings" />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                  <button className="btn btn-primary" onClick={handleAdd} disabled={loading || !form.title}>
                    {loading ? <span className="spinner" /> : null}
                    {loading ? "Saving..." : "Save Project"}
                  </button>
                  <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="scroll-y fade-in" style={{ flex: 1, padding: 32 }}>
              <div style={{ maxWidth: 760 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, gap: 20 }}>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, lineHeight: 1.2 }}>{selected.title}</h2>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {selected.industry && <span className="chip chip-accent">{selected.industry}</span>}
                      {selected.tags.map(t => <span key={t} className="chip">{t}</span>)}
                    </div>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(selected.id)}>Delete</button>
                </div>

                {[
                  { label: "Problem Statement", value: selected.problem },
                  { label: "Solution", value: selected.solution },
                  { label: "Outcomes", value: selected.outcomes },
                ].filter(x => x.value).map(({ label, value }) => (
                  <div key={label} className="card" style={{ padding: "18px 20px", marginBottom: 14 }}>
                    <div className="label" style={{ marginBottom: 8 }}>{label}</div>
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>{value}</div>
                  </div>
                ))}

                {selected.techStack.length > 0 && (
                  <div className="card" style={{ padding: "18px 20px", marginBottom: 14 }}>
                    <div className="label" style={{ marginBottom: 10 }}>Tech Stack</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {selected.techStack.map(t => <span key={t} className="chip chip-green">{t}</span>)}
                    </div>
                  </div>
                )}

                {selected.links && (
                  <div className="card" style={{ padding: "18px 20px" }}>
                    <div className="label" style={{ marginBottom: 8 }}>Links</div>
                    <a href={selected.links} target="_blank" rel="noreferrer"
                      style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "none", wordBreak: "break-all" }}>
                      {selected.links}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">{ICON}</div>
              <div className="empty-title">Select a project</div>
              <div className="empty-sub">Choose from the list or add a new one</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
