"use client";
import { useState, useEffect, useCallback } from "react";
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
  savedAt: string;
}

const PER_PAGE = 50;
const SORT_OPTIONS = [
  { value: "saved_at", label: "Date Saved" },
  { value: "name", label: "Name" },
  { value: "company", label: "Company" },
  { value: "title", label: "Title" },
  { value: "industry", label: "Industry" },
  { value: "location", label: "Location" },
];

function WaLink({ phone, message, name }: { phone: string; message: string; name: string }) {
  const clean = phone.replace(/\D/g, "");
  const text = message.replace("{name}", name).replace("{phone}", phone);
  const url = `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="chip chip-green" style={{ fontSize: 11, textDecoration: "none", cursor: "pointer" }} title="Open WhatsApp">
      💬 {phone}
    </a>
  );
}

export default function SavedLeadsView() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [waTemplate, setWaTemplate] = useState("Hi {name}, I'd love to connect!");
  const [banner, setBanner] = useState<{ kind: "error"|"success"|"info"; text: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Selection and Instantly state
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [instantlyCampaigns, setInstantlyCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [pushingToInstantly, setPushingToInstantly] = useState(false);
  const [instantlyResult, setInstantlyResult] = useState<{ ok: boolean; pushed: number; failed: number; errors: string[] } | null>(null);

  const [filters, setFilters] = useState({
    name: "", company: "", title: "", industry: "",
    country: "", state: "", hasPhone: "", hasEmail: "",
    savedAfter: "", savedBefore: "",
  });
  const [sortBy, setSortBy] = useState("saved_at");
  const [sortDir, setSortDir] = useState("desc");

  const f = (k: keyof typeof filters, v: string) => setFilters(p => ({ ...p, [k]: v }));

  const activeFilterCount = Object.values(filters).filter(v => v !== "").length;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), perPage: String(PER_PAGE), sortBy, sortDir });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const data = await api.get<{ leads: Lead[]; total: number }>(`/api/saved-leads?${params}`);
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setLoading(false); }
  }, [filters, sortBy, sortDir]);

  useEffect(() => {
    api.get<{ values: Record<string, string> }>("/api/settings")
      .then(d => { if (d.values?.whatsapp_message_template) setWaTemplate(d.values.whatsapp_message_template); })
      .catch(() => {});
    api.get<{ id: string; name: string }[]>("/api/instantly/campaigns")
      .then(campaigns => setInstantlyCampaigns(campaigns))
      .catch(() => setInstantlyCampaigns([]));
    load(1);
  }, []);

  const onDelete = async (id: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/saved-leads/${id}`, { method: "DELETE" });
      setLeads(p => p.filter(l => l.id !== id));
      setTotal(p => p - 1);
    } catch (e: any) { setBanner({ kind: "error", text: e.message }); }
  };

  const toggleLeadSelection = (id: string) => {
    const updated = new Set(selectedLeadIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedLeadIds(updated);
  };

  const selectAllOnPage = () => {
    if (selectedLeadIds.size === leads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(leads.map(l => l.id)));
    }
  };

  const pushToInstantly = async () => {
    if (!selectedCampaignId || selectedLeadIds.size === 0) return;
    setPushingToInstantly(true);
    try {
      const selectedLeads = leads.filter(l => selectedLeadIds.has(l.id));
      const contacts = selectedLeads.flatMap(l => 
        l.emails.map(email => ({ email, name: l.name }))
      );
      if (contacts.length === 0) {
        setInstantlyResult({ ok: false, pushed: 0, failed: 0, errors: ["No emails found in selected leads"] });
        setTimeout(() => setInstantlyResult(null), 4000);
        return;
      }
      const result = await api.post<{ ok: boolean; pushed: number; failed: number; errors: string[] }>(
        "/api/instantly/push",
        { campaignId: selectedCampaignId, contacts }
      );
      setInstantlyResult(result);
      setTimeout(() => setInstantlyResult(null), 4000);
    } catch (err: any) {
      setInstantlyResult({ ok: false, pushed: 0, failed: 0, errors: [err.message] });
      setTimeout(() => setInstantlyResult(null), 4000);
    } finally {
      setPushingToInstantly(false);
    }
  };

  const clearFilters = () => {
    setFilters({ name: "", company: "", title: "", industry: "", country: "", state: "", hasPhone: "", hasEmail: "", savedAfter: "", savedBefore: "" });
    setSortBy("saved_at"); setSortDir("desc");
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="page">
      {/* Header row */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Saved Prospects</h1>
          <div className="page-sub">{total.toLocaleString()} total</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Sort inline */}
          <select className="input" style={{ width: 150, padding: "6px 10px", fontSize: 13 }}
            value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="input" style={{ width: 120, padding: "6px 10px", fontSize: 13 }}
            value={sortDir} onChange={e => setSortDir(e.target.value)}>
            <option value="desc">Newest</option>
            <option value="asc">Oldest</option>
          </select>
          {/* Filter toggle */}
          <button className={`btn ${showFilters ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setShowFilters(p => !p)}
            style={{ position: "relative" }}>
            ⚙ Filters
            {activeFilterCount > 0 && (
              <span style={{
                position: "absolute", top: -6, right: -6,
                background: "var(--accent)", color: "white",
                borderRadius: "50%", width: 18, height: 18,
                fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700
              }}>{activeFilterCount}</span>
            )}
          </button>
          <button className="btn btn-primary" onClick={() => load(1)} disabled={loading}>
            {loading ? <span className="spinner" /> : "Search"}
          </button>
        </div>
      </div>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      {/* Collapsible filter panel */}
      {showFilters && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
            {([
              ["name", "Name", "e.g. John"],
              ["company", "Company", "e.g. Acme"],
              ["title", "Job Title", "e.g. CTO"],
              ["industry", "Industry", "e.g. SaaS"],
              ["country", "Country", "e.g. India"],
              ["state", "State / City", "e.g. Chennai"],
            ] as [keyof typeof filters, string, string][]).map(([k, label, ph]) => (
              <div key={k}>
                <div className="field-label">{label}</div>
                <input className="input" placeholder={ph} value={filters[k]}
                  onChange={e => f(k, e.target.value)}
                  onKeyDown={e => e.key === "Enter" && load(1)} />
              </div>
            ))}
            <div>
              <div className="field-label">Has Phone</div>
              <select className="input" value={filters.hasPhone} onChange={e => f("hasPhone", e.target.value)}>
                <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
            <div>
              <div className="field-label">Has Email</div>
              <select className="input" value={filters.hasEmail} onChange={e => f("hasEmail", e.target.value)}>
                <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
            <div>
              <div className="field-label">Saved After</div>
              <input className="input" type="date" value={filters.savedAfter} onChange={e => f("savedAfter", e.target.value)} />
            </div>
            <div>
              <div className="field-label">Saved Before</div>
              <input className="input" type="date" value={filters.savedBefore} onChange={e => f("savedBefore", e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { load(1); setShowFilters(false); }}>Apply</button>
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear All</button>
          </div>
        </div>
      )}

      {/* Push to Instantly Panel */}
      {selectedLeadIds.size > 0 && instantlyCampaigns.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div className="card-title">Push to Instantly</div>
              <div className="card-sub">{selectedLeadIds.size} lead(s) selected • {leads.filter(l => selectedLeadIds.has(l.id)).reduce((sum, l) => sum + l.emails.length, 0)} email(s)</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(e.target.value)}
                disabled={pushingToInstantly}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}
              >
                <option value="">Select campaign...</option>
                {instantlyCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button 
                className="btn btn-sm" 
                style={{ background: "#22c55e", color: "white", border: "none" }} 
                onClick={pushToInstantly}
                disabled={!selectedCampaignId || pushingToInstantly}
              >
                {pushingToInstantly ? (
                  <><span className="spinner spinner-light" style={{ width: 10, height: 10 }} /> Pushing...</>
                ) : (
                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Push</>
                )}
              </button>
            </div>
          </div>
          {instantlyResult && (
            <div style={{
              padding: "12px 14px", 
              background: instantlyResult.ok ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
              borderRadius: 8,
              border: `1px solid ${instantlyResult.ok ? "#22c55e" : "#ef4444"}`,
              fontSize: 13,
              color: instantlyResult.ok ? "#16a34a" : "#991b1b"
            }}>
              {instantlyResult.ok ? (
                <>✓ {instantlyResult.pushed} pushed{instantlyResult.errors.length > 0 && ` • ${instantlyResult.errors.join(", ")}`}</>
              ) : (
                <>✕ Failed: {instantlyResult.errors.join(", ")}</>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {leads.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 24 }}>
                    <input type="checkbox" 
                      checked={selectedLeadIds.size > 0 && selectedLeadIds.size === leads.length}
                      onChange={selectAllOnPage}
                      style={{ cursor: "pointer" }}
                    />
                  </th>
                  <th>Name</th><th>Title</th><th>Company</th><th>Industry</th>
                  <th>Location</th><th>Email</th><th>Phone</th><th>Saved</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id}>
                    <td style={{ width: 24 }}>
                      <input type="checkbox" 
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={() => toggleLeadSelection(lead.id)}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{lead.name || "—"}</div>
                      {lead.linkedinUrl && (<a href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="LinkedIn"
                        style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                      </a>)}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.title || "—"}</td>
                    <td style={{ fontSize: 12 }}>{lead.company || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.industry || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.location || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {lead.emails?.[0] ? <span className="chip chip-blue" style={{ fontSize: 11 }}>{lead.emails[0]}</span> : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {lead.phones?.[0] ? <WaLink phone={lead.phones[0]} message={waTemplate} name={lead.name} /> : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>{new Date(lead.savedAt).toLocaleDateString()}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => onDelete(lead.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => load(page - 1)} disabled={page <= 1 || loading}>← Prev</button>
              <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>Page {page} / {totalPages}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => load(page + 1)} disabled={page >= totalPages || loading}>Next →</button>
            </div>
          )}
        </>
      ) : (
        !loading && (
          <div className="empty">
            <div className="empty-title">No prospects found</div>
            <div style={{ fontSize: 13, color: "var(--dim)" }}>Save leads from Lead Search to see them here</div>
          </div>
        )
      )}
    </div>
  );
}
