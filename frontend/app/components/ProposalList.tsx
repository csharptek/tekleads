"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

type GenerateProposalCtx = {
  proposalId: string;
  proposalHeadline?: string;
  clientName?: string;
  clientCompany?: string;
};

type Proposal = {
  id: string;
  jobPostHeadline: string;
  jobPostBody: string;
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  clientLinkedin: string;
  clientCountry: string;
  clientCity: string;
  clientQuestions: string[];
  documentUrls: string[];
  documentNames: string[];
  links: string[];
  linkLabels: string[];
  budgetMin?: number;
  budgetMax?: number;
  finalPrice?: number;
  timelineValue?: string;
  timelineUnit?: string;
  status: string;
  lostReason?: string;
  notes?: string;
  tags?: string;
  followUpDate?: string;
  sentAt?: string;
  wonAt?: string;
  lostAt?: string;
  contactsJson?: string;
  apolloContactJson?: string;
  createdAt: string;
  updatedAt: string;
};

type Contact = { name: string; email: string; phone?: string; role?: string; linkedin?: string; };

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: "Draft",      color: "#6b7280", bg: "#f3f4f6" },
  sent:       { label: "Sent",       color: "#2563eb", bg: "#eff6ff" },
  follow_up:  { label: "Follow Up",  color: "#d97706", bg: "#fffbeb" },
  won:        { label: "Won",        color: "#16a34a", bg: "#f0fdf4" },
  lost:       { label: "Lost",       color: "#dc2626", bg: "#fef2f2" },
};

const PAGE_SIZE = 10;

export default function ProposalList({
  onNew,
  onEdit,
  onGenerateProposal,
  onGenerateArtifacts,
}: {
  onNew: () => void;
  onEdit?: (proposalId: string) => void;
  onGenerateProposal?: (ctx: GenerateProposalCtx) => void;
  onGenerateArtifacts?: (ctx: any) => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "draft" | "sent" | "follow_up" | "won" | "lost">("all");
  const [sortField, setSortField] = useState<"createdAt" | "clientCompany" | "budgetMax" | "status">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<Proposal | null>(null);
  const [drawerTab, setDrawerTab] = useState<"details" | "contacts" | "docs" | "notes">("details");
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [drawerSuccess, setDrawerSuccess] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [finalPrice, setFinalPrice] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [wonOpen, setWonOpen] = useState(false);
  const [syncingLeads, setSyncingLeads] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await api.get("/api/proposals");
      setProposals(data || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = proposals
    .filter(p => activeTab === "all" || p.status === activeTab)
    .filter(p => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return p.clientName?.toLowerCase().includes(s) || p.clientCompany?.toLowerCase().includes(s) ||
        p.jobPostHeadline?.toLowerCase().includes(s) || p.tags?.toLowerCase().includes(s);
    })
    .sort((a, b) => {
      let va: any = a[sortField as keyof Proposal] ?? "";
      let vb: any = b[sortField as keyof Proposal] ?? "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const won = proposals.filter(p => p.status === "won");
  const lost = proposals.filter(p => p.status === "lost");

  const toggleSort = (f: typeof sortField) => {
    if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(f); setSortDir("desc"); }
  };

  const openDrawer = (p: Proposal) => {
    setDrawer(p); setDrawerTab("details"); setDrawerError(""); setDrawerSuccess("");
    setFinalPrice(p.finalPrice?.toString() || ""); setLostReason(p.lostReason || ""); setNotes(p.notes || "");
    try { setContacts(p.contactsJson ? JSON.parse(p.contactsJson) : []); } catch { setContacts([]); }
  };
  const closeDrawer = () => { setDrawer(null); setDrawerError(""); setDrawerSuccess(""); };

  const saveDrawer = async () => {
    if (!drawer) return;
    setDrawerSaving(true); setDrawerError(""); setDrawerSuccess("");
    try {
      const payload = { ...drawer, finalPrice: finalPrice ? parseFloat(finalPrice) : null, lostReason, notes, contactsJson: JSON.stringify(contacts) };
      const res: any = await api.put(`/api/proposals/${drawer.id}`, payload);
      setDrawer(res); setProposals(ps => ps.map(p => p.id === res.id ? res : p)); setDrawerSuccess("Saved.");
    } catch (e: any) { setDrawerError(e.message); }
    finally { setDrawerSaving(false); }
  };

  const changeStatus = async (p: Proposal, status: string) => {
    setStatusChanging(true);
    try {
      const now = new Date().toISOString();
      const updated: any = { ...p, status, sentAt: status === "sent" ? (p.sentAt || now) : p.sentAt, wonAt: status === "won" ? (p.wonAt || now) : p.wonAt, lostAt: status === "lost" ? (p.lostAt || now) : p.lostAt };
      const res: any = await api.put(`/api/proposals/${p.id}`, updated);
      setProposals(ps => ps.map(x => x.id === res.id ? res : x));
      if (drawer?.id === p.id) setDrawer(res);
    } catch (e: any) { setDrawerError(e.message); }
    finally { setStatusChanging(false); }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!drawer) return;
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true); setDrawerError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData(); fd.append("file", file);
        const res: any = await api.upload(`/api/proposals/${drawer.id}/upload`, fd);
        setDrawer(d => d ? { ...d, documentUrls: [...d.documentUrls, res.url], documentNames: [...d.documentNames, res.name] } : d);
        setProposals(ps => ps.map(p => p.id === drawer.id ? { ...p, documentUrls: [...p.documentUrls, res.url], documentNames: [...p.documentNames, res.name] } : p));
      }
      setDrawerSuccess("File uploaded.");
    } catch (e: any) { setDrawerError(e.message); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const handleRemoveDoc = async (i: number) => {
    if (!drawer) return;
    const url = drawer.documentUrls[i];
    try { await api.del(`/api/proposals/${drawer.id}/document`, { url }); } catch { }
    const urls = drawer.documentUrls.filter((_, j) => j !== i);
    const names = drawer.documentNames.filter((_, j) => j !== i);
    setDrawer(d => d ? { ...d, documentUrls: urls, documentNames: names } : d);
    setProposals(ps => ps.map(p => p.id === drawer.id ? { ...p, documentUrls: urls, documentNames: names } : p));
  };

  const addContact = () => setContacts(c => [...c, { name: "", email: "", phone: "", role: "", linkedin: "" }]);
  const updateContact = (i: number, f: keyof Contact, v: string) => setContacts(c => c.map((x, j) => j === i ? { ...x, [f]: v } : x));
  const removeContact = (i: number) => setContacts(c => c.filter((_, j) => j !== i));

  const handleSyncFromLeads = async () => {
    if (!drawer?.clientCompany) { setDrawerError("Proposal has no company name to match against."); return; }
    setSyncingLeads(true); setDrawerError(""); setDrawerSuccess("");
    try {
      const companyLower = drawer.clientCompany.toLowerCase().trim();
      // Fetch all saved leads — paginate through all pages
      let allLeads: any[] = [];
      let page = 1;
      while (true) {
        const data: any = await api.get(`/api/saved-leads?page=${page}&perPage=100`);
        const batch: any[] = data.leads || [];
        allLeads = [...allLeads, ...batch];
        if (batch.length < 100) break;
        page++;
      }
      // Match by company name (case-insensitive, partial match)
      const matched = allLeads.filter((l: any) => {
        const lc = (l.company || "").toLowerCase().trim();
        return lc === companyLower || lc.includes(companyLower) || companyLower.includes(lc);
      });
      if (matched.length === 0) {
        setDrawerSuccess(`No saved leads found matching "${drawer.clientCompany}".`);
        return;
      }
      // Build new contacts from matched leads, dedupe by email
      const existingEmails = new Set(contacts.map(c => c.email?.toLowerCase()).filter(Boolean));
      const toAdd: Contact[] = [];
      for (const lead of matched) {
        const emails: string[] = lead.emails || [];
        const phones: string[] = lead.phones || [];
        if (emails.length === 0 && phones.length === 0) {
          // No contact info — add name-only if not already present by name
          const alreadyByName = contacts.some(c => c.name?.toLowerCase() === (lead.name || "").toLowerCase());
          if (!alreadyByName) {
            toAdd.push({ name: lead.name || "", email: "", phone: phones[0] || "", role: lead.title || "", linkedin: lead.linkedinUrl || "" });
          }
          continue;
        }
        if (emails.length === 0) {
          // Phone only
          toAdd.push({ name: lead.name || "", email: "", phone: phones[0] || "", role: lead.title || "", linkedin: lead.linkedinUrl || "" });
          continue;
        }
        for (let i = 0; i < emails.length; i++) {
          const email = emails[i];
          if (existingEmails.has(email.toLowerCase())) continue;
          existingEmails.add(email.toLowerCase());
          toAdd.push({ name: lead.name || "", email, phone: phones[i] || phones[0] || "", role: lead.title || "", linkedin: lead.linkedinUrl || "" });
        }
      }
      if (toAdd.length === 0) {
        setDrawerSuccess(`All ${matched.length} matched lead(s) already in contacts.`);
        return;
      }
      setContacts(c => [...c, ...toAdd]);
      setDrawerSuccess(`Added ${toAdd.length} contact(s) from ${matched.length} saved lead(s) matching "${drawer.clientCompany}". Click Save Changes to persist.`);
    } catch (e: any) { setDrawerError(e.message); }
    finally { setSyncingLeads(false); }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
    return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, color: cfg.color, background: cfg.bg, whiteSpace: "nowrap" }}>{cfg.label}</span>;
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <span style={{ marginLeft: 4, opacity: sortField === field ? 1 : 0.3 }}>{sortField === field && sortDir === "asc" ? "↑" : "↓"}</span>
  );

  const tabCounts = { all: proposals.length, draft: proposals.filter(p => p.status === "draft").length, sent: proposals.filter(p => p.status === "sent").length, follow_up: proposals.filter(p => p.status === "follow_up").length, won: won.length, lost: lost.length };
  const fmt = (d?: string) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
  const fmtBudget = (min?: number, max?: number) => { if (!min && !max) return "—"; if (min && max) return `$${min.toLocaleString()}–$${max.toLocaleString()}`; return `$${(min || max)!.toLocaleString()}`; };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Proposals</div>
          <div className="page-sub">{proposals.length} total proposals</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onNew}>+ New Proposal</button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {(["all", "draft", "sent", "follow_up", "won", "lost"] as const).map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setPage(1); }}
            style={{ padding: "8px 14px", fontSize: 13, fontWeight: 500, border: "none", background: "none", cursor: "pointer", borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent", color: activeTab === tab ? "var(--accent)" : "var(--muted)" }}>
            {STATUS_CONFIG[tab]?.label || "All"} <span style={{ fontSize: 11, opacity: 0.7 }}>({tabCounts[tab]})</span>
          </button>
        ))}
      </div>

      {/* Search + sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search company, client, headline, tags..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input" style={{ width: 160 }} value={sortField} onChange={e => setSortField(e.target.value as any)}>
          <option value="createdAt">Date Created</option>
          <option value="clientCompany">Company</option>
          <option value="budgetMax">Budget</option>
          <option value="status">Status</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>{sortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}><span className="spinner spinner-dark" /></div>
      ) : paged.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No proposals found.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                <th style={th} onClick={() => toggleSort("clientCompany")} className="sortable-col">Company <SortIcon field="clientCompany" /></th>
                <th style={th}>Client</th>
                <th style={th}>Headline</th>
                <th style={th} onClick={() => toggleSort("budgetMax")} className="sortable-col">Budget <SortIcon field="budgetMax" /></th>
                <th style={th} onClick={() => toggleSort("createdAt")} className="sortable-col">Date <SortIcon field="createdAt" /></th>
                <th style={th} onClick={() => toggleSort("status")} className="sortable-col">Status <SortIcon field="status" /></th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "white" : "#fafafa", cursor: "pointer" }} onClick={() => openDrawer(p)}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{p.clientCompany || "—"}</div></td>
                  <td style={{...td, whiteSpace: "nowrap"}}><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span>{p.clientName || "—"}</span>{p.clientLinkedin && <a href={p.clientLinkedin} target="_blank" rel="noreferrer" title="LinkedIn" style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none", marginLeft: 4 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>{p.clientEmail}</div></td>
                  <td style={td}><div style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.jobPostHeadline || p.jobPostBody?.slice(0, 60) || "—"}</div></td>
                  <td style={td}>{fmtBudget(p.budgetMin, p.budgetMax)}</td>
                  <td style={td}>{fmt(p.createdAt)}</td>
                  <td style={td}><StatusBadge status={p.status} /></td>
                  <td style={{ ...td, minWidth: 160 }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {onEdit && <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => onEdit(p.id)}>Edit</button>}
                      {onGenerateArtifacts && <button className="btn btn-sm" style={{ fontSize: 11, background: "#0f172a", color: "white", border: "none" }} onClick={() => {
                          let allEmails: string[] = p.clientEmail ? [p.clientEmail] : [];
                          let allPhones: string[] = [];
                          // Pull enriched contacts from contactsJson first
                          try {
                            const cx: Contact[] = p.contactsJson ? JSON.parse(p.contactsJson) : [];
                            if (cx.length > 0) {
                              const cxEmails = cx.map(c => c.email).filter(Boolean);
                              const cxPhones = cx.map(c => c.phone).filter(Boolean) as string[];
                              if (cxEmails.length > 0) allEmails = Array.from(new Set([...allEmails, ...cxEmails]));
                              if (cxPhones.length > 0) allPhones = Array.from(new Set([...allPhones, ...cxPhones]));
                            }
                          } catch {}
                          // Also pull from apolloContactJson
                          try {
                            const ap = p.apolloContactJson ? JSON.parse(p.apolloContactJson) : null;
                            if (ap) {
                              const apEmails: string[] = ap.emails || [];
                              const apPhones: string[] = ap.phones || [];
                              allEmails = Array.from(new Set([...allEmails, ...apEmails])).filter(Boolean);
                              allPhones = Array.from(new Set([...allPhones, ...apPhones])).filter(Boolean);
                            }
                          } catch {}
                          onGenerateArtifacts({ proposalId: p.id, proposalHeadline: p.jobPostHeadline || p.jobPostBody?.slice(0, 60), clientName: p.clientName, clientEmail: allEmails[0] || p.clientEmail, clientPhone: allPhones[0] || "", allEmails, allPhones, autoGenerate: false });
                        }}>✦ Artifacts</button>}
                      {onGenerateProposal && <button className="btn btn-sm" style={{ fontSize: 11, background: "#1e293b", color: "white", border: "none" }} onClick={() => onGenerateProposal({ proposalId: p.id, proposalHeadline: p.jobPostHeadline || p.jobPostBody?.slice(0, 60), clientName: p.clientName, clientCompany: p.clientCompany })}>Generate</button>}
                      {p.status !== "sent" && <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => changeStatus(p, "sent")} disabled={statusChanging}>Sent</button>}
                      {p.status !== "won" && <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "var(--green)" }} onClick={() => changeStatus(p, "won")} disabled={statusChanging}>Won</button>}
                      {p.status !== "lost" && <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "var(--red)" }} onClick={() => changeStatus(p, "lost")} disabled={statusChanging}>Lost</button>}
                      {p.status !== "follow_up" && <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "var(--orange)" }} onClick={() => changeStatus(p, "follow_up")} disabled={statusChanging}>Follow Up</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const n = i + 1;
            return <button key={n} className={`btn btn-sm ${n === page ? "btn-primary" : "btn-ghost"}`} onClick={() => setPage(n)}>{n}</button>;
          })}
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
        </div>
      )}

      {/* Won section */}
      {won.length > 0 && (activeTab === "all" || activeTab === "won") && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setWonOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, color: "var(--green)", marginBottom: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={wonOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} /></svg>
            Won ({won.length}) — Total: ${won.reduce((s, p) => s + (p.finalPrice || p.budgetMax || 0), 0).toLocaleString()}
          </button>
          {wonOpen && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {won.map((p, i) => (
                <div key={p.id} onClick={() => openDrawer(p)} style={{ display: "flex", gap: 16, padding: "12px 16px", borderBottom: i < won.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer", alignItems: "center" }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{p.clientCompany || p.clientName}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{p.jobPostHeadline || p.jobPostBody?.slice(0, 60)}</div></div>
                  <div style={{ textAlign: "right" }}><div style={{ fontWeight: 600, color: "var(--green)" }}>${(p.finalPrice || p.budgetMax || 0).toLocaleString()}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>{fmt(p.wonAt)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lost section */}
      {lost.length > 0 && (activeTab === "all" || activeTab === "lost") && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setLostOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, color: "var(--red)", marginBottom: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={lostOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} /></svg>
            Lost ({lost.length})
          </button>
          {lostOpen && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {lost.map((p, i) => (
                <div key={p.id} onClick={() => openDrawer(p)} style={{ display: "flex", gap: 16, padding: "12px 16px", borderBottom: i < lost.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer", alignItems: "center" }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{p.clientCompany || p.clientName}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{p.jobPostHeadline || p.jobPostBody?.slice(0, 60)}</div></div>
                  <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "var(--red)" }}>{p.lostReason || "No reason given"}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>{fmt(p.lostAt)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drawer */}
      {drawer && (
        <>
          <div onClick={closeDrawer} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 200 }} />
          <div className="drawer-panel" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "white", zIndex: 201, boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {/* Drawer header */}
            <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{drawer.clientCompany || drawer.clientName || "Proposal"}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{drawer.jobPostHeadline || drawer.jobPostBody?.slice(0, 80)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <StatusBadge status={drawer.status} />
                  <button className="icon-btn" onClick={closeDrawer}>✕</button>
                </div>
              </div>
              {/* Status buttons */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
                  <button key={s} onClick={() => changeStatus(drawer, s)} disabled={statusChanging || drawer.status === s}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, border: `1px solid ${cfg.color}`, background: drawer.status === s ? cfg.bg : "white", color: cfg.color, cursor: drawer.status === s ? "default" : "pointer", fontWeight: 500 }}>
                    {cfg.label}
                  </button>
                ))}
              </div>
              {/* Drawer tabs */}
              <div style={{ display: "flex" }}>
                {(["details", "contacts", "docs", "notes"] as const).map(t => (
                  <button key={t} onClick={() => setDrawerTab(t)}
                    style={{ padding: "8px 16px", fontSize: 13, fontWeight: 500, border: "none", background: "none", cursor: "pointer", borderBottom: drawerTab === t ? "2px solid var(--accent)" : "2px solid transparent", color: drawerTab === t ? "var(--accent)" : "var(--muted)" }}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Drawer body */}
            <div style={{ padding: 24, flex: 1 }}>
              {drawerError && <div className="banner banner-error" style={{ marginBottom: 12 }}>{drawerError}</div>}
              {drawerSuccess && <div className="banner banner-success" style={{ marginBottom: 12 }}>{drawerSuccess}</div>}

              {drawerTab === "details" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Name</span><div style={{ display: "flex", alignItems: "center", gap: 4 }}>{drawer.clientName || "—"}{drawer.clientLinkedin && <a href={drawer.clientLinkedin} target="_blank" rel="noreferrer" title="LinkedIn" style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none", marginLeft: 4 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Email</span><div>{drawer.clientEmail || "—"}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Company</span><div>{drawer.clientCompany || "—"}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Location</span><div>{[drawer.clientCity, drawer.clientCountry].filter(Boolean).join(", ") || "—"}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Budget</span><div>{fmtBudget(drawer.budgetMin, drawer.budgetMax)}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Timeline</span><div>{drawer.timelineValue ? `${drawer.timelineValue} ${drawer.timelineUnit}` : "—"}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Created</span><div>{fmt(drawer.createdAt)}</div></div>
                    <div><span style={{ color: "var(--muted)", fontSize: 11 }}>Tags</span><div>{drawer.tags || "—"}</div></div>
                  </div>
                  {drawer.status === "won" && <div><div className="field-label">Final Agreed Price (USD)</div><input className="input" type="number" placeholder="Enter final price" value={finalPrice} onChange={e => setFinalPrice(e.target.value)} /></div>}
                  {drawer.status === "lost" && <div><div className="field-label">Reason Lost</div><input className="input" placeholder="e.g. Budget too low..." value={lostReason} onChange={e => setLostReason(e.target.value)} /></div>}
                  {drawer.followUpDate && <div style={{ padding: "10px 12px", background: "#fffbeb", borderRadius: 8, fontSize: 13, color: "#d97706" }}>📅 Follow up: {fmt(drawer.followUpDate)}</div>}
                  {drawer.jobPostBody && <div><div className="field-label">Job Post</div><div style={{ fontSize: 12, color: "var(--muted)", background: "var(--surface)", padding: "10px 12px", borderRadius: 6, maxHeight: 200, overflowY: "auto", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{drawer.jobPostBody}</div></div>}
                  {drawer.links?.filter(l => l).length > 0 && <div><div className="field-label">Links</div>{drawer.links.map((l, i) => l && <a key={i} href={l} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 13, color: "var(--accent)", textDecoration: "none", marginBottom: 4 }}>{drawer.linkLabels?.[i] || l}</a>)}</div>}
                  {drawer.clientQuestions?.filter(q => q).length > 0 && <div><div className="field-label">Client Questions</div>{drawer.clientQuestions.filter(q => q).map((q, i) => <div key={i} style={{ fontSize: 13, padding: "6px 10px", background: "var(--surface)", borderRadius: 6, marginBottom: 4 }}>{q}</div>)}</div>}
                </div>
              )}

              {drawerTab === "contacts" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "center" }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Contacts</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {drawer.clientCompany && (
                        <button className="btn btn-ghost btn-sm" onClick={handleSyncFromLeads} disabled={syncingLeads}
                          title={`Pull all saved leads matching "${drawer.clientCompany}"`}
                          style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                          {syncingLeads ? <span className="spinner spinner-dark" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>}
                          Sync from Leads
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={addContact}>+ Add</button>
                    </div>
                  </div>
                  {contacts.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No contacts yet.</div>}
                  {contacts.map((c, i) => (
                    <div key={i} style={{ marginBottom: 16, padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => removeContact(i)} style={{ color: "var(--red)", fontSize: 11 }}>Remove</button></div>
                      <div className="grid-2" style={{ gap: 8 }}>
                        <div><div className="field-label">Name</div><input className="input" value={c.name} onChange={e => updateContact(i, "name", e.target.value)} /></div>
                        <div><div className="field-label">Email</div><input className="input" type="email" value={c.email} onChange={e => updateContact(i, "email", e.target.value)} /></div>
                        <div><div className="field-label">Phone</div><input className="input" value={c.phone || ""} onChange={e => updateContact(i, "phone", e.target.value)} /></div>
                        <div><div className="field-label">Role / Title</div><input className="input" value={c.role || ""} onChange={e => updateContact(i, "role", e.target.value)} /></div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div className="field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            LinkedIn
                            {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" title="Open LinkedIn" style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>}
                          </div>
                          <input className="input" value={c.linkedin || ""} onChange={e => updateContact(i, "linkedin", e.target.value)} placeholder="https://linkedin.com/in/..." />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {drawerTab === "docs" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Documents</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {uploading && <span className="spinner spinner-dark" />}
                      <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Upload
                        <input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp" style={{ display: "none" }} onChange={handleUploadDoc} />
                      </label>
                    </div>
                  </div>
                  {drawer.documentUrls.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No documents uploaded.</div>}
                  {drawer.documentUrls.map((url, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)", marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, color: "var(--accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drawer.documentNames[i] || `Document ${i + 1}`}</a>
                      <button className="icon-btn" onClick={() => handleRemoveDoc(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              {drawerTab === "notes" && (
                <div>
                  <div className="field-label" style={{ marginBottom: 8 }}>Internal Notes</div>
                  <textarea className="input" rows={10} placeholder="Notes about this proposal..." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
                </div>
              )}
            </div>

            {/* Drawer footer */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, background: "white", flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" onClick={closeDrawer}>Close</button>
              {onEdit && (
                <button className="btn btn-ghost btn-sm" onClick={() => { closeDrawer(); onEdit(drawer.id); }}>Edit</button>
              )}
              <button className="btn btn-primary btn-sm" onClick={saveDrawer} disabled={drawerSaving}>
                {drawerSaving ? <span className="spinner" /> : null}Save Changes
              </button>
              {onGenerateProposal && (
                <button className="btn btn-sm" onClick={() => onGenerateProposal({ proposalId: drawer.id, proposalHeadline: drawer.jobPostHeadline || drawer.jobPostBody?.slice(0, 60), clientName: drawer.clientName, clientCompany: drawer.clientCompany })}
                  style={{ background: "#0f172a", color: "white", border: "none" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                  Generate Proposal
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--muted)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };
