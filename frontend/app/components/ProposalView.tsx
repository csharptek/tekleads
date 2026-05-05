"use client";
import { useState, useRef, useEffect } from "react";
import { api } from "../../lib/api";

type GenerateProposalCtx = {
  proposalId: string;
  proposalHeadline?: string;
  clientName?: string;
  clientCompany?: string;
};

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

type Proposal = {
  id?: string;
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
  linkedLeadId?: string;
  apolloContactJson?: string;
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

export default function ProposalView({
  onViewList,
  onGenerateProposal,
  onGenerateArtifacts,
  editProposalId,
  onEditDone,
}: {
  onViewList?: () => void;
  onGenerateProposal?: (ctx: GenerateProposalCtx) => void;
  onGenerateArtifacts?: (ctx: any) => void;
  editProposalId?: string | null;
  onEditDone?: () => void;
}) {
  const [form, setForm] = useState<Proposal>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [apolloSearching, setApolloSearching] = useState(false);

  useEffect(() => {
    if (!editProposalId) return;
    api.get<any>(`/api/proposals/${editProposalId}`).then(p => {
      setSavedId(p.id);
      setForm({
        jobPostHeadline: p.jobPostHeadline || "",
        jobPostBody: p.jobPostBody || "",
        clientName: p.clientName || "",
        clientCompany: p.clientCompany || "",
        clientCountry: p.clientCountry || "",
        clientCity: p.clientCity || "",
        clientEmail: p.clientEmail || "",
        clientLinkedin: p.clientLinkedin || "",
        clientQuestions: p.clientQuestions?.length ? p.clientQuestions : [""],
        links: p.links?.length ? p.links : [""],
        linkLabels: p.linkLabels?.length ? p.linkLabels : [""],
        documentUrls: p.documentUrls || [],
        documentNames: p.documentNames || [],
        timelineValue: p.timelineValue || "",
        timelineUnit: p.timelineUnit || "weeks",
        budgetMin: p.budgetMin?.toString() || "",
        budgetMax: p.budgetMax?.toString() || "",
        notes: p.notes || "",
        tags: p.tags || "",
        followUpDate: p.followUpDate ? p.followUpDate.split("T")[0] : "",
        status: p.status || "draft",
        linkedLeadId: p.linkedLeadId,
        apolloContactJson: p.apolloContactJson,
      });
      onEditDone?.();
    }).catch(() => {});
  }, [editProposalId]);
  const [apolloResults, setApolloResults] = useState<Lead[]>([]);
  const [apolloError, setApolloError] = useState("");
  const [linkedContact, setLinkedContact] = useState<Lead | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{ emails: string[]; phones: string[]; fullName: string; location: string; phoneWebhookPending?: boolean } | null>(null);

  const set = (k: keyof Proposal, v: any) => setForm(f => ({ ...f, [k]: v }));

  const setQuestion = (i: number, v: string) => {
    const arr = [...form.clientQuestions]; arr[i] = v; set("clientQuestions", arr);
  };
  const addQuestion = () => set("clientQuestions", [...form.clientQuestions, ""]);
  const removeQuestion = (i: number) => set("clientQuestions", form.clientQuestions.filter((_, j) => j !== i));

  const setLink = (i: number, field: "url" | "label", v: string) => {
    const urls = [...form.links]; const labels = [...form.linkLabels];
    if (field === "url") urls[i] = v; else labels[i] = v;
    setForm(f => ({ ...f, links: urls, linkLabels: labels }));
  };
  const addLink = () => setForm(f => ({ ...f, links: [...f.links, ""], linkLabels: [...f.linkLabels, ""] }));
  const removeLink = (i: number) => setForm(f => ({
    ...f, links: f.links.filter((_, j) => j !== i), linkLabels: f.linkLabels.filter((_, j) => j !== i),
  }));

  const handleSave = async (andNew = false) => {
    if (!form.jobPostBody.trim()) { setError("Job post is required."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const payload: any = {
        ...form,
        budgetMin: form.budgetMin ? parseFloat(form.budgetMin) : null,
        budgetMax: form.budgetMax ? parseFloat(form.budgetMax) : null,
        clientQuestions: form.clientQuestions.filter(q => q.trim()),
        links: form.links.filter(l => l.trim()),
        followUpDate: form.followUpDate || null,
        linkedLeadId: linkedContact?.id || null,
        apolloContactJson: linkedContact ? JSON.stringify(linkedContact) : null,
      };
      let res: any;
      if (savedId) {
        res = await api.put(`/api/proposals/${savedId}`, payload);
      } else {
        res = await api.post("/api/proposals", payload);
        setSavedId(res.id);
      }
      setSuccess(andNew ? "Saved! Starting new proposal." : "Proposal saved.");
      if (andNew) {
        setTimeout(() => {
          setForm({ ...EMPTY });
          setSavedId(null);
          setLinkedContact(null);
          setApolloResults([]);
          setEnrichResult(null);
          setSuccess("");
        }, 800);
      }
      return res?.id ?? savedId;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateArtifacts = async () => {
    if (!form.jobPostBody.trim()) { setError("Job post is required to generate artifacts."); return; }
    let id = savedId;
    if (!id) {
      id = await handleSave(false);
    }
    if (!id) return;
    if (onGenerateArtifacts) {
      onGenerateArtifacts({
        proposalId: id,
        proposalHeadline: form.jobPostHeadline || form.jobPostBody.slice(0, 60),
        clientName: form.clientName,
        clientEmail: form.clientEmail,
        clientPhone: enrichResult?.phones?.[0] || linkedContact?.phones?.[0] || "",
        autoGenerate: true,
      });
    }
  };

  const handleGenerateProposal = async () => {
    if (!form.jobPostBody.trim()) { setError("Job post is required to generate a proposal."); return; }
    let id = savedId;
    if (!id) {
      id = await handleSave(false);
    }
    if (onGenerateProposal) {
      onGenerateProposal({
        proposalId: id || "new",
        proposalHeadline: form.jobPostHeadline || form.jobPostBody.slice(0, 60),
        clientName: form.clientName,
        clientCompany: form.clientCompany,
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    if (!savedId) { setError("Save the proposal first before uploading files."); e.target.value = ""; return; }
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res: any = await api.upload(`/api/proposals/${savedId}/upload`, fd);
        setForm(f => ({ ...f, documentUrls: [...f.documentUrls, res.url], documentNames: [...f.documentNames, res.name] }));
      }
      setSuccess("File(s) uploaded.");
    } catch (e: any) {
      setError(e.message);
    } finally { setUploading(false); e.target.value = ""; }
  };

  const handleRemoveDoc = async (i: number) => {
    const url = form.documentUrls[i];
    if (savedId && url) { try { await api.del(`/api/proposals/${savedId}/document`, { url }); } catch { } }
    setForm(f => ({ ...f, documentUrls: f.documentUrls.filter((_, j) => j !== i), documentNames: f.documentNames.filter((_, j) => j !== i) }));
  };

  const handleApolloSearch = async () => {
    if (!form.clientName && !form.clientCompany) { setApolloError("Enter client name or company first."); return; }
    setApolloSearching(true); setApolloError(""); setApolloResults([]);
    try {
      const res: any = await api.post(`/api/leads/search`, { name: form.clientName || null, company: form.clientCompany || null, title: null, industry: null, location: null, page: 1, perPage: 10 });
      setApolloResults(res.leads || []);
      if (!res.leads?.length) setApolloError("No results found.");
    } catch (e: any) { setApolloError(e.message); } finally { setApolloSearching(false); }
  };

  const handleLinkContact = (lead: Lead) => {
    setLinkedContact(lead);
    setForm(f => ({
      ...f,
      clientName: lead.name || f.clientName,
      clientCompany: lead.company || f.clientCompany,
      clientEmail: f.clientEmail || lead.emails?.[0] || "",
    }));
    setApolloResults([]); setEnrichResult(null);
  };

  const handleRevealContact = async () => {
    if (!linkedContact) return;
    setEnriching(true); setApolloError("");
    try {
      await api.post("/api/leads/save", [linkedContact]);
      const allLeads: any = await api.get("/api/leads");
      const dbLead = (allLeads || []).find((l: any) => l.apolloId === linkedContact.apolloId);
      if (!dbLead) throw new Error("Could not find saved lead in DB.");
      const res: any = await api.post(`/api/leads/${dbLead.id}/reveal-phone`, {});
      setEnrichResult(res);
      const enrichedName = res.fullName?.trim() ? res.fullName : null;
      // Parse location string "City, State, Country" from Apollo
      const locationParts = (res.location || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      const enrichedCity    = locationParts[0] || "";
      const enrichedCountry = locationParts[locationParts.length - 1] || "";

      setForm(f => ({
        ...f,
        ...(enrichedName ? { clientName: enrichedName } : {}),
        ...(res.emails?.length > 0 ? { clientEmail: f.clientEmail || res.emails[0] } : {}),
        ...(enrichedCity    && !f.clientCity    ? { clientCity: enrichedCity }       : {}),
        ...(enrichedCountry && !f.clientCountry ? { clientCountry: enrichedCountry } : {}),
      }));
      setLinkedContact(c => c ? {
        ...c,
        id: dbLead.id,
        name: enrichedName || c.name,
        emails: res.emails?.length ? res.emails : c.emails,
        phones: res.phones?.length ? res.phones : c.phones,
        location: res.location || c.location,
      } : c);
    } catch (e: any) { setApolloError(e.message); } finally { setEnriching(false); }
  };

  const resetForm = () => {
    setForm({ ...EMPTY }); setSavedId(null); setLinkedContact(null);
    setApolloResults([]); setSuccess(""); setError(""); setEnrichResult(null);
  };

  const SaveButtons = ({ sm = false }: { sm?: boolean }) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className={`btn btn-ghost ${sm ? "btn-sm" : ""}`} onClick={resetForm}>Clear</button>
      {onViewList && (
        <button className={`btn btn-ghost ${sm ? "btn-sm" : ""}`} onClick={onViewList}>View All</button>
      )}
      <button className={`btn btn-secondary ${sm ? "btn-sm" : ""}`} onClick={() => handleSave(true)} disabled={saving}>
        {saving ? <span className="spinner" /> : null}Save & New
      </button>
      <button className={`btn btn-primary ${sm ? "btn-sm" : ""}`} onClick={() => handleSave(false)} disabled={saving}>
        {saving ? <span className="spinner" /> : null}
        {savedId ? "Update" : "Save Draft"}
      </button>
      <button
        className={`btn ${sm ? "btn-sm" : ""}`}
        onClick={handleGenerateArtifacts}
        disabled={saving}
        style={{ background: "#0f172a", color: "white", border: "none" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Generate Artifacts
      </button>
    </div>
  );

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="page-header">
        <div>
          <div className="page-title">New Proposal</div>
          <div className="page-sub">Job post, client info, and Apollo contact lookup</div>
        </div>
        <SaveButtons sm />
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {success && <div className="banner banner-success">{success}</div>}

      {/* Job Post */}
      <div className="card">
        <div className="card-title">Job Post</div>
        <div className="card-sub">Paste the job post or client brief</div>
        <div style={{ marginBottom: 12 }}>
          <div className="field-label">Headline (optional)</div>
          <input className="input" placeholder="e.g. Need a .NET developer for SaaS platform..." value={form.jobPostHeadline} onChange={e => set("jobPostHeadline", e.target.value)} />
        </div>
        <div>
          <div className="field-label">Job Description <span style={{ color: "var(--red)" }}>*</span></div>
          <textarea className="input" rows={6} placeholder="Paste full job post here..." value={form.jobPostBody} onChange={e => set("jobPostBody", e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
        </div>
      </div>

      {/* Client Info */}
      <div className="card">
        <div className="card-title">Client Information</div>
        <div className="card-sub">All fields optional</div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div><div className="field-label">Client Name</div><input className="input" placeholder="John Smith" value={form.clientName} onChange={e => set("clientName", e.target.value)} /></div>
          <div><div className="field-label">Company</div><input className="input" placeholder="Acme Corp" value={form.clientCompany} onChange={e => set("clientCompany", e.target.value)} /></div>
          <div><div className="field-label">Country</div><input className="input" placeholder="United States" value={form.clientCountry} onChange={e => set("clientCountry", e.target.value)} /></div>
          <div><div className="field-label">City</div><input className="input" placeholder="New York" value={form.clientCity} onChange={e => set("clientCity", e.target.value)} /></div>
          <div><div className="field-label">Email</div><input className="input" placeholder="client@example.com" value={form.clientEmail} onChange={e => set("clientEmail", e.target.value)} /></div>
          <div><div className="field-label">LinkedIn</div><input className="input" placeholder="https://linkedin.com/in/..." value={form.clientLinkedin} onChange={e => set("clientLinkedin", e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="field-label" style={{ margin: 0 }}>Apollo Contact Lookup</div>
            <button className="btn btn-ghost btn-sm" onClick={handleApolloSearch} disabled={apolloSearching}>
              {apolloSearching ? <span className="spinner spinner-dark" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>}
              Search Apollo
            </button>
          </div>
          {linkedContact && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--green-light)", borderRadius: 8, marginBottom: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>{linkedContact.name} — {linkedContact.title} at {linkedContact.company}</div>
                {enrichResult && (
                  <div style={{ fontSize: 11, color: "var(--green)", marginTop: 2 }}>
                    {enrichResult.emails?.length > 0 && <span>📧 {enrichResult.emails.join(", ")} </span>}
                    {enrichResult.phones?.length > 0 && <span>📞 {enrichResult.phones.join(", ")} </span>}
                    {enrichResult.location && <span>📍 {enrichResult.location}</span>}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleRevealContact} disabled={enriching}>
                {enriching ? <span className="spinner spinner-dark" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>}
                Reveal Email & Phone
              </button>
              <button className="icon-btn" onClick={() => { setLinkedContact(null); setEnrichResult(null); }}>✕</button>
            </div>
          )}
          {apolloError && <div className="banner banner-error" style={{ marginBottom: 8 }}>{apolloError}</div>}
          {apolloResults.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              {apolloResults.map((lead, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: i < apolloResults.length - 1 ? "1px solid var(--border)" : "none", background: "white" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{lead.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{lead.title}{lead.company ? ` · ${lead.company}` : ""}{lead.location ? ` · ${lead.location}` : ""}</div>
                    {lead.emails?.length > 0 && <div style={{ fontSize: 11, color: "var(--accent)" }}>{lead.emails[0]}</div>}
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => handleLinkContact(lead)}>Link</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Documents */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>Documents</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Word, PDF, images — save proposal first to enable upload</div>
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
        {!savedId && <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px", background: "var(--surface)", borderRadius: 6 }}>💡 Save the proposal first, then upload files.</div>}
        {form.documentUrls.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {form.documentUrls.map((url, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, color: "var(--accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {form.documentNames[i] || `Document ${i + 1}`}
                </a>
                <button className="icon-btn" onClick={() => handleRemoveDoc(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Questions */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>Client Questions</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Questions from the client — optional</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addQuestion}>+ Add</button>
        </div>
        {form.clientQuestions.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder={`Question ${i + 1}`} value={q} onChange={e => setQuestion(i, e.target.value)} />
            {form.clientQuestions.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => removeQuestion(i)}>✕</button>}
          </div>
        ))}
      </div>

      {/* Links */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>Links</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Relevant links — optional</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addLink}>+ Add</button>
        </div>
        {form.links.map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="Label (e.g. Demo)" value={form.linkLabels[i] || ""} onChange={e => setLink(i, "label", e.target.value)} />
            <input className="input" placeholder="https://..." value={l} onChange={e => setLink(i, "url", e.target.value)} />
            {form.links.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => removeLink(i)}>✕</button>}
          </div>
        ))}
      </div>

      {/* Timeline & Budget */}
      <div className="card">
        <div className="card-title">Timeline, Budget & Meta</div>
        <div className="card-sub">Optional — used for proposal generation context</div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
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
      </div>

      {/* Notes */}
      <div className="card">
        <div className="card-title">Internal Notes</div>
        <textarea className="input" rows={3} placeholder="Private notes about this proposal..." value={form.notes} onChange={e => set("notes", e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
      </div>

      {/* Fixed bottom bar */}
      <div className="bottom-bar">
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {savedId ? `ID: ${savedId.slice(0, 8)}…` : "Not saved yet"}
          {form.documentUrls.length > 0 && ` · ${form.documentUrls.length} file(s)`}
        </div>
        <SaveButtons />
      </div>
    </div>
  );
}
