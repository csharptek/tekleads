"use client";
import React, { useState, useEffect, useCallback } from "react";
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    enriched: "#22c55e", pending: "#f59e0b", failed: "#ef4444",
  };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
      background: `${colors[status] || "#94a3b8"}22`,
      color: colors[status] || "#94a3b8",
      border: `1px solid ${colors[status] || "#94a3b8"}44`,
    }}>{status}</span>
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
    .replace(/\{\{name\}\}/gi,     contact.name    || "")
    .replace(/\{\{company\}\}/gi,  contact.company || "")
    .replace(/\{\{location\}\}/gi, contact.location || "")
    .replace(/\{\{title\}\}/gi,    contact.title   || "")
    .replace(/\{\{email\}\}/gi,    contact.email   || "")
    .replace(/\{\{phone\}\}/gi,    contact.phone   || "");
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContactListsView() {
  const [lists, setLists]           = useState<ContactList[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeList, setActiveList] = useState<ContactList | null>(null);
  const [tab, setTab]               = useState<"contacts" | "templates" | "log">("contacts");

  // Upload modal
  const [showUpload, setShowUpload]   = useState(false);
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
    if (!uploadFile)          { setUploadErr("File required."); return; }
    setUploading(true); setUploadErr("");
    try {
      const fd = new FormData();
      fd.append("title", uploadTitle.trim());
      fd.append("file",  uploadFile);
      const res: any = await api.upload("/api/contact-lists/upload", fd);
      setShowUpload(false); setUploadTitle(""); setUploadFile(null);
      await loadLists();
      // auto-open the newly created list
      const fresh: ContactList[] = await api.get("/api/contact-lists");
      setLists(fresh);
      const created = fresh.find(l => l.id === res.listId);
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
    return (
      <ContactDetailView
        list={activeList}
        tab={tab}
        setTab={setTab}
        onBack={() => { setActiveList(null); loadLists(); }}
      />
    );
  }

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
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

      {/* Lists table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}><span className="spinner spinner-dark" /></div>
      ) : lists.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>
          No lists yet. Upload an Apollo export to get started.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
                {["Title", "Created", "Total", "Enriched", "Pending", "Failed", ""].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lists.map(l => (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  onClick={() => { setActiveList(l); setTab("contacts"); }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--text)" }}>{l.title}</td>
                  <td style={{ padding: "12px 14px", color: "var(--muted)" }}>{new Date(l.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: "12px 14px" }}><span style={{ fontWeight: 700 }}>{l.total}</span></td>
                  <td style={{ padding: "12px 14px", color: "#22c55e", fontWeight: 600 }}>{l.enriched}</td>
                  <td style={{ padding: "12px 14px", color: "#f59e0b", fontWeight: 600 }}>{l.notEnriched}</td>
                  <td style={{ padding: "12px 14px", color: "#ef4444", fontWeight: 600 }}>{l.failed}</td>
                  <td style={{ padding: "12px 14px" }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteList(l.id)}
                      style={{ color: "#ef4444" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload modal */}
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
              <input type="file" accept=".xlsx"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                style={{ fontSize: 13, color: "var(--text)" }} />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                Apollo export columns auto-mapped: First Name, Last Name, Title, Company, Email, Phone, LinkedIn URL, City, State, Country
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

// ── Contact Detail View ───────────────────────────────────────────────────────

function ContactDetailView({ list, tab, setTab, onBack }: {
  list: ContactList;
  tab: "contacts" | "templates" | "log";
  setTab: (t: "contacts" | "templates" | "log") => void;
  onBack: () => void;
}) {
  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>{list.title}</h1>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{list.total}</span> total ·
          <span style={{ color: "#22c55e", fontWeight: 600 }}>{list.enriched}</span> enriched ·
          <span style={{ color: "#f59e0b", fontWeight: 600 }}>{list.notEnriched}</span> pending
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {(["contacts", "templates", "log"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: "8px 16px", fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "var(--accent)" : "var(--muted)",
              background: "none", border: "none", cursor: "pointer",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1, textTransform: "capitalize",
            }}>
            {t === "log" ? "Outreach Log" : t === "templates" ? "Templates" : "Contacts"}
          </button>
        ))}
      </div>

      {tab === "contacts"  && <ContactsTab  list={list} />}
      {tab === "templates" && <TemplatesTab list={list} />}
      {tab === "log"       && <LogTab       list={list} />}
    </div>
  );
}

// ── Contacts Tab ──────────────────────────────────────────────────────────────

function ContactsTab({ list }: { list: ContactList }) {
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pageSize]                  = useState(25);
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatus]   = useState("");
  const [loading, setLoading]       = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [enriching, setEnriching]   = useState(false);
  const [enrichMsg, setEnrichMsg]   = useState("");
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [sendModal, setSendModal]   = useState<{ contact: Contact; type: "email" | "whatsapp" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res: any = await api.get(`/api/contact-lists/${list.id}/contacts?${params}`);
      setContacts(res.items || []);
      setTotal(res.total || 0);
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  }, [list.id, page, pageSize, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get<Template[]>(`/api/contact-lists/${list.id}/templates`).then(setTemplates).catch(() => {});
  }, [list.id]);

  function toggleOne(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectPage(checked: boolean) {
    setSelected(s => {
      const n = new Set(s);
      contacts.forEach(c => checked ? n.add(c.id) : n.delete(c.id));
      return n;
    });
  }
  function selectAll() {
    // select all contacts in list — fetch all IDs
    api.get<any>(`/api/contact-lists/${list.id}/contacts?page=1&pageSize=10000`).then(res => {
      setSelected(new Set((res.items as Contact[]).map(c => c.id)));
    });
  }

  async function enrich() {
    if (selected.size === 0) return;
    setEnriching(true); setEnrichMsg("");
    try {
      const res: any = await api.post(`/api/contact-lists/${list.id}/enrich`, { contactIds: [...selected] });
      setEnrichMsg(`Enriched: ${res.enriched} · Failed: ${res.failed}`);
      setSelected(new Set());
      load();
    } catch (e: any) { setEnrichMsg(e.message); }
    finally { setEnriching(false); }
  }

  const pages = Math.ceil(total / pageSize);

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder="Search name, email, company…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 200 }} />
        <select className="input" value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1); }}
          style={{ width: 140 }}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="enriched">Enriched</option>
          <option value="failed">Failed</option>
        </select>
        {selected.size > 0 && (
          <>
            <button className="btn btn-primary btn-sm" onClick={enrich} disabled={enriching}>
              {enriching
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Enriching…</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Enrich {selected.size}</>}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())} style={{ fontSize: 12 }}>Clear</button>
          </>
        )}
        {enrichMsg && <span style={{ fontSize: 12, color: "var(--muted)" }}>{enrichMsg}</span>}
      </div>

      {/* Select helpers */}
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, display: "flex", gap: 12 }}>
        <label style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={contacts.length > 0 && contacts.every(c => selected.has(c.id))}
            onChange={e => selectPage(e.target.checked)} style={{ marginRight: 4 }} />
          Select page
        </label>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "0 4px" }} onClick={selectAll}>
          Select all {total}
        </button>
        {selected.size > 0 && <span style={{ color: "var(--accent)", fontWeight: 600 }}>{selected.size} selected</span>}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}><span className="spinner spinner-dark" /></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
                <th style={{ padding: "10px 12px", width: 32 }}></th>
                {["Name", "Title", "Company", "Location", "Email", "Phone", "LinkedIn", "Status", "Actions"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                  </td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{c.name || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{c.title || "—"}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{c.company || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{c.location || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {c.email
                      ? <a href={`mailto:${c.email}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{c.email}</a>
                      : <span style={{ color: "#334155" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{c.phone || "—"}</td>
                  <td style={{ padding: "10px 12px" }}><LinkedInIcon url={c.linkedinUrl} /></td>
                  <td style={{ padding: "10px 12px" }}><StatusBadge status={c.enrichStatus} /></td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {c.email && (
                        <button className="btn btn-ghost btn-sm" title="Send Email"
                          onClick={() => setSendModal({ contact: c, type: "email" })}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        </button>
                      )}
                      {c.phone && (
                        <button className="btn btn-ghost btn-sm" title="WhatsApp"
                          onClick={() => setSendModal({ contact: c, type: "whatsapp" })}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>No contacts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, alignItems: "center", fontSize: 13 }}>
          <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span style={{ color: "var(--muted)" }}>Page {page} of {pages} · {total} contacts</span>
          <button className="btn btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next ›</button>
        </div>
      )}

      {/* Send modal */}
      {sendModal && (
        <SendOutreachModal
          contact={sendModal.contact}
          type={sendModal.type}
          listId={list.id}
          templates={templates.filter(t => t.type === sendModal.type)}
          onClose={() => setSendModal(null)}
        />
      )}
    </>
  );
}

// ── Send Outreach Modal ───────────────────────────────────────────────────────

function SendOutreachModal({ contact, type, listId, templates, onClose }: {
  contact: Contact; type: "email" | "whatsapp"; listId: string;
  templates: Template[]; onClose: () => void;
}) {
  const [selectedTpl, setSelectedTpl] = useState(templates[0]?.id || "");
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");
  const [sending, setSending]         = useState(false);
  const [msg, setMsg]                 = useState("");

  useEffect(() => {
    const tpl = templates.find(t => t.id === selectedTpl) || templates[0];
    if (tpl) {
      setSubject(interpolate(tpl.subject, contact));
      setBody(interpolate(tpl.body, contact));
    } else {
      setSubject(""); setBody("");
    }
  }, [selectedTpl, contact, templates]);

  async function send() {
    setSending(true); setMsg("");
    try {
      if (type === "email") {
        await api.post(`/api/contact-lists/${listId}/send-email`, {
          contactId: contact.id,
          toEmail: contact.email,
          toName:  contact.name,
          subject, body,
        });
        setMsg("Email sent.");
      } else {
        const phone = contact.phone.replace(/\D/g, "");
        const encodedMsg = encodeURIComponent(body);
        await api.post(`/api/contact-lists/${listId}/log-whatsapp`, { contactId: contact.id, phone: contact.phone });
        window.open(`https://wa.me/${phone}?text=${encodedMsg}`, "_blank");
        setMsg("WhatsApp opened.");
      }
    } catch (e: any) { setMsg(`Error: ${e.message}`); }
    finally { setSending(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            {type === "email" ? "✉ Send Email" : "💬 Send WhatsApp"} — {contact.name}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
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
          <textarea className="input" value={body} onChange={e => setBody(e.target.value)}
            rows={8} style={{ width: "100%", resize: "vertical" }} />
          <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Variables: {'{{name}}'} {'{{company}}'} {'{{title}}'} {'{{location}}'}
          </p>
        </div>

        {msg && <p style={{ fontSize: 13, color: msg.startsWith("Error") ? "#ef4444" : "#22c55e", marginBottom: 10 }}>{msg}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={send} disabled={sending || (!body.trim())}>
            {sending ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Sending…</> : type === "email" ? "Send Email" : "Open WhatsApp"}
          </button>
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

  const load = useCallback(async () => {
    const res = await api.get<Template[]>(`/api/contact-lists/${list.id}/templates`);
    setTemplates(res);
  }, [list.id]);

  useEffect(() => { load(); }, [load]);

  function newTemplate(type: "email" | "whatsapp") {
    setEditing({ type, name: "", subject: "", body: "" });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.post(`/api/contact-lists/${list.id}/templates`, editing);
      setEditing(null);
      load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete template?")) return;
    await api.delete(`/api/contact-lists/${list.id}/templates/${id}`);
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className="btn btn-primary btn-sm" onClick={() => newTemplate("email")}>+ Email Template</button>
        <button className="btn btn-ghost btn-sm" onClick={() => newTemplate("whatsapp")}>+ WhatsApp Template</button>
      </div>

      {templates.length === 0 && !editing && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          No templates yet. Create one to use in outreach.
        </div>
      )}

      {templates.map(t => (
        <div key={t.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.type === "email" ? "var(--accent)" : "#22c55e",
                background: t.type === "email" ? "var(--accent-10)" : "#22c55e22", padding: "2px 8px", borderRadius: 10, marginRight: 8 }}>
                {t.type.toUpperCase()}
              </span>
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
          <div className="card" style={{ width: 540, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{editing.id ? "Edit" : "New"} {editing.type === "email" ? "Email" : "WhatsApp"} Template</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>TEMPLATE NAME</label>
              <input className="input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={{ width: "100%" }} placeholder="e.g. SaaS Outreach v1" />
            </div>
            {editing.type === "email" && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>SUBJECT</label>
                <input className="input" value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} style={{ width: "100%" }} placeholder="e.g. Quick intro — {{company}}" />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>BODY</label>
              <textarea className="input" value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })}
                rows={10} style={{ width: "100%", resize: "vertical" }} placeholder={"Hi {{name}},\n\nI noticed {{company}} is…"} />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Variables: {'{{name}}'} {'{{company}}'} {'{{title}}'} {'{{location}}'} {'{{email}}'} {'{{phone}}'}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Outreach Log Tab ──────────────────────────────────────────────────────────

function LogTab({ list }: { list: ContactList }) {
  const [log, setLog]     = useState<OutreachLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<OutreachLog[]>(`/api/contact-lists/${list.id}/outreach-log`)
      .then(setLog).catch(() => {}).finally(() => setLoading(false));
  }, [list.id]);

  return (
    <div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}><span className="spinner spinner-dark" /></div>
      ) : log.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No outreach logged yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
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
                      background: l.type === "email" ? "var(--accent-10)" : "#22c55e22",
                      color: l.type === "email" ? "var(--accent)" : "#22c55e" }}>
                      {l.type}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>{l.recipient}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <StatusBadge status={l.status} />
                  </td>
                  <td style={{ padding: "10px 14px", color: "#ef4444", fontSize: 12 }}>{l.error || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {new Date(l.sentAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
