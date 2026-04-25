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
  const [page, setPage] = useState(1);
  const PER_PAGE = 25;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "error"|"success"|"info"; text: string } | null>(null);
  const [searched, setSearched] = useState(false);

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const doSearch = async (p: number) => {
    setSearching(true);
    setBanner(null);
    setSelected(new Set());
    try {
      const data = await api.post<SearchResult>("/api/leads/search", { ...form, page: p, perPage: PER_PAGE });
      setResults(data.leads || []);
      setTotal(data.total || 0);
      setPage(p);
      setSearched(true);
      if ((data.leads || []).length === 0)
        setBanner({ kind: "info", text: "No results. Try broader filters." });
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setSearching(false); }
  };

  const onSearch = () => doSearch(1);

  const toggleSelect = (id: string) =>
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelected(selected.size === results.length ? new Set() : new Set(results.map(l => l.id)));

  const onSave = async () => {
    const toSave = results.filter(l => selected.has(l.id));
    if (!toSave.length) { setBanner({ kind: "info", text: "Select leads to save." }); return; }
    setSaving(true); setBanner(null);
    try {
      const res = await api.post<{ saved: number }>("/api/leads/save", toSave);
      setBanner({ kind: "success", text: `${res.saved} lead(s) saved.` });
      setSelected(new Set());
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setSaving(false); }
  };

  const onReveal = async (lead: Lead) => {
    if (!lead.apolloId) { setBanner({ kind: "info", text: "Save this lead first." }); return; }
    setRevealingId(lead.id); setBanner(null);
    try {
      await api.post("/api/leads/save", [lead]);
      const res = await api.post<{ emails: string[]; phones: string[]; autoSaved: boolean; note?: string }>(
        `/api/leads/${lead.id}/reveal-phone`, {});
      setResults(prev => prev.map(l => l.id === lead.id
        ? { ...l, emails: res.emails.length ? res.emails : l.emails, phones: res.phones.length ? res.phones : l.phones }
        : l));
      if (res.phones.length > 0)
        setBanner({ kind: "success", text: `Phone: ${res.phones.join(", ")}${res.autoSaved ? " — auto-saved" : ""}` });
      else if (res.emails.length > 0)
        setBanner({ kind: "success", text: `Email found: ${res.emails[0]}${res.autoSaved ? " — auto-saved" : ""}` });
      else
        setBanner({ kind: "info", text: res.note || "No contact data available for this person." });
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setRevealingId(null); }
  };

  const totalPages = Math.ceil(total / PER_PAGE);
  const allSelected = results.length > 0 && selected.size === results.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Search</h1>
          <div className="page-sub">Search Apollo.io · Reveal contact info · Save leads</div>
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
        <div className="card-sub">Results include similar matches — Apollo fuzzy search</div>
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
              {searching ? <><span className="spinner" />&nbsp;Searching…</> : "Search Apollo"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searched && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {total > 0
                ? `${total.toLocaleString()} total · page ${page} of ${totalPages} · showing ${results.length}`
                : "No results"}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {results.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {allSelected ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
          </div>

          {results.length > 0 && (
            <>
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
                        <td><input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelect(lead.id)} /></td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>{lead.name || "—"}</div>
                          {lead.linkedinUrl && (
                            <a href={lead.linkedinUrl} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: "var(--accent)" }}>LinkedIn ↗</a>
                          )}
                        </td>
                        <td style={{ color: "var(--muted)" }}>{lead.title || "—"}</td>
                        <td>{lead.company || "—"}</td>
                        <td style={{ color: "var(--muted)", fontSize: 12 }}>{lead.location || "—"}</td>
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
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => onReveal(lead)}
                            disabled={revealingId === lead.id}
                          >
                            {revealingId === lead.id ? <span className="spinner spinner-dark" /> : "Enrich"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 16 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => doSearch(page - 1)} disabled={page <= 1 || searching}>
                    ← Prev
                  </button>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Page {page} / {totalPages}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => doSearch(page + 1)} disabled={page >= totalPages || searching}>
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
