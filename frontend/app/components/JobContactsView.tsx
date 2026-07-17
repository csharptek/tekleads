"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

interface JobContact {
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
  createdAt: string;
  leadCompany: string;
  leadJobTitle: string;
  leadStatus: string;
}

const PER_PAGE = 25;

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      title="Copy" style={{ background: "none", border: "none", cursor: "pointer", padding: "0 3px", color: copied ? "#22c55e" : "var(--muted)", opacity: 0.7, verticalAlign: "middle", lineHeight: 1, flexShrink: 0 }}>
      {copied
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
    </button>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt", label: "Date Enriched" },
  { value: "name", label: "Name" },
  { value: "company", label: "Company" },
];

export default function JobContactsView() {
  const [contacts, setContacts] = useState<JobContact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "poster" | "priority">("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      params.set("page", String(p));
      params.set("perPage", String(PER_PAGE));
      const data = await api.get<{ contacts: JobContact[]; total: number }>(`/api/job-leads/contacts/all?${params.toString()}`);
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (e: any) {
      setError(e.message || "Failed to load contacts.");
    } finally {
      setLoading(false);
    }
  }, [search, sourceFilter, sortBy, sortDir]);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.ceil(total / PER_PAGE) || 1;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Job Contacts</h1>
          <div className="page-sub">{total.toLocaleString()} enriched contact{total !== 1 ? "s" : ""} across job leads</div>
        </div>
      </div>

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input className="input" placeholder="Search name, email, company…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 220, flex: "1 1 220px" }} />
        <select className="input" value={sourceFilter} onChange={e => setSourceFilter(e.target.value as any)} style={{ maxWidth: 160 }}>
          <option value="all">All sources</option>
          <option value="poster">Job Poster</option>
          <option value="priority">Title Match</option>
        </select>
        <span className="field-label" style={{ margin: 0 }}>Sort by</span>
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ maxWidth: 160 }}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="icon-btn" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>
          {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
      </div>

      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <span className="spinner spinner-dark" />
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>Loading contacts...</div>
        </div>
      ) : contacts.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Title</th><th>Company</th><th>Source</th>
                  <th>Email</th><th>Lead Status</th><th>Enriched</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.name || "—"}</div>
                      {c.linkedinUrl && (
                        <a href={c.linkedinUrl} target="_blank" rel="noreferrer" title="LinkedIn"
                          style={{ display: "inline-flex", alignItems: "center", color: "#0a66c2", textDecoration: "none" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                        </a>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{c.title || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      <div>{c.leadCompany || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--dim)" }}>{c.leadJobTitle}</div>
                    </td>
                    <td>
                      <span className={c.source === "poster" ? "chip chip-green" : "chip"} style={{ fontSize: 10 }}>
                        {c.source === "poster" ? "Job Poster" : "Title Match"}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {c.email
                        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span className="chip chip-blue" style={{ fontSize: 11 }}>{c.email}</span>
                            <CopyBtn text={c.email} />
                          </span>
                        : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <span className="chip" style={{ fontSize: 10 }}>{c.leadStatus}</span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => load(page - 1)} disabled={page <= 1 || loading}>← Prev</button>
              <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>Page {page} / {totalPages}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => load(page + 1)} disabled={page >= totalPages || loading}>Next →</button>
            </div>
          )}
        </>
      ) : (
        !loading && (
          <div className="empty">
            <div className="empty-title">No enriched job contacts yet</div>
            <div style={{ fontSize: 13, color: "var(--dim)" }}>Find and enrich candidates from a job lead's Contact tab to see them here.</div>
          </div>
        )
      )}
    </div>
  );
}
