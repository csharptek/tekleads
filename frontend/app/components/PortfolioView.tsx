"use client";
import { useState, useEffect, useRef } from "react";
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

interface FormState {
  title: string; industry: string; tags: string[];
  problem: string; solution: string; techStack: string;
  outcomes: string; links: string[];
}

type ViewMode = "card" | "list";
type SortKey = "date" | "title" | "indexed";

const empty = (): FormState => ({
  title: "", industry: "", tags: [], problem: "",
  solution: "", techStack: "", outcomes: "", links: [""],
});

function Banner({ b, onClose }: { b: { kind: "error" | "success" | "info"; text: string }; onClose: () => void }) {
  return (
    <div className={`banner banner-${b.kind}`}>
      <span>{b.text}</span>
      <button className="icon-btn" onClick={onClose}>✕</button>
    </div>
  );
}

const GridIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
  </svg>
);

const ListIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);

export default function PortfolioView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<FormState>(empty());
  const [tagInput, setTagInput] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setJustSavedId(null);
    const linksArr = Array.isArray(p.links)
      ? p.links
      : (typeof p.links === "string" && p.links ? p.links.split("\n").filter(Boolean) : [""]);
    setForm({
      title: p.title, industry: p.industry, tags: p.tags, problem: p.problem,
      solution: p.solution, techStack: p.techStack, outcomes: p.outcomes,
      links: linksArr.length ? linksArr : [""],
    });
    setShowForm(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function cancelForm() {
    setShowForm(false); setEditId(null); setForm(empty()); setTagInput(""); setJustSavedId(null);
  }

  async function handleExtract(file: File) {
    setExtracting(true);
    setBanner({ kind: "info", text: `Reading ${file.name}…` });
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1]);
        r.onerror = () => rej(new Error("File read failed"));
        r.readAsDataURL(file);
      });
      const result = await api.post<{ ok: boolean; message: string; project: any }>("/api/portfolio/extract", { fileName: file.name, base64 });
      if (!result.ok) { setBanner({ kind: "error", text: result.message }); return; }
      const p = result.project;
      const linksArr = typeof p.links === "string" && p.links ? p.links.split("\n").filter(Boolean) : [];
      setForm({
        title: p.title || "", industry: p.industry || "", tags: p.tags || [],
        problem: p.problem || "", solution: p.solution || "",
        techStack: p.techStack || "", outcomes: p.outcomes || "",
        links: linksArr.length ? linksArr : [""],
      });
      setShowForm(true);
      setBanner({ kind: "success", text: "Fields extracted — review and save." });
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setExtracting(false); }
  }

  async function handleSubmit() {
    if (!form.title.trim()) { setBanner({ kind: "error", text: "Title is required." }); return; }
    setLoading(true);
    const payload = { ...form, links: form.links.filter(l => l.trim()).join("\n") };
    try {
      let savedId = editId;
      if (editId) {
        await api.put(`/api/portfolio/${editId}`, payload);
        setBanner({ kind: "success", text: "Project updated." });
      } else {
        const res = await api.post<{ id: string }>("/api/portfolio", payload);
        savedId = res.id;
        if (!editId && savedId) setEditId(savedId);
        setBanner({ kind: "success", text: "Project saved." });
      }
      await loadProjects();
      setJustSavedId(savedId);
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/portfolio/${id}`);
      setDeleteConfirmId(null);
      loadProjects();
    } catch (e: any) { setBanner({ kind: "error", text: e.message }); }
  }

  async function handleIndex(id: string) {
    setIndexingId(id);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/api/portfolio/${id}/index`, {});
      setBanner({ kind: res.ok ? "success" : "error", text: res.message });
      if (res.ok) { loadProjects(); setJustSavedId(null); }
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setIndexingId(null); }
  }

  const filtered = projects
    .filter(p => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return p.title.toLowerCase().includes(q)
        || p.industry.toLowerCase().includes(q)
        || p.tags.some(t => t.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortKey === "title") return a.title.localeCompare(b.title);
      if (sortKey === "indexed") return (b.embeddingIndexed ? 1 : 0) - (a.embeddingIndexed ? 1 : 0);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const indexedCount = projects.filter(p => p.embeddingIndexed).length;

  const toggleStyle = (active: boolean) => ({
    display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
    borderRadius: 6, border: "none", cursor: "pointer" as const, fontSize: 12, fontWeight: 500,
    background: active ? "white" : "transparent",
    color: active ? "var(--accent)" : "var(--muted)",
    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
    transition: "all 0.15s",
  });

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Portfolio</div>
          <div className="page-sub" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            Projects used as RAG context for AI email generation
            {projects.length > 0 && (
              <span className={`chip ${indexedCount === projects.length ? "chip-green" : indexedCount > 0 ? "chip-orange" : "chip-red"}`}
                style={{ fontSize: 11 }}>
                {indexedCount}/{projects.length} indexed for AI
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* View toggle */}
          <div style={{ display: "flex", background: "var(--border)", borderRadius: 8, padding: 2, gap: 2 }}>
            <button style={toggleStyle(viewMode === "card")} onClick={() => setViewMode("card")}>
              <GridIcon /> Cards
            </button>
            <button style={toggleStyle(viewMode === "list")} onClick={() => setViewMode("list")}>
              <ListIcon /> List
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" style={{ display: "none" }}
            onChange={e => { const fl = e.target.files?.[0]; if (fl) handleExtract(fl); e.target.value = ""; }} />
          <button className="btn btn-ghost" disabled={extracting} onClick={() => fileRef.current?.click()}>
            {extracting ? <><span className="spinner spinner-dark" /> Extracting…</> : "↑ Upload & Extract"}
          </button>
          <button className="btn btn-primary" onClick={() => { cancelForm(); setShowForm(s => !s); }}>
            + Add Project
          </button>
        </div>
      </div>

      {banner && <Banner b={banner} onClose={() => setBanner(null)} />}

      {/* Form */}
      <div ref={formRef}>
        {showForm && (
          <div className="card" style={{ marginBottom: 20, borderLeft: `3px solid ${editId ? "var(--accent)" : "var(--green)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div className="card-title" style={{ marginBottom: 2 }}>{editId ? "Edit Project" : "New Project"}</div>
                {editId && <div style={{ fontSize: 11, color: "var(--muted)" }}>ID: {editId.slice(0, 8)}…</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={cancelForm}>✕ Cancel</button>
            </div>

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
                    <span key={t} className="chip chip-blue" style={{ cursor: "pointer" }} onClick={() => removeTag(t)}>{t} ✕</span>
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
                {form.links.map((link, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input className="input" style={{ flex: 1 }} value={link}
                      onChange={e => {
                        const arr = [...form.links]; arr[i] = e.target.value;
                        setForm(p => ({ ...p, links: arr }));
                      }}
                      placeholder="https://..." />
                    {form.links.length > 1 && (
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
                        onClick={() => setForm(p => ({ ...p, links: p.links.filter((_, j) => j !== i) }))}>✕</button>
                    )}
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 2 }}
                  onClick={() => setForm(p => ({ ...p, links: [...p.links, ""] }))}>+ Add Link</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn-primary" disabled={loading} onClick={handleSubmit}>
                {loading ? <span className="spinner" /> : null} {editId ? "Update Project" : "Save Project"}
              </button>

              {justSavedId && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                  background: "var(--accent-light)", border: "1px solid #bfdbfe", borderRadius: 8,
                }}>
                  <span style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 500 }}>
                    ✓ Saved — index for AI?
                  </span>
                  <button className="btn btn-sm"
                    style={{ background: "var(--accent)", color: "white", fontSize: 12 }}
                    disabled={indexingId === justSavedId}
                    onClick={() => handleIndex(justSavedId)}>
                    {indexingId === justSavedId
                      ? <><span className="spinner" style={{ borderTopColor: "white" }} /> Indexing…</>
                      : "Index for AI"}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                    onClick={() => { setJustSavedId(null); cancelForm(); }}>
                    Done
                  </button>
                </div>
              )}

              {!justSavedId && <button className="btn btn-ghost" onClick={cancelForm}>Cancel</button>}
            </div>
          </div>
        )}
      </div>

      {/* Search + sort bar */}
      {projects.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 360, minWidth: 200 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" strokeWidth="2"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input className="input" style={{ paddingLeft: 32, height: 36 }}
              placeholder="Search title, industry, tag…"
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button onClick={() => setSearch("")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, lineHeight: 1 }}>
                ✕
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Sort:</span>
            {(["date", "title", "indexed"] as SortKey[]).map(k => (
              <button key={k} onClick={() => setSortKey(k)}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
                  background: sortKey === k ? "var(--accent)" : "white",
                  color: sortKey === k ? "white" : "var(--muted)",
                  fontSize: 12, cursor: "pointer", fontWeight: sortKey === k ? 600 : 400,
                  transition: "all 0.15s",
                }}>
                {k === "date" ? "Newest" : k === "title" ? "A–Z" : "Indexed first"}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--dim)", marginLeft: "auto" }}>
            {filtered.length} of {projects.length}
          </span>
        </div>
      )}

      {/* Empty states */}
      {projects.length === 0 && !showForm && (
        <div className="card">
          <div className="empty">
            <div className="empty-title">No projects yet</div>
            <div style={{ fontSize: 13, color: "var(--dim)", marginTop: 4 }}>Add your first project to enable AI email personalisation</div>
          </div>
        </div>
      )}
      {projects.length > 0 && filtered.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No projects match "{search}"</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSearch("")}>Clear search</button>
        </div>
      )}

      {/* ── Card view ── */}
      {viewMode === "card" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
          {filtered.map(p => (
            <div key={p.id} className="card" style={{
              position: "relative",
              borderLeft: `3px solid ${p.embeddingIndexed ? "var(--green)" : "var(--border)"}`,
              transition: "border-color 0.2s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                  {p.industry && <span className="chip">{p.industry}</span>}
                </div>
                <span className={`chip ${p.embeddingIndexed ? "chip-green" : "chip-orange"}`} style={{ marginLeft: 10, flexShrink: 0, fontSize: 11 }}>
                  {p.embeddingIndexed ? "✓ Indexed" : "Not indexed"}
                </span>
              </div>

              {p.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {p.tags.map(t => <span key={t} className="chip chip-blue">{t}</span>)}
                </div>
              )}

              {p.problem && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
                  {p.problem.slice(0, 120)}{p.problem.length > 120 ? "…" : ""}
                </div>
              )}

              {p.outcomes && (
                <div style={{ padding: "7px 10px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.15)", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>🎯 {p.outcomes}</span>
                </div>
              )}

              {p.techStack && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  <strong>Stack:</strong> {p.techStack}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>✏️ Edit</button>
                <button className="btn btn-sm"
                  style={{ background: p.embeddingIndexed ? "var(--border)" : "var(--accent)", color: p.embeddingIndexed ? "var(--muted)" : "white" }}
                  disabled={indexingId === p.id}
                  onClick={() => handleIndex(p.id)}>
                  {indexingId === p.id
                    ? <><span className="spinner" style={{ borderTopColor: p.embeddingIndexed ? "var(--muted)" : "white" }} /> Indexing…</>
                    : p.embeddingIndexed ? "Re-index" : "Index for AI"}
                </button>
                {p.links && p.links.split("\n").filter(Boolean).map((url, i, arr) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                    className="btn btn-ghost btn-sm" style={{ textDecoration: "none", fontSize: 11 }}>
                    ↗ {arr.length > 1 ? `Link ${i + 1}` : "Link"}
                  </a>
                ))}
                {deleteConfirmId === p.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                    <span style={{ fontSize: 11, color: "var(--red)" }}>Delete?</span>
                    <button className="btn btn-sm" style={{ background: "var(--red)", color: "white", fontSize: 11 }} onClick={() => handleDelete(p.id)}>Yes</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setDeleteConfirmId(null)}>No</button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", marginLeft: "auto" }}
                    onClick={() => setDeleteConfirmId(p.id)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── List view ── */}
      {viewMode === "list" && filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "2px solid var(--border)" }}>
                {["Project", "Industry", "Tags", "Outcomes", "Status", "Actions"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <>
                  <tr key={p.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: expandedId === p.id ? "var(--accent-light)" : i % 2 === 0 ? "white" : "var(--bg)",
                      cursor: "pointer", transition: "background 0.15s",
                    }}
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, color: "var(--dim)", display: "inline-block", transition: "transform 0.15s", transform: expandedId === p.id ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{p.title}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>{p.industry || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {p.tags.slice(0, 3).map(t => <span key={t} className="chip chip-blue" style={{ fontSize: 10 }}>{t}</span>)}
                        {p.tags.length > 3 && <span className="chip" style={{ fontSize: 10 }}>+{p.tags.length - 3}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--green)", maxWidth: 200 }}>
                      {p.outcomes ? `🎯 ${p.outcomes.slice(0, 50)}${p.outcomes.length > 50 ? "…" : ""}` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className={`chip ${p.embeddingIndexed ? "chip-green" : "chip-orange"}`} style={{ fontSize: 10 }}>
                        {p.embeddingIndexed ? "✓ Indexed" : "Not indexed"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => startEdit(p)}>Edit</button>
                        <button className="btn btn-sm"
                          style={{ fontSize: 11, background: p.embeddingIndexed ? "var(--border)" : "var(--accent)", color: p.embeddingIndexed ? "var(--muted)" : "white" }}
                          disabled={indexingId === p.id} onClick={() => handleIndex(p.id)}>
                          {indexingId === p.id ? "…" : p.embeddingIndexed ? "Re-index" : "Index"}
                        </button>
                        {deleteConfirmId === p.id ? (
                          <>
                            <button className="btn btn-sm" style={{ fontSize: 11, background: "var(--red)", color: "white" }} onClick={() => handleDelete(p.id)}>Yes</button>
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setDeleteConfirmId(null)}>No</button>
                          </>
                        ) : (
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "var(--red)" }} onClick={() => setDeleteConfirmId(p.id)}>Del</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === p.id && (
                    <tr key={`${p.id}-exp`} style={{ borderBottom: "1px solid var(--border)", background: "var(--accent-light)" }}>
                      <td colSpan={6} style={{ padding: "12px 40px 16px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                          {p.problem && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Problem</div>
                              <div style={{ fontSize: 12, lineHeight: 1.6 }}>{p.problem}</div>
                            </div>
                          )}
                          {p.solution && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Solution</div>
                              <div style={{ fontSize: 12, lineHeight: 1.6 }}>{p.solution}</div>
                            </div>
                          )}
                          {p.techStack && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Tech Stack</div>
                              <div style={{ fontSize: 12 }}>{p.techStack}</div>
                            </div>
                          )}
                          {p.links && p.links.split("\n").filter(Boolean).length > 0 && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Links</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {p.links.split("\n").filter(Boolean).map((url, li) => (
                                  <a key={li} href={url} target="_blank" rel="noreferrer"
                                    className="btn btn-ghost btn-sm" style={{ fontSize: 11, textDecoration: "none" }}>
                                    ↗ Link {li + 1}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
