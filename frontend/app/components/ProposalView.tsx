"use client";
import { useState } from "react";
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
  timelineValue: string;
  timelineUnit: string;
  budgetMin: string;
  budgetMax: string;
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
  timelineValue: "",
  timelineUnit: "weeks",
  budgetMin: "",
  budgetMax: "",
  status: "draft",
};

export default function ProposalView() {
  const [form, setForm] = useState<Proposal>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Apollo search
  const [apolloSearching, setApolloSearching] = useState(false);
  const [apolloResults, setApolloResults] = useState<Lead[]>([]);
  const [apolloError, setApolloError] = useState("");
  const [linkedContact, setLinkedContact] = useState<Lead | null>(null);
  const [linkSaving, setLinkSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{emails:string[],phones:string[],fullName:string,location:string,phoneWebhookPending?:boolean}|null>(null);

  const set = (k: keyof Proposal, v: any) => setForm(f => ({ ...f, [k]: v }));

  const setQuestion = (i: number, v: string) => {
    const arr = [...form.clientQuestions];
    arr[i] = v;
    set("clientQuestions", arr);
  };
  const addQuestion = () => set("clientQuestions", [...form.clientQuestions, ""]);
  const removeQuestion = (i: number) => set("clientQuestions", form.clientQuestions.filter((_, j) => j !== i));

  const setLink = (i: number, field: "url" | "label", v: string) => {
    const urls = [...form.links];
    const labels = [...form.linkLabels];
    if (field === "url") urls[i] = v; else labels[i] = v;
    setForm(f => ({ ...f, links: urls, linkLabels: labels }));
  };
  const addLink = () => setForm(f => ({ ...f, links: [...f.links, ""], linkLabels: [...f.linkLabels, ""] }));
  const removeLink = (i: number) => setForm(f => ({
    ...f,
    links: f.links.filter((_, j) => j !== i),
    linkLabels: f.linkLabels.filter((_, j) => j !== i),
  }));

  const handleSave = async () => {
    if (!form.jobPostBody.trim()) { setError("Job post is required."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const payload = {
        ...form,
        budgetMin: form.budgetMin ? parseFloat(form.budgetMin) : null,
        budgetMax: form.budgetMax ? parseFloat(form.budgetMax) : null,
        clientQuestions: form.clientQuestions.filter(q => q.trim()),
        links: form.links.filter(l => l.trim()),
        linkLabels: form.linkLabels,
        documentUrls: [],
      };
      let res: any;
      if (savedId) {
        res = await api.put(`/api/proposals/${savedId}`, payload);
      } else {
        res = await api.post("/api/proposals", payload);
        setSavedId(res.id);
      }
      setSuccess("Saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApolloSearch = async () => {
    if (!form.clientName && !form.clientCompany) {
      setApolloError("Enter client name or company first.");
      return;
    }
    setApolloSearching(true); setApolloError(""); setApolloResults([]);
    try {
      const res: any = await api.post(`/api/leads/search`, {
        name: form.clientName || null,
        company: form.clientCompany || null,
        title: null,
        industry: null,
        location: null,
        page: 1,
        perPage: 10,
      });
      setApolloResults(res.leads || []);
      if (!res.leads?.length) setApolloError("No results found.");
    } catch (e: any) {
      setApolloError(e.message);
    } finally {
      setApolloSearching(false);
    }
  };

  const handleLinkContact = async (lead: Lead) => {
    if (!savedId) {
      setApolloError("Save the proposal first before linking a contact.");
      return;
    }
    setLinkSaving(true);
    try {
      const res: any = await api.post(`/api/proposals/${savedId}/link-contact`, {
        apolloContactJson: JSON.stringify(lead),
        clientName: lead.name || form.clientName,
        clientCompany: lead.company || form.clientCompany,
        lead: {
          apolloId: lead.apolloId,
          name: lead.name,
          title: lead.title,
          company: lead.company,
          industry: lead.industry,
          location: lead.location,
          emails: lead.emails || [],
          phones: lead.phones || [],
          linkedinUrl: lead.linkedinUrl || null,
        },
      });
      setLinkedContact({ ...lead, id: res.leadId });
      setForm(f => ({
        ...f,
        clientName: lead.name || f.clientName,
        clientCompany: lead.company || f.clientCompany,
        linkedLeadId: res.leadId,
      }));
      setApolloResults([]);
      setEnrichResult(null);
      setSuccess("Contact linked and saved to leads.");
    } catch (e: any) {
      setApolloError(e.message);
    } finally {
      setLinkSaving(false);
    }
  };

  const handleRevealContact = async () => {
    if (!linkedContact?.id) return;
    setEnriching(true); setApolloError("");
    try {
      // Save lead first (required before reveal-phone, same as LeadSearchView)
      await api.post("/api/leads/save", [linkedContact]);
      const res: any = await api.post(`/api/leads/${linkedContact.id}/reveal-phone`, {});
      setEnrichResult(res);
      if (res.emails?.length > 0) setForm(f => ({ ...f, clientEmail: f.clientEmail || res.emails[0] }));
      setLinkedContact(c => c ? {
        ...c,
        name: res.fullName?.trim() ? res.fullName : c.name,
        location: res.location?.trim() ? res.location : c.location,
        emails: res.emails?.length ? res.emails : c.emails,
        phones: res.phones?.length ? res.phones : c.phones,
      } : c);
    } catch (e: any) {
      setApolloError(e.message);
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">New Proposal</div>
          <div className="page-sub">Job post, client info, and Apollo contact lookup</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...EMPTY }); setSavedId(null); setLinkedContact(null); setApolloResults([]); setSuccess(""); setError(""); }}>
            Clear
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {savedId ? "Update" : "Save Draft"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {success && <div className="banner banner-success">{success}</div>}

      {/* Job Post */}
      <div className="card">
        <div className="card-title">Job Post</div>
        <div className="card-sub">Paste the Upwork job post or any brief from the client</div>
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
        <div className="card-sub">All fields optional except for Apollo lookup</div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div>
            <div className="field-label">Client Name</div>
            <input className="input" placeholder="John Smith" value={form.clientName} onChange={e => set("clientName", e.target.value)} />
          </div>
          <div>
            <div className="field-label">Company</div>
            <input className="input" placeholder="Acme Corp" value={form.clientCompany} onChange={e => set("clientCompany", e.target.value)} />
          </div>
          <div>
            <div className="field-label">Country</div>
            <input className="input" placeholder="United States" value={form.clientCountry} onChange={e => set("clientCountry", e.target.value)} />
          </div>
          <div>
            <div className="field-label">City</div>
            <input className="input" placeholder="New York" value={form.clientCity} onChange={e => set("clientCity", e.target.value)} />
          </div>
          <div>
            <div className="field-label">Email</div>
            <input className="input" placeholder="client@example.com" value={form.clientEmail} onChange={e => set("clientEmail", e.target.value)} />
          </div>
          <div>
            <div className="field-label">LinkedIn</div>
            <input className="input" placeholder="https://linkedin.com/in/..." value={form.clientLinkedin} onChange={e => set("clientLinkedin", e.target.value)} />
          </div>
        </div>

        {/* Apollo lookup */}
        <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="field-label" style={{ margin: 0 }}>Apollo Contact Lookup</div>
            <button className="btn btn-ghost btn-sm" onClick={handleApolloSearch} disabled={apolloSearching}>
              {apolloSearching ? <span className="spinner spinner-dark" /> : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              )}
              Search Apollo
            </button>
          </div>

          {linkedContact && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--green-light)", borderRadius: 8, marginBottom: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>{linkedContact.name} — {linkedContact.title} at {linkedContact.company}</div>
                  {enrichResult && (
                    <div style={{ fontSize: 11, color: "var(--green)", marginTop: 2 }}>
                      {enrichResult.emails?.length > 0 && <span>📧 {enrichResult.emails.join(", ")} </span>}
                      {enrichResult.phones?.length > 0 && <span>📞 {enrichResult.phones.join(", ")}</span>}
                      {enrichResult.phoneWebhookPending && <span style={{ color: "var(--orange)" }}> · Phone pending webhook</span>}
                    </div>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={handleRevealContact} disabled={enriching} style={{ flexShrink: 0 }}>
                  {enriching ? <span className="spinner spinner-dark" /> : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                  )}
                  Reveal Email & Phone
                </button>
                <button className="icon-btn" onClick={() => { setLinkedContact(null); setEnrichResult(null); }}>✕</button>
              </div>
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
                  <button className="btn btn-primary btn-sm" onClick={() => handleLinkContact(lead)} disabled={linkSaving}>
                    {linkSaving ? <span className="spinner" /> : "Link"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Client Questions */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>Client Questions</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Questions the client asked — optional</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addQuestion}>+ Add</button>
        </div>
        {form.clientQuestions.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder={`Question ${i + 1}`} value={q} onChange={e => setQuestion(i, e.target.value)} />
            {form.clientQuestions.length > 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => removeQuestion(i)} style={{ flexShrink: 0 }}>✕</button>
            )}
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
            {form.links.length > 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => removeLink(i)}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* Timeline & Budget */}
      <div className="card">
        <div className="card-title">Timeline & Budget</div>
        <div className="card-sub">Optional — used for proposal generation context</div>
        <div className="grid-2">
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
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : null}
          {savedId ? "Update Proposal" : "Save Proposal"}
        </button>
      </div>
    </div>
  );
}
