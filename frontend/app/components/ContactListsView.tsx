"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type ContactList = {
  id: string; title: string; total: number; enriched: number;
  notEnriched: number; failed: number; createdAt: string;
};

type Contact = {
  id: string; listId: string; name: string; title: string; company: string;
  location: string; email: string; phone: string; linkedinUrl: string;
  apolloId: string; enrichStatus: "pending" | "enriched" | "failed"; enrichedAt?: string;
};

type Template = {
  id?: string; listId?: string; type: "email" | "whatsapp";
  name: string; subject: string; body: string;
};

type OutreachLog = {
  id: string; contactId: string; type: string; recipient: string; status: string; error?: string; sentAt: string;
};

type SortKey = "name" | "title" | "company" | "location" | "email" | "phone" | "enrichStatus";
type SortDir = "asc" | "desc";

const TOKENS = [
  { label: "Name",     value: "{{name}}" },
  { label: "Company",  value: "{{company}}" },
  { label: "Title",    value: "{{title}}" },
  { label: "Location", value: "{{location}}" },
  { label: "Email",    value: "{{email}}" },
  { label: "Phone",    value: "{{phone}}" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { enriched: "#22c55e", pending: "#f59e0b", failed: "#ef4444", sent: "#22c55e", skipped: "#94a3b8", opened: "#22c55e" };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
      background: `${colors[status] || "#94a3b8"}22`, color: colors[status] || "#94a3b8",
      border: `1px solid ${colors[status] || "#94a3b8"}44` }}>{status}</span>
  );
}

function LinkedInIcon({ url }: { url: string }) {
  if (!url) return <span style={{ color: "#334155", fontSize: 13 }}>—</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}
      style={{ color: "#0a66c2", display: "inline-flex", alignItems: "center" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
        <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
      </svg>
    </a>
  );
}

function interpolate(template: string, contact: Contact): string {
  return template
    .replace(/\{\{name\}\}/gi,     contact.name     || "")
    .replace(/\{\{company\}\}/gi,  contact.company  || "")
    .replace(/\{\{location\}\}/gi, contact.location || "")
    .replace(/\{\{title\}\}/gi,    contact.title    || "")
    .replace(/\{\{email\}\}/gi,    contact.email    || "")
    .replace(/\{\{phone\}\}/gi,    contact.phone    || "");
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: .3, flexShrink: 0 }}><path d="M12 5v14M5 12l7-7 7 7"/></svg>;
  return sortDir === "asc"
    ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M12 5v14M5 12l7 7 7-7"/></svg>;
}

function PaginationBar({ page, pages, total, pageSize, onPage, onPageSize }: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>Rows:</span>
        <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
          style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <span>{total} contacts</span>
      <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
        {[["«", 1], ["‹", page - 1], [null, null], ["›", page + 1], ["»", pages]].map(([label, target], i) => {
          if (label === null) return <span key={i} style={{ padding: "3px 10px", background: "var(--accent)", color: "white", borderRadius: 6, fontSize: 12 }}>{page} / {pages}</span>;
          const disabled = (target as number) < 1 || (target as number) > pages || target === page;
          return (
            <button key={i} onClick={() => !disabled && onPage(target as number)} disabled={disabled}
              style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: disabled ? "var(--muted)" : "var(--text)", cursor: disabled ? "default" : "pointer", fontSize: 12 }}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ContactListsView() {
  const [lists, setLists]           = useState<ContactList[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeList, setActiveList] = useState<ContactList | null>(null);
  const [tab, setTab]               = useState<"contacts" | "templates" | "log">("contacts");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile]   = useState<File | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState("");

  const loadLists = useCallback(async () => {
    setLoading(true);
    try { setLists(await api.get("/api/contact-lists")); }
    catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  async function handleUpload() {
    if (!uploadTitle.trim()) { setUploadErr("Title required."); return; }
    if (!uploadFile) { setUploadErr("File required."); return; }
    setUploading(true); setUploadErr("");
    try {
      const fd = new FormData();
      fd.append("title", uploadTitle.trim());
      fd.append("file", uploadFile);
      const res: any = await api.upload("/api/contact-lists/upload", fd);
      setShowUpload(false); setUploadTitle(""); setUploadFile(null);
      const fresh: ContactList[] = await api.get("/api/contact-lists");
      setLists(fresh);
      const created = fresh.find((l: ContactList) => l.id === res.listId);
      if (created) { setActiveList(created); setTab("contacts"); }
    } catch (e: any) { setUploadErr(e.message); }
    finally { setUploading(false); }
  }

  async function handleDeleteList(id: string) {
    if (!confirm("Delete this list and all contacts?")) return;
    await api.delete(`/api/contact-lists/${id}`);
    if (activeList?.id === id) setActiveList(null);
    loadLists();
  }

  if (activeList) {
    return <ContactDetailView list={activeList} tab={tab} setTab={setTab} onBack={() => { setActiveList(null); loadLists(); }} />;
  }

  return (
    <div style={{ padding: 24, height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Contact Lists</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Upload Apollo exports, enrich, and send outreach</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowUpload(true); setUploadErr(""); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload List
        </button>
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 48 }}><span className="spinner spinner-dark" /></div>
        : lists.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>No lists yet. Upload an Apollo export to get started.</div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
                  {["Title", "Created", "Total", "Enriched", "Pending", "Failed", ""].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lists.map(l => (
                  <tr key={l.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                    onClick={() => { setActiveList(l); setTab("contacts"); }}>
                    <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text)" }}>{l.title}</td>
                    <td style={{ padding: "12px 14px", color: "var(--muted)" }}>{new Date(l.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: "12px 14px", fontWeight: 700 }}>{l.total}</td>
                    <td style={{ padding: "12px 14px", color: "#22c55e", fontWeight: 600 }}>{l.enriched}</td>
                    <td style={{ padding: "12px 14px", color: "#f59e0b", fontWeight: 600 }}>{l.notEnriched}</td>
                    <td style={{ padding: "12px 14px", color: "#ef4444", fontWeight: 600 }}>{l.failed}</td>
                    <td style={{ padding: "12px 14px" }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" style={{ color: "#ef4444" }} onClick={() => handleDeleteList(l.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {showUpload && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: 420, maxWidth: "90vw" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Upload Contact List</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowUpload(false)}>✕</button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>LIST TITLE</label>
              <input className="input" value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                placeholder="e.g. SaaS CTOs Q2 2025" style={{ width: "100%" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>EXCEL FILE (.xlsx)</label>
              <input type="file" accept=".xlsx" onChange={e => setUploadFile(e.target.files?.[0] || null)}
                style={{ fontSize: 13, color: "var(--text)" }} />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                Apollo export columns auto-mapped: First Name, Last Name, Title, Company, Email, Phone, LinkedIn, City, State, Country
              </p>
            </div>
            {uploadErr && <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>{uploadErr}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Uploading…</> : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────

function ContactDetailView({ list, tab, setTab, onBack }: {
  list: ContactList; tab: "contacts" | "templates" | "log";
  setTab: (t: "contacts" | "templates" | "log") => void; onBack: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "20px 24px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>{list.title}</h1>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
            <span><strong style={{ color: "var(--text)" }}>{list.total}</strong> <span style={{ color: "var(--muted)" }}>total</span></span>
            <span style={{ color: "#22c55e", fontWeight: 600 }}>{list.enriched} enriched</span>
            <span style={{ color: "#f59e0b", fontWeight: 600 }}>{list.notEnriched} pending</span>
            <span style={{ color: "#ef4444", fontWeight: 600 }}>{list.failed} failed</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
          {(["contacts", "templates", "log"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "var(--accent)" : "var(--muted)", background: "none", border: "none", cursor: "pointer",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1, textTransform: "capitalize",
            }}>{t === "log" ? "Outreach Log" : t === "templates" ? "Templates" : "Contacts"}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {tab === "contacts"  && <ContactsTab  list={list} />}
        {tab === "templates" && <TemplatesTab list={list} />}
        {tab === "log"       && <LogTab       list={list} />}
      </div>
    </div>
  );
}

// ── Contacts Tab ──────────────────────────────────────────────────────────────

function ContactsTab({ list }: { list: ContactList }) {
  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(25);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("");
  const [sortKey, setSortKey]     = useState<SortKey>("name");
  const [sortDir, setSortDir]     = useState<SortDir>("asc");
  const [loading, setLoading]     = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sendModal, setSendModal] = useState<{ contact: Contact; type: "email" | "whatsapp" } | null>(null);
  const [sendInterval, setSendInterval] = useState(5);
  const [bulkType, setBulkType]         = useState<"email" | "whatsapp">("email");
  const [bulkTemplate, setBulkTemplate] = useState("");
  const [bulkJobs, setBulkJobs]         = useState<{ name: string; recipient: string; status: "pending" | "sent" | "skipped" }[]>([]);
  const [bulkRunning, setBulkRunning]   = useState(false);
  const bulkRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res: any = await api.get(`/api/contact-lists/${list.id}/contacts?${params}`);
      let items: Contact[] = res.items || [];
      items = [...items].sort((a, b) => {
        const av = (a[sortKey] || "").toString().toLowerCase();
        const bv = (b[sortKey] || "").toString().toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      setContacts(items);
      setTotal(res.total || 0);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [list.id, page, pageSize, search, statusFilter, sortKey, sortDir]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get<Template[]>(`/api/contact-lists/${list.id}/templates`).then(t => {
      setTemplates(t);
      if (t.length) setBulkTemplate(t[0].id || "");
    }).catch(() => {});
  }, [list.id]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }
  function toggleOne(id: string) { setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function selectPage(checked: boolean) { setSelected(s => { const n = new Set(s); contacts.forEach(c => checked ? n.add(c.id) : n.delete(c.id)); return n; }); }
  async function selectAll() {
    const res: any = await api.get(`/api/contact-lists/${list.id}/contacts?page=1&pageSize=10000`);
    setSelected(new Set((res.items as Contact[]).map((c: Contact) => c.id)));
  }

  async function enrich() {
    if (!selected.size) return;
    setEnriching(true); setEnrichMsg("");
    try {
      const res: any = await api.post(`/api/contact-lists/${list.id}/enrich`, { contactIds: [...selected] });
      setEnrichMsg(`Enriched: ${res.enriched} · Failed: ${res.failed}`);
      setSelected(new Set()); load();
    } catch (e: any) { setEnrichMsg(e.message); }
    finally { setEnriching(false); }
  }

  function startBulkSend() {
    if (!selected.size) return;
    const tpl = templates.find(t => t.id === bulkTemplate);
    if (!tpl) return;
    const targets = contacts.filter(c => selected.has(c.id));
    const jobs = targets.map(c => ({
      name: c.name,
      recipient: bulkType === "email" ? c.email : c.phone,
      status: "pending" as const,
      contact: c,
    })).filter(j => j.recipient);
    if (!jobs.length) { setEnrichMsg(`No contacts with ${bulkType} in selection.`); return; }
    const jobsDisplay = jobs.map(j => ({ name: j.name, recipient: j.recipient, status: "pending" as const }));
    setBulkJobs(jobsDisplay);
    setBulkRunning(true);
    let i = 0;
    function sendNext() {
      if (i >= jobs.length) { setBulkRunning(false); return; }
      const { contact, recipient } = jobs[i];
      if (bulkType === "email") {
        window.open(`mailto:${recipient}?subject=${encodeURIComponent(interpolate(tpl!.subject, contact))}&body=${encodeURIComponent(interpolate(tpl!.body, contact))}`, "_blank");
      } else {
        const phone = recipient.replace(/\D/g, "");
        window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(interpolate(tpl!.body, contact))}` : `https://wa.me/?text=${encodeURIComponent(interpolate(tpl!.body, contact))}`, "_blank");
      }
      api.post(`/api/contact-lists/${list.id}/log-whatsapp`, { contactId: contact.id, phone: recipient }).catch(() => {});
      setBulkJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "sent" } : j));
      i++;
      if (i < jobs.length) bulkRef.current = setTimeout(sendNext, sendInterval * 60 * 1000);
      else setBulkRunning(false);
    }
    sendNext();
  }

  function cancelBulk() {
    if (bulkRef.current) clearTimeout(bulkRef.current);
    setBulkRunning(false);
    setBulkJobs(prev => prev.map(j => j.status === "pending" ? { ...j, status: "skipped" } : j));
  }

  const thStyle: React.CSSProperties = {
    padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "var(--muted)",
    fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", whiteSpace: "nowrap",
    cursor: "pointer", userSelect: "none",
  };
  const thInner: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4 };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pagBar = <PaginationBar page={page} pages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />;

  const COLS: { key: SortKey; label: string }[] = [
    { key: "name", label: "Name" }, { key: "title", label: "Title" }, { key: "company", label: "Company" },
    { key: "location", label: "Location" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
    { key: "enrichStatus", label: "Status" },
  ];

  return (
    <>
      {/* ── Sticky send bar ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg, white)",
        borderBottom: "1px solid var(--border)", marginBottom: 12, paddingBottom: 10 }}>

        {/* Row 1: search + filter + enrich */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <input className="input" placeholder="Search name, email, company…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ flex: 1, minWidth: 180 }} />
          <select className="input" value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 140 }}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="enriched">Enriched</option>
            <option value="failed">Failed</option>
          </select>
          {selected.size > 0 && (
            <button className="btn btn-primary btn-sm" onClick={enrich} disabled={enriching}>
              {enriching ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Enriching…</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Enrich {selected.size}</>}
            </button>
          )}
          {enrichMsg && <span style={{ fontSize: 12, color: "var(--muted)" }}>{enrichMsg}</span>}
        </div>

        {/* Row 2: send bar — always visible */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "8px 12px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
          <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", minWidth: 100 }}>
            {selected.size > 0
              ? <span style={{ color: "var(--accent)" }}>{selected.size} selected</span>
              : <span style={{ color: "var(--muted)" }}>Select to send</span>}
          </span>
          <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
          <select value={bulkType} onChange={e => setBulkType(e.target.value as "email" | "whatsapp")}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
            <option value="email">📧 Email</option>
            <option value="whatsapp">💬 WhatsApp</option>
          </select>
          {templates.filter(t => t.type === bulkType).length > 0 ? (
            <select value={bulkTemplate} onChange={e => setBulkTemplate(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", maxWidth: 200 }}>
              {templates.filter(t => t.type === bulkType).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 11, color: "#f59e0b" }}>No {bulkType} template — create in Templates tab</span>
          )}
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Interval (min):</span>
          <select value={sendInterval} onChange={e => setSendInterval(Number(e.target.value))} disabled={bulkRunning}
            style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", width: 56 }}>
            {[1,2,3,4,5,6,7,8,9,10,15,20,30].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {bulkRunning ? (
            <button onClick={cancelBulk}
              style={{ background: "#dc3545", color: "white", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              ✕ Cancel
            </button>
          ) : (
            <button onClick={startBulkSend}
              disabled={selected.size === 0 || !bulkTemplate || templates.filter(t => t.type === bulkType).length === 0}
              style={{ background: selected.size === 0 ? "#64748b" : bulkType === "email" ? "#0078d4" : "#25d366",
                color: "white", border: "none", borderRadius: 6, padding: "5px 14px",
                cursor: selected.size === 0 ? "default" : "pointer", opacity: selected.size === 0 ? 0.5 : 1,
                fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              {bulkType === "email" ? "Send to All" : "WhatsApp All"}
            </button>
          )}
          {bulkJobs.filter(j => j.status === "sent").length > 0 && (
            <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>
              ✓ {bulkJobs.filter(j => j.status === "sent").length}/{bulkJobs.length} sent
            </span>
          )}
        </div>

        {/* Progress list while bulk running */}
        {bulkRunning && bulkJobs.length > 0 && (
          <div style={{ maxHeight: 100, overflowY: "auto", marginTop: 6,
            padding: "6px 12px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            {bulkJobs.map((j, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, padding: "2px 0", color: "var(--muted)" }}>
                <span style={{ color: j.status === "sent" ? "#22c55e" : "var(--muted)", width: 12 }}>
                  {j.status === "sent" ? "✓" : j.status === "skipped" ? "–" : "○"}
                </span>
                <span style={{ flex: 1 }}>{j.name}</span>
                <span>{j.recipient}</span>
              </div>
            ))}
          </div>
        )}

        {/* Row 3: select helpers */}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={contacts.length > 0 && contacts.every(c => selected.has(c.id))} onChange={e => selectPage(e.target.checked)} />
            Select page
          </label>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "0 4px" }} onClick={selectAll}>Select all {total}</button>
          {selected.size > 0 && <span style={{ color: "var(--accent)", fontWeight: 600 }}>{selected.size} selected</span>}
          {selected.size > 0 && <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "0 4px" }} onClick={() => setSelected(new Set())}>Clear</button>}
        </div>
      </div>

      {/* Pagination top */}
      <div style={{ marginBottom: 10 }}>{pagBar}</div>

      {loading ? <div style={{ textAlign: "center", padding: 40 }}><span className="spinner spinner-dark" /></div> : (
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
            <thead>
              <tr style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "10px 12px", width: 32 }}></th>
                {/* Name */}
                <th onClick={() => toggleSort("name")} style={thStyle}>
                  <span style={thInner}>Name <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* Company */}
                <th onClick={() => toggleSort("company")} style={thStyle}>
                  <span style={thInner}>Company <SortIcon col="company" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* Phone */}
                <th onClick={() => toggleSort("phone")} style={thStyle}>
                  <span style={thInner}>Phone <SortIcon col="phone" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* Email */}
                <th onClick={() => toggleSort("email")} style={thStyle}>
                  <span style={thInner}>Email <SortIcon col="email" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* Send buttons header */}
                <th style={{ padding: "10px 12px", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap" }}>Send</th>
                {/* Title */}
                <th onClick={() => toggleSort("title")} style={thStyle}>
                  <span style={thInner}>Title <SortIcon col="title" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* Location */}
                <th onClick={() => toggleSort("location")} style={thStyle}>
                  <span style={thInner}>Location <SortIcon col="location" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* Status */}
                <th onClick={() => toggleSort("enrichStatus")} style={thStyle}>
                  <span style={thInner}>Status <SortIcon col="enrichStatus" sortKey={sortKey} sortDir={sortDir} /></span>
                </th>
                {/* LinkedIn */}
                <th style={{ padding: "10px 12px", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 12px" }}><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} /></td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{c.name || "—"}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{c.company || "—"}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap", fontSize: 12 }}>{c.phone || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {c.email ? <a href={"mailto:" + c.email} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>{c.email}</a> : <span style={{ color: "#334155" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button title="Send Email" onClick={() => setSendModal({ contact: c, type: "email" })}
                        style={{ background: c.email ? "#0078d4" : "#94a3b8", border: "none", borderRadius: 6, padding: "4px 8px", cursor: c.email ? "pointer" : "default", display: "flex", alignItems: "center", opacity: c.email ? 1 : 0.4 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                      </button>
                      <button title="Open WhatsApp" onClick={() => setSendModal({ contact: c, type: "whatsapp" })}
                        style={{ background: c.phone ? "#25d366" : "#94a3b8", border: "none", borderRadius: 6, padding: "4px 8px", cursor: c.phone ? "pointer" : "default", display: "flex", alignItems: "center", opacity: c.phone ? 1 : 0.4 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap", fontSize: 12 }}>{c.title || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap", fontSize: 12 }}>{c.location || "—"}</td>
                  <td style={{ padding: "10px 12px" }}><StatusBadge status={c.enrichStatus} /></td>
                  <td style={{ padding: "10px 12px" }}><LinkedInIcon url={c.linkedinUrl} /></td>
                </tr>
              ))}
              {!contacts.length && <tr><td colSpan={10} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>No contacts found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination bottom */}
      <div style={{ marginTop: 12 }}>{pagBar}</div>

      {sendModal && (
        <SendOutreachModal contact={sendModal.contact} type={sendModal.type}
          listId={list.id} templates={templates.filter(t => t.type === sendModal.type)}
          onClose={() => setSendModal(null)} />
      )}
    </>
  );
}

// ── Send Modal ────────────────────────────────────────────────────────────────

function SendOutreachModal({ contact, type, listId, templates, onClose }: {
  contact: Contact; type: "email" | "whatsapp"; listId: string; templates: Template[]; onClose: () => void;
}) {
  const [selectedTpl, setSelectedTpl] = useState(templates[0]?.id || "");
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");

  useEffect(() => {
    const tpl = templates.find(t => t.id === selectedTpl) || templates[0];
    if (tpl) { setSubject(interpolate(tpl.subject, contact)); setBody(interpolate(tpl.body, contact)); }
    else { setSubject(""); setBody(""); }
  }, [selectedTpl, contact, templates]);

  function openEmail() {
    window.open(`mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
    api.post(`/api/contact-lists/${listId}/log-whatsapp`, { contactId: contact.id, phone: contact.email }).catch(() => {});
  }
  function openWhatsApp() {
    const phone = contact.phone.replace(/\D/g, "");
    window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(body)}` : `https://wa.me/?text=${encodeURIComponent(body)}`, "_blank");
    api.post(`/api/contact-lists/${listId}/log-whatsapp`, { contactId: contact.id, phone: contact.phone }).catch(() => {});
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            {type === "email"
              ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 6 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>Email</>
              : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#25d366" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 6 }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>WhatsApp</>}
            <span style={{ fontWeight: 400, fontSize: 13, color: "var(--muted)", marginLeft: 8 }}>— {contact.name}</span>
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginBottom: 14, padding: "8px 12px", background: "var(--surface2)", borderRadius: 8, fontSize: 12, color: "var(--muted)" }}>
          {type === "email"
            ? <><strong style={{ color: "var(--text)" }}>To:</strong> {contact.email || <span style={{ color: "#ef4444" }}>No email</span>} · Opens Outlook</>
            : <><strong style={{ color: "var(--text)" }}>Phone:</strong> {contact.phone || <span style={{ color: "#ef4444" }}>No phone</span>} · Opens WhatsApp</>}
        </div>
        {templates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>TEMPLATE</label>
            <select className="input" value={selectedTpl} onChange={e => setSelectedTpl(e.target.value)} style={{ width: "100%" }}>
              <option value="">— None —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {type === "email" && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>SUBJECT</label>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} style={{ width: "100%" }} />
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>MESSAGE</label>
          <textarea className="input" value={body} onChange={e => setBody(e.target.value)} rows={8} style={{ width: "100%", resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {type === "email"
            ? <button onClick={openEmail} disabled={!contact.email || !body.trim()}
                style={{ background: "#0078d4", color: "white", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Open in Outlook
              </button>
            : <button onClick={openWhatsApp} disabled={!body.trim()}
                style={{ background: "#25d366", color: "white", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                Open WhatsApp
              </button>}
        </div>
      </div>
    </div>
  );
}

// ── Templates Tab ─────────────────────────────────────────────────────────────

function TemplatesTab({ list }: { list: ContactList }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing]     = useState<Template | null>(null);
  const [saving, setSaving]       = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setTemplates(await api.get<Template[]>(`/api/contact-lists/${list.id}/templates`));
  }, [list.id]);

  useEffect(() => { load(); }, [load]);

  function insertAt(ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement>, token: string, field: "body" | "subject") {
    const el = ref.current;
    if (!el) { setEditing(e => e ? { ...e, [field]: (e[field] || "") + token } : null); return; }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const newVal = el.value.slice(0, start) + token + el.value.slice(end);
    setEditing(e => e ? { ...e, [field]: newVal } : null);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); }, 0);
  }

  async function save() {
    if (!editing?.name.trim()) { alert("Template name required."); return; }
    setSaving(true);
    try { await api.post(`/api/contact-lists/${list.id}/templates`, editing); setEditing(null); load(); }
    catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete template?")) return;
    await api.delete(`/api/contact-lists/${list.id}/templates/${id}`);
    load();
  }

  const sampleContact: Contact = { id: "", listId: "", name: "John Smith", title: "CEO", company: "Acme Corp", location: "Sydney, Australia", email: "john@acme.com", phone: "+61 400 000 000", linkedinUrl: "", apolloId: "", enrichStatus: "enriched" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ type: "email", name: "", subject: "", body: "" })}>+ Email Template</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ type: "whatsapp", name: "", subject: "", body: "" })}>+ WhatsApp Template</button>
      </div>

      {templates.length === 0 && !editing && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No templates yet.</div>
      )}

      {templates.map(t => (
        <div key={t.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.type === "email" ? "var(--accent)" : "#25d366",
                background: t.type === "email" ? "var(--accent-10)" : "#25d36622",
                padding: "2px 8px", borderRadius: 10, marginRight: 8 }}>{t.type.toUpperCase()}</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</span>
              {t.subject && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>· {t.subject}</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...t })}>Edit</button>
              <button className="btn btn-ghost btn-sm" style={{ color: "#ef4444" }} onClick={() => del(t.id!)}>Delete</button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, marginBottom: 0, whiteSpace: "pre-wrap" }}>
            {t.body.slice(0, 200)}{t.body.length > 200 ? "…" : ""}
          </p>
        </div>
      ))}

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: 620, maxWidth: "96vw", maxHeight: "94vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                {editing.id ? "Edit" : "New"} {editing.type === "email" ? "📧 Email" : "💬 WhatsApp"} Template
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>✕</button>
            </div>

            {/* Token palette */}
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".5px" }}>
                Insert Placeholder at cursor — click to add
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TOKENS.map(tk => (
                  <button key={tk.value}
                    onClick={() => {
                      const activeEl = document.activeElement;
                      if (activeEl === bodyRef.current) insertAt(bodyRef as React.RefObject<HTMLTextAreaElement>, tk.value, "body");
                      else if (activeEl === subjRef.current) insertAt(subjRef as React.RefObject<HTMLInputElement>, tk.value, "subject");
                      else insertAt(bodyRef as React.RefObject<HTMLTextAreaElement>, tk.value, "body");
                    }}
                    style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, background: "var(--accent-10)",
                      color: "var(--accent)", border: "1px solid var(--accent)55", cursor: "pointer", fontFamily: "monospace", fontWeight: 600 }}>
                    {tk.value}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Click inside subject or body first, then click a token to insert at that position.</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>TEMPLATE NAME</label>
              <input className="input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                style={{ width: "100%" }} placeholder="e.g. Med Spa Cold Outreach" />
            </div>

            {editing.type === "email" && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>SUBJECT</label>
                <input ref={subjRef as React.RefObject<HTMLInputElement>} className="input" value={editing.subject}
                  onChange={e => setEditing({ ...editing, subject: e.target.value })}
                  style={{ width: "100%" }} placeholder="e.g. Quick intro — {{company}}" />
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>BODY</label>
              <textarea ref={bodyRef as React.RefObject<HTMLTextAreaElement>} className="input" value={editing.body}
                onChange={e => setEditing({ ...editing, body: e.target.value })}
                rows={10} style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
                placeholder={"Hi {{name}},\n\nI noticed {{company}} is…\n\nWould love to connect!\n\nBest,\n[Your Name]"} />
            </div>

            {/* Live preview */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                PREVIEW <span style={{ fontWeight: 400, fontSize: 11 }}>(sample: John Smith · CEO · Acme Corp · Sydney)</span>
              </label>
              <div style={{ padding: "12px 14px", background: "var(--surface2)", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", whiteSpace: "pre-wrap", color: "var(--text)", maxHeight: 150, overflowY: "auto", lineHeight: 1.6 }}>
                {editing.type === "email" && editing.subject && (
                  <div style={{ fontWeight: 600, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                    Subject: {interpolate(editing.subject, sampleContact)}
                  </div>
                )}
                {editing.body
                  ? <span>{interpolate(editing.body, sampleContact)}</span>
                  : <span style={{ color: "var(--muted)" }}>Preview appears here as you type…</span>}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Template"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Log Tab ───────────────────────────────────────────────────────────────────

function LogTab({ list }: { list: ContactList }) {
  const [log, setLog]         = useState<OutreachLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<OutreachLog[]>(`/api/contact-lists/${list.id}/outreach-log`)
      .then(setLog).catch(() => {}).finally(() => setLoading(false));
  }, [list.id]);

  return loading ? <div style={{ textAlign: "center", padding: 40 }}><span className="spinner spinner-dark" /></div>
    : log.length === 0 ? <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No outreach logged yet.</div>
    : (
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
              {["Type", "Recipient", "Status", "Error", "Sent At"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.map(l => (
              <tr key={l.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                    background: l.type === "email" ? "var(--accent-10)" : "#25d36622",
                    color: l.type === "email" ? "var(--accent)" : "#25d366" }}>{l.type}</span>
                </td>
                <td style={{ padding: "10px 14px" }}>{l.recipient}</td>
                <td style={{ padding: "10px 14px" }}><StatusBadge status={l.status} /></td>
                <td style={{ padding: "10px 14px", color: "#ef4444", fontSize: 12 }}>{l.error || "—"}</td>
                <td style={{ padding: "10px 14px", color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(l.sentAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
}
