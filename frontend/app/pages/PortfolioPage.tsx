"use client";
import { useState } from "react";
import PageHeader from "../components/PageHeader";

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

const MOCK_PROJECTS: Project[] = [
  {
    id: "1",
    title: "AI-Powered Fleet Management",
    industry: "Logistics",
    tags: ["AI", "IoT", "Real-time"],
    problem: "Manual fleet tracking causing 30% downtime",
    solution: "ML-based predictive maintenance + live GPS",
    techStack: ["Azure", "Python", "React", "CosmosDB"],
    outcomes: "42% reduction in downtime, $2M savings",
    links: "https://example.com",
  },
  {
    id: "2",
    title: "Healthcare Claims Automation",
    industry: "Healthcare",
    tags: ["RPA", "ML", "Compliance"],
    problem: "Manual claims processing taking 14 days avg",
    solution: "Automated OCR + NLP claims extraction",
    techStack: [".NET", "Azure AI", "SQL Server"],
    outcomes: "Claims processed in 2hrs, 95% accuracy",
    links: "",
  },
];

export default function PortfolioPage() {
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [form, setForm] = useState({
    title: "", industry: "", tags: "", problem: "",
    solution: "", techStack: "", outcomes: "", links: "",
  });

  const handleAdd = () => {
    const p: Project = {
      id: Date.now().toString(),
      title: form.title,
      industry: form.industry,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      problem: form.problem,
      solution: form.solution,
      techStack: form.techStack.split(",").map(t => t.trim()).filter(Boolean),
      outcomes: form.outcomes,
      links: form.links,
    };
    setProjects(prev => [p, ...prev]);
    setShowForm(false);
    setForm({ title: "", industry: "", tags: "", problem: "", solution: "", techStack: "", outcomes: "", links: "" });
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Portfolio Intelligence"
        subtitle="Manage project data used for AI email generation"
        icon="◈"
        actions={
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            + Add Project
          </button>
        }
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Project List */}
        <div style={{
          width: 320, borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <input className="input" placeholder="Search projects..." style={{ fontSize: 11 }} />
          </div>
          <div className="scroll-y" style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {projects.map(p => (
              <div
                key={p.id}
                className={`card ${selected?.id === p.id ? "card-active" : ""}`}
                style={{ padding: "12px 14px", cursor: "pointer" }}
                onClick={() => setSelected(p)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{
                    fontFamily: "Syne, sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text)",
                    lineHeight: 1.3,
                  }}>{p.title}</div>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                  <span className="chip chip-accent">{p.industry}</span>
                  {p.tags.slice(0, 2).map(t => <span key={t} className="chip">{t}</span>)}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {p.outcomes.substring(0, 60)}...
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Detail / Add Form */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showForm ? (
            <div className="scroll-y" style={{ flex: 1, padding: 24 }}>
              <div style={{ maxWidth: 600 }}>
                <div style={{
                  fontFamily: "Syne, sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  marginBottom: 20,
                  color: "var(--text)",
                }}>New Project</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {[
                    { key: "title", label: "Project Title", full: true },
                    { key: "industry", label: "Industry" },
                    { key: "tags", label: "Tags (comma-separated)" },
                    { key: "techStack", label: "Tech Stack (comma-separated)" },
                    { key: "links", label: "Links" },
                  ].map(({ key, label, full }) => (
                    <div key={key} style={{ gridColumn: full ? "1 / -1" : undefined }}>
                      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
                      <input
                        className="input"
                        value={(form as any)[key]}
                        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={label}
                      />
                    </div>
                  ))}
                  {[
                    { key: "problem", label: "Problem Statement" },
                    { key: "solution", label: "Solution" },
                    { key: "outcomes", label: "Outcomes & Results", full: true },
                  ].map(({ key, label, full }) => (
                    <div key={key} style={{ gridColumn: full ? "1 / -1" : undefined }}>
                      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
                      <textarea
                        className="textarea"
                        rows={3}
                        value={(form as any)[key]}
                        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder={label}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button className="btn btn-primary" onClick={handleAdd}>Save Project</button>
                  <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="scroll-y fade-in" style={{ flex: 1, padding: 28 }}>
              <div style={{ maxWidth: 640 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{selected.title}</h2>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className="chip chip-accent">{selected.industry}</span>
                      {selected.tags.map(t => <span key={t} className="chip">{t}</span>)}
                    </div>
                  </div>
                  <button className="btn btn-danger" onClick={() => {
                    setProjects(prev => prev.filter(p => p.id !== selected.id));
                    setSelected(null);
                  }}>Delete</button>
                </div>

                {[
                  { label: "Problem Statement", value: selected.problem },
                  { label: "Solution", value: selected.solution },
                  { label: "Outcomes", value: selected.outcomes },
                ].map(({ label, value }) => (
                  <div key={label} className="card" style={{ padding: "14px 16px", marginBottom: 12 }}>
                    <div className="label" style={{ marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>{value}</div>
                  </div>
                ))}

                <div className="card" style={{ padding: "14px 16px", marginBottom: 12 }}>
                  <div className="label" style={{ marginBottom: 8 }}>Tech Stack</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selected.techStack.map(t => <span key={t} className="chip chip-green">{t}</span>)}
                  </div>
                </div>

                {selected.links && (
                  <div className="card" style={{ padding: "14px 16px" }}>
                    <div className="label" style={{ marginBottom: 6 }}>Links</div>
                    <a href={selected.links} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>
                      {selected.links}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              color: "var(--text-dim)",
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
              <div style={{ fontFamily: "Syne, sans-serif", fontSize: 14, marginBottom: 6 }}>Select a project</div>
              <div style={{ fontSize: 11 }}>or add a new one</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
