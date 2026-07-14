"use client";
import { useState, useMemo, useRef, useEffect } from "react";

/* ─── Types ─────────────────────────────────────────────────────────── */

type LeadStatus = "scraped" | "enriched" | "email_ready" | "scheduled" | "sent" | "replied";
type DrawerTab = "job" | "contact" | "email" | "fu1" | "fu2" | "activity";
type Provider = "azure" | "groq" | "claude";

interface ActivityEvent { label: string; at: string; }

interface JobLead {
  id: string;
  company: string;
  industry: string;
  companySize: string;
  jobTitle: string;
  jobDescription: string;
  jobUrl: string;
  postedAt: string;
  score: number;
  status: LeadStatus;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactLinkedin?: string;
  emailSubject?: string;
  emailBody?: string;
  fu1Subject?: string;
  fu1Body?: string;
  fu2Subject?: string;
  fu2Body?: string;
  sender?: string;
  activity: ActivityEvent[];
}

/* ─── Static config ─────────────────────────────────────────────────── */

const SENDERS = ["manjika.tantia@csharptek.com", "amrita.rani@csharptek.com"];
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

/* ─── Mock data (UI-only phase — replaced by API in next pass) ───────── */

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 864e5).toISOString();

const MOCK: JobLead[] = [
  {
    id: "1", company: "Northwind Analytics", industry: "SaaS / Data", companySize: "12 employees",
    jobTitle: "Senior Full Stack Engineer", jobUrl: "https://linkedin.com/jobs/1",
    jobDescription: "We're looking for a senior full stack engineer to help us scale our analytics platform. You'll work across our Next.js frontend and .NET backend, own features end to end, and collaborate directly with the founding team. 3+ years experience with React and C# required.",
    postedAt: daysAgo(2), score: 3, status: "scraped",
    activity: [{ label: "Scraped from LinkedIn", at: daysAgo(2) }],
  },
  {
    id: "2", company: "Fernbridge Health", industry: "Healthtech", companySize: "34 employees",
    jobTitle: "Backend Engineer (Node.js)", jobUrl: "https://linkedin.com/jobs/2",
    jobDescription: "Fernbridge Health is building patient scheduling infra for clinics. Looking for a backend engineer comfortable with Node.js, PostgreSQL, and HIPAA-aware system design. Remote friendly.",
    postedAt: daysAgo(4), score: 3, status: "enriched",
    contactName: "Priya Shah", contactTitle: "Head of Engineering", contactEmail: "priya@fernbridgehealth.com", contactLinkedin: "https://linkedin.com/in/priyashah",
    activity: [{ label: "Scraped from LinkedIn", at: daysAgo(4) }, { label: "Enriched via Apollo", at: daysAgo(3) }],
  },
  {
    id: "3", company: "Cursive Robotics", industry: "AI / Robotics", companySize: "8 employees",
    jobTitle: "AI Engineer", jobUrl: "https://linkedin.com/jobs/3",
    jobDescription: "Small robotics team looking for an AI engineer to work on perception models. Python, PyTorch, and a genuine interest in shipping fast.",
    postedAt: daysAgo(5), score: 4, status: "email_ready",
    contactName: "Dan Ferreira", contactTitle: "Co-founder", contactEmail: "dan@cursiverobotics.ai",
    emailSubject: "Quick thought on Cursive's AI Engineer role",
    emailBody: "Hi Dan,\n\nSaw Cursive Robotics is hiring an AI Engineer — congrats on the momentum. We recently helped a similarly-sized robotics team ship a perception pipeline in half the usual timeline.\n\nWorth a quick chat?\n\nBest,\nManjika",
    activity: [{ label: "Scraped from LinkedIn", at: daysAgo(5) }, { label: "Enriched via Apollo", at: daysAgo(4) }, { label: "Email generated", at: daysAgo(3) }],
  },
  {
    id: "4", company: "Loomvale Studio", industry: "Design Tech", companySize: "6 employees",
    jobTitle: "Frontend Engineer (React)", jobUrl: "https://linkedin.com/jobs/4",
    jobDescription: "Loomvale is a design tooling startup. We need a frontend engineer who's obsessed with interaction detail — React, Tailwind, Framer Motion.",
    postedAt: daysAgo(6), score: 3, status: "scheduled",
    contactName: "Wren Okafor", contactTitle: "Founder", contactEmail: "wren@loomvale.studio",
    emailSubject: "Loomvale's Frontend Engineer search",
    emailBody: "Hi Wren,\n\nNoticed Loomvale is hiring for frontend. We've built pixel-precise interaction-heavy UIs for a few design tools recently — happy to share examples.\n\nBest,\nManjika",
    sender: "manjika.tantia@csharptek.com",
    activity: [{ label: "Scraped from LinkedIn", at: daysAgo(6) }, { label: "Enriched via Apollo", at: daysAgo(5) }, { label: "Email generated", at: daysAgo(4) }, { label: "Scheduled to send", at: daysAgo(1) }],
  },
  {
    id: "5", company: "Portside Logistics", industry: "Logistics Tech", companySize: "21 employees",
    jobTitle: "Full Stack Engineer", jobUrl: "https://linkedin.com/jobs/5",
    jobDescription: "Portside is digitizing port logistics. Full stack engineer needed, Next.js + .NET, fleet tracking dashboards.",
    postedAt: daysAgo(9), score: 2, status: "sent",
    contactName: "Marcus Lin", contactTitle: "CTO", contactEmail: "marcus@portsidelogistics.com",
    emailSubject: "Portside's Full Stack Engineer opening",
    emailBody: "Hi Marcus,\n\nSaw the Full Stack Engineer opening at Portside. We've shipped a few fleet/logistics dashboards on the exact Next.js + .NET stack you're running.\n\nOpen to a quick intro call?\n\nBest,\nAmrita",
    sender: "amrita.rani@csharptek.com",
    activity: [{ label: "Scraped from LinkedIn", at: daysAgo(9) }, { label: "Enriched via Apollo", at: daysAgo(8) }, { label: "Email generated", at: daysAgo(7) }, { label: "Sent", at: daysAgo(6) }],
  },
  {
    id: "6", company: "Amberloop", industry: "Fintech", companySize: "15 employees",
    jobTitle: "Senior Backend Engineer", jobUrl: "https://linkedin.com/jobs/6",
    jobDescription: "Amberloop is building embedded payments infra. Senior backend engineer, C#/.NET, strong security fundamentals expected.",
    postedAt: daysAgo(11), score: 3, status: "replied",
    contactName: "Sofia Reyes", contactTitle: "VP Engineering", contactEmail: "sofia@amberloop.io",
    emailSubject: "Amberloop's Senior Backend Engineer search",
    emailBody: "Hi Sofia,\n\nSaw Amberloop is hiring a senior backend engineer. We specialize in exactly this — .NET teams building payments-grade infra.\n\nBest,\nManjika",
    sender: "manjika.tantia@csharptek.com",
    activity: [{ label: "Scraped from LinkedIn", at: daysAgo(11) }, { label: "Enriched via Apollo", at: daysAgo(10) }, { label: "Email generated", at: daysAgo(9) }, { label: "Sent", at: daysAgo(8) }, { label: "Replied", at: daysAgo(6) }],
  },
];

/* ─── Small building blocks ─────────────────────────────────────────── */

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", minWidth: 92 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ScoreChip({ score }: { score: number }) {
  const cls = score >= 3 ? "chip chip-green" : score === 2 ? "chip chip-orange" : "chip";
  return <span className={cls}>{score}</span>;
}

/* ─── Main view ──────────────────────────────────────────────────────── */

export default function JobLeadsView() {
  const [leads, setLeads] = useState<JobLead[]>(MOCK);
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("job");
  const [provider, setProvider] = useState<Provider>("azure");

  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeParams, setScrapeParams] = useState({
    country: COUNTRIES[0], companySize: COMPANY_SIZES[0], postedWithin: 7,
    roles: [ROLE_OPTIONS[0], ROLE_OPTIONS[1]],
  });
  const [scrapeLog, setScrapeLog] = useState<string[]>([]);
  const scrapeBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (scrapeOpen && scrapeBtnRef.current && !scrapeBtnRef.current.contains(e.target as Node)) setScrapeOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [scrapeOpen]);

  const drawer = leads.find(l => l.id === drawerId) || null;

  const stats = useMemo(() => ({
    scraped: leads.length,
    qualified: leads.filter(l => l.score >= 2).length,
    enriched: leads.filter(l => ["enriched", "email_ready", "scheduled", "sent", "replied"].includes(l.status)).length,
    emailReady: leads.filter(l => l.status === "email_ready").length,
    sent: leads.filter(l => ["sent", "replied"].includes(l.status)).length,
    replied: leads.filter(l => l.status === "replied").length,
  }), [leads]);

  const filtered = leads.filter(l => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (l.score < minScore) return false;
    if (search && !`${l.company} ${l.jobTitle}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const patch = (id: string, fields: Partial<JobLead>, activityLabel?: string) => {
    setLeads(ls => ls.map(l => l.id === id
      ? { ...l, ...fields, activity: activityLabel ? [...l.activity, { label: activityLabel, at: new Date().toISOString() }] : l.activity }
      : l));
  };

  const toggleRole = (r: string) =>
    setScrapeParams(p => ({ ...p, roles: p.roles.includes(r) ? p.roles.filter(x => x !== r) : [...p.roles, r] }));

  const runScrape = async () => {
    setScraping(true); setScrapeLog([]);
    const steps = [
      `Searching LinkedIn for: ${scrapeParams.roles.join(", ")}`,
      `Fetching listings — ${scrapeParams.country}, last ${scrapeParams.postedWithin}d`,
      "Found 9 raw postings",
      "Filtered 2 staffing/agency companies",
      "7 leads added to the table",
    ];
    for (const s of steps) { await new Promise(r => setTimeout(r, 450)); setScrapeLog(l => [...l, s]); }
    setScraping(false);
  };

  const toggleSelect = (id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () =>
    setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)));

  const enrichOne = (id: string) => {
    patch(id, {
      status: "enriched",
      contactName: "Alex Rivera", contactTitle: "Engineering Manager",
      contactEmail: "alex@" + leads.find(l => l.id === id)?.company.toLowerCase().replace(/\s+/g, "") + ".com",
    }, "Enriched via Apollo");
  };

  const generateEmailOne = (id: string) => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    patch(id, {
      status: "email_ready",
      emailSubject: `Quick note on ${lead.company}'s ${lead.jobTitle} search`,
      emailBody: `Hi ${lead.contactName?.split(" ")[0] || "there"},\n\nSaw ${lead.company} is hiring a ${lead.jobTitle}. We've shipped similar work recently — happy to share examples if useful.\n\nBest,\nManjika`,
    }, "Email generated");
  };

  const bulkEnrich = () => { selected.forEach(id => { if (leads.find(l => l.id === id)?.status === "scraped") enrichOne(id); }); setSelected(new Set()); };
  const bulkGenerate = () => { selected.forEach(id => { if (leads.find(l => l.id === id)?.status === "enriched") generateEmailOne(id); }); setSelected(new Set()); };
  const bulkSend = () => { selected.forEach(id => { if (leads.find(l => l.id === id)?.status === "email_ready") patch(id, { status: "scheduled", sender: SENDERS[0] }, "Scheduled to send"); }); setSelected(new Set()); };
  const bulkDelete = () => { setLeads(ls => ls.filter(l => !selected.has(l.id))); setSelected(new Set()); };

  const openDrawer = (id: string) => { setDrawerId(id); setDrawerTab("job"); };

  const tabDef: { id: DrawerTab; label: string }[] = [
    { id: "job", label: "Job" },
    { id: "contact", label: "Contact" },
    { id: "email", label: "Email" },
    { id: "fu1", label: "Follow-up 1" },
    { id: "fu2", label: "Follow-up 2" },
    { id: "activity", label: "Activity" },
  ];

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
              {scrapeLog.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.8, maxHeight: 120, overflowY: "auto" }}>
                  {scrapeLog.map((s, i) => <div key={i}>· {s}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stat pills */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <StatPill label="Scraped" value={stats.scraped} />
        <StatPill label="Qualified" value={stats.qualified} />
        <StatPill label="Enriched" value={stats.enriched} />
        <StatPill label="Email Ready" value={stats.emailReady} />
        <StatPill label="Sent" value={stats.sent} />
        <StatPill label="Replied" value={stats.replied} />
      </div>

      {/* Filter row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setStatusFilter("all")} className={statusFilter === "all" ? "chip chip-blue" : "chip"} style={{ cursor: "pointer", padding: "5px 12px" }}>All</button>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={statusFilter === s ? "chip chip-blue" : "chip"} style={{ cursor: "pointer", padding: "5px 12px" }}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <input className="input" placeholder="Search company or title…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 220, marginLeft: "auto" }} />
        <select className="input" value={minScore} onChange={e => setMinScore(+e.target.value)} style={{ maxWidth: 130 }}>
          <option value={0}>Any score</option>
          <option value={2}>Score ≥ 2</option>
          <option value={3}>Score ≥ 3</option>
        </select>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="banner banner-info" style={{ alignItems: "center" }}>
          <span>{selected.size} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={bulkEnrich}>Enrich</button>
            <button className="btn btn-ghost btn-sm" onClick={bulkGenerate}>Generate Emails</button>
            <button className="btn btn-ghost btn-sm" onClick={bulkSend}>Schedule Send</button>
            <button className="btn btn-danger btn-sm" onClick={bulkDelete}>Delete</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-wrap">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-title">No leads match your filters</div>
            <div>Run a new scrape or widen your filters.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} /></th>
                <th>Company</th>
                <th>Job Title</th>
                <th>Score</th>
                <th>Status</th>
                <th>Contact</th>
                <th>Last Action</th>
                <th style={{ width: 24 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => openDrawer(l.id)}>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.company}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.industry} · {l.companySize}</div>
                  </td>
                  <td style={{ maxWidth: 240 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.jobTitle}</div>
                  </td>
                  <td><ScoreChip score={l.score} /></td>
                  <td><span className={STATUS_CHIP[l.status]}>{STATUS_LABEL[l.status]}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    {l.contactName ? (
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 12 }}>{l.contactName}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.contactTitle}</div>
                      </div>
                    ) : (
                      <button className="icon-btn" style={{ color: "var(--accent)" }} onClick={() => enrichOne(l.id)}>Enrich</button>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(l.activity[l.activity.length - 1]?.at)}</td>
                  <td style={{ color: "var(--dim)" }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Drawer */}
      {drawer && (
        <>
          <div onClick={() => setDrawerId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 200 }} />
          <div className="drawer-panel" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "white", zIndex: 201, boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{drawer.company}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{drawer.jobTitle}</div>
                </div>
                <button className="icon-btn" onClick={() => setDrawerId(null)} style={{ fontSize: 18 }}>×</button>
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
                  <div className="chip" style={{ marginBottom: 12 }}>{fmtDate(drawer.postedAt)} · {drawer.industry} · {drawer.companySize}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{drawer.jobDescription}</div>
                  <a href={drawer.jobUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 16, fontSize: 12, color: "var(--accent)" }}>View original posting ↗</a>
                </div>
              )}

              {drawerTab === "contact" && (
                drawer.contactName ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div><div className="field-label">Name</div><div>{drawer.contactName}</div></div>
                    <div><div className="field-label">Title</div><div>{drawer.contactTitle}</div></div>
                    <div><div className="field-label">Email</div><div>{drawer.contactEmail}</div></div>
                    {drawer.contactPhone && <div><div className="field-label">Phone</div><div>{drawer.contactPhone}</div></div>}
                    {drawer.contactLinkedin && <div><div className="field-label">LinkedIn</div><a href={drawer.contactLinkedin} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{drawer.contactLinkedin}</a></div>}
                  </div>
                ) : (
                  <div className="empty" style={{ padding: "40px 0" }}>
                    <div className="empty-title">No contact yet</div>
                    <button className="btn btn-primary btn-sm" onClick={() => enrichOne(drawer.id)}>Enrich via Apollo</button>
                  </div>
                )
              )}

              {drawerTab === "email" && (
                <EmailPanel
                  subject={drawer.emailSubject} body={drawer.emailBody} sender={drawer.sender}
                  provider={provider} setProvider={setProvider}
                  canGenerate={!!drawer.contactEmail}
                  onGenerate={() => generateEmailOne(drawer.id)}
                  onChange={(subject, body) => patch(drawer.id, { emailSubject: subject, emailBody: body })}
                  onSetSender={sender => patch(drawer.id, { sender })}
                  onSend={sender => patch(drawer.id, { status: "sent", sender }, "Sent")}
                  onSchedule={sender => patch(drawer.id, { status: "scheduled", sender }, "Scheduled to send")}
                />
              )}

              {(drawerTab === "fu1" || drawerTab === "fu2") && (
                <FollowUpPanel
                  stage={drawerTab === "fu1" ? 1 : 2}
                  subject={drawerTab === "fu1" ? drawer.fu1Subject : drawer.fu2Subject}
                  body={drawerTab === "fu1" ? drawer.fu1Body : drawer.fu2Body}
                  enabled={["sent", "replied"].includes(drawer.status)}
                  onGenerate={() => {
                    const field = drawerTab === "fu1" ? "fu1Subject" : "fu2Subject";
                    const bodyField = drawerTab === "fu1" ? "fu1Body" : "fu2Body";
                    patch(drawer.id, {
                      [field]: `Following up — ${drawer.jobTitle} at ${drawer.company}`,
                      [bodyField]: `Hi ${drawer.contactName?.split(" ")[0] || "there"},\n\nJust following up on my earlier note about the ${drawer.jobTitle} role — happy to share more examples if timing's better now.\n\nBest,\nManjika`,
                    } as any, `Follow-up ${drawerTab === "fu1" ? 1 : 2} generated`);
                  }}
                />
              )}

              {drawerTab === "activity" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {drawer.activity.map((a, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
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
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Email tab ──────────────────────────────────────────────────────── */

function EmailPanel({
  subject, body, sender, provider, setProvider, canGenerate, onGenerate, onChange, onSetSender, onSend, onSchedule,
}: {
  subject?: string; body?: string; sender?: string; provider: Provider; setProvider: (p: Provider) => void;
  canGenerate: boolean; onGenerate: () => void; onChange: (subject: string, body: string) => void;
  onSetSender: (s: string) => void; onSend: (s: string) => void; onSchedule: (s: string) => void;
}) {
  const [localSubject, setLocalSubject] = useState(subject || "");
  const [localBody, setLocalBody] = useState(body || "");
  const [localSender, setLocalSender] = useState(sender || "all");
  useEffect(() => { setLocalSubject(subject || ""); setLocalBody(body || ""); }, [subject, body]);
  useEffect(() => { setLocalSender(sender || "all"); }, [sender]);

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
        <button className="btn btn-primary btn-sm" disabled={!canGenerate} onClick={onGenerate}>Generate Email</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div className="field-label">Subject</div>
        <input className="input" value={localSubject} onChange={e => { setLocalSubject(e.target.value); onChange(e.target.value, localBody); }} />
      </div>
      <div>
        <div className="field-label">Body</div>
        <textarea className="input" rows={10} value={localBody} onChange={e => { setLocalBody(e.target.value); onChange(localSubject, e.target.value); }} style={{ resize: "vertical", fontFamily: "inherit" }} />
      </div>
      <div>
        <div className="field-label">Send From</div>
        <select className="input" value={localSender} onChange={e => { setLocalSender(e.target.value); onSetSender(e.target.value); }}>
          <option value="all">All senders — round robin</option>
          {SENDERS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="btn btn-primary btn-sm" onClick={() => onSend(localSender)}>Send Now</button>
        <button className="btn btn-ghost btn-sm" onClick={() => onSchedule(localSender)}>Schedule</button>
        <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onGenerate}>Regenerate</button>
      </div>
    </div>
  );
}

/* ─── Follow-up tab ──────────────────────────────────────────────────── */

function FollowUpPanel({ stage, subject, body, enabled, onGenerate }: { stage: 1 | 2; subject?: string; body?: string; enabled: boolean; onGenerate: () => void; }) {
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
        <button className="btn btn-primary btn-sm" onClick={onGenerate}>Generate Follow-up {stage}</button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><div className="field-label">Subject</div><div className="input" style={{ background: "var(--bg)" }}>{subject}</div></div>
      <div><div className="field-label">Body</div><div className="input" style={{ background: "var(--bg)", whiteSpace: "pre-wrap", minHeight: 140 }}>{body}</div></div>
      <button className="icon-btn" onClick={onGenerate}>Regenerate</button>
    </div>
  );
}
