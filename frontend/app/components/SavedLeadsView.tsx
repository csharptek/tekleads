"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

interface LeadOrgDetails {
  orgWebsiteUrl?: string;
  orgDescription?: string;
  orgEstimatedEmployees?: string;
  orgAnnualRevenue?: string;
  orgFoundedYear?: string;
  orgLogoUrl?: string;
  orgLinkedinUrl?: string;
  orgPhone?: string;
  orgAddress?: string;
}

interface LeadEmploymentHistory {
  id: string;
  jobTitle?: string;
  orgName?: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

interface Lead {
  id: string;
  apolloId?: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  city: string;
  state: string;
  country: string;
  emails: string[];
  phones: string[];
  linkedinUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  facebookUrl?: string;
  photoUrl?: string;
  headline?: string;
  seniority?: string;
  emailStatus?: string;
  departments: string[];
  savedAt: string;
  orgDetails?: LeadOrgDetails;
  employmentHistory: LeadEmploymentHistory[];
}

const PER_PAGE = 20;

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      title="Copy" style={{ background: "none", border: "none", cursor: "pointer", padding: "0 3px", color: copied ? "#22c55e" : "var(--muted)", opacity: 0.7, verticalAlign: "middle", lineHeight: 1, flexShrink: 0 }}>
      {copied
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
    </button>
  );
}

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
  return (
    <a href={`https://wa.me/${clean}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
      className="chip chip-green" style={{ fontSize: 11, textDecoration: "none", cursor: "pointer" }} title="Open WhatsApp">
      💬 {phone}
    </a>
  );
}

function ExpandedRow({ lead, waTemplate }: { lead: Lead; waTemplate: string }) {
  const org = lead.orgDetails;
  return (
    <tr>
      <td colSpan={10} style={{ padding: 0, background: "var(--surface)" }}>
        <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>

          {/* Contact details */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Contact</div>
            {lead.headline && <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 4 }}>{lead.headline}</div>}
            {lead.seniority && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Seniority: <span style={{ color: "var(--text)" }}>{lead.seniority}</span></div>}
            {lead.departments?.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Dept: <span style={{ color: "var(--text)" }}>{lead.departments.join(", ")}</span></div>}
            {lead.emailStatus && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Email status: <span style={{ color: "var(--text)" }}>{lead.emailStatus}</span></div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
              {lead.emails.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="chip chip-blue" style={{ fontSize: 11 }}>{e}</span>
                  <CopyBtn text={e} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
              {lead.phones.map((ph, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <WaLink phone={ph} message={waTemplate} name={lead.name} />
                  <CopyBtn text={ph} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {lead.linkedinUrl && <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="LinkedIn" style={{ color: "#0a66c2", display: "inline-flex", alignItems: "center" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>}
              {lead.twitterUrl && <a href={lead.twitterUrl} target="_blank" rel="noreferrer" title="Twitter" style={{ color: "#1da1f2", fontSize: 11 }}>𝕏</a>}
              {lead.githubUrl && <a href={lead.githubUrl} target="_blank" rel="noreferrer" title="GitHub" style={{ color: "var(--text)", fontSize: 11 }}>GH</a>}
            </div>
          </div>

          {/* Organisation */}
          {org && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Organisation</div>
              {org.orgWebsiteUrl && <div style={{ fontSize: 12, marginBottom: 4 }}><a href={org.orgWebsiteUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{org.orgWebsiteUrl}</a></div>}
              {org.orgAddress && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{org.orgAddress}</div>}
              {org.orgEstimatedEmployees && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Employees: <span style={{ color: "var(--text)" }}>{org.orgEstimatedEmployees}</span></div>}
              {org.orgAnnualRevenue && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Revenue: <span style={{ color: "var(--text)" }}>{org.orgAnnualRevenue}</span></div>}
              {org.orgFoundedYear && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Founded: <span style={{ color: "var(--text)" }}>{org.orgFoundedYear}</span></div>}
              {org.orgPhone && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Phone: <span style={{ color: "var(--text)" }}>{org.orgPhone}</span></div>}
              {org.orgLinkedinUrl && <a href={org.orgLinkedinUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#0a66c2" }}>LinkedIn</a>}
              {org.orgDescription && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>{org.orgDescription}</div>}
            </div>
          )}

          {/* Employment history */}
          {lead.employmentHistory?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Employment History</div>
              {lead.employmentHistory.map((e, i) => (
                <div key={i} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: `2px solid ${e.isCurrent ? "var(--accent)" : "var(--border)"}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{e.jobTitle || "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.orgName}</div>
                  <div style={{ fontSize: 11, color: "var(--dim)" }}>
                    {e.startDate || ""}{e.startDate && (e.endDate || e.isCurrent) ? " – " : ""}{e.isCurrent ? "Present" : e.endDate || ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [instantlyCampaigns, setInstantlyCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [instantlyError, setInstantlyError] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [pushingToInstantly, setPushingToInstantly] = useState(false);
  const [instantlyResult, setInstantlyResult] = useState<{ ok: boolean; pushed: number; failed: number; errors: string[] } | null>(null);

  const [filters, setFilters] = useState({
    name: "", company: "", title: "", industry: "",
    country: "", state: "", phone: "", hasPhone: "", hasEmail: "",
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
      .then(campaigns => { setInstantlyCampaigns(campaigns); setInstantlyError(""); })
      .catch(err => { setInstantlyError(err.message); setInstantlyCampaigns([]); });
    load(1);
  }, []);

  const onDelete = async (id: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/saved-leads/${id}`, { method: "DELETE" });
      setLeads(p => p.filter(l => l.id !== id));
      setTotal(p => p - 1);
    } catch (e: any) { setBanner({ kind: "error", text: e.message }); }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleLeadSelection = (id: string) => {
    const updated = new Set(selectedLeadIds);
    if (updated.has(id)) updated.delete(id); else updated.add(id);
    setSelectedLeadIds(updated);
  };

  const selectAllOnPage = () => {
    if (selectedLeadIds.size === leads.length) setSelectedLeadIds(new Set());
    else setSelectedLeadIds(new Set(leads.map(l => l.id)));
  };

  const pushToInstantly = async () => {
    if (!selectedCampaignId || selectedLeadIds.size === 0) return;
    setPushingToInstantly(true);
    try {
      const selectedLeads = leads.filter(l => selectedLeadIds.has(l.id));
      const contacts = selectedLeads.flatMap(l => l.emails.map(email => ({ email, name: l.name })));
      if (contacts.length === 0) {
        setInstantlyResult({ ok: false, pushed: 0, failed: 0, errors: ["No emails found in selected leads"] });
        setTimeout(() => setInstantlyResult(null), 4000);
        return;
      }
      const result = await api.post<{ ok: boolean; pushed: number; failed: number; errors: string[] }>(
        "/api/instantly/push", { campaignId: selectedCampaignId, contacts });
      setInstantlyResult(result);
      setTimeout(() => setInstantlyResult(null), 4000);
    } catch (err: any) {
      setInstantlyResult({ ok: false, pushed: 0, failed: 0, errors: [err.message] });
      setTimeout(() => setInstantlyResult(null), 4000);
    } finally { setPushingToInstantly(false); }
  };

  const clearFilters = () => {
    setFilters({ name: "", company: "", title: "", industry: "", country: "", state: "", phone: "", hasPhone: "", hasEmail: "", savedAfter: "", savedBefore: "" });
    setSortBy("saved_at"); setSortDir("desc");
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Saved Contacts</h1>
          <div className="page-sub">{total.toLocaleString()} total</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="input" style={{ minWidth: 0, flex: "1 1 120px", maxWidth: 180, padding: "6px 10px", fontSize: 13 }}
            value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="input" style={{ minWidth: 0, flex: "1 1 90px", maxWidth: 130, padding: "6px 10px", fontSize: 13 }}
            value={sortDir} onChange={e => setSortDir(e.target.value)}>
            <option value="desc">Newest</option>
            <option value="asc">Oldest</option>
          </select>
          <button className={`btn ${showFilters ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setShowFilters(p => !p)} style={{ position: "relative" }}>
            ⚙ Filters
            {activeFilterCount > 0 && (
              <span style={{ position: "absolute", top: -6, right: -6, background: "var(--accent)", color: "white", borderRadius: "50%", width: 18, height: 18, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{activeFilterCount}</span>
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

      {showFilters && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
            {([
              ["name", "Name", "e.g. John"],
              ["company", "Company", "e.g. Acme"],
              ["title", "Job Title", "e.g. CTO"],
              ["industry", "Industry", "e.g. SaaS"],
              ["country", "Country", "e.g. India"],
              ["state", "State / City", "e.g. Chennai"],
              ["phone", "Phone Number", "e.g. 14155552671"],
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

      {selectedLeadIds.size > 0 && instantlyCampaigns.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div className="card-title">Push to Instantly</div>
              <div className="card-sub">{selectedLeadIds.size} lead(s) selected • {leads.filter(l => selectedLeadIds.has(l.id)).reduce((sum, l) => sum + l.emails.length, 0)} email(s)</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select value={selectedCampaignId} onChange={e => setSelectedCampaignId(e.target.value)} disabled={pushingToInstantly}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}>
                <option value="">Select campaign...</option>
                {instantlyCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn btn-sm" style={{ background: "#22c55e", color: "white", border: "none" }}
                onClick={pushToInstantly} disabled={!selectedCampaignId || pushingToInstantly}>
                {pushingToInstantly ? <><span className="spinner spinner-light" style={{ width: 10, height: 10 }} /> Pushing...</> : <>Push</>}
              </button>
            </div>
          </div>
          {instantlyResult && (
            <div style={{ padding: "12px 14px", background: instantlyResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", borderRadius: 8, border: `1px solid ${instantlyResult.ok ? "#22c55e" : "#ef4444"}`, fontSize: 13, color: instantlyResult.ok ? "#16a34a" : "#991b1b" }}>
              {instantlyResult.ok ? <>✓ {instantlyResult.pushed} pushed</> : <>✕ {instantlyResult.errors.join(", ")}</>}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <span className="spinner spinner-dark" />
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>Loading contacts...</div>
        </div>
      ) : leads.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 24 }}>
                    <input type="checkbox" checked={selectedLeadIds.size > 0 && selectedLeadIds.size === leads.length} onChange={selectAllOnPage} style={{ cursor: "pointer" }} />
                  </th>
                  <th style={{ width: 24 }}></th>
                  <th>Name</th><th>Title</th><th>Company</th><th>Location</th>
                  <th>Email</th><th>Phone</th><th>Saved</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => {
                  const expanded = expandedIds.has(lead.id);
                  return (
                    <>
                      <tr key={lead.id} style={{ cursor: "pointer" }} onClick={() => toggleExpand(lead.id)}>
                        <td style={{ width: 24 }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedLeadIds.has(lead.id)} onChange={() => toggleLeadSelection(lead.id)} style={{ cursor: "pointer" }} />
                        </td>
                        <td style={{ width: 24, color: "var(--muted)", fontSize: 11 }}>{expanded ? "▲" : "▼"}</td>
                        <td>
                          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                            {lead.photoUrl && <img src={lead.photoUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
                            {lead.name || "—"}
                            {lead.name && <CopyBtn text={lead.name} />}
                          </div>
                          {lead.linkedinUrl && (<a href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="LinkedIn" onClick={e => e.stopPropagation()}
                            style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          </a>)}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>
                          <div>{lead.title || "—"}</div>
                          {lead.seniority && <div style={{ fontSize: 11, color: "var(--dim)" }}>{lead.seniority}</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <div>{lead.company || "—"}</div>
                          {lead.orgDetails?.orgWebsiteUrl && <div style={{ fontSize: 11, color: "var(--muted)" }}><a href={lead.orgDetails.orgWebsiteUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)" }}>{lead.orgDetails.orgWebsiteUrl.replace(/^https?:\/\//, "")}</a></div>}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>
                          <div>{lead.location || "—"}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {lead.emails?.[0]
                            ? <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                {lead.emails.slice(0, 2).map((e, i) => (
                                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <span className="chip chip-blue" style={{ fontSize: 11 }}>{e}</span>
                                    <CopyBtn text={e} />
                                  </span>
                                ))}
                                {lead.emails.length > 2 && <span style={{ fontSize: 10, color: "var(--muted)" }}>+{lead.emails.length - 2} more</span>}
                              </div>
                            : <span style={{ color: "var(--dim)" }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {lead.phones?.[0]
                            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <WaLink phone={lead.phones[0]} message={waTemplate} name={lead.name} />
                                <CopyBtn text={lead.phones[0]} />
                              </span>
                            : <span style={{ color: "var(--dim)" }}>—</span>}
                        </td>
                        <td style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>{new Date(lead.savedAt).toLocaleDateString()}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => onDelete(lead.id)}>✕</button>
                        </td>
                      </tr>
                      {expanded && <ExpandedRow key={`exp-${lead.id}`} lead={lead} waTemplate={waTemplate} />}
                    </>
                  );
                })}
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
            <div className="empty-title">No contacts found</div>
            <div style={{ fontSize: 13, color: "var(--dim)" }}>Save leads from Lead Search to see them here</div>
          </div>
        )
      )}
    </div>
  );
}
