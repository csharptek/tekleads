"use client";
import { useState, useRef, useEffect } from "react";
import { api } from "../../lib/api";

interface LeadOrgDetails {
  orgWebsiteUrl?: string;
  orgEstimatedEmployees?: string;
  orgAnnualRevenue?: string;
  orgFoundedYear?: string;
  orgLinkedinUrl?: string;
  orgPhone?: string;
  orgAddress?: string;
}

interface LeadEmploymentHistory {
  jobTitle?: string;
  orgName?: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

type Lead = {
  id?: string;
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
  headline?: string;
  seniority?: string;
  emailStatus?: string;
  departments?: string[];
  photoUrl?: string;
  orgDetails?: LeadOrgDetails;
  employmentHistory?: LeadEmploymentHistory[];
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
  const [searchForm, setSearchForm] = useState({ name: "", company: "", title: "", industry: "", location: "", domain: "", linkedinUrl: "" });
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

  // Duplicate check modal
  type DupMatch = { id: string; name: string; title: string; company: string; emails: string[]; phones: string[] };
  type EnrichType = "email" | "phone" | "all";
  type EnrichModal = { lead: Lead; resultIdx: number; matches: DupMatch[]; enrichType: EnrichType } | null;
  const CREDIT_INFO: Record<EnrichType, string> = {
    email: "Reveals email only · uses Apollo credits · phone will not be revealed.",
    phone: "Reveals phone only · uses Apollo credits · reveal is async.",
    all:   "Reveals email + phone · uses Apollo credits · phone reveal is async.",
  };
  const [enrichModal, setEnrichModal] = useState<EnrichModal>(null);

  const startEnrich = async (lead: Lead, resultIdx: number, enrichType: EnrichType) => {
    if (!lead.apolloId) return;
    try {
      const res: any = await api.post("/api/leads/check-duplicate", {
        apolloId: lead.apolloId,
        name: lead.name,
        company: lead.company,
        linkedinUrl: lead.linkedinUrl,
      });
      if (res.matches && res.matches.length > 0) {
        // Only show modal when there is a duplicate warning
        setEnrichModal({ lead, resultIdx, matches: res.matches, enrichType });
      } else {
        // No duplicate — go straight
        if (enrichType === "email") handleEnrichEmail(lead, resultIdx);
        else handleEnrich(lead, resultIdx);
      }
    } catch {
      if (enrichType === "email") handleEnrichEmail(lead, resultIdx);
      else handleEnrich(lead, resultIdx);
    }
  };

  const confirmEnrich = () => {
    if (!enrichModal) return;
    const { lead, resultIdx, enrichType } = enrichModal;
    setEnrichModal(null);
    if (enrichType === "email") handleEnrichEmail(lead, resultIdx);
    else handleEnrich(lead, resultIdx);
  };

  const sf = (k: keyof typeof searchForm, v: string) => setSearchForm(p => ({ ...p, [k]: v }));
  const set = (k: keyof Proposal, v: any) => setForm(f => ({ ...f, [k]: v }));

  const [haveDetails, setHaveDetails] = useState(false);
  const [manualContact, setManualContact] = useState({ name: "", title: "", company: "", email: "", phone: "", linkedin: "" });
  const mc = (k: string, v: string) => setManualContact(p => ({ ...p, [k]: v }));
  const section2Unlocked = contacts.some(c => c.enriched) || haveDetails;

  const primaryContact = contacts.find(c => c.isPrimary) ??
    (haveDetails && manualContact.name.trim() ? {
      lead: {
        id: "", apolloId: "", name: manualContact.name, title: manualContact.title,
        company: manualContact.company, location: "", industry: "",
        emails: manualContact.email ? [manualContact.email] : [],
        phones: manualContact.phone ? [manualContact.phone] : [],
        linkedinUrl: manualContact.linkedin,
      } as any,
      enriching: false, enriched: true, isPrimary: true,
      checkedEmails: manualContact.email ? [manualContact.email] : [],
      checkedPhones: manualContact.phone ? [manualContact.phone] : [],
    } as EnrichedContact : undefined);

  // ── Search ──
  const doSearch = async (p = 1) => {
    setSearching(true); setError(""); setSearchResults([]);
    try {
      if (searchForm.linkedinUrl.trim() && !searchForm.name && !searchForm.title && !searchForm.company && !searchForm.industry && !searchForm.location && !searchForm.domain) {
        const res: any = await api.post("/api/leads/search-by-linkedin", { linkedinUrl: searchForm.linkedinUrl.trim() });
        setSearchResults(res.lead ? [res.lead] : []);
        setSearchTotal(res.lead ? 1 : 0);
        setSearchPage(1);
        setSearched(true);
        if (!res.lead) setError("No match found for that LinkedIn URL.");
      } else {
        const res: any = await api.post("/api/leads/search", { ...searchForm, page: p, perPage: SEARCH_PER_PAGE });
        setSearchResults(res.leads || []);
        setSearchTotal(res.total || 0);
        setSearchPage(p);
        setSearched(true);
        if (!(res.leads || []).length) setError("No results found.");
      }
    } catch (e: any) { setError(e.message); }
    finally { setSearching(false); }
  };

  const resetAll = () => {
    setSearchForm({ name: "", company: "", title: "", industry: "", location: "", domain: "", linkedinUrl: "" });
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

      const enrichedLead2 = res.lead || {};
      const updatedLead: Lead = {
        ...lead,
        id: realId,
        name: res.fullName?.trim() ? res.fullName : (enrichedLead2.name || lead.name),
        title: enrichedLead2.title || lead.title,
        company: enrichedLead2.company || lead.company,
        location: res.location?.trim() ? res.location : (enrichedLead2.location || lead.location),
        city: enrichedLead2.city || lead.city || "",
        state: enrichedLead2.state || lead.state || "",
        country: enrichedLead2.country || lead.country || "",
        emails: res.emails?.length ? res.emails : lead.emails,
        phones: res.phones?.length ? res.phones : lead.phones,
        linkedinUrl: res.linkedinUrl?.trim() ? res.linkedinUrl : lead.linkedinUrl,
        headline: enrichedLead2.headline || lead.headline,
        seniority: enrichedLead2.seniority || lead.seniority,
        orgDetails: enrichedLead2.orgDetails || lead.orgDetails,
        employmentHistory: enrichedLead2.employmentHistory || lead.employmentHistory,
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
        // Poll DB only — Apollo will POST to webhook when ready (can take 2-5 mins)
        const timer = setInterval(async () => {
          try {
            const polled: any = await api.get(`/api/leads/${realId}`);
            const phones = polled.phones?.length ? polled.phones : null;
            if (phones?.length > 0) {
              clearInterval(timer);
              setPhonePending(p => { const n = new Set(p); n.delete(realId); return n; });
              setContacts(prev => prev.map(c => c.lead.id === realId ? {
                ...c, lead: { ...c.lead, phones },
                checkedPhones: phones,
              } : c));
              setSearchResults(prev => prev.map(l => l.id === realId ? { ...l, phones } : l));
            }
          } catch { }
        }, 10000);
        // Stop polling after 10 mins
        setTimeout(() => {
          clearInterval(timer);
          setPhonePending(p => { const n = new Set(p); n.delete(realId); return n; });
        }, 600000);
      }
    } catch (e: any) {
      setError(e.message);
      setContacts(prev => prev.map(c => c.lead.apolloId === lead.apolloId ? { ...c, enriching: false } : c));
    }
  };

  // ── Enrich Email Only ──
  const handleEnrichEmail = async (lead: Lead, resultIdx: number) => {
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
      const res: any = await api.post(`/api/leads/${realId}/reveal-email`, {});

      const enrichedLeadEmail = res.lead || {};
      const updatedLead: Lead = {
        ...lead,
        id: realId,
        name: res.fullName?.trim() ? res.fullName : (enrichedLeadEmail.name || lead.name),
        title: enrichedLeadEmail.title || lead.title,
        company: enrichedLeadEmail.company || lead.company,
        location: res.location?.trim() ? res.location : (enrichedLeadEmail.location || lead.location),
        city: enrichedLeadEmail.city || lead.city || "",
        state: enrichedLeadEmail.state || lead.state || "",
        country: enrichedLeadEmail.country || lead.country || "",
        emails: res.emails?.length ? res.emails : lead.emails,
        linkedinUrl: res.linkedinUrl?.trim() ? res.linkedinUrl : lead.linkedinUrl,
        headline: enrichedLeadEmail.headline || lead.headline,
        seniority: enrichedLeadEmail.seniority || lead.seniority,
        orgDetails: enrichedLeadEmail.orgDetails || lead.orgDetails,
        employmentHistory: enrichedLeadEmail.employmentHistory || lead.employmentHistory,
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
          checkedPhones: [],
        } : c);
      });

      setSearchResults(prev => prev.map((l, i) => i === resultIdx ? updatedLead : l));
    } catch (e: any) {
      setError(e.message);
      setContacts(prev => prev.map(c => c.lead.apolloId === lead.apolloId ? { ...c, enriching: false } : c));
    }
  };

  const setPrimary = (apolloId: string) => {
    setContacts(prev => prev.map(c => ({ ...c, isPrimary: c.lead.apolloId === apolloId })));
    const contact = contacts.find(c => c.lead.apolloId === apolloId);
    if (contact) {
      const l = contact.lead;
      setForm(f => ({
        ...f,
        clientName:    l.name    || f.clientName,
        clientCompany: l.company || f.clientCompany,
        clientEmail:   f.clientEmail || contact.checkedEmails[0] || l.emails?.[0] || "",
        clientLinkedin: f.clientLinkedin || l.linkedinUrl || "",
        clientCountry: f.clientCountry || l.country || "",
        clientCity:    f.clientCity    || l.city    || l.state || "",
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

    // auto-fill form fields from manual contact if not already set
    const effectiveForm = { ...form };
    if (haveDetails && !contacts.some(c => c.enriched)) {
      if (!effectiveForm.clientName  && manualContact.name)    effectiveForm.clientName    = manualContact.name;
      if (!effectiveForm.clientEmail && manualContact.email)   effectiveForm.clientEmail   = manualContact.email;
      if (!effectiveForm.clientCompany && manualContact.company) effectiveForm.clientCompany = manualContact.company;
      if (!effectiveForm.clientLinkedin && manualContact.linkedin) effectiveForm.clientLinkedin = manualContact.linkedin;
    }

    try {
      const secondary = contacts.filter(c => !c.isPrimary && c.enriched);
      // Build contactsJson from ALL enriched contacts (primary first, then secondary)
      const allEnriched = [primaryContact, ...secondary];
      const contactsForJson = allEnriched.flatMap(c => {
        const emails = c.checkedEmails.length ? c.checkedEmails : (c.lead.emails?.length ? c.lead.emails : [""]);
        const phones = c.lead.phones || [];
        // One entry per unique email, sharing phones[0]
        if (emails.length === 0) {
          return [{ name: c.lead.name || "", email: "", phone: phones[0] || "", role: c.lead.title || "", linkedin: c.lead.linkedinUrl || "" }];
        }
        return emails.map((email, ei) => ({
          name: c.lead.name || "",
          email,
          phone: phones[ei] || phones[0] || "",
          role: c.lead.title || "",
          linkedin: c.lead.linkedinUrl || "",
        }));
      });
      const payload: any = {
        ...effectiveForm,
        budgetMin: effectiveForm.budgetMin ? parseFloat(effectiveForm.budgetMin) : null,
        budgetMax: effectiveForm.budgetMax ? parseFloat(effectiveForm.budgetMax) : null,
        clientQuestions: effectiveForm.clientQuestions.filter(q => q.trim()),
        links: effectiveForm.links.filter(l => l.trim()),
        followUpDate: effectiveForm.followUpDate || null,
        linkedLeadId: primaryContact.lead.id || null,
        apolloContactJson: JSON.stringify(primaryContact.lead),
        contactsJson: JSON.stringify(contactsForJson),
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
    const allEmails: string[] = [];
    const allEmailNames: string[] = [];
    const allPhones: string[] = [];
    const allPhoneNames: string[] = [];
    contacts.forEach(c => {
      const emails = c.checkedEmails.length > 0 ? c.checkedEmails : c.lead.emails || [];
      const phones = c.checkedPhones.length > 0 ? c.checkedPhones : c.lead.phones || [];
      emails.forEach(email => { allEmails.push(email); allEmailNames.push(c.lead.name || ""); });
      phones.forEach(phone => { allPhones.push(phone); allPhoneNames.push(c.lead.name || ""); });
    });
    // also include clientEmail if not already present
    if (form.clientEmail && !allEmails.includes(form.clientEmail)) {
      allEmails.unshift(form.clientEmail);
      allEmailNames.unshift(form.clientName || "");
    }
    onGenerateArtifacts?.({
      proposalId: id,
      proposalHeadline: form.jobPostHeadline || form.jobPostBody.slice(0, 60),
      clientName: form.clientName,
      clientEmail: primaryContact.checkedEmails[0] || form.clientEmail,
      clientPhone: primaryContact.checkedPhones[0] || "",
      allEmails,
      allPhones,
      allEmailNames,
      allPhoneNames,
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

      {/* ── Enrich Modal (duplicate warning only) ── */}
      {enrichModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ maxWidth: 500, margin: 0, width: "100%" }}>
            <div className="card-title">⚠ Duplicate Found</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
              <strong>{enrichModal.lead.name}</strong> may already exist in Prospects:
            </div>
            {enrichModal.matches.map((m, i) => (
              <div key={i} style={{ background: "var(--surface2)", borderRadius: 8, padding: "10px 14px", marginBottom: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                  {[m.title, m.company].filter(Boolean).join(" @ ")}
                  {m.emails?.[0] && <span style={{ marginLeft: 8 }}>{m.emails[0]}</span>}
                </div>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEnrichModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmEnrich}>
                {enrichModal.enrichType === "email" ? "Get Email" : "Enrich anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
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
          {([["name","Person Name","e.g. John Smith"],["title","Job Title","e.g. CTO"],["company","Company","e.g. Acme Corp"],["industry","Industry","e.g. Software"],["location","Location","e.g. London"],["domain","Website Domain","e.g. acmecorp.com"]] as [keyof typeof searchForm, string, string][]).map(([k, lbl, ph]) => (
            <div key={k}>
              <div className="field-label">{lbl}</div>
              <input className="input" placeholder={ph} value={searchForm[k]}
                onChange={e => sf(k, e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(1)} />
            </div>
          ))}
          <div>
            <div className="field-label">LinkedIn URL <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>(direct lookup · 1 credit)</span></div>
            <input className="input" placeholder="https://linkedin.com/in/username" value={searchForm.linkedinUrl}
              onChange={e => sf("linkedinUrl", e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch(1)} />
          </div>
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
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => startEnrich(lead, i, "email")} disabled={enriching || enriched} title="Email only">
                            {enriching ? <span className="spinner spinner-dark" /> : enriched ? "✓" : "Email"}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => startEnrich(lead, i, "all")} disabled={enriching || enriched} title="Email + phone">
                            {enriching ? <span className="spinner spinner-dark" /> : enriched ? "✓ Enriched" : "Enrich"}
                          </button>
                        </div>
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
            {contacts.filter(c => c.enriched).map((c, i) => {
              const l = c.lead;
              const org = l.orgDetails;
              return (
                <div key={i} style={{ padding: "10px 14px", background: c.isPrimary ? "var(--green-light)" : "var(--surface)", borderRadius: 8, marginBottom: 6, border: `1px solid ${c.isPrimary ? "var(--green)" : "var(--border)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <input type="radio" name="primary-contact" checked={c.isPrimary} onChange={() => setPrimary(l.apolloId || "")} />
                    {l.photoUrl && <img src={l.photoUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{[l.title, l.seniority].filter(Boolean).join(" · ")}</div>
                    </div>
                    {c.isPrimary && <span style={{ fontSize: 10, fontWeight: 700, background: "var(--green)", color: "white", padding: "1px 5px", borderRadius: 8 }}>PRIMARY</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11 }}>
                    {l.company && <div style={{ color: "var(--muted)" }}>🏢 <span style={{ color: "var(--text)" }}>{l.company}</span></div>}
                    {org?.orgWebsiteUrl && <div style={{ color: "var(--muted)" }}>🌐 <a href={org.orgWebsiteUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{org.orgWebsiteUrl.replace(/^https?:\/\//, "")}</a></div>}
                    {(l.city || l.state || l.country) && <div style={{ color: "var(--muted)" }}>📍 <span style={{ color: "var(--text)" }}>{[l.city, l.state, l.country].filter(Boolean).join(", ")}</span></div>}
                    {l.headline && <div style={{ color: "var(--muted)", gridColumn: "1/-1" }}>💬 <span style={{ color: "var(--text)" }}>{l.headline}</span></div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
                    {l.emails?.map((e, ei) => (
                      <div key={ei} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="chip chip-blue" style={{ fontSize: 10 }}>{e}</span>
                      </div>
                    ))}
                    {l.phones?.map((ph, pi) => (
                      <div key={pi} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="chip chip-green" style={{ fontSize: 10 }}>📞 {ph}</span>
                      </div>
                    ))}
                  </div>
                  {l.linkedinUrl && <a href={l.linkedinUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#0a66c2", display: "inline-flex", alignItems: "center", gap: 3, marginTop: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                  </a>}
                </div>
              );
            })}
            {!primaryContact && (
              <div style={{ fontSize: 12, color: "var(--red, #ef4444)", marginTop: 4 }}>⚠ Select a primary contact to enable saving</div>
            )}
          </div>
        )}

        {/* ── I have the details toggle ── */}
        {!contacts.some(c => c.enriched) && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
              <div
                onClick={() => setHaveDetails(v => !v)}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: haveDetails ? "var(--accent, #0078d4)" : "var(--border)",
                  position: "relative", transition: "background .2s", flexShrink: 0,
                }}>
                <div style={{
                  position: "absolute", top: 3, left: haveDetails ? 21 : 3,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "white", transition: "left .2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>I have the details</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>— skip enrichment, enter contact manually</span>
            </label>

            {haveDetails && (
              <div style={{ marginTop: 14, padding: "14px 16px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
                  <div><div className="field-label">Name *</div><input className="input" placeholder="Full name" value={manualContact.name} onChange={e => mc("name", e.target.value)} /></div>
                  <div><div className="field-label">Title</div><input className="input" placeholder="e.g. CEO" value={manualContact.title} onChange={e => mc("title", e.target.value)} /></div>
                  <div><div className="field-label">Company</div><input className="input" placeholder="Company name" value={manualContact.company} onChange={e => mc("company", e.target.value)} /></div>
                  <div><div className="field-label">Email</div><input className="input" type="email" placeholder="email@example.com" value={manualContact.email} onChange={e => mc("email", e.target.value)} /></div>
                  <div><div className="field-label">Phone</div><input className="input" placeholder="+1 234 567 8900" value={manualContact.phone} onChange={e => mc("phone", e.target.value)} /></div>
                  <div><div className="field-label">LinkedIn</div><input className="input" placeholder="https://linkedin.com/in/..." value={manualContact.linkedin} onChange={e => mc("linkedin", e.target.value)} /></div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "default" }}>
                  <input type="checkbox" checked readOnly style={{ width: 15, height: 15, accentColor: "var(--accent, #0078d4)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent, #0078d4)" }}>Primary</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>— this contact will be used for outreach</span>
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── SECTION 2 ── */}
      <div className="card" style={{ opacity: section2Unlocked ? 1 : 0.5, pointerEvents: section2Unlocked ? "auto" : "none" }}>
        <div className="card-title">Section 2 — Proposal Details</div>
        <div className="card-sub">{!section2Unlocked ? "Enrich at least one contact above to enable" : "Enter proposal details below"}</div>

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
