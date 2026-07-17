"use client";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

/* ─── Types (mirror backend camelCase JSON) ───────────────────────────── */

type LeadStatus = "scraped" | "enriched" | "email_ready" | "scheduled" | "sent" | "replied";
type DrawerTab = "job" | "contact" | "artifacts" | "activity";
type Provider = "azure" | "groq" | "claude";
type GroupBy = "none" | "scraped" | "posted" | "emailSent" | "company" | "activity" | "size";
type SortBy = "scraped" | "posted" | "emailSent" | "company";
type SortDir = "asc" | "desc";

interface ActivityEvent { id: string; jobLeadId: string; label: string; at: string; }

interface JobLeadContact {
  id: string;
  jobLeadId: string;
  apolloId?: string | null;
  name: string;
  title: string;
  linkedinUrl?: string | null;
  email?: string | null;
  source: "poster" | "priority" | string;
  selected: boolean;
  enriched: boolean;
  creditsUsed: number;
}

interface JobLead {
  id: string;
  runId?: string | null;
  company: string;
  industry: string;
  companySize: string;
  country: string;
  jobTitle: string;
  jobDescription: string;
  jobUrl: string;
  posterName?: string | null;
  posterTitle?: string | null;
  posterLinkedin?: string | null;
  status: LeadStatus;
  matchedKeywords: string[];
  missedKeywords: string[];
  apolloPersonId?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactLinkedin?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  fu1Subject?: string | null;
  fu1Body?: string | null;
  fu2Subject?: string | null;
  fu2Body?: string | null;
  senderEmail?: string | null;
  scrapedAt: string;
  postedAt?: string | null;
  savedAt: string;
  enrichedAt?: string | null;
  emailGeneratedAt?: string | null;
  sentAt?: string | null;
  fu1SentAt?: string | null;
  fu2SentAt?: string | null;
  repliedAt?: string | null;
  activity: ActivityEvent[];
}

interface JobLeadStats {
  scraped: number; enriched: number; emailReady: number; sent: number; replied: number; needsFollowUp: number;
}

interface ScrapeRun {
  id: string; status: "running" | "completed" | "failed"; leadsFound: number; error?: string | null; logLines: string[];
}

/* ─── Static config ─────────────────────────────────────────────────── */

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "azure", label: "Azure OpenAI" },
  { id: "groq", label: "Groq" },
  { id: "claude", label: "Claude" },
];

const STATUS_ORDER: LeadStatus[] = ["scraped", "enriched", "email_ready", "scheduled", "sent", "replied"];
const STATUS_LABEL: Record<LeadStatus, string> = {
  scraped: "Scraped", enriched: "Enriched", email_ready: "Email Ready",
  scheduled: "Scheduled", sent: "Sent", replied: "Replied",
};
const STATUS_CHIP: Record<LeadStatus, string> = {
  scraped: "chip", enriched: "chip chip-blue", email_ready: "chip chip-orange",
  scheduled: "chip chip-orange", sent: "chip chip-green", replied: "chip chip-green",
};

const ROLE_OPTIONS = ["Software Engineer", "Full Stack Engineer", "Backend Engineer", "Frontend Engineer", "AI Engineer", "ML Engineer"];
const COUNTRIES = ["United States", "United Kingdom", "Canada", "Australia", "India"];
const EMPLOYEE_BUCKETS = ["1–9", "10–50", "51–200", "201–1000", "1000+", "Unknown"];
const POSTED_WITHIN = [1, 3, 7, 14, 30];
const PER_PAGE = 20;
const GROUPED_FETCH_SIZE = 500;

/* ─── Small building blocks ─────────────────────────────────────────── */

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", minWidth: 92 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function KeywordSummary({ matched, missed }: { matched: string[]; missed: string[] }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
      <span style={{ color: "var(--green)", fontWeight: 600 }}>✓{matched.length}</span>
      <span style={{ color: "var(--dim)" }}>✗{missed.length}</span>
    </div>
  );
}

function bucketFor(iso?: string | null): string {
  if (!iso) return "Older";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This week";
  if (diffDays <= 14) return "Last week";
  return "Older";
}
const BUCKET_ORDER = ["Today", "Yesterday", "This week", "Last week", "Older"];

function sizeBucket(companySize?: string | null): string {
  if (!companySize) return "Unknown";
  const n = parseInt(companySize.replace(/[^0-9]/g, ""), 10);
  if (!n || isNaN(n)) return "Unknown";
  if (n <= 9) return "1–9";
  if (n <= 50) return "10–50";
  if (n <= 200) return "51–200";
  if (n <= 1000) return "201–1000";
  return "1000+";
}

/* ─── Main view ──────────────────────────────────────────────────────── */

export default function JobLeadsView() {
  const [leads, setLeads] = useState<JobLead[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<JobLeadStats>({ scraped: 0, enriched: 0, emailReady: 0, sent: 0, replied: 0, needsFollowUp: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [search, setSearch] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [needsFollowUp, setNeedsFollowUp] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortBy, setSortBy] = useState<SortBy>("scraped");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const [filterOptions, setFilterOptions] = useState<{ industries: string[]; sizes: string[]; countries: string[] }>({ industries: [], sizes: [], countries: [] });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerLead, setDrawerLead] = useState<JobLead | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("job");
  const [provider, setProvider] = useState<Provider>("azure");
  const [defaultPrompts, setDefaultPrompts] = useState<{ email: string; followUp1: string; followUp2: string }>({ email: "", followUp1: "", followUp2: "" });
  const [customPrompts, setCustomPrompts] = useState<{ email: string; followUp1: string; followUp2: string }>({ email: "", followUp1: "", followUp2: "" });
  const [promptModal, setPromptModal] = useState<{ type: "email" | "followUp1" | "followUp2"; title: string } | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set()); // ids with an in-flight action
  const [candidates, setCandidates] = useState<JobLeadContact[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [pickedContactIds, setPickedContactIds] = useState<Set<string>>(new Set());

  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeParams, setScrapeParams] = useState({
    country: COUNTRIES[0], postedWithin: 7, companySize: "",
    roles: [ROLE_OPTIONS[0], ROLE_OPTIONS[1]],
  });
  const [scrapeRun, setScrapeRun] = useState<ScrapeRun | null>(null);
  const [scrapeElapsed, setScrapeElapsed] = useState(0);
  const scrapeBtnRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (scrapeOpen && scrapeBtnRef.current && !scrapeBtnRef.current.contains(e.target as Node)) setScrapeOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [scrapeOpen]);

  // ── Fetch leads (filters + pagination or grouped bulk fetch) ─────────
  const buildParams = useCallback((forGrouping: boolean) => {
    const p = new URLSearchParams();
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (search) p.set("search", search);
    if (keywordFilter) p.set("keyword", keywordFilter);
    if (industryFilter !== "all") p.set("industry", industryFilter);
    if (sizeFilter !== "all") p.set("size", sizeFilter);
    if (countryFilter !== "all") p.set("country", countryFilter);
    if (needsFollowUp) p.set("needsFollowUp", "true");
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    p.set("sortBy", sortBy);
    p.set("sortDir", sortDir);
    p.set("page", forGrouping ? "1" : String(page));
    p.set("perPage", forGrouping ? String(GROUPED_FETCH_SIZE) : String(PER_PAGE));
    return p;
  }, [statusFilter, search, keywordFilter, industryFilter, sizeFilter, countryFilter, needsFollowUp, dateFrom, dateTo, page, sortBy, sortDir]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = buildParams(groupBy !== "none");
      const res = await api.get<{ leads: JobLead[]; total: number; stats: JobLeadStats }>(`/api/job-leads?${params.toString()}`);
      setLeads(res.leads);
      setTotal(res.total);
      setStats(res.stats);
    } catch (e: any) {
      setError(e.message || "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }, [buildParams, groupBy]);

  const refreshFilterOptions = useCallback(async () => {
    try {
      const res = await api.get<{ leads: JobLead[] }>(`/api/job-leads?page=1&perPage=${GROUPED_FETCH_SIZE}`);
      setFilterOptions({
        industries: Array.from(new Set(res.leads.map(l => l.industry).filter(Boolean))).sort(),
        sizes: Array.from(new Set(res.leads.map(l => l.companySize).filter(Boolean))).sort(),
        countries: Array.from(new Set(res.leads.map(l => l.country).filter(Boolean))).sort(),
      });
    } catch { /* non-critical */ }
  }, []);

  // Debounced refetch whenever any filter/page/groupBy changes
  useEffect(() => {
    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => { fetchLeads(); }, 300);
    return () => { if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search, keywordFilter, industryFilter, sizeFilter, countryFilter, needsFollowUp, dateFrom, dateTo, groupBy, sortBy, sortDir, page]);

  useEffect(() => { setPage(1); }, [statusFilter, search, keywordFilter, industryFilter, sizeFilter, countryFilter, needsFollowUp, dateFrom, dateTo, groupBy, sortBy, sortDir]);

  useEffect(() => { refreshFilterOptions(); }, [refreshFilterOptions]);

  const grouped = useMemo(() => {
    if (groupBy === "none") return null;

    if (groupBy === "company") {
      const map = new Map<string, JobLead[]>();
      for (const l of leads) {
        const key = (l.company || "Unknown").trim() || "Unknown";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(l);
      }
      const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
      return keys.map(k => ({ label: k, rows: map.get(k)! }));
    }

    const map = new Map<string, JobLead[]>();
    for (const l of leads) {
      const key = groupBy === "size"
        ? sizeBucket(l.companySize)
        : bucketFor(
            groupBy === "scraped" ? l.scrapedAt
            : groupBy === "posted" ? l.postedAt
            : groupBy === "emailSent" ? l.sentAt
            : (l.activity[l.activity.length - 1]?.at ?? l.scrapedAt)
          );
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    const order = groupBy === "size" ? EMPLOYEE_BUCKETS : BUCKET_ORDER;
    return order.map(b => ({ label: b, rows: map.get(b) || [] })).filter(g => g.rows.length > 0);
  }, [leads, groupBy]);

  const clearFilters = () => {
    setStatusFilter("all"); setSearch(""); setKeywordFilter(""); setIndustryFilter("all");
    setSizeFilter("all"); setCountryFilter("all"); setNeedsFollowUp(false); setDateFrom(""); setDateTo("");
  };

  // ── Scrape run + polling ──────────────────────────────────────────────
  const toggleRole = (r: string) =>
    setScrapeParams(p => ({ ...p, roles: p.roles.includes(r) ? p.roles.filter(x => x !== r) : [...p.roles, r] }));

  const runScrape = async () => {
    setScraping(true);
    setScrapeRun(null);
    setScrapeElapsed(0);
    setActionError("");
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setScrapeElapsed(s => s + 1), 1000);
    try {
      const { runId } = await api.post<{ runId: string }>("/api/job-leads/scrape", {
        roles: scrapeParams.roles, country: scrapeParams.country, postedWithinDays: scrapeParams.postedWithin,
        companySize: scrapeParams.companySize,
      });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const run = await api.get<ScrapeRun>(`/api/job-leads/scrape/${runId}`);
          setScrapeRun(run);
          if (run.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (elapsedRef.current) clearInterval(elapsedRef.current);
            setScraping(false);
            fetchLeads();
            refreshFilterOptions();
          }
        } catch { /* keep polling until timeout below stops it via error */ }
      }, 1500);
    } catch (e: any) {
      setActionError(e.message || "Failed to start scrape.");
      setScraping(false);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (elapsedRef.current) clearInterval(elapsedRef.current); }, []);

  // ── Selection ──────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = (rows: JobLead[]) =>
    setSelected(s => s.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map(l => l.id)));

  // ── Single-lead actions ────────────────────────────────────────────
  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusy(b => new Set(b).add(id));
    setActionError("");
    try { await fn(); }
    catch (e: any) { setActionError(e.message || "Action failed."); }
    finally { setBusy(b => { const n = new Set(b); n.delete(id); return n; }); }
  };

  const refreshLead = async (id: string) => {
    const lead = await api.get<JobLead>(`/api/job-leads/${id}`);
    setLeads(ls => ls.map(l => l.id === id ? { ...l, ...lead } : l));
    if (drawerId === id) setDrawerLead(lead);
    fetchLeads(); // cheap re-sync of stats + current view
  };

  const enrichOne = (id: string) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/enrich`, {});
    await refreshLead(id);
  });

  const findCandidates = (id: string) => withBusy(id, async () => {
    setCandidatesLoading(true);
    try {
      const res = await api.post<{ contacts: JobLeadContact[] }>(`/api/job-leads/${id}/contacts/find`, {});
      setCandidates(res.contacts);
      setPickedContactIds(new Set(res.contacts.filter(c => c.source === "poster").map(c => c.id)));
    } finally {
      setCandidatesLoading(false);
    }
  });

  const loadCandidates = async (id: string) => {
    setCandidatesLoading(true);
    try {
      const res = await api.get<{ contacts: JobLeadContact[] }>(`/api/job-leads/${id}/contacts`);
      setCandidates(res.contacts);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const enrichPicked = (id: string) => withBusy(id, async () => {
    const res = await api.post<{ contacts: JobLeadContact[] }>(`/api/job-leads/${id}/contacts/enrich`, {
      contactIds: Array.from(pickedContactIds),
    });
    setCandidates(res.contacts);
    await refreshLead(id);
  });

  const toggleCandidate = (id: string) => {
    setPickedContactIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const [defaults, saved] = await Promise.all([
          api.get<{ email: string; followUp1: string; followUp2: string }>("/api/job-leads/prompts"),
          api.get<{ values: Record<string, string> }>("/api/settings"),
        ]);
        setDefaultPrompts(defaults);
        const s = saved.values || {};
        setCustomPrompts({
          email:     s["job_lead_email_prompt"]     || defaults.email,
          followUp1: s["job_lead_followup1_prompt"] || defaults.followUp1,
          followUp2: s["job_lead_followup2_prompt"] || defaults.followUp2,
        });
      } catch { /* non-critical */ }
    })();
  }, []);

  const promptKeyMap: Record<"email" | "followUp1" | "followUp2", string> = {
    email: "job_lead_email_prompt", followUp1: "job_lead_followup1_prompt", followUp2: "job_lead_followup2_prompt",
  };

  const savePromptToDb = async (type: "email" | "followUp1" | "followUp2", value: string) => {
    try { await api.post("/api/settings", { values: { [promptKeyMap[type]]: value } }); } catch { /* non-critical */ }
  };

  const openPromptModal = (type: "email" | "followUp1" | "followUp2") => {
    const titles = { email: "Outreach Email Prompt", followUp1: "Follow-up 1 Prompt", followUp2: "Follow-up 2 Prompt" };
    const current = customPrompts[type] || defaultPrompts[type];
    setPromptDraft(current);
    setPromptModal({ type, title: titles[type] });
  };

  const resetPrompt = (type: "email" | "followUp1" | "followUp2") => {
    setPromptDraft(defaultPrompts[type]);
    savePromptToDb(type, "");
  };

  const handlePromptSaveOnly = () => {
    if (!promptModal) return;
    setCustomPrompts(p => ({ ...p, [promptModal.type]: promptDraft }));
    savePromptToDb(promptModal.type, promptDraft);
    setPromptModal(null);
  };

  const handlePromptRegenerate = () => {
    if (!promptModal || !drawerId) return;
    const { type } = promptModal;
    setCustomPrompts(p => ({ ...p, [type]: promptDraft }));
    savePromptToDb(type, promptDraft);
    setPromptModal(null);
    if (type === "email") generateEmailOne(drawerId, promptDraft);
    if (type === "followUp1") generateFollowUp(drawerId, 1, promptDraft);
    if (type === "followUp2") generateFollowUp(drawerId, 2, promptDraft);
  };

  const generateEmailOne = (id: string, customPrompt?: string) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/generate-email`, { provider, customPrompt });
    await refreshLead(id);
  });

  const generateFollowUp = (id: string, stage: 1 | 2, customPrompt?: string) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/generate-followup${stage}`, { provider, customPrompt });
    await refreshLead(id);
  });


  const generateAll = (id: string) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/generate-email`, { provider });
    await api.post(`/api/job-leads/${id}/generate-followup1`, { provider });
    await api.post(`/api/job-leads/${id}/generate-followup2`, { provider });
    await refreshLead(id);
  });

  const saveEmailEdits = (id: string, subject: string, body: string) => withBusy(id, async () => {
    await api.put(`/api/job-leads/${id}/email`, { subject, body });
    setLeads(ls => ls.map(l => l.id === id ? { ...l, emailSubject: subject, emailBody: body } : l));
    if (drawerId === id) setDrawerLead(d => d ? { ...d, emailSubject: subject, emailBody: body } : d);
  });

  const sendEmail = (id: string, sender: string, scheduledAt?: string) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/send`, { sender, scheduledAt: scheduledAt || null });
    await refreshLead(id);
  });

  const deleteOne = (id: string) => withBusy(id, async () => {
    await api.delete(`/api/job-leads/${id}`);
    if (drawerId === id) { setDrawerId(null); setDrawerLead(null); }
    await fetchLeads();
  });

  const openDrawer = async (id: string) => {
    setDrawerId(id); setDrawerTab("job"); setDrawerLead(null); setDrawerLoading(true);
    setCandidates([]); setPickedContactIds(new Set());
    try { setDrawerLead(await api.get<JobLead>(`/api/job-leads/${id}`)); }
    catch (e: any) { setActionError(e.message || "Failed to load lead."); }
    finally { setDrawerLoading(false); }
  };

  // ── Bulk actions ───────────────────────────────────────────────────
  const bulkBusy = busy.has("__bulk__");
  const runBulk = async (fn: () => Promise<void>) => {
    setBusy(b => new Set(b).add("__bulk__"));
    setActionError("");
    try { await fn(); await fetchLeads(); await refreshFilterOptions(); setSelected(new Set()); }
    catch (e: any) { setActionError(e.message || "Bulk action failed."); }
    finally { setBusy(b => { const n = new Set(b); n.delete("__bulk__"); return n; }); }
  };

  const bulkEnrich = () => runBulk(() => api.post("/api/job-leads/bulk/enrich", { ids: Array.from(selected) }));
  const bulkGenerate = () => runBulk(() => api.post("/api/job-leads/bulk/generate-email", { ids: Array.from(selected) }));
  const bulkSend = () => runBulk(() => api.post("/api/job-leads/bulk/send", { ids: Array.from(selected), sender: "all" }));
  const bulkDelete = () => runBulk(() => api.post("/api/job-leads/bulk/delete", { ids: Array.from(selected) }));

  const tabDef: { id: DrawerTab; label: string }[] = [
    { id: "job", label: "Job" },
    { id: "contact", label: "Contact" },
    { id: "artifacts", label: "Artifacts" },
    { id: "activity", label: "Activity" },
  ];

  const activeFilterCount = [
    statusFilter !== "all", !!search, !!keywordFilter, industryFilter !== "all",
    sizeFilter !== "all", countryFilter !== "all", needsFollowUp, !!dateFrom, !!dateTo,
  ].filter(Boolean).length;

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  /* Shared table renderer */
  const renderTable = (rows: JobLead[]) => (
    <div className="table-wrap" style={{ marginBottom: groupBy === "none" ? 0 : 16 }}>
      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-title">{loading ? "Loading…" : "No leads match your filters"}</div>
          {!loading && <div>Run a new scrape or widen your filters.</div>}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={selected.size > 0 && rows.every(r => selected.has(r.id))} onChange={() => toggleSelectAll(rows)} /></th>
              <th>Company</th>
              <th>Job Title</th>
              <th>Posted By</th>
              <th>Employees</th>
              <th>Keywords</th>
              <th>Status</th>
              <th>Contact</th>
              <th>Scraped</th>
              <th>Last Action</th>
              <th style={{ width: 24 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(l => (
              <tr key={l.id} style={{ cursor: "pointer", opacity: busy.has(l.id) ? 0.5 : 1 }} onClick={() => openDrawer(l.id)}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.company}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.industry || "Industry unknown"} · {l.companySize || "Size unknown"} · {l.country}</div>
                </td>
                <td style={{ maxWidth: 220 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.jobTitle}</div>
                </td>
                <td style={{ fontSize: 12 }}>
                  {l.posterName ? (
                    l.posterLinkedin
                      ? <a href={l.posterLinkedin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)" }}>{l.posterName}</a>
                      : <span>{l.posterName}</span>
                  ) : <span style={{ color: "var(--dim)" }}>—</span>}
                  {l.posterTitle && <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.posterTitle}</div>}
                </td>
                <td style={{ fontSize: 12, color: l.companySize ? "var(--text)" : "var(--dim)" }}>{l.companySize || "—"}
                </td>
                <td><KeywordSummary matched={l.matchedKeywords} missed={l.missedKeywords} /></td>
                <td><span className={STATUS_CHIP[l.status]}>{STATUS_LABEL[l.status]}</span></td>
                <td onClick={e => e.stopPropagation()}>
                  {l.contactName ? (
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 12 }}>{l.contactName}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.contactTitle}</div>
                    </div>
                  ) : (
                    <button className="icon-btn" style={{ color: "var(--accent)" }} disabled={busy.has(l.id)} onClick={() => enrichOne(l.id)}>Enrich</button>
                  )}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(l.scrapedAt)}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(l.activity[l.activity.length - 1]?.at ?? l.scrapedAt)}</td>
                <td style={{ color: "var(--dim)" }}>›</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">Job Leads</div>
          <div className="page-sub">Scraped LinkedIn job posts, enriched via Apollo, ready for outreach</div>
        </div>
        <div style={{ position: "relative" }} ref={scrapeBtnRef}>
          <button className="btn btn-primary" onClick={() => setScrapeOpen(o => !o)}>+ New Scrape</button>
          {scrapeOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, background: "white", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.14)", padding: 16, zIndex: 150 }}>
              <div className="field-label">Country</div>
              <select className="input" value={scrapeParams.country} onChange={e => setScrapeParams(p => ({ ...p, country: e.target.value }))} style={{ marginBottom: 10 }}>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <div className="field-label">Posted Within</div>
              <select className="input" value={scrapeParams.postedWithin} onChange={e => setScrapeParams(p => ({ ...p, postedWithin: +e.target.value }))} style={{ marginBottom: 10 }}>
                {POSTED_WITHIN.map(d => <option key={d} value={d}>Last {d} day{d > 1 ? "s" : ""}</option>)}
              </select>
              <div className="field-label">Company Size</div>
              <select className="input" value={scrapeParams.companySize} onChange={e => setScrapeParams(p => ({ ...p, companySize: e.target.value }))} style={{ marginBottom: 10 }}>
                <option value="">Any size</option>
                <option value="1">1-10</option>
                <option value="2">11-50</option>
                <option value="3">51-200</option>
                <option value="4">201-500</option>
                <option value="5">501-1000</option>
                <option value="6">1001-5000</option>
                <option value="7">5001-10000</option>
                <option value="8">10001+</option>
              </select>
              <div className="field-label">Roles</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {ROLE_OPTIONS.map(r => {
                  const active = scrapeParams.roles.includes(r);
                  return (
                    <button key={r} onClick={() => toggleRole(r)} style={{
                      background: active ? "var(--accent)" : "var(--bg)", color: active ? "white" : "var(--muted)",
                      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, borderRadius: 20,
                      padding: "3px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer",
                    }}>{r}</button>
                  );
                })}
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={scraping || scrapeParams.roles.length === 0} onClick={runScrape}>
                {scraping ? <><span className="spinner" style={{ marginRight: 6 }} />Running… {String(Math.floor(scrapeElapsed / 60)).padStart(2, "0")}:{String(scrapeElapsed % 60).padStart(2, "0")}</> : "Run Scraper"}
              </button>
              {scraping && (
                <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: "var(--bg)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (scrapeElapsed / 280) * 100)}%`, background: "var(--accent)", transition: "width 1s linear" }} />
                </div>
              )}
              {scrapeRun && (
                <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.8, maxHeight: 140, overflowY: "auto" }}>
                  {scrapeRun.logLines.map((s, i) => <div key={i}>· {s}</div>)}
                  {scrapeRun.status === "completed" && <div style={{ color: "var(--green)", fontWeight: 600, marginTop: 4 }}>Done — {scrapeRun.leadsFound} leads added.</div>}
                  {scrapeRun.status === "failed" && <div style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>Failed: {scrapeRun.error}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <div className="banner banner-error">
          <span>{actionError}</span>
          <button className="icon-btn" onClick={() => setActionError("")}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button className="icon-btn" onClick={fetchLeads}>Retry</button>
        </div>
      )}

      {/* Stat pills */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <StatPill label="Scraped" value={stats.scraped} />
        <StatPill label="Enriched" value={stats.enriched} />
        <StatPill label="Email Ready" value={stats.emailReady} />
        <StatPill label="Sent" value={stats.sent} />
        <StatPill label="Replied" value={stats.replied} />
        <StatPill label="Needs Follow-up" value={stats.needsFollowUp} />
      </div>

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={() => setStatusFilter("all")} className={statusFilter === "all" ? "chip chip-blue" : "chip"} style={{ cursor: "pointer", padding: "5px 12px" }}>All</button>
        {STATUS_ORDER.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={statusFilter === s ? "chip chip-blue" : "chip"} style={{ cursor: "pointer", padding: "5px 12px" }}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" placeholder="Search company or title…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 200 }} />
          <input className="input" placeholder="Keyword (e.g. React)" value={keywordFilter} onChange={e => setKeywordFilter(e.target.value)} style={{ maxWidth: 170 }} />
          <select className="input" value={industryFilter} onChange={e => setIndustryFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="all">All industries</option>
            {filterOptions.industries.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select className="input" value={sizeFilter} onChange={e => setSizeFilter(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="all">All sizes</option>
            {EMPLOYEE_BUCKETS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={countryFilter} onChange={e => setCountryFilter(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="all">All countries</option>
            {filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={needsFollowUp} onChange={e => setNeedsFollowUp(e.target.checked)} />
            Needs follow-up
          </label>
          {activeFilterCount > 0 && <button className="icon-btn" onClick={clearFilters}>Clear filters ({activeFilterCount})</button>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <span className="field-label" style={{ margin: 0 }}>Scraped</span>
          <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ maxWidth: 150 }} />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>to</span>
          <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ maxWidth: 150 }} />
          <span className="field-label" style={{ margin: "0 0 0 12px" }}>Group by</span>
          <select className="input" value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)} style={{ maxWidth: 160 }}>
            <option value="none">None (paginated)</option>
            <option value="scraped">Scraped date</option>
            <option value="posted">Date posted</option>
            <option value="emailSent">Email sent date</option>
            <option value="company">Company name</option>
            <option value="activity">Last activity</option>
            <option value="size">Company size</option>
          </select>
          <span className="field-label" style={{ margin: "0 0 0 12px" }}>Sort by</span>
          <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)} style={{ maxWidth: 150 }}>
            <option value="scraped">Scraped date</option>
            <option value="posted">Date posted</option>
            <option value="emailSent">Email sent date</option>
            <option value="company">Company name</option>
          </select>
          <button className="icon-btn" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} title={sortDir === "asc" ? "Ascending" : "Descending"}>
            {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="banner banner-info" style={{ alignItems: "center" }}>
          <span>{selected.size} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={bulkEnrich}>Enrich</button>
            <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={bulkGenerate}>Generate Emails</button>
            <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={bulkSend}>Send Now</button>
            <button className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={bulkDelete}>Delete</button>
          </div>
        </div>
      )}

      {/* Table(s) */}
      {groupBy === "none" ? (
        <>
          {renderTable(leads)}
          {total > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 12, color: "var(--muted)" }}>
              <span>{total} lead{total !== 1 ? "s" : ""} · page {page} of {totalPages}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      ) : (
        (grouped || []).map(g => (
          <div key={g.label} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, margin: "0 0 8px 2px" }}>
              {g.label} <span style={{ fontWeight: 500, color: "var(--dim)" }}>({g.rows.length})</span>
            </div>
            {renderTable(g.rows)}
          </div>
        ))
      )}
      {groupBy !== "none" && grouped && grouped.length === 0 && (
        <div className="table-wrap"><div className="empty"><div className="empty-title">{loading ? "Loading…" : "No leads match your filters"}</div></div></div>
      )}

      {/* Drawer */}
      {drawerId && (
        <>
          <div onClick={() => { setDrawerId(null); setDrawerLead(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 200 }} />
          <div className="drawer-panel" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "white", zIndex: 201, boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column" }}>
            {drawerLoading || !drawerLead ? (
              <div className="empty" style={{ margin: "auto" }}><span className="spinner spinner-dark" /></div>
            ) : (
              <>
                <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{drawerLead.company}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{drawerLead.jobTitle}</div>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <button className="icon-btn" style={{ color: "var(--red)" }} disabled={busy.has(drawerLead.id)} onClick={() => deleteOne(drawerLead.id)}>Delete</button>
                      <button className="icon-btn" onClick={() => { setDrawerId(null); setDrawerLead(null); }} style={{ fontSize: 18 }}>×</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
                    {tabDef.map(t => (
                      <button key={t.id} onClick={() => { setDrawerTab(t.id); if ((t.id === "contact" || t.id === "artifacts") && drawerLead) loadCandidates(drawerLead.id); }} style={{
                        background: "none", border: "none", borderBottom: drawerTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                        color: drawerTab === t.id ? "var(--accent)" : "var(--muted)", fontWeight: 600, fontSize: 12.5,
                        padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap",
                      }}>{t.label}</button>
                    ))}
                  </div>
                  <div style={{ padding: "10px 0" }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!drawerLead.contactEmail || busy.has(drawerLead.id)}
                      onClick={() => generateAll(drawerLead.id)}
                      style={{ width: "100%" }}
                    >
                      {busy.has(drawerLead.id) ? "Generating…" : "⚡ Generate All — Email + Follow-up 1 + Follow-up 2"}
                    </button>
                    {!drawerLead.contactEmail && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textAlign: "center" }}>Enrich the contact first (Contact tab)</div>}
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
                  {drawerTab === "job" && (
                    <div>
                      <div className="chip" style={{ marginBottom: 12 }}>Scraped {fmtDate(drawerLead.scrapedAt)} · {drawerLead.industry || "Industry unknown"} · {drawerLead.companySize || "Size unknown"} · {drawerLead.country}</div>
                      <div className="field-label">Matched keywords</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                        {drawerLead.matchedKeywords.length > 0 ? drawerLead.matchedKeywords.map(k => <span key={k} className="chip chip-green">{k}</span>) : <span style={{ fontSize: 12, color: "var(--muted)" }}>None</span>}
                      </div>
                      <div className="field-label">Missing keywords</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                        {drawerLead.missedKeywords.length > 0 ? drawerLead.missedKeywords.map(k => <span key={k} className="chip">{k}</span>) : <span style={{ fontSize: 12, color: "var(--muted)" }}>None</span>}
                      </div>
                      <div className="field-label">Description</div>
                      <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{drawerLead.jobDescription}</div>
                      {drawerLead.posterName && (
                        <div style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>
                          Posted by {drawerLead.posterLinkedin
                            ? <a href={drawerLead.posterLinkedin} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{drawerLead.posterName}</a>
                            : drawerLead.posterName}
                          {drawerLead.posterTitle && ` — ${drawerLead.posterTitle}`}
                        </div>
                      )}
                      {drawerLead.jobUrl && <a href={drawerLead.jobUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--accent)" }}>View original posting ↗</a>}
                    </div>
                  )}

                  {drawerTab === "contact" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {drawerLead.contactName && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
                          <div className="field-label">Current saved contact</div>
                          <div><div className="field-label">Name</div><div>{drawerLead.contactName}</div></div>
                          <div><div className="field-label">Title</div><div>{drawerLead.contactTitle}</div></div>
                          <div><div className="field-label">Email</div><div>{drawerLead.contactEmail}</div></div>
                          {drawerLead.contactPhone && <div><div className="field-label">Phone</div><div>{drawerLead.contactPhone}</div></div>}
                          {drawerLead.contactLinkedin && <div><div className="field-label">LinkedIn</div><a href={drawerLead.contactLinkedin} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{drawerLead.contactLinkedin}</a></div>}
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div className="field-label" style={{ margin: 0 }}>Candidates</div>
                        <button className="btn btn-ghost btn-sm" disabled={busy.has(drawerLead.id)} onClick={() => findCandidates(drawerLead.id)}>
                          {busy.has(drawerLead.id) ? "Finding…" : "Find Candidates"}
                        </button>
                      </div>

                      {candidatesLoading ? (
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
                      ) : candidates.length === 0 ? (
                        <div className="empty" style={{ padding: "24px 0" }}>
                          <div className="empty-title">No candidates yet</div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>Click "Find Candidates" to search the poster and likely titles at this company (free search, no credits spent).</div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {candidates.map(c => (
                            <label key={c.id} style={{
                              display: "flex", gap: 10, alignItems: "flex-start", padding: 10,
                              border: "1px solid var(--border)", borderRadius: 8,
                              background: pickedContactIds.has(c.id) ? "var(--accent-bg, #f0f6ff)" : "transparent",
                              cursor: "pointer",
                            }}>
                              <input type="checkbox" checked={pickedContactIds.has(c.id)} onChange={() => toggleCandidate(c.id)} style={{ marginTop: 3 }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name || "(name pending)"}</span>
                                  <span className={c.source === "poster" ? "chip chip-green" : "chip"} style={{ fontSize: 10 }}>
                                    {c.source === "poster" ? "Job Poster" : "Title Match"}
                                  </span>
                                  {c.enriched && <span className="chip" style={{ fontSize: 10 }}>Enriched</span>}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.title}</div>
                                {c.email && <div style={{ fontSize: 12, marginTop: 2 }}>{c.email}</div>}
                                {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: "var(--accent)" }}>LinkedIn ↗</a>}
                              </div>
                            </label>
                          ))}
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busy.has(drawerLead.id) || pickedContactIds.size === 0}
                            onClick={() => enrichPicked(drawerLead.id)}
                            style={{ marginTop: 4 }}
                          >
                            {busy.has(drawerLead.id) ? "Enriching…" : `Enrich Selected (${pickedContactIds.size})`}
                          </button>
                        </div>
                      )}

                      {!drawerLead.contactName && candidates.length === 0 && !candidatesLoading && (
                        <button className="btn btn-ghost btn-sm" disabled={busy.has(drawerLead.id)} onClick={() => enrichOne(drawerLead.id)}>
                          {busy.has(drawerLead.id) ? "Enriching…" : "Or: Quick Auto-Enrich (old behavior)"}
                        </button>
                      )}
                    </div>
                  )}

                  {drawerTab === "artifacts" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                      <EmailPanel
                        key={drawerLead.id + (drawerLead.emailGeneratedAt || "")}
                        subject={drawerLead.emailSubject} body={drawerLead.emailBody} sender={drawerLead.senderEmail}
                        provider={provider} setProvider={setProvider}
                        canGenerate={!!drawerLead.contactEmail}
                        busy={busy.has(drawerLead.id)}
                        onGenerate={() => generateEmailOne(drawerLead.id)}
                        onSave={(subject, body) => saveEmailEdits(drawerLead.id, subject, body)}
                        onSend={(sender, scheduledAt) => sendEmail(drawerLead.id, sender, scheduledAt)}
                        onPromptClick={() => openPromptModal("email")}
                      />
                      <FollowUpPanel
                        key={drawerLead.id + "fu1"}
                        stage={1}
                        subject={drawerLead.fu1Subject}
                        body={drawerLead.fu1Body}
                        enabled={!!drawerLead.emailSubject}
                        busy={busy.has(drawerLead.id)}
                        onGenerate={() => generateFollowUp(drawerLead.id, 1)}
                        onPromptClick={() => openPromptModal("followUp1")}
                      />
                      <FollowUpPanel
                        key={drawerLead.id + "fu2"}
                        stage={2}
                        subject={drawerLead.fu2Subject}
                        body={drawerLead.fu2Body}
                        enabled={!!drawerLead.emailSubject}
                        busy={busy.has(drawerLead.id)}
                        onGenerate={() => generateFollowUp(drawerLead.id, 2)}
                        onPromptClick={() => openPromptModal("followUp2")}
                      />
                      <OutreachQueuePanel
                        leadId={drawerLead.id}
                        emailReady={!!drawerLead.emailSubject && !!drawerLead.emailBody}
                        candidates={candidates}
                      />
                    </div>
                  )}

                  {drawerTab === "activity" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {drawerLead.activity.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No activity yet.</div>}
                      {drawerLead.activity.map((a) => (
                        <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", marginTop: 5, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(a.at).toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Prompt Modal */}
      {promptModal && (
        <>
          <div onClick={() => setPromptModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 300 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "min(700px, 94vw)", background: "white", borderRadius: 12,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)", zIndex: 301, display: "flex", flexDirection: "column", maxHeight: "90vh",
          }}>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{promptModal.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Edit the system prompt sent to AI. Job post + contact + portfolio context is appended automatically.
                </div>
              </div>
              <button className="icon-btn" onClick={() => setPromptModal(null)}>✕</button>
            </div>
            <div style={{ padding: "16px 24px", flex: 1, overflowY: "auto" }}>
              <textarea
                value={promptDraft}
                onChange={e => setPromptDraft(e.target.value)}
                style={{
                  width: "100%", minHeight: 320, fontFamily: "monospace", fontSize: 13, lineHeight: 1.6,
                  padding: 14, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)",
                  color: "var(--text)", resize: "vertical", boxSizing: "border-box",
                }}
              />
              {promptDraft !== defaultPrompts[promptModal.type] && (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>● Custom prompt active</span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => resetPrompt(promptModal.type)}>
                    Reset to default
                  </button>
                </div>
              )}
            </div>
            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPromptModal(null)}>Cancel</button>
              <button className="btn btn-ghost btn-sm" onClick={handlePromptSaveOnly}>Save (no regenerate)</button>
              <button className="btn btn-primary btn-sm" onClick={handlePromptRegenerate}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                Save & Regenerate
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Prompt button ──────────────────────────────────────────────────── */

function PromptBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" onClick={onClick} title="View / edit prompt" style={{ fontSize: 11 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      Prompt
    </button>
  );
}

/* ─── Email tab ──────────────────────────────────────────────────────── */

function EmailPanel({
  subject, body, sender, provider, setProvider, canGenerate, busy, onGenerate, onSave, onSend, onPromptClick,
}: {
  subject?: string | null; body?: string | null; sender?: string | null; provider: Provider; setProvider: (p: Provider) => void;
  canGenerate: boolean; busy: boolean; onGenerate: () => void; onSave: (subject: string, body: string) => void;
  onSend: (sender: string, scheduledAt?: string) => void; onPromptClick: () => void;
}) {
  const [localSubject, setLocalSubject] = useState(subject || "");
  const [localBody, setLocalBody] = useState(body || "");
  const [localSender, setLocalSender] = useState(sender || "all");
  const [scheduleAt, setScheduleAt] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEdit = (s: string, b: string) => {
    setLocalSubject(s); setLocalBody(b);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onSave(s, b), 600);
  };

  if (!subject && !body) {
    return (
      <div className="empty" style={{ padding: "40px 0" }}>
        <div className="empty-title">No email generated yet</div>
        <div style={{ marginBottom: 14 }}>{canGenerate ? "Not auto-generated — click below." : "Contact not enriched yet — go to the Contact tab first."}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => setProvider(p.id)} className={provider === p.id ? "chip chip-blue" : "chip"} style={{ cursor: "pointer" }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn btn-primary btn-sm" disabled={!canGenerate || busy} onClick={onGenerate}>{busy ? "Generating…" : "Generate Email"}</button>
          <PromptBtn onClick={onPromptClick} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div className="field-label">Subject</div>
        <input className="input" value={localSubject} onChange={e => onEdit(e.target.value, localBody)} />
      </div>
      <div>
        <div className="field-label">Body</div>
        <textarea className="input" rows={10} value={localBody} onChange={e => onEdit(localSubject, e.target.value)} style={{ resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <div>
        <div className="field-label">Send From</div>
        <select className="input" value={localSender} onChange={e => setLocalSender(e.target.value)}>
          <option value="all">All senders — round robin</option>
        </select>
      </div>
      <div>
        <div className="field-label">Schedule for (optional)</div>
        <input type="datetime-local" className="input" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSend(localSender)}>{busy ? "Sending…" : "Send Now"}</button>
        <button className="btn btn-ghost btn-sm" disabled={busy || !scheduleAt} onClick={() => onSend(localSender, new Date(scheduleAt).toISOString())}>Schedule</button>
        <PromptBtn onClick={onPromptClick} />
        <button className="icon-btn" style={{ marginLeft: "auto" }} disabled={busy} onClick={onGenerate}>Regenerate</button>
      </div>
    </div>
  );
}

/* ─── Follow-up tab ──────────────────────────────────────────────────── */

function FollowUpPanel({ stage, subject, body, enabled, busy, onGenerate, onPromptClick }: { stage: 1 | 2; subject?: string | null; body?: string | null; enabled: boolean; busy: boolean; onGenerate: () => void; onPromptClick: () => void; }) {
  if (!enabled) {
    return (
      <div className="empty" style={{ padding: "40px 0" }}>
        <div className="empty-title">Not available yet</div>
        <div>Follow-up {stage} unlocks once the initial email is generated.</div>
      </div>
    );
  }
  if (!subject && !body) {
    return (
      <div className="empty" style={{ padding: "40px 0" }}>
        <div className="empty-title">No follow-up {stage} yet</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={onGenerate}>{busy ? "Generating…" : `Generate Follow-up ${stage}`}</button>
          <PromptBtn onClick={onPromptClick} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><div className="field-label">Subject</div><div className="input" style={{ background: "var(--bg)" }}>{subject}</div></div>
      <div><div className="field-label">Body</div><div className="input" style={{ background: "var(--bg)", whiteSpace: "pre-wrap", minHeight: 140 }}>{body}</div></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="icon-btn" disabled={busy} onClick={onGenerate}>Regenerate</button>
        <PromptBtn onClick={onPromptClick} />
      </div>
    </div>
  );
}

/* ─── Outreach Queue (multi-contact send with FU1/FU2, matches Proposals Artifacts page) ─── */

interface SendJob {
  id: string; toEmail: string; toName: string; scheduledAt: string; sentAt?: string | null;
  status: string; error?: string | null; followUpStage: number; subject?: string | null; body?: string | null;
}

function OutreachQueuePanel({ leadId, emailReady, candidates }: { leadId: string; emailReady: boolean; candidates: JobLeadContact[] }) {
  const [jobs, setJobs] = useState<SendJob[]>([]);
  const [queued, setQueued] = useState(false);
  const [interval_, setInterval_] = useState(5);
  const [fu1Delay, setFu1Delay] = useState(24);
  const [fu2Delay, setFu2Delay] = useState(48);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const emailCandidates = candidates.filter(c => c.email);

  const pollStatus = useCallback(() => {
    api.get<SendJob[]>(`/api/job-leads/${leadId}/send-bulk/status`)
      .then(list => {
        setJobs(list);
        const allDone = list.every(j => j.status === "sent" || j.status === "failed" || j.status === "cancelled");
        if (allDone && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      })
      .catch(() => {});
  }, [leadId]);

  useEffect(() => {
    api.get<SendJob[]>(`/api/job-leads/${leadId}/send-bulk/status`)
      .then(list => {
        if (list.length > 0) {
          setJobs(list);
          setQueued(true);
          if (list.some(j => j.status === "pending")) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(pollStatus, 5000);
          }
        }
      }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [leadId, pollStatus]);

  const togglePick = (id: string) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sendToPicked = async () => {
    const recipients = emailCandidates
      .filter(c => picked.has(c.id))
      .map(c => ({ email: c.email as string, name: c.name }));
    if (recipients.length === 0) return;
    await api.post(`/api/job-leads/${leadId}/send-bulk`, {
      recipients, sender: "all", intervalMinutes: interval_,
      followUp1: { delayHours: fu1Delay }, followUp2: { delayHours: fu2Delay },
    });
    setQueued(true);
    pollStatus();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollStatus, 5000);
  };

  const cancelAll = async () => {
    await api.post(`/api/job-leads/${leadId}/send-bulk/cancel`, {});
    pollStatus();
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const cancelFollowUps = async (contactEmail?: string) => {
    await api.post(`/api/job-leads/${leadId}/send-bulk/cancel-followups`, { contactEmail: contactEmail ?? null, stage: null });
    pollStatus();
  };

  const cancelJob = async (jobId: string) => {
    await api.post(`/api/job-leads/send-job/${jobId}/cancel`, {});
    pollStatus();
  };

  const sendJobNow = async (jobId: string) => {
    await api.post(`/api/job-leads/send-job/${jobId}/send-now`, {});
    pollStatus();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollStatus, 5000);
  };

  if (!emailReady) {
    return (
      <div className="card">
        <div className="card-title">Send to Contacts</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Generate the email above first.</div>
      </div>
    );
  }

  const anyPending = jobs.some(j => j.status === "pending");
  const anyFuPending = jobs.some(j => j.status === "pending" && j.followUpStage > 0);
  const totalSent = jobs.filter(j => j.status === "sent").length;

  const statusIcon = (status: string) => {
    if (status === "sent") return <span style={{ color: "#22c55e", fontSize: 13 }}>✓</span>;
    if (status === "failed") return <span style={{ color: "#ef4444", fontSize: 13 }}>✕</span>;
    if (status === "cancelled") return <span style={{ color: "var(--muted)", fontSize: 13 }}>–</span>;
    return <span style={{ color: "#f59e0b", fontSize: 13 }}>⏳</span>;
  };
  const stageChip = (label: string, color: string) => (
    <span style={{ background: color, color: "white", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, minWidth: 40, textAlign: "center" as const, display: "inline-block" }}>{label}</span>
  );
  const scheduledLabel = (job?: SendJob) =>
    job && job.status === "pending"
      ? <span style={{ color: "var(--muted)", fontSize: 10 }}>due {new Date(job.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      : null;

  const grouped = Array.from(new Set(jobs.map(j => j.toEmail))).map(email => ({
    email,
    name: jobs.find(j => j.toEmail === email)?.toName || email,
    initial: jobs.find(j => j.toEmail === email && j.followUpStage === 0),
    fu1: jobs.find(j => j.toEmail === email && j.followUpStage === 1),
    fu2: jobs.find(j => j.toEmail === email && j.followUpStage === 2),
  }));

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div className="card-title">Send to Contacts</div>
          <div className="card-sub">Pick enriched candidates, then queue initial + follow-ups</div>
        </div>
        {!anyPending && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Interval (min):</label>
            <select value={interval_} onChange={e => setInterval_(Number(e.target.value))}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
              {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>FU1 (hrs):</label>
            <input type="number" min={1} value={fu1Delay} onChange={e => setFu1Delay(Number(e.target.value))}
              style={{ width: 50, fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }} />
            <label style={{ fontSize: 12, color: "var(--muted)" }}>FU2 (hrs):</label>
            <input type="number" min={1} value={fu2Delay} onChange={e => setFu2Delay(Number(e.target.value))}
              style={{ width: 50, fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }} />
          </div>
        )}
      </div>

      {!anyPending && emailCandidates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {emailCandidates.map(c => (
            <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.email}</span>
            </label>
          ))}
          <button className="btn btn-primary btn-sm" disabled={picked.size === 0} onClick={sendToPicked} style={{ alignSelf: "flex-start", marginTop: 4 }}>
            Send to Selected ({picked.size})
          </button>
        </div>
      )}

      {emailCandidates.length === 0 && jobs.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>No enriched contacts with email yet — enrich candidates in the Contact tab first.</div>
      )}

      {queued && jobs.length > 0 && (
        <div style={{ padding: "12px 14px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>📤 Outreach queue</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{totalSent}/{jobs.length} sent</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {anyFuPending && (
                <button className="btn btn-sm" style={{ background: "#f59e0b", color: "white", border: "none", fontSize: 11, padding: "3px 8px" }}
                  onClick={() => cancelFollowUps()}>⏹ Stop All Follow-ups</button>
              )}
              {anyPending && (
                <button className="btn btn-sm" style={{ background: "#dc3545", color: "white", border: "none", fontSize: 11, padding: "3px 8px" }}
                  onClick={cancelAll}>✕ Cancel All</button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grouped.map(({ email, name, initial, fu1, fu2 }) => {
              const hasPendingFu = (fu1 && fu1.status === "pending") || (fu2 && fu2.status === "pending");
              return (
                <div key={email} style={{ background: "var(--surface2, var(--surface))", borderRadius: 6, border: "1px solid var(--border)", padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{email}</span>
                    </div>
                    {hasPendingFu && (
                      <button className="btn btn-sm" style={{ background: "#f59e0b", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }}
                        onClick={() => cancelFollowUps(email)}>⏹ Stop FU</button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {initial && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        {statusIcon(initial.status)}{stageChip("Initial", "#0078d4")}{scheduledLabel(initial)}
                        {initial.status === "pending" && (
                          <button className="btn btn-sm" style={{ background: "#0078d4", color: "white", border: "none", fontSize: 10, padding: "2px 6px", marginLeft: "auto" }}
                            onClick={() => sendJobNow(initial.id)}>Send Now</button>
                        )}
                        {initial.status === "sent" && initial.sentAt && (
                          <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>sent {new Date(initial.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        )}
                        {initial.status === "failed" && initial.error && <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>{initial.error}</span>}
                      </div>
                    )}
                    {fu1 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        {statusIcon(fu1.status)}{stageChip("FU1", "#a855f7")}{scheduledLabel(fu1)}
                        {fu1.status === "pending" && (
                          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                            <button className="btn btn-sm" style={{ background: "#0078d4", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }} onClick={() => sendJobNow(fu1!.id)}>Send Now</button>
                            <button className="btn btn-sm" style={{ background: "#dc3545", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }} onClick={() => cancelJob(fu1!.id)}>⏹ Stop</button>
                          </div>
                        )}
                        {fu1.status === "sent" && fu1.sentAt && <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>sent {new Date(fu1.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                        {fu1.status === "cancelled" && <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>stopped</span>}
                        {fu1.status === "failed" && fu1.error && <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>{fu1.error}</span>}
                      </div>
                    )}
                    {fu2 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        {statusIcon(fu2.status)}{stageChip("FU2", "#ec4899")}{scheduledLabel(fu2)}
                        {fu2.status === "pending" && (
                          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                            <button className="btn btn-sm" style={{ background: "#0078d4", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }} onClick={() => sendJobNow(fu2!.id)}>Send Now</button>
                            <button className="btn btn-sm" style={{ background: "#dc3545", color: "white", border: "none", fontSize: 10, padding: "2px 6px" }} onClick={() => cancelJob(fu2!.id)}>⏹ Stop</button>
                          </div>
                        )}
                        {fu2.status === "sent" && fu2.sentAt && <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>sent {new Date(fu2.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                        {fu2.status === "cancelled" && <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>stopped</span>}
                        {fu2.status === "failed" && fu2.error && <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>{fu2.error}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
