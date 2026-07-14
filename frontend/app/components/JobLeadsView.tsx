"use client";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

/* ─── Types (mirror backend camelCase JSON) ───────────────────────────── */

type LeadStatus = "scraped" | "enriched" | "email_ready" | "scheduled" | "sent" | "replied";
type DrawerTab = "job" | "contact" | "email" | "fu1" | "fu2" | "activity";
type Provider = "azure" | "groq" | "claude";
type GroupBy = "none" | "scraped" | "activity";

interface ActivityEvent { id: string; jobLeadId: string; label: string; at: string; }

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
const COMPANY_SIZES = ["1–9 employees", "10–50 employees", "51–200 employees", "Any size"];
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
  const [page, setPage] = useState(1);

  const [filterOptions, setFilterOptions] = useState<{ industries: string[]; sizes: string[]; countries: string[] }>({ industries: [], sizes: [], countries: [] });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerLead, setDrawerLead] = useState<JobLead | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("job");
  const [provider, setProvider] = useState<Provider>("azure");
  const [busy, setBusy] = useState<Set<string>>(new Set()); // ids with an in-flight action

  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeParams, setScrapeParams] = useState({
    country: COUNTRIES[0], companySize: COMPANY_SIZES[0], postedWithin: 7,
    roles: [ROLE_OPTIONS[0], ROLE_OPTIONS[1]],
  });
  const [scrapeRun, setScrapeRun] = useState<ScrapeRun | null>(null);
  const scrapeBtnRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    p.set("page", forGrouping ? "1" : String(page));
    p.set("perPage", forGrouping ? String(GROUPED_FETCH_SIZE) : String(PER_PAGE));
    return p;
  }, [statusFilter, search, keywordFilter, industryFilter, sizeFilter, countryFilter, needsFollowUp, dateFrom, dateTo, page]);

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
  }, [statusFilter, search, keywordFilter, industryFilter, sizeFilter, countryFilter, needsFollowUp, dateFrom, dateTo, groupBy, page]);

  useEffect(() => { setPage(1); }, [statusFilter, search, keywordFilter, industryFilter, sizeFilter, countryFilter, needsFollowUp, dateFrom, dateTo, groupBy]);

  useEffect(() => { refreshFilterOptions(); }, [refreshFilterOptions]);

  const grouped = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, JobLead[]>();
    for (const l of leads) {
      const key = bucketFor(groupBy === "scraped" ? l.scrapedAt : (l.activity[l.activity.length - 1]?.at ?? l.scrapedAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return BUCKET_ORDER.map(b => ({ label: b, rows: map.get(b) || [] })).filter(g => g.rows.length > 0);
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
    setActionError("");
    try {
      const { runId } = await api.post<{ runId: string }>("/api/job-leads/scrape", {
        roles: scrapeParams.roles, country: scrapeParams.country, companySize: scrapeParams.companySize, postedWithinDays: scrapeParams.postedWithin,
      });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const run = await api.get<ScrapeRun>(`/api/job-leads/scrape/${runId}`);
          setScrapeRun(run);
          if (run.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
            setScraping(false);
            fetchLeads();
            refreshFilterOptions();
          }
        } catch { /* keep polling until timeout below stops it via error */ }
      }, 1500);
    } catch (e: any) {
      setActionError(e.message || "Failed to start scrape.");
      setScraping(false);
    }
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

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

  const generateEmailOne = (id: string) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/generate-email`, { provider });
    await refreshLead(id);
  });

  const generateFollowUp = (id: string, stage: 1 | 2) => withBusy(id, async () => {
    await api.post(`/api/job-leads/${id}/generate-followup${stage}`, { provider });
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
    { id: "email", label: "Email" },
    { id: "fu1", label: "Follow-up 1" },
    { id: "fu2", label: "Follow-up 2" },
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
              <div className="field-label">Company Size</div>
              <select className="input" value={scrapeParams.companySize} onChange={e => setScrapeParams(p => ({ ...p, companySize: e.target.value }))} style={{ marginBottom: 10 }}>
                {COMPANY_SIZES.map(c => <option key={c}>{c}</option>)}
              </select>
              <div className="field-label">Posted Within</div>
              <select className="input" value={scrapeParams.postedWithin} onChange={e => setScrapeParams(p => ({ ...p, postedWithin: +e.target.value }))} style={{ marginBottom: 10 }}>
                {POSTED_WITHIN.map(d => <option key={d} value={d}>Last {d} day{d > 1 ? "s" : ""}</option>)}
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
                {scraping ? <><span className="spinner" style={{ marginRight: 6 }} />Running…</> : "Run Scraper"}
              </button>
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
            {filterOptions.sizes.map(s => <option key={s} value={s}>{s}</option>)}
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
            <option value="activity">Last activity</option>
          </select>
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
                      <button key={t.id} onClick={() => setDrawerTab(t.id)} style={{
                        background: "none", border: "none", borderBottom: drawerTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                        color: drawerTab === t.id ? "var(--accent)" : "var(--muted)", fontWeight: 600, fontSize: 12.5,
                        padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap",
                      }}>{t.label}</button>
                    ))}
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
                      {drawerLead.jobUrl && <a href={drawerLead.jobUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 16, fontSize: 12, color: "var(--accent)" }}>View original posting ↗</a>}
                    </div>
                  )}

                  {drawerTab === "contact" && (
                    drawerLead.contactName ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div><div className="field-label">Name</div><div>{drawerLead.contactName}</div></div>
                        <div><div className="field-label">Title</div><div>{drawerLead.contactTitle}</div></div>
                        <div><div className="field-label">Email</div><div>{drawerLead.contactEmail}</div></div>
                        {drawerLead.contactPhone && <div><div className="field-label">Phone</div><div>{drawerLead.contactPhone}</div></div>}
                        {drawerLead.contactLinkedin && <div><div className="field-label">LinkedIn</div><a href={drawerLead.contactLinkedin} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{drawerLead.contactLinkedin}</a></div>}
                      </div>
                    ) : (
                      <div className="empty" style={{ padding: "40px 0" }}>
                        <div className="empty-title">No contact yet</div>
                        <button className="btn btn-primary btn-sm" disabled={busy.has(drawerLead.id)} onClick={() => enrichOne(drawerLead.id)}>
                          {busy.has(drawerLead.id) ? "Enriching…" : "Enrich via Apollo"}
                        </button>
                      </div>
                    )
                  )}

                  {drawerTab === "email" && (
                    <EmailPanel
                      key={drawerLead.id + (drawerLead.emailGeneratedAt || "")}
                      subject={drawerLead.emailSubject} body={drawerLead.emailBody} sender={drawerLead.senderEmail}
                      provider={provider} setProvider={setProvider}
                      canGenerate={!!drawerLead.contactEmail}
                      busy={busy.has(drawerLead.id)}
                      onGenerate={() => generateEmailOne(drawerLead.id)}
                      onSave={(subject, body) => saveEmailEdits(drawerLead.id, subject, body)}
                      onSend={(sender, scheduledAt) => sendEmail(drawerLead.id, sender, scheduledAt)}
                    />
                  )}

                  {(drawerTab === "fu1" || drawerTab === "fu2") && (
                    <FollowUpPanel
                      key={drawerLead.id + drawerTab}
                      stage={drawerTab === "fu1" ? 1 : 2}
                      subject={drawerTab === "fu1" ? drawerLead.fu1Subject : drawerLead.fu2Subject}
                      body={drawerTab === "fu1" ? drawerLead.fu1Body : drawerLead.fu2Body}
                      enabled={["sent", "replied"].includes(drawerLead.status)}
                      busy={busy.has(drawerLead.id)}
                      onGenerate={() => generateFollowUp(drawerLead.id, drawerTab === "fu1" ? 1 : 2)}
                    />
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
    </div>
  );
}

/* ─── Email tab ──────────────────────────────────────────────────────── */

function EmailPanel({
  subject, body, sender, provider, setProvider, canGenerate, busy, onGenerate, onSave, onSend,
}: {
  subject?: string | null; body?: string | null; sender?: string | null; provider: Provider; setProvider: (p: Provider) => void;
  canGenerate: boolean; busy: boolean; onGenerate: () => void; onSave: (subject: string, body: string) => void;
  onSend: (sender: string, scheduledAt?: string) => void;
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
        <div style={{ marginBottom: 14 }}>{canGenerate ? "Generate a personalized email using portfolio context." : "Enrich the contact first."}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => setProvider(p.id)} className={provider === p.id ? "chip chip-blue" : "chip"} style={{ cursor: "pointer" }}>{p.label}</button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" disabled={!canGenerate || busy} onClick={onGenerate}>{busy ? "Generating…" : "Generate Email"}</button>
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
        <button className="icon-btn" style={{ marginLeft: "auto" }} disabled={busy} onClick={onGenerate}>Regenerate</button>
      </div>
    </div>
  );
}

/* ─── Follow-up tab ──────────────────────────────────────────────────── */

function FollowUpPanel({ stage, subject, body, enabled, busy, onGenerate }: { stage: 1 | 2; subject?: string | null; body?: string | null; enabled: boolean; busy: boolean; onGenerate: () => void; }) {
  if (!enabled) {
    return (
      <div className="empty" style={{ padding: "40px 0" }}>
        <div className="empty-title">Not available yet</div>
        <div>Follow-up {stage} unlocks once the outreach email has been sent.</div>
      </div>
    );
  }
  if (!subject && !body) {
    return (
      <div className="empty" style={{ padding: "40px 0" }}>
        <div className="empty-title">No follow-up {stage} yet</div>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={onGenerate}>{busy ? "Generating…" : `Generate Follow-up ${stage}`}</button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><div className="field-label">Subject</div><div className="input" style={{ background: "var(--bg)" }}>{subject}</div></div>
      <div><div className="field-label">Body</div><div className="input" style={{ background: "var(--bg)", whiteSpace: "pre-wrap", minHeight: 140 }}>{body}</div></div>
      <button className="icon-btn" disabled={busy} onClick={onGenerate}>Regenerate</button>
    </div>
  );
}
