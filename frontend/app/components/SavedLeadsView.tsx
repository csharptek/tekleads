"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

interface Lead {
  id: string;
  apolloId?: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  emails: string[];
  phones: string[];
  linkedinUrl?: string;
  savedAt: string;
}

const PER_PAGE = 50;

const SORT_OPTIONS = [
  { value: "saved_at", label: "Date Saved" },
  { value: "name", label: "Name" },
  { value: "company", label: "Company" },
  { value: "title", label: "Title" },
  { value: "industry", label: "Industry" },
  { value: "location", label: "Location" },
];

function WaLink({ phone, message, name }: { phone: string; message: string; name: string }) {
  const clean = phone.replace(/\D/g, "");
  const text = message
    .replace("{name}", name)
    .replace("{phone}", phone);
  const url = `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="chip chip-green" style={{ fontSize: 11, textDecoration: "none", cursor: "pointer" }}
      title="Open WhatsApp">
      💬 {phone}
    </a>
  );
}

export default function SavedLeadsView() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [waTemplate, setWaTemplate] = useState("Hi {name}, I'd love to connect!");
  const [banner, setBanner] = useState<{ kind: "error"|"success"|"info"; text: string } | null>(null);

  const [filters, setFilters] = useState({
    name: "", company: "", title: "", industry: "",
    country: "", state: "", hasPhone: "", hasEmail: "",
    savedAfter: "", savedBefore: "",
  });
  const [sortBy, setSortBy] = useState("saved_at");
  const [sortDir, setSortDir] = useState("desc");

  const f = (k: keyof typeof filters, v: string) => setFilters(p => ({ ...p, [k]: v }));

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), perPage: String(PER_PAGE), sortBy, sortDir });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const data = await api.get<{ leads: Lead[]; total: number }>(`/api/saved-leads?${params}`);
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setLoading(false); }
  }, [filters, sortBy, sortDir]);

  useEffect(() => {
    // Load WA template from settings
    api.get<{ values: Record<string, string>; isSet: Record<string, boolean> }>("/api/settings")
      .then(d => {
        const t = d.values?.whatsapp_message_template;
        if (t) setWaTemplate(t);
      }).catch(() => {});
    load(1);
  }, []);

  const onDelete = async (id: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/saved-leads/${id}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error('Delete failed'); });
      setLeads(p => p.filter(l => l.id !== id));
      setTotal(p => p - 1);
      setBanner({ kind: "success", text: "Removed." });
    } catch (e: any) { setBanner({ kind: "error", text: e.message }); }
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Saved Prospects</h1>
          <div className="page-sub">{total.toLocaleString()} total · WhatsApp links auto-open with pre-filled message</div>
        </div>
        <button className="btn btn-primary" onClick={() => load(1)} disabled={loading}>
          {loading ? <span className="spinner" /> : "🔍"} Search
        </button>
      </div>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="card-title">Filters</div>
        <div className="grid-3" style={{ marginBottom: 12 }}>
          {([
            ["name", "Name", "e.g. John"],
            ["company", "Company", "e.g. Acme"],
            ["title", "Job Title", "e.g. CTO"],
            ["industry", "Industry", "e.g. SaaS"],
            ["country", "Country", "e.g. India"],
            ["state", "State / City", "e.g. Chennai"],
          ] as [keyof typeof filters, string, string][]).map(([k, label, ph]) => (
            <div key={k}>
              <div className="field-label">{label}</div>
              <input className="input" placeholder={ph} value={filters[k]}
                onChange={e => f(k, e.target.value)}
                onKeyDown={e => e.key === "Enter" && load(1)} />
            </div>
          ))}
        </div>
        <div className="grid-3">
          <div>
            <div className="field-label">Has Phone</div>
            <select className="input" value={filters.hasPhone} onChange={e => f("hasPhone", e.target.value)}>
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <div className="field-label">Has Email</div>
            <select className="input" value={filters.hasEmail} onChange={e => f("hasEmail", e.target.value)}>
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <div className="field-label">Saved After</div>
            <input className="input" type="date" value={filters.savedAfter}
              onChange={e => f("savedAfter", e.target.value)} />
          </div>
          <div>
            <div className="field-label">Saved Before</div>
            <input className="input" type="date" value={filters.savedBefore}
              onChange={e => f("savedBefore", e.target.value)} />
          </div>
          <div>
            <div className="field-label">Sort By</div>
            <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Direction</div>
            <select className="input" value={sortDir} onChange={e => setSortDir(e.target.value)}>
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => load(1)} disabled={loading}>Apply Filters</button>
          <button className="btn btn-ghost" onClick={() => {
            setFilters({ name: "", company: "", title: "", industry: "", country: "", state: "", hasPhone: "", hasEmail: "", savedAfter: "", savedBefore: "" });
            setSortBy("saved_at"); setSortDir("desc");
          }}>Clear</button>
        </div>
      </div>

      {/* WA Template preview */}
      <div className="card" style={{ background: "var(--accent-light)", borderColor: "#bfdbfe" }}>
        <div className="card-title" style={{ color: "var(--accent)" }}>WhatsApp Message Template</div>
        <div style={{ fontSize: 12, color: "var(--accent-text)" }}>
          Configure in Settings → WhatsApp Message Template. Variables: <code>{"{name}"}</code> <code>{"{phone}"}</code>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, fontStyle: "italic", color: "var(--text)" }}>"{waTemplate}"</div>
      </div>

      {/* Table */}
      {leads.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Industry</th>
                  <th>Location</th>
                  <th>Email</th>
                  <th>Phone (WhatsApp)</th>
                  <th>Saved</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{lead.name || "—"}</div>
                      {lead.linkedinUrl && (
                        <a href={lead.linkedinUrl} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: "var(--accent)" }}>LinkedIn ↗</a>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.title || "—"}</td>
                    <td style={{ fontSize: 12 }}>{lead.company || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.industry || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lead.location || "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {lead.emails?.[0]
                        ? <span className="chip chip-blue" style={{ fontSize: 11 }}>{lead.emails[0]}</span>
                        : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {lead.phones?.[0]
                        ? <WaLink phone={lead.phones[0]} message={waTemplate} name={lead.name} />
                        : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>
                      {new Date(lead.savedAt).toLocaleDateString()}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
                        onClick={() => onDelete(lead.id)}>✕</button>
                    </td>
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
            <div className="empty-title">No prospects found</div>
            <div style={{ fontSize: 13, color: "var(--dim)" }}>Save leads from Lead Search to see them here</div>
          </div>
        )
      )}
    </div>
  );
}
