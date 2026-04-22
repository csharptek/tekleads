"use client";
import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { get, post, del } from "../../lib/api";

const put = (path: string, body: unknown) =>
  fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000') + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => { if (!r.ok) throw new Error(r.statusText); });

interface Lead {
  id: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  emails?: string[];
  phones?: string[];
  linkedinUrl?: string;
  savedAt?: string;
}

interface SearchResult {
  leads: Lead[];
  hasMore: boolean;
  page: number;
}

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
);

const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

export default function LeadSearchPage() {
  const [filters, setFilters] = useState({ company: "", personName: "", jobTitle: "", industry: "", location: "" });
  const [results, setResults] = useState<Lead[]>([]);
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState<string | null>(null);
  const [tab, setTab] = useState<"search" | "saved">("search");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const loadSaved = useCallback(async () => {
    try {
      const data: Lead[] = await get("/api/leads/saved");
      setSavedLeads(data || []);
      setSavedIds(new Set((data || []).map(l => l.id)));
    } catch (e: any) {
      console.error("Failed to load saved leads:", e.message);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const handleSearch = async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data: SearchResult = await post("/api/leads/search", { ...filters, page: p, perPage: 25 });
      if (p === 1) setResults(data.leads);
      else setResults(prev => [...prev, ...data.leads]);
      setHasMore(data.hasMore);
      setPage(p);
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (lead: Lead) => {
    setSaveLoading(lead.id);
    try {
      if (savedIds.has(lead.id)) {
        await del(`/api/leads/${lead.id}`);
        setSavedIds(prev => { const s = new Set(prev); s.delete(lead.id); return s; });
        setSavedLeads(prev => prev.filter(l => l.id !== lead.id));
      } else {
        await post("/api/leads/save", lead);
        setSavedIds(prev => new Set([...prev, lead.id]));
        setSavedLeads(prev => [lead, ...prev]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaveLoading(null);
    }
  };

  const handleSavePhone = async () => {
    if (!selected || !savedIds.has(selected.id)) return;
    setPhoneSaving(true);
    try {
      const phones = phoneInput.split(',').map(p => p.trim()).filter(Boolean);
      await put(`/api/leads/${selected.id}/phones`, { phones });
      const updated = { ...selected, phones };
      setSelected(updated);
      setSavedLeads(prev => prev.map(l => l.id === selected.id ? updated : l));
      setEditingPhone(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPhoneSaving(false);
    }
  };

  const displayList = tab === "saved" ? savedLeads : results;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Lead Search"
        subtitle="Discover prospects via Apollo integration"
        icon={ICON}
      />

      {error && (
        <div style={{ margin: "12px 20px 0", padding: "10px 14px", background: "var(--red-light)", border: "1px solid var(--red-light)", borderRadius: 8, fontSize: 12, color: "var(--red)", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Filters */}
        <div style={{ width: 280, borderRight: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", flexDirection: "column" }}>
          <div className="scroll-y" style={{ flex: 1, padding: "18px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 14 }}>Search Filters</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { key: "personName", label: "Person Name", placeholder: "Sarah Chen" },
                { key: "company", label: "Company", placeholder: "Nexora Systems" },
                { key: "jobTitle", label: "Job Title", placeholder: "VP Engineering" },
                { key: "industry", label: "Industry", placeholder: "SaaS" },
                { key: "location", label: "Location", placeholder: "San Francisco" },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <div className="label">{label}</div>
                  <input
                    className="input"
                    placeholder={placeholder}
                    value={(filters as any)[key]}
                    onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && handleSearch(1)}
                  />
                </div>
              ))}
              <button className="btn btn-primary" onClick={() => handleSearch(1)} disabled={loading} style={{ marginTop: 4 }}>
                {loading ? <span className="spinner" /> : null}
                {loading ? "Searching..." : "Search Apollo"}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="tab-bar">
            <button className={`tab ${tab === "search" ? "tab-active" : ""}`} onClick={() => { setTab("search"); setSelected(null); }}>
              Search Results {results.length > 0 && <span className="chip" style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10 }}>{results.length}</span>}
            </button>
            <button className={`tab ${tab === "saved" ? "tab-active" : ""}`} onClick={() => { setTab("saved"); setSelected(null); }}>
              Saved {savedLeads.length > 0 && <span className="chip" style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10 }}>{savedLeads.length}</span>}
            </button>
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* List */}
            <div className="scroll-y" style={{ width: 340, borderRight: "1px solid var(--border)", background: "var(--bg-card)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {displayList.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon">{ICON}</div>
                  <div className="empty-title">{tab === "search" ? "No results yet" : "No saved leads"}</div>
                  <div className="empty-sub">{tab === "search" ? "Run a search to find prospects" : "Star leads from search to save them"}</div>
                </div>
              ) : (
                <>
                  {displayList.map(lead => (
                    <div
                      key={lead.id}
                      className={`card card-hover ${selected?.id === lead.id ? "card-active" : ""}`}
                      style={{ padding: "12px 14px", cursor: "pointer" }}
                      onClick={() => setSelected(lead)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{lead.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.title}</div>
                          <div style={{ fontSize: 11, color: "var(--accent-text)", fontWeight: 500 }}>{lead.company}</div>
                        </div>
                        <button
                          className="btn btn-xs"
                          style={{ flexShrink: 0, color: savedIds.has(lead.id) ? "var(--orange)" : "var(--text-dim)" }}
                          disabled={saveLoading === lead.id}
                          onClick={e => { e.stopPropagation(); handleSave(lead); }}
                        >
                          {saveLoading === lead.id ? <span className="spinner-dark spinner" /> : <StarIcon filled={savedIds.has(lead.id)} />}
                        </button>
                      </div>
                      {(lead.industry || lead.location) && (
                        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                          {lead.industry && <span className="chip">{lead.industry}</span>}
                          {lead.location && <span className="chip">{lead.location}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {hasMore && tab === "search" && (
                    <button className="btn" onClick={() => handleSearch(page + 1)} disabled={loading} style={{ marginTop: 4 }}>
                      {loading ? "Loading..." : "Load More"}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Detail */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {selected ? (
                <div className="fade-in" style={{ padding: 32 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, gap: 20 }}>
                    <div>
                      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{selected.name}</h2>
                      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>{selected.title}</div>
                      <div style={{ fontSize: 13, color: "var(--accent-text)", fontWeight: 500 }}>{selected.company}</div>
                    </div>
                    <button
                      className={savedIds.has(selected.id) ? "btn btn-sm" : "btn btn-primary btn-sm"}
                      disabled={saveLoading === selected.id}
                      onClick={() => handleSave(selected)}
                    >
                      <StarIcon filled={savedIds.has(selected.id)} />
                      {savedIds.has(selected.id) ? "Saved" : "Save Lead"}
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    {[
                      { label: "Industry", value: selected.industry || "—" },
                      { label: "Location", value: selected.location || "—" },
                      { label: "Email", value: selected.emails?.join(", ") || "—" },
                      { label: "Company", value: selected.company || "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="card" style={{ padding: "14px 16px" }}>
                        <div className="label" style={{ marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 13, color: "var(--text)", wordBreak: "break-word" }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {selected.linkedinUrl && (
                    <div className="card" style={{ padding: "14px 16px", marginBottom: 14 }}>
                      <div className="label" style={{ marginBottom: 6 }}>LinkedIn</div>
                      <a href={selected.linkedinUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "none", wordBreak: "break-all" }}>
                        {selected.linkedinUrl}
                      </a>
                    </div>
                  )}

                  {savedIds.has(selected.id) && (
                    <div className="card" style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div className="label" style={{ margin: 0 }}>Phone Numbers</div>
                        {!editingPhone ? (
                          <button className="btn btn-xs" onClick={() => { setPhoneInput((selected.phones || []).join(", ")); setEditingPhone(true); }}>Edit</button>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-primary btn-xs" onClick={handleSavePhone} disabled={phoneSaving}>
                              {phoneSaving ? "..." : "Save"}
                            </button>
                            <button className="btn btn-xs" onClick={() => setEditingPhone(false)}>Cancel</button>
                          </div>
                        )}
                      </div>
                      {editingPhone ? (
                        <>
                          <input className="input" placeholder="+91 98765 43210, +1 555 000 0000" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} autoFocus />
                          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>
                            Separate multiple numbers with commas. Include country code.
                          </div>
                        </>
                      ) : (
                        selected.phones && selected.phones.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {selected.phones.map((p, i) => (
                              <div key={i} className="mono" style={{ fontSize: 13, color: "var(--green)" }}>{p}</div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No phone saved — click Edit to add one</div>
                        )
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-icon">{ICON}</div>
                  <div className="empty-title">Select a lead</div>
                  <div className="empty-sub">Choose a lead to view details</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
