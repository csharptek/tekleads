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
      setSavedLeads(data);
      setSavedIds(new Set(data.map(l => l.id)));
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
    if (savedIds.has(lead.id)) {
      // Unsave
      setSaveLoading(lead.id);
      try {
        await del(`/api/leads/${lead.id}`);
        setSavedIds(prev => { const s = new Set(prev); s.delete(lead.id); return s; });
        setSavedLeads(prev => prev.filter(l => l.id !== lead.id));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaveLoading(null);
      }
    } else {
      // Save
      setSaveLoading(lead.id);
      try {
        await post("/api/leads/save", lead);
        setSavedIds(prev => new Set([...prev, lead.id]));
        setSavedLeads(prev => [lead, ...prev]);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaveLoading(null);
      }
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
        icon="◎"
      />

      {error && (
        <div style={{
          margin: "0 16px",
          padding: "8px 12px",
          background: "rgba(255,68,68,0.08)",
          border: "1px solid rgba(255,68,68,0.3)",
          borderRadius: 4,
          fontSize: 11,
          color: "var(--red)",
          flexShrink: 0,
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: "right", background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Filters */}
        <div style={{ width: 260, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 14px", borderBottom: "1px solid var(--border)" }}>
            <div className="label" style={{ marginBottom: 12 }}>Search Filters</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { key: "personName", placeholder: "Person name" },
                { key: "company", placeholder: "Company name" },
                { key: "jobTitle", placeholder: "Job title" },
                { key: "industry", placeholder: "Industry" },
                { key: "location", placeholder: "Location" },
              ].map(({ key, placeholder }) => (
                <div key={key}>
                  <div className="label" style={{ marginBottom: 4, fontSize: 9 }}>{key.replace(/([A-Z])/g, ' $1').toUpperCase()}</div>
                  <input
                    className="input"
                    style={{ fontSize: 11 }}
                    placeholder={placeholder}
                    value={(filters as any)[key]}
                    onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && handleSearch(1)}
                  />
                </div>
              ))}
              <button
                className="btn btn-primary"
                style={{ marginTop: 4, justifyContent: "center" }}
                onClick={() => handleSearch(1)}
                disabled={loading}
              >
                {loading ? "Searching..." : "Search Apollo"}
              </button>
            </div>
          </div>

          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Results", value: results.length },
                { label: "Saved", value: savedLeads.length },
              ].map(({ label, value }) => (
                <div key={label} className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 18, fontFamily: "Syne, sans-serif", fontWeight: 700, color: "var(--accent)" }}>{value}</div>
                  <div className="label" style={{ fontSize: 9, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 16px" }}>
            {(["search", "saved"] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelected(null); }}
                style={{
                  fontFamily: "DM Mono, monospace",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  padding: "12px 16px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: tab === t ? "var(--accent)" : "var(--text-muted)",
                  borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                {t === "search" ? `Results (${results.length})` : `Saved (${savedLeads.length})`}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* List */}
            <div className="scroll-y" style={{ width: 320, borderRight: "1px solid var(--border)", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {displayList.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-dim)" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>◎</div>
                  <div style={{ fontSize: 11 }}>
                    {tab === "search" ? "Run a search to see results" : "No saved leads yet"}
                  </div>
                </div>
              ) : (
                <>
                  {displayList.map(lead => (
                    <div
                      key={lead.id}
                      className={`card ${selected?.id === lead.id ? "card-active" : ""}`}
                      style={{ padding: "11px 13px", cursor: "pointer" }}
                      onClick={() => setSelected(lead)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "Syne, sans-serif", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{lead.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>{lead.title}</div>
                          <div style={{ fontSize: 10, color: "var(--accent)" }}>{lead.company}</div>
                        </div>
                        <button
                          className="btn"
                          style={{ padding: "4px 8px", fontSize: 11, flexShrink: 0, opacity: saveLoading === lead.id ? 0.5 : 1 }}
                          disabled={saveLoading === lead.id}
                          onClick={e => { e.stopPropagation(); handleSave(lead); }}
                        >
                          {saveLoading === lead.id ? "…" : savedIds.has(lead.id) ? "★" : "☆"}
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                        {lead.industry && <span className="chip">{lead.industry}</span>}
                        {lead.location && <span className="chip">{lead.location}</span>}
                      </div>
                    </div>
                  ))}
                  {hasMore && tab === "search" && (
                    <button
                      className="btn"
                      style={{ justifyContent: "center", marginTop: 4 }}
                      onClick={() => handleSearch(page + 1)}
                      disabled={loading}
                    >
                      {loading ? "Loading..." : "Load More"}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Detail */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {selected ? (
                <div className="fade-in" style={{ padding: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{selected.name}</h2>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{selected.title}</div>
                      <div style={{ fontSize: 12, color: "var(--accent)" }}>{selected.company}</div>
                    </div>
                    <button
                      className="btn"
                      style={{ fontSize: 10, opacity: saveLoading === selected.id ? 0.5 : 1 }}
                      disabled={saveLoading === selected.id}
                      onClick={() => handleSave(selected)}
                    >
                      {saveLoading === selected.id ? "…" : savedIds.has(selected.id) ? "★ Saved" : "☆ Save"}
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    {[
                      { label: "Industry", value: selected.industry },
                      { label: "Location", value: selected.location },
                      { label: "Email", value: selected.emails?.join(", ") || "—" },
                      { label: "Company", value: selected.company },
                    ].map(({ label, value }) => (
                      <div key={label} className="card" style={{ padding: "11px 13px" }}>
                        <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>{label}</div>
                        <div style={{ fontSize: 12, color: "var(--text)", wordBreak: "break-all" }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {selected.linkedinUrl && (
                    <div className="card" style={{ padding: "11px 13px", marginBottom: 16 }}>
                      <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>LinkedIn</div>
                      <a href={selected.linkedinUrl} target="_blank" rel="noreferrer"
                        style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>
                        {selected.linkedinUrl}
                      </a>
                    </div>
                  )}
                  {/* Phone numbers — editable */}
                  {savedIds.has(selected.id) && (
                    <div className="card" style={{ padding: "11px 13px", marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div className="label" style={{ fontSize: 9 }}>Phone Numbers</div>
                        {!editingPhone ? (
                          <button
                            className="btn"
                            style={{ padding: "3px 8px", fontSize: 9 }}
                            onClick={() => {
                              setPhoneInput((selected.phones || []).join(", "));
                              setEditingPhone(true);
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-primary" style={{ padding: "3px 8px", fontSize: 9 }} onClick={handleSavePhone} disabled={phoneSaving}>
                              {phoneSaving ? "…" : "Save"}
                            </button>
                            <button className="btn" style={{ padding: "3px 8px", fontSize: 9 }} onClick={() => setEditingPhone(false)}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                      {editingPhone ? (
                        <div>
                          <input
                            className="input"
                            style={{ fontSize: 11 }}
                            placeholder="+91 98765 43210, +1 555 000 0000"
                            value={phoneInput}
                            onChange={e => setPhoneInput(e.target.value)}
                            autoFocus
                          />
                          <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 4 }}>
                            ↳ Separate multiple numbers with commas. Include country code (e.g. +91)
                          </div>
                        </div>
                      ) : (
                        selected.phones && selected.phones.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {selected.phones.map((p, i) => (
                              <div key={i} style={{ fontSize: 12, color: "var(--green)", fontFamily: "DM Mono, monospace" }}>{p}</div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                            No phone saved — click Edit to add one
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {!savedIds.has(selected.id) && (
                    <button
                      className="btn btn-primary"
                      style={{ marginBottom: 10 }}
                      onClick={() => handleSave(selected)}
                      disabled={saveLoading === selected.id}
                    >
                      ☆ Save Lead
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>◎</div>
                  <div style={{ fontSize: 11 }}>Select a lead to view details</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
