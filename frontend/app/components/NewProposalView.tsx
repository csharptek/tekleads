"use client";
import { useState, useRef, useEffect } from "react";
import { api } from "../../lib/api";

type Lead = {
  id?: string;
  apolloId?: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  emails: string[];
  phones: string[];
  linkedinUrl?: string;
};

type EnrichedContact = {
  lead: Lead;
  enriching: boolean;
  enriched: boolean;
  checkedEmails: string[];
  checkedPhones: string[];
  isPrimary: boolean;
};

type Proposal = {
  jobPostHeadline: string;
  jobPostBody: string;
  clientName: string;
  clientCompany: string;
  clientCountry: string;
  clientCity: string;
  clientEmail: string;
  clientLinkedin: string;
  clientQuestions: string[];
  links: string[];
  linkLabels: string[];
  documentUrls: string[];
  documentNames: string[];
  timelineValue: string;
  timelineUnit: string;
  budgetMin: string;
  budgetMax: string;
  notes: string;
  tags: string;
  followUpDate: string;
  status: string;
};

const EMPTY_PROPOSAL: Proposal = {
  jobPostHeadline: "", jobPostBody: "", clientName: "", clientCompany: "",
  clientCountry: "", clientCity: "", clientEmail: "", clientLinkedin: "",
  clientQuestions: [""], links: [""], linkLabels: [], documentUrls: [],
  documentNames: [], timelineValue: "", timelineUnit: "weeks",
  budgetMin: "", budgetMax: "", notes: "", tags: "", followUpDate: "", status: "draft",
};

export default function NewProposalView({
  onViewList,
  onGenerateArtifacts,
}: {
  onViewList?: () => void;
  onGenerateArtifacts?: (ctx: any) => void;
}) {
  const [waTemplate, setWaTemplate] = useState("Hi {name}, I came across your profile and would love to connect!");

  useEffect(() => {
    api.get<{ values: Record<string, string> }>("/api/settings")
      .then(d => { if (d.values?.whatsapp_message_template) setWaTemplate(d.values.whatsapp_message_template); })
      .catch(() => {});
  }, []);

  // Section 1 — search
  const [searchForm, setSearchForm] = useState({ name: "", company: "", title: "", industry: "", location: "" });
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [contacts, setContacts] = useState<EnrichedContact[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const SEARCH_PER_PAGE = 25;
  const [phonePending, setPhonePending] = useState<Set<string>>(new Set());

  // Section 2 — proposal
  const [form, setForm] = useState<Proposal>({ ...EMPTY_PROPOSAL });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sf = (k: keyof typeof searchForm, v: string) => setSearchForm(p => ({ ...p, [k]: v }));
  const set = (k: keyof Proposal, v: any) => setForm(f => ({ ...f, [k]: v }));

  const primaryContact = contacts.find(c => c.isPrimary);
  const section2Unlocked = contacts.some(c => c.enriched);

  // ── Search ──
  const doSearch = async (p = 1) => {
    setSearching(true); setError(""); setSearchResults([]);
    try {
      const res: any = await api.post("/api/leads/search", { ...searchForm, page: p, perPage: SEARCH_PER_PAGE });
      setSearchResults(res.leads || []);
      setSearchTotal(res.total || 0);
      setSearchPage(p);
      setSearched(true);
      if (!(res.leads || []).length) setError("No results found.");
    } catch (e: any) { setError(e.message); }
    finally { setSearching(false); }
  };

  const resetAll = () => {
    setSearchForm({ name: "", company: "", title: "", industry: "", location: "" });
    setSearchResults([]); setSearched(false); setSearchPage(1); setSearchTotal(0);
    setContacts([]); setPhonePending(new Set());
    setForm({ ...EMPTY_PROPOSAL }); setSavedId(null);
    setError(""); setSuccess("");
  };

  // ── Enrich ──
  const handleEnrich = async (lead: Lead, resultIdx: number) => {
    // Add to contacts list if not already there
    const existing = contacts.findIndex(c => c.lead.apolloId === lead.apolloId);
    if (existing === -1) {
      setContacts(prev => [...prev, {
        lead, enriching: true, enriched: false,
        checkedEmails: [], checkedPhones: [], isPrimary: false,
      }]);
    } else {
      setContacts(prev => prev.map((c, i) => i === existing ? { ...c, enriching: true } : c));
    }
    setError("");
    try {
      const saveRes: any = await api.post("/api/leads/save", [lead]);
      const savedLead = saveRes.leads?.find((l: any) => l.apolloId === lead.apolloId) || lead;
      const realId = savedLead.id || lead.id;
      const res: any = await api.post(`/api/leads/${realId}/reveal-phone`, {});

      const updatedLead: Lead = {
        ...lead,
        id: realId,
        name: res.fullName?.trim() ? res.fullName : lead.name,
        location: res.location?.trim() ? res.location : lead.location,
        emails: res.emails?.length ? res.emails : lead.emails,
        phones: res.phones?.length ? res.phones : lead.phones,
        linkedinUrl: res.linkedinUrl?.trim() ? res.linkedinUrl : lead.linkedinUrl,
      };

      setContacts(prev => {
        const idx = prev.findIndex(c => c.lead.apolloId === lead.apolloId);
        if (idx === -1) return prev;
        return prev.map((c, i) => i === idx ? {
          ...c,
          lead: updatedLead,
          enriching: false,
          enriched: true,
          checkedEmails: updatedLead.emails || [],
          checkedPhones: updatedLead.phones || [],
        } : c);
      });

      // also update search results row
      setSearchResults(prev => prev.map((l, i) => i === resultIdx ? updatedLead : l));

      if (res.phoneWebhookPending) {
        setPhonePending(p => new Set([...p, realId]));
        const timer = setInterval(async () => {
          try {
            const updated: any = await api.get(`/api/leads/${realId}`);
            if (updated.phones?.length > 0) {
              clearInterval(timer);
              setPhonePending(p => { const n = new Set(p); n.delete(realId); return n; });
              setContacts(prev => prev.map(c => c.lead.id === realId ? {
                ...c, lead: { ...c.lead, phones: updated.phones },
                checkedPhones: updated.phones,
              } : c));
            }
          } catch { }
        }, 5000);
        setTimeout(() => clearInterval(timer), 120000);
      }
    } catch (e: any) {
      setError(e.message);
      setContacts(prev => prev.map(c => c.lead.apolloId === lead.apolloId ? { ...c, enriching: false } : c));
    }
  };

  const setPrimary = (apolloId: string) => {
    setContacts(prev => prev.map(c => ({ ...c, isPrimary: c.lead.apolloId === apolloId })));
    const contact = contacts.find(c => c.lead.apolloId === apolloId);
    if (contact) {
      setForm(f => ({
        ...f,
        clientName: contact.lead.name || f.clientName,
        clientCompany: contact.lead.company || f.clientCompany,
        clientEmail: f.clientEmail || contact.checkedEmails[0] || "",
      }));
    }
  };

  const toggleEmail = (apolloId: string, email: string) => {
    setContacts(prev => prev.map(c => {
      if (c.lead.apolloId !== apolloId) return c;
      const has = c.checkedEmails.includes(email);
      return { ...c, checkedEmails: has ? c.checkedEmails.filter(e => e !== email) : [...c.checkedEmails, email] };
    }));
  };

  const togglePhone = (apolloId: string, phone: string) => {
    setContacts(prev => prev.map(c => {
      if (c.lead.apolloId !== apolloId) return c;
      const has = c.checkedPhones.includes(phone);
      return { ...c, checkedPhones: has ? c.checkedPhones.filter(p => p !== phone) : [...c.checkedPhones, phone] };
    }));
  };

  // ── Proposal fields helpers ──
  const setQuestion = (i: number, v: string) => { const a = [...form.clientQuestions]; a[i] = v; set("clientQuestions", a); };
  const addQuestion = () => set("clientQuestions", [...form.clientQuestions, ""]);
  const removeQuestion = (i: number) => set("clientQuestions", form.clientQuestions.filter((_, j) => j !== i));
  const setLink = (i: number, field: "url" | "label", v: string) => {
    const urls = [...form.links]; const labels = [...(form.linkLabels || [])];
    if (field === "url") urls[i] = v; else labels[i] = v;
    setForm(f => ({ ...f, links: urls, linkLabels: labels }));
  };
  const addLink = () => setForm(f => ({ ...f, links: [...f.links, ""], linkLabels: [...(f.linkLabels || []), ""] }));
  const removeLink = (i: number) => setForm(f => ({
    ...f, links: f.links.filter((_, j) => j !== i), linkLabels: (f.linkLabels || []).filter((_, j) => j !== i),
  }));

  // ── Save ──
  const handleSave = async (andNew = false) => {
    if (!primaryContact) { setError("Select a primary contact first."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const secondary = contacts.filter(c => !c.isPrimary && c.enriched);
      const payload: any = {
        ...form,
        budgetMin: form.budgetMin ? parseFloat(form.budgetMin) : null,
        budgetMax: form.budgetMax ? parseFloat(form.budgetMax) : null,
        clientQuestions: form.clientQuestions.filter(q => q.trim()),
        links: form.links.filter(l => l.trim()),
        followUpDate: form.followUpDate || null,
        linkedLeadId: primaryContact.lead.id || null,
        apolloContactJson: JSON.stringify(primaryContact.lead),
        additionalContactsJson: secondary.length ? JSON.stringify(secondary.map(c => c.lead)) : null,
      };
      let res: any;
      if (savedId) {
        res = await api.put(`/api/proposals/${savedId}`, payload);
      } else {
        res = await api.post("/api/proposals", payload);
        setSavedId(res.id);
      }
      setSuccess(andNew ? "Saved! Starting new." : "Proposal saved.");
      if (andNew) setTimeout(resetAll, 800);
      return res?.id ?? savedId;
    } catch (e: any) { setError(e.message); return null; }
    finally { setSaving(false); }
  };

  const handleGenerateArtifacts = async () => {
    if (!primaryContact) { setError("Select a primary contact first."); return; }
    if (!form.jobPostBody.trim()) { setError("Job post is required."); return; }
    let id = savedId;
    if (!id) id = await handleSave(false);
    if (!id) return;
    const allEmails = contacts.flatMap(c => c.checkedEmails);
    const allPhones = contacts.flatMap(c => c.checkedPhones);
    onGenerateArtifacts?.({
      proposalId: id,
      proposalHeadline: form.jobPostHeadline || form.jobPostBody.slice(0, 60),
      clientName: form.clientName,
      clientEmail: primaryContact.checkedEmails[0] || form.clientEmail,
      clientPhone: primaryContact.checkedPhones[0] || "",
      allEmails,
      allPhones,
      autoGenerate: true,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    if (!savedId) { setError("Save first before uploading."); e.target.value = ""; return; }
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData(); fd.append("file", file);
        const res: any = await api.upload(`/api/proposals/${savedId}/upload`, fd);
        setForm(f => ({ ...f, documentUrls: [...f.documentUrls, res.url], documentNames: [...f.documentNames, res.name] }));
      }
      setSuccess("File(s) uploaded.");
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const handleRemoveDoc = async (i: number) => {
    const url = form.documentUrls[i];
    if (savedId && url) { try { await api.del(`/api/proposals/${savedId}/document`, { url }); } catch { } }
    setForm(f => ({ ...f, documentUrls: f.documentUrls.filter((_, j) => j !== i), documentNames: f.documentNames.filter((_, j) => j !== i) }));
  };

  const SaveButtons = ({ sm = false }: { sm?: boolean }) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {onViewList && <button className={`btn btn-ghost ${sm ? "btn-sm" : ""}`} onClick={onViewList}>View All</button>}
      <button className={`btn btn-secondary ${sm ? "btn-sm" : ""}`} onClick={() => handleSave(true)} disabled={saving || !section2Unlocked}>
        {saving ? <span className="spinner" /> : null}Save & New
      </button>
      <button className={`btn btn-primary ${sm ? "btn-sm" : ""}`} onClick={() => handleSave(false)} disabled={saving || !section2Unlocked}>
        {saving ? <span className="spinner" /> : null}{savedId ? "Update" : "Save Draft"}
      </button>
      <button className={`btn ${sm ? "btn-sm" : ""}`} onClick={handleGenerateArtifacts} disabled={saving || !section2Unlocked}
        style={{ background: "#0f172a", color: "white", border: "none", opacity: section2Unlocked ? 1 : 0.5 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Generate Artifacts
      </button>
    </div>
  );

  const isEnriched = (lead: Lead) => contacts.some(c => c.lead.apolloId === lead.apolloId && c.enriched);
  const isEnriching = (lead: Lead) => contacts.some(c => c.lead.apolloId === lead.apolloId && c.enriching);
  const getContact = (lead: Lead) => contacts.find(c => c.lead.apolloId === lead.apolloId);

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="page-header">
        <div>
          <div className="page-title">New Proposal (New)</div>
          <div className="page-sub">Search contacts · Enrich · Select primary · Build proposal</div>
        </div>
        <SaveButtons sm />
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {success && <div className="banner banner-success">{success}</div>}

      {/* ── SECTION 1 ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div className="card-title">Section 1 — Contact Search</div>
            <div className="card-sub">Search Apollo · Enrich contacts · Select one as primary (required)</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={resetAll}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>
            New Search
          </button>
        </div>

        {/* Search filters */}
        <div className="grid-3" style={{ marginBottom: 12 }}>
          {([["name","Person Name","e.g. John Smith"],["title","Job Title","e.g. CTO"],["company","Company","e.g. Acme Corp"],["industry","Industry","e.g. Software"],["location","Location","e.g. London"]] as [keyof typeof searchForm, string, string][]).map(([k, lbl, ph]) => (
            <div key={k}>
              <div className="field-label">{lbl}</div>
              <input className="input" placeholder={ph} value={searchForm[k]}
                onChange={e => sf(k, e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(1)} />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => doSearch(1)} disabled={searching}>
              {searching ? <><span className="spinner" />&nbsp;Searching…</> : "Search Apollo"}
            </button>
          </div>
        </div>

        {/* Results table */}
        {searched && searchResults.length > 0 && (
          <>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>Primary</th>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Emails</th>
                  <th>Phones</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((lead, i) => {
                  const contact = getContact(lead);
                  const enriched = !!contact?.enriched;
                  const enriching = !!contact?.enriching;
                  const pending = phonePending.has(lead.id || "");
                  return (
                    <tr key={i} style={{ background: contact?.isPrimary ? "var(--green-light)" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        {enriched ? (
                          <input type="radio" name="primary-contact"
                            checked={!!contact?.isPrimary}
                            onChange={() => setPrimary(lead.apolloId || "")}
                            title="Set as primary contact" />
                        ) : <span style={{ color: "var(--dim)", fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{lead.name || "—"}</div>
                        {lead.linkedinUrl && (<a href={lead.linkedinUrl} target="_blank" rel="noreferrer" title="LinkedIn"
                        style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                      </a>)}
                        {contact?.isPrimary && <span style={{ fontSize: 10, fontWeight: 700, background: "var(--green)", color: "white", padding: "1px 5px", borderRadius: 8, marginLeft: 4 }}>PRIMARY</span>}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.title || "—"}</td>
                      <td style={{ fontSize: 12 }}>{lead.company || "—"}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.location || "—"}</td>
                      <td style={{ fontSize: 12 }}>
                        {enriched && contact ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {contact.lead.emails.map((email, ei) => (
                              <label key={ei} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                                <input type="checkbox" checked={contact.checkedEmails.includes(email)}
                                  onChange={() => toggleEmail(lead.apolloId || "", email)} />
                                <span className="chip chip-blue" style={{ fontSize: 10 }}>{email}</span>
                              </label>
                            ))}
                            {!contact.lead.emails.length && <span style={{ color: "var(--dim)" }}>—</span>}
                          </div>
                        ) : lead.emails?.[0]
                          ? <span className="chip chip-blue" style={{ fontSize: 10 }}>{lead.emails[0]}</span>
                          : <span style={{ color: "var(--dim)" }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {enriched && contact ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {pending && !contact.lead.phones.length && <span className="chip chip-orange" style={{ fontSize: 10 }}>pending…</span>}
                            {contact.lead.phones.map((phone, pi) => {
                              const clean = phone.replace(/\D/g, "");
                              return (
                                <label key={pi} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                                  <input type="checkbox" checked={contact.checkedPhones.includes(phone)}
                                    onChange={() => togglePhone(lead.apolloId || "", phone)} />
                                  <a href={`https://wa.me/${clean}?text=${encodeURIComponent(waTemplate.replace("{name}", contact.lead.name?.split(" ")[0] || contact.lead.name || "").replace("{phone}", phone))}`} target="_blank" rel="noreferrer"
                                    className="chip chip-green" style={{ fontSize: 10, textDecoration: "none" }}>💬 {phone}</a>
                                </label>
                              );
                            })}
                            {!contact.lead.phones.length && !pending && <span style={{ color: "var(--dim)" }}>—</span>}
                          </div>
                        ) : <span style={{ color: "var(--dim)" }}>—</span>}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleEnrich(lead, i)} disabled={enriching || enriched}>
                          {enriching ? <span className="spinner spinner-dark" /> : enriched ? "✓ Enriched" : "Enrich"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {searchTotal > SEARCH_PER_PAGE && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {searchTotal.toLocaleString()} total · page {searchPage} of {Math.ceil(searchTotal / SEARCH_PER_PAGE)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => doSearch(searchPage - 1)} disabled={searchPage <= 1 || searching}>← Prev</button>
                <button className="btn btn-ghost btn-sm" onClick={() => doSearch(searchPage + 1)} disabled={searchPage >= Math.ceil(searchTotal / SEARCH_PER_PAGE) || searching}>Next →</button>
              </div>
            </div>
          )}
          </>
        )}

        {searched && searchResults.length === 0 && !searching && (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>No results.</div>
        )}

        {/* Enriched contacts summary */}
        {contacts.filter(c => c.enriched).length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div className="field-label" style={{ marginBottom: 6 }}>Enriched contacts for this proposal</div>
            {contacts.filter(c => c.enriched).map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: c.isPrimary ? "var(--green-light)" : "var(--surface)", borderRadius: 6, marginBottom: 4, border: `1px solid ${c.isPrimary ? "var(--green)" : "var(--border)"}` }}>
                <input type="radio" name="primary-contact" checked={c.isPrimary}
                  onChange={() => setPrimary(c.lead.apolloId || "")} />
                <div style={{ flex: 1, fontSize: 13 }}>
                  <strong>{c.lead.name}</strong>
                  <span style={{ color: "var(--muted)", marginLeft: 6 }}>{c.lead.title} · {c.lead.company}</span>
                </div>
                {c.isPrimary && <span style={{ fontSize: 10, fontWeight: 700, background: "var(--green)", color: "white", padding: "1px 5px", borderRadius: 8 }}>PRIMARY</span>}
              </div>
            ))}
            {!primaryContact && (
              <div style={{ fontSize: 12, color: "var(--red, #ef4444)", marginTop: 4 }}>⚠ Select a primary contact to enable saving</div>
            )}
          </div>
        )}
      </div>

      {/* ── SECTION 2 ── */}
      <div className="card" style={{ opacity: section2Unlocked ? 1 : 0.5, pointerEvents: section2Unlocked ? "auto" : "none" }}>
        <div className="card-title">Section 2 — Proposal Details</div>
        <div className="card-sub">{section2Unlocked ? "Enrich at least one contact above to enable" : "Unlocked — enter proposal details below"}</div>

        {/* Manual client fields */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div><div className="field-label">Client Name</div><input className="input" placeholder="John Smith" value={form.clientName} onChange={e => set("clientName", e.target.value)} /></div>
          <div><div className="field-label">Company</div><input className="input" placeholder="Acme Corp" value={form.clientCompany} onChange={e => set("clientCompany", e.target.value)} /></div>
          <div><div className="field-label">Country</div><input className="input" placeholder="United States" value={form.clientCountry} onChange={e => set("clientCountry", e.target.value)} /></div>
          <div><div className="field-label">City</div><input className="input" placeholder="New York" value={form.clientCity} onChange={e => set("clientCity", e.target.value)} /></div>
          <div><div className="field-label">Email</div><input className="input" placeholder="client@example.com" value={form.clientEmail} onChange={e => set("clientEmail", e.target.value)} /></div>
          <div><div className="field-label">LinkedIn</div><input className="input" placeholder="https://linkedin.com/in/..." value={form.clientLinkedin} onChange={e => set("clientLinkedin", e.target.value)} /></div>
        </div>

        {/* Job Post */}
        <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="field-label">Headline (optional)</div>
          <input className="input" placeholder="e.g. Need a .NET developer for SaaS platform..." value={form.jobPostHeadline} onChange={e => set("jobPostHeadline", e.target.value)} style={{ marginBottom: 10 }} />
          <div className="field-label">Job Description</div>
          <textarea className="input" rows={6} placeholder="Paste full job post here..." value={form.jobPostBody} onChange={e => set("jobPostBody", e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {/* Timeline & Budget */}
        <div className="grid-2" style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><div className="field-label">Timeline</div><input className="input" type="number" placeholder="4" value={form.timelineValue} onChange={e => set("timelineValue", e.target.value)} /></div>
            <div style={{ width: 110 }}><div className="field-label">Unit</div>
              <select className="input" value={form.timelineUnit} onChange={e => set("timelineUnit", e.target.value)}>
                <option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><div className="field-label">Budget Min (USD)</div><input className="input" type="number" placeholder="1000" value={form.budgetMin} onChange={e => set("budgetMin", e.target.value)} /></div>
            <div style={{ flex: 1 }}><div className="field-label">Budget Max (USD)</div><input className="input" type="number" placeholder="5000" value={form.budgetMax} onChange={e => set("budgetMax", e.target.value)} /></div>
          </div>
          <div><div className="field-label">Tags</div><input className="input" placeholder="urgent, react, long-term" value={form.tags} onChange={e => set("tags", e.target.value)} /></div>
          <div><div className="field-label">Follow-up Date</div><input className="input" type="date" value={form.followUpDate} onChange={e => set("followUpDate", e.target.value)} /></div>
        </div>

        {/* Links */}
        <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="field-label" style={{ margin: 0 }}>Links</div>
            <button className="btn btn-ghost btn-sm" onClick={addLink}>+ Add</button>
          </div>
          {form.links.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginBottom: 8 }}>
              <input className="input" placeholder="Label" value={(form.linkLabels || [])[i] || ""} onChange={e => setLink(i, "label", e.target.value)} />
              <input className="input" placeholder="https://..." value={l} onChange={e => setLink(i, "url", e.target.value)} />
              {form.links.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => removeLink(i)}>✕</button>}
            </div>
          ))}
        </div>

        {/* Documents */}
        <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div className="field-label" style={{ margin: 0 }}>Documents</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Save proposal first to enable upload</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {uploading && <span className="spinner spinner-dark" />}
              <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading || !savedId}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload
              </button>
              <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp" style={{ display: "none" }} onChange={handleFileUpload} />
            </div>
          </div>
          {!savedId && <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px", background: "var(--surface)", borderRadius: 6 }}>💡 Save first, then upload files.</div>}
          {form.documentUrls.map((url, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)", marginBottom: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, color: "var(--accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {form.documentNames[i] || `Document ${i + 1}`}
              </a>
              <button className="icon-btn" onClick={() => handleRemoveDoc(i)}>✕</button>
            </div>
          ))}
        </div>

        {/* Questions */}
        <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="field-label" style={{ margin: 0 }}>Client Questions</div>
            <button className="btn btn-ghost btn-sm" onClick={addQuestion}>+ Add</button>
          </div>
          {form.clientQuestions.map((q, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input className="input" placeholder={`Question ${i + 1}`} value={q} onChange={e => setQuestion(i, e.target.value)} />
              {form.clientQuestions.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => removeQuestion(i)}>✕</button>}
            </div>
          ))}
        </div>

        {/* Notes */}
        <div style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="field-label">Internal Notes</div>
          <textarea className="input" rows={3} placeholder="Private notes..." value={form.notes} onChange={e => set("notes", e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bottom-bar">
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {savedId ? `ID: ${savedId.slice(0, 8)}…` : "Not saved yet"}
          {primaryContact && ` · Primary: ${primaryContact.lead.name}`}
          {contacts.filter(c => c.enriched).length > 1 && ` · ${contacts.filter(c => c.enriched).length} contacts`}
        </div>
        <SaveButtons />
      </div>
    </div>
  );
}
