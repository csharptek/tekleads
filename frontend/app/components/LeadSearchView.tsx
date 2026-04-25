"use client";
import { useState } from "react";
import { api } from "../../lib/api";

interface Lead {
  id: string;
  apolloId?: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  emails: string[];
  phones: string[];
  linkedinUrl?: string;
}

interface SearchResult { leads: Lead[]; total: number; }

export default function LeadSearchView() {
  const [form, setForm] = useState({ name: "", title: "", company: "", industry: "", location: "" });
  const [results, setResults] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "error"|"success"|"info"; text: string } | null>(null);
  const [searched, setSearched] = useState(false);

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const onSearch = async () => {
    setSearching(true);
    setBanner(null);
    setSelected(new Set());
    try {
      const data = await api.post<SearchResult>("/api/leads/search", form);
      setResults(data.leads || []);
      setTotal(data.total || 0);
      setSearched(true);
      if ((data.leads || []).length === 0)
        setBanner({ kind: "info", text: "No results found. Try broader filters." });
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setSearching(false); }
  };

  const toggleSelect = (id: string) =>
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelected(selected.size === results.length ? new Set() : new Set(results.map(l => l.id)));

  const onSave = async () => {
    const toSave = results.filter(l => selected.has(l.id));
    if (!toSave.length) { setBanner({ kind: "info", text: "Select leads to save." }); return; }
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.post<{ saved: number }>("/api/leads/save", toSave);
      setBanner({ kind: "success", text: `${res.saved} lead(s) saved.` });
      setSelected(new Set());
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setSaving(false); }
  };

  // Reveal phone for a saved lead (must be saved first with apolloId)
  const onReveal = async (lead: Lead) => {
    if (!lead.apolloId) { setBanner({ kind: "info", text: "Save this lead first to reveal phone." }); return; }
    setRevealingId(lead.id);
    setBanner(null);
    try {
      // Save lead first (so it exists in DB), then reveal
      await api.post("/api/leads/save", [lead]);
      const res = await api.post<{ phones: string[]; autoSaved: boolean }>(`/api/leads/${lead.id}/reveal-phone`, {});
      if (res.phones.length > 0) {
        setResults(prev => prev.map(l => l.id === lead.id ? { ...l, phones: res.phones } : l));
        setBanner({ kind: "success", text: `Phone revealed${res.autoSaved ? " and auto-saved" : ""}: ${res.phones.join(", ")}` });
      } else {
        setBanner({ kind: "info", text: "No phone number available for this contact." });
      }
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setRevealingId(null); }
  };

  const allSelected = results.length > 0 && selected.size === results.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Search</h1>
          <div className="page-sub">Search Apollo.io · Reveal phones · Save leads</div>
        </div>
        {selected.size > 0 && (
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {saving ? "Saving..." : `Save ${selected.size} Lead${selected.size > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="card-title">Search Filters</div>
        <div className="card-sub">Fill any combination of fields</div>
        <div className="grid-3">
          {([
            ["name",     "Person Name",  "e.g. John Smith"],
            ["title",    "Job Title",    "e.g. CTO"],
            ["company",  "Company",      "e.g. Acme Corp"],
            ["industry", "Industry",     "e.g. Software"],
            ["location", "Location",     "e.g. London"],
          ] as [keyof typeof form, string, string][]).map(([k, label, ph]) => (
            <div key={k}>
              <div className="field-label">{label}</div>
              <input className="input" placeholder={ph} value={form[k]}
                onChange={e => f(k, e.target.value)}
                onKeyDown={e => e.key === "Enter" && onSearch()} />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={onSearch} disabled={searching}>
              {searching ? <><span className="spinner" /> Searching…</> : "Search Apollo"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searched && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {total > 0 ? `${total.toLocaleString()} total · showing ${results.length}` : ""}
            </div>
            {results.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          {results.length === 0 ? null : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    </th>
                    <th>Name</th>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(lead => (
                    <tr key={lead.id} className={selected.has(lead.id) ? "selected" : ""}>
                      <td>
                        <input type="checkbox" checked={selected.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--text)" }}>{lead.name}</div>
                        {lead.linkedinUrl && (
                          <a href={lead.linkedinUrl} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: "var(--accent)" }}>LinkedIn ↗</a>
                        )}
                      </td>
                      <td style={{ color: "var(--muted)" }}>{lead.title}</td>
                      <td>{lead.company}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{lead.location}</td>
                      <td style={{ fontSize: 12 }}>
                        {lead.emails?.[0]
                          ? <span className="chip chip-blue">{lead.emails[0]}</span>
                          : <span style={{ color: "var(--dim)" }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {lead.phones?.[0]
                          ? <span className="chip chip-green">{lead.phones[0]}</span>
                          : <span style={{ color: "var(--dim)" }}>—</span>}
                      </td>
                      <td>
                        {!lead.phones?.[0] && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => onReveal(lead)}
                            disabled={revealingId === lead.id}
                          >
                            {revealingId === lead.id
                              ? <span className="spinner spinner-dark" />
                              : "Reveal Phone"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
