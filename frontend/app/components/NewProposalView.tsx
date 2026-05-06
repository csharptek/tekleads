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

type EnrichResult = {
  emails: string[];
  phones: string[];
  fullName: string;
  location: string;
  phoneWebhookPending?: boolean;
};

type LinkedContact = {
  lead: Lead;
  enrichResult: EnrichResult | null;
  enriching: boolean;
  isPrimary: boolean;
  checkedEmails: Set<string>;
  checkedPhones: Set<string>;
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

const EMPTY: Proposal = {
  jobPostHeadline: "",
  jobPostBody: "",
  clientName: "",
  clientCompany: "",
  clientCountry: "",
  clientCity: "",
  clientEmail: "",
  clientLinkedin: "",
  clientQuestions: [""],
  links: [""],
  linkLabels: [""],
  documentUrls: [],
  documentNames: [],
  timelineValue: "",
  timelineUnit: "weeks",
  budgetMin: "",
  budgetMax: "",
  notes: "",
  tags: "",
  followUpDate: "",
  status: "draft",
};

// Inline search panel — reusable inside this file
function ApolloSearchPanel({
  onSelect,
  label = "Search Apollo",
}: {
  onSelect: (lead: Lead) => void;
  label?: string;
}) {
  const [form, setForm] = useState({ name: "", company: "", title: "", industry: "", location: "" });
  const [results, setResults] = useState<Lead[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const doSearch = async () => {
    setSearching(true); setError(""); setResults([]);
    try {
      const res: any = await api.post("/api/leads/search", { ...form, page: 1, perPage: 10 });
      setResults(res.leads || []);
      setSearched(true);
      if (!(res.leads || []).length) setError("No results.");
    } catch (e: any) { setError(e.message); }
    finally { setSearching(false); }
  };

  return (
    <div style={{ marginTop: 12, padding: 14, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div className="grid-3" style={{ marginBottom: 10 }}>
        {([ ["name","Person Name","e.g. John Smith"], ["company","Company","e.g. Acme Corp"], ["title","Job Title","e.g. CTO"], ["industry","Industry","e.g. Software"], ["location","Location","e.g. London"] ] as [keyof typeof form, string, string][]).map(([k, lbl, ph]) => (
          <div key={k}>
            <div className="field-label">{lbl}</div>
            <input className="input" placeholder={ph} value={form[k]} onChange={e => f(k, e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()} />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={doSearch} disabled={searching}>
            {searching ? <><span className="spinner" />&nbsp;Searching…</> : label}
          </button>
        </div>
      </div>
      {error && <div className="banner banner-error" style={{ marginBottom: 8 }}>{error}</div>}
      {searched && results.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {results.map((lead, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none", background: "white" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lead.name || "—"}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{lead.title}{lead.company ? ` · ${lead.company}` : ""}{lead.location ? ` · ${lead.location}` : ""}</div>
                {lead.emails?.[0] && <div style={{ fontSize: 11, color: "var(--accent)" }}>{lead.emails[0]}</div>}
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => { onSelect(lead); setResults([]); setSearched(false); setForm({ name: "", company: "", title: "", industry: "", location: "" }); }}>
                Select
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewProposalView({
  onViewList,
  onGenerateArtifacts,
}: {
  onViewList?: () => void;
  onGenerateArtifacts?: (ctx: any) => void;
}) {
  const [form, setForm] = useState<Proposal>({ ...EMPTY });
  const [contacts, setContacts] = useState<LinkedContact[]>([]);
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phonePending, setPhonePending] = useState<Set<string>>(new Set());

  const set = (k: keyof Proposal, v: any) => setForm(f => ({ ...f, [k]: v }));

  const setQuestion = (i: number, v: string) => { const a = [...form.clientQuestions]; a[i] = v; set("clientQuestions", a); };
  const addQuestion = () => set("clientQuestions", [...form.clientQuestions, ""]);
  const removeQuestion = (i: number) => set("clientQuestions", form.clientQuestions.filter((_, j) => j !== i));

  const setLink = (i: number, field: "url" | "label", v: string) => {
    const urls = [...form.links]; const labels = [...form.linkLabels];
    if (field === "url") urls[i] = v; else labels[i] = v;
    setForm(f => ({ ...f, links: urls, linkLabels: labels }));
  };
  const addLink = () => setForm(f => ({ ...f, links: [...f.links, ""], linkLabels: [...f.linkLabels, ""] }));
  const removeLink = (i: number) => setForm(f => ({ ...f, links: f.links.filter((_, j) => j !== i), linkLabels: f.linkLabels.filter((_, j) => j !== i) }));

  const handleSelectContact = (lead: Lead, isPrimary: boolean) => {
    const newContact: LinkedContact = {
      lead,
      enrichResult: null,
      enriching: false,
      isPrimary,
      checkedEmails: new Set(lead.emails || []),
      checkedPhones: new Set(lead.phones || []),
    };
    if (isPrimary) {
      setContacts(prev => [newContact, ...prev.filter(c => !c.isPrimary)]);
      setForm(f => ({
        ...f,
        clientName: lead.name || f.clientName,
        clientCompany: lead.company || f.clientCompany,
        clientEmail: f.clientEmail || lead.emails?.[0] || "",
      }));
    } else {
      setContacts(prev => [...prev, newContact]);
    }
    setShowAddSearch(false);
  };

  const handleReveal = async (idx: number) => {
    const contact = contacts[idx];
    if (!contact) return;

    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, enriching: true } : c));
    setError("");
    try {
      const saveRes: any = await api.post("/api/leads/save", [contact.lead]);
      const savedLead = saveRes.leads?.find((l: any) => l.apolloId === contact.lead.apolloId) || contact.lead;
      const realId = savedLead.id || contact.lead.id;

      const res: any = await api.post(`/api/leads/${realId}/reveal-phone`, {});

      const updatedLead: Lead = {
        ...contact.lead,
        id: realId,
        name: res.fullName?.trim() ? res.fullName : contact.lead.name,
        location: res.location?.trim() ? res.location : contact.lead.location,
        emails: res.emails?.length ? res.emails : contact.lead.emails,
        phones: res.phones?.length ? res.phones : contact.lead.phones,
      };

      setContacts(prev => prev.map((c, i) => i === idx ? {
        ...c,
        lead: updatedLead,
        enrichResult: res,
        enriching: false,
        checkedEmails: new Set(res.emails?.length ? res.emails : contact.lead.emails),
        checkedPhones: new Set(res.phones?.length ? res.phones : contact.lead.phones),
      } : c));

      if (contact.isPrimary) {
        const locParts = (res.location || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        setForm(f => ({
          ...f,
          ...(res.fullName?.trim() ? { clientName: res.fullName } : {}),
          ...(res.emails?.[0] && !f.clientEmail ? { clientEmail: res.emails[0] } : {}),
          ...(locParts[0] && !f.clientCity ? { clientCity: locParts[0] } : {}),
          ...(locParts[locParts.length - 1] && !f.clientCountry ? { clientCountry: locParts[locParts.length - 1] } : {}),
        }));
      }

      if (res.phoneWebhookPending) {
        setPhonePending(p => new Set([...p, realId]));
        const timer = setInterval(async () => {
          try {
            const updated: any = await api.get(`/api/leads/${realId}`);
            if (updated.phones?.length > 0) {
              clearInterval(timer);
              setPhonePending(p => { const n = new Set(p); n.delete(realId); return n; });
              setContacts(prev => prev.map((c, i) => i === idx ? {
                ...c,
                lead: { ...c.lead, phones: updated.phones },
                checkedPhones: new Set(updated.phones),
              } : c));
            }
          } catch { }
        }, 5000);
        setTimeout(() => clearInterval(timer), 120000);
      }
    } catch (e: any) {
      setError(e.message);
      setContacts(prev => prev.map((c, i) => i === idx ? { ...c, enriching: false } : c));
    }
  };

  const removeContact = (idx: number) => setContacts(prev => prev.filter((_, i) => i !== idx));

  const toggleEmail = (idx: number, email: string) => {
    setContacts(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const s = new Set(c.checkedEmails);
      s.has(email) ? s.delete(email) : s.add(email);
      return { ...c, checkedEmails: s };
    }));
  };

  const togglePhone = (idx: number, phone: string) => {
    setContacts(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const s = new Set(c.checkedPhones);
      s.has(phone) ? s.delete(phone) : s.add(phone);
      return { ...c, checkedPhones: s };
    }));
  };

  const handleSave = async (andNew = false) => {
    if (!form.jobPostBody.trim() && !contacts.length) { setError("Add a contact or job post."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const primary = contacts.find(c => c.isPrimary);
      const additional = contacts.filter(c => !c.isPrimary);
      const payload: any = {
        ...form,
        budgetMin: form.budgetMin ? parseFloat(form.budgetMin) : null,
        budgetMax: form.budgetMax ? parseFloat(form.budgetMax) : null,
        clientQuestions: form.clientQuestions.filter(q => q.trim()),
        links: form.links.filter(l => l.trim()),
        followUpDate: form.followUpDate || null,
        linkedLeadId: primary?.lead?.id || null,
        apolloContactJson: primary ? JSON.stringify(primary.lead) : null,
        additionalContactsJson: additional.length ? JSON.stringify(additional.map(c => c.lead)) : null,
      };
      let res: any;
      if (savedId) {
        res = await api.put(`/api/proposals/${savedId}`, payload);
      } else {
        res = await api.post("/api/proposals", payload);
        setSavedId(res.id);
      }
      setSuccess(andNew ? "Saved! Starting new." : "Proposal saved.");
      if (andNew) {
        setTimeout(() => {
          setForm({ ...EMPTY }); setSavedId(null);
          setContacts([]); setSuccess("");
        }, 800);
      }
      return res?.id ?? savedId;
    } catch (e: any) { setError(e.message); return null; }
    finally { setSaving(false); }
  };

  const handleGenerateArtifacts = async () => {
    if (!form.jobPostBody.trim()) { setError("Job post is required."); return; }
    let id = savedId;
    if (!id) id = await handleSave(false);
    if (!id) return;
    const primary = contacts.find(c => c.isPrimary);
    onGenerateArtifacts?.({
      proposalId: id,
      proposalHeadline: form.jobPostHeadline || form.jobPostBody.slice(0, 60),
      clientName: form.clientName,
      clientEmail: [...contacts].flatMap(c => [...c.checkedEmails])[0] || form.clientEmail,
      clientPhone: [...contacts].flatMap(c => [...c.checkedPhones])[0] || "",
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

  const resetForm = () => {
    setForm({ ...EMPTY }); setSavedId(null);
    setContacts([]); setSuccess(""); setError("");
  };

  const SaveButtons = ({ sm = false }: { sm?: boolean }) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className={`btn btn-ghost ${sm ? "btn-sm" : ""}`} onClick={resetForm}>Clear</button>
      {onViewList && <button className={`btn btn-ghost ${sm ? "btn-sm" : ""}`} onClick={onViewList}>View All</button>}
      <button className={`btn btn-secondary ${sm ? "btn-sm" : ""}`} onClick={() => handleSave(true)} disabled={saving}>
        {saving ? <span className="spinner" /> : null}Save & New
      </button>
      <button className={`btn btn-primary ${sm ? "btn-sm" : ""}`} onClick={() => handleSave(false)} disabled={saving}>
        {saving ? <span className="spinner" /> : null}
        {savedId ? "Update" : "Save Draft"}
      </button>
      <button className={`btn ${sm ? "btn-sm" : ""}`} onClick={handleGenerateArtifacts} disabled={saving}
        style={{ background: "#0f172a", color: "white", border: "none" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Generate Artifacts
      </button>
    </div>
  );

  const hasPrimary = contacts.some(c => c.isPrimary);

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="page-header">
        <div>
          <div className="page-title">New Proposal (New)</div>
          <div className="page-sub">Search contacts, build proposal, generate artifacts</div>
        </div>
        <SaveButtons sm />
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {success && <div className="banner banner-success">{success}</div>}

      {/* ── SECTION 1: Client Information ── */}
      <div className="card">
        <div className="card-title">Section 1 — Client Information</div>
        <div className="card-sub">Search and select contacts. Enrich auto-saves to Saved Leads.</div>

        {/* Manual fields */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div><div className="field-label">Client Name</div><input className="input" placeholder="John Smith" value={form.clientName} onChange={e => set("clientName", e.target.value)} /></div>
          <div><div className="field-label">Company</div><input className="input" placeholder="Acme Corp" value={form.clientCompany} onChange={e => set("clientCompany", e.target.value)} /></div>
          <div><div className="field-label">Country</div><input className="input" placeholder="United States" value={form.clientCountry} onChange={e => set("clientCountry", e.target.value)} /></div>
          <div><div className="field-label">City</div><input className="input" placeholder="New York" value={form.clientCity} onChange={e => set("clientCity", e.target.value)} /></div>
          <div><div className="field-label">Email</div><input className="input" placeholder="client@example.com" value={form.clientEmail} onChange={e => set("clientEmail", e.target.value)} /></div>
          <div><div className="field-label">LinkedIn</div><input className="input" placeholder="https://linkedin.com/in/..." value={form.clientLinkedin} onChange={e => set("clientLinkedin", e.target.value)} /></div>
        </div>

        {/* Primary search */}
        <div style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="field-label" style={{ marginBottom: 4 }}>
            {hasPrimary ? "Primary Contact" : "Search & Select Primary Contact"}
          </div>

          {!hasPrimary && (
            <ApolloSearchPanel label="Search Apollo" onSelect={lead => handleSelectContact(lead, true)} />
          )}

          {/* Contact cards */}
          {contacts.map((c, idx) => (
            <div key={idx} style={{ marginTop: 10, padding: "12px 14px", background: c.isPrimary ? "var(--green-light)" : "var(--surface)", borderRadius: 8, border: `1px solid ${c.isPrimary ? "var(--green)" : "var(--border)"}` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    {c.isPrimary && <span style={{ fontSize: 10, fontWeight: 700, background: "var(--green)", color: "white", padding: "1px 6px", borderRadius: 10 }}>PRIMARY</span>}
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.lead.name}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.lead.title}{c.lead.company ? ` · ${c.lead.company}` : ""}</span>
                  </div>

                  {/* Emails with checkboxes */}
                  {(c.enrichResult?.emails?.length || c.lead.emails?.length) ? (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Emails (check to include in artifacts):</div>
                      {(c.enrichResult?.emails?.length ? c.enrichResult.emails : c.lead.emails).map((email, ei) => (
                        <label key={ei} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 2 }}>
                          <input type="checkbox" checked={c.checkedEmails.has(email)} onChange={() => toggleEmail(idx, email)} />
                          <span className="chip chip-blue" style={{ fontSize: 11 }}>{email}</span>
                          <a href={`mailto:${email}`} style={{ fontSize: 11, color: "var(--accent)" }} title="Open mailto">✉</a>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {/* Phones with checkboxes */}
                  {(c.enrichResult?.phones?.length || c.lead.phones?.length || phonePending.has(c.lead.id || "")) ? (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Phones (check to include in artifacts):</div>
                      {phonePending.has(c.lead.id || "") && !(c.enrichResult?.phones?.length || c.lead.phones?.length) && (
                        <span className="chip chip-orange" style={{ fontSize: 11 }}>pending…</span>
                      )}
                      {(c.enrichResult?.phones?.length ? c.enrichResult.phones : c.lead.phones || []).map((phone, pi) => {
                        const clean = phone.replace(/\D/g, "");
                        return (
                          <label key={pi} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 2 }}>
                            <input type="checkbox" checked={c.checkedPhones.has(phone)} onChange={() => togglePhone(idx, phone)} />
                            <span className="chip chip-green" style={{ fontSize: 11 }}>{phone}</span>
                            <a href={`https://wa.me/${clean}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--green)" }} title="Open WhatsApp">💬</a>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleReveal(idx)} disabled={c.enriching}>
                    {c.enriching ? <span className="spinner spinner-dark" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>}
                    Reveal
                  </button>
                  <button className="icon-btn" onClick={() => removeContact(idx)} title="Remove">✕</button>
                </div>
              </div>
            </div>
          ))}

          {/* Add another contact */}
          <div style={{ marginTop: 12 }}>
            {!showAddSearch ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddSearch(true)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                + Add Another Contact
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div className="field-label" style={{ margin: 0 }}>Search Additional Contact</div>
                  <button className="icon-btn" onClick={() => setShowAddSearch(false)}>✕</button>
                </div>
                <ApolloSearchPanel label="Search Apollo" onSelect={lead => handleSelectContact(lead, false)} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Proposal Details ── */}
      <div className="card">
        <div className="card-title">Section 2 — Proposal Details</div>
        <div className="card-sub">Job post, timeline, budget, documents, notes</div>

        {/* Job Post */}
        <div style={{ marginBottom: 14 }}>
          <div className="field-label">Headline (optional)</div>
          <input className="input" placeholder="e.g. Need a .NET developer for SaaS platform..." value={form.jobPostHeadline} onChange={e => set("jobPostHeadline", e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div className="field-label">Job Description</div>
          <textarea className="input" rows={6} placeholder="Paste full job post here..." value={form.jobPostBody} onChange={e => set("jobPostBody", e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {/* Timeline & Budget */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">Timeline</div>
              <input className="input" type="number" placeholder="4" value={form.timelineValue} onChange={e => set("timelineValue", e.target.value)} />
            </div>
            <div style={{ width: 110 }}>
              <div className="field-label">Unit</div>
              <select className="input" value={form.timelineUnit} onChange={e => set("timelineUnit", e.target.value)}>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="field-label">Budget Min (USD)</div>
              <input className="input" type="number" placeholder="1000" value={form.budgetMin} onChange={e => set("budgetMin", e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="field-label">Budget Max (USD)</div>
              <input className="input" type="number" placeholder="5000" value={form.budgetMax} onChange={e => set("budgetMax", e.target.value)} />
            </div>
          </div>
          <div>
            <div className="field-label">Tags (comma separated)</div>
            <input className="input" placeholder="urgent, long-term, react" value={form.tags} onChange={e => set("tags", e.target.value)} />
          </div>
          <div>
            <div className="field-label">Follow-up Date</div>
            <input className="input" type="date" value={form.followUpDate} onChange={e => set("followUpDate", e.target.value)} />
          </div>
        </div>

        {/* Links */}
        <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="field-label" style={{ margin: 0 }}>Links</div>
            <button className="btn btn-ghost btn-sm" onClick={addLink}>+ Add</button>
          </div>
          {form.links.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginBottom: 8 }}>
              <input className="input" placeholder="Label" value={form.linkLabels[i] || ""} onChange={e => setLink(i, "label", e.target.value)} />
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
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload
              </button>
              <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp" style={{ display: "none" }} onChange={handleFileUpload} />
            </div>
          </div>
          {!savedId && <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px", background: "var(--surface)", borderRadius: 6 }}>💡 Save proposal first, then upload files.</div>}
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
          {contacts.length > 0 && ` · ${contacts.length} contact(s)`}
          {form.documentUrls.length > 0 && ` · ${form.documentUrls.length} file(s)`}
        </div>
        <SaveButtons />
      </div>
    </div>
  );
}
