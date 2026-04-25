"use client";
import { useState, useEffect } from "react";
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
}

interface SearchResult { leads: Lead[]; total: number; }

const PER_PAGE = 25;

function WaLink({ phone, message, name }: { phone: string; message: string; name: string }) {
  const clean = phone.replace(/\D/g, "");
  const text = message.replace("{name}", name).replace("{phone}", phone);
  const url = `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="chip chip-green" style={{ fontSize: 11, textDecoration: "none", cursor: "pointer" }}
      title="Open WhatsApp">
      💬 {phone}
    </a>
  );
}

export default function LeadSearchView() {
  const [form, setForm] = useState({ name: "", title: "", company: "", industry: "", location: "" });
  const [results, setResults] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [phonePending, setPhonePending] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<{ kind: "error"|"success"|"info"; text: string } | null>(null);
  const [searched, setSearched] = useState(false);
  const [enrichConfirm, setEnrichConfirm] = useState<Lead | null>(null);
  const [waTemplate, setWaTemplate] = useState("Hi {name}, I'd love to connect!");

  useEffect(() => {
    api.get<{ values: Record<string, string> }>("/api/settings")
      .then(d => { if (d.values?.whatsapp_message_template) setWaTemplate(d.values.whatsapp_message_template); })
      .catch(() => {});
  }, []);

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const doSearch = async (p: number) => {
    setSearching(true); setBanner(null); setSelected(new Set());
    try {
      const data = await api.post<SearchResult>("/api/leads/search", { ...form, page: p, perPage: PER_PAGE });
      setResults(data.leads || []);
      setTotal(data.total || 0);
      setPage(p);
      setSearched(true);
      if ((data.leads || []).length === 0)
        setBanner({ kind: "info", text: "No results. Try broader filters." });
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setSearching(false); }
  };

  const toggleSelect = (id: string) =>
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected(selected.size === results.length ? new Set() : new Set(results.map(l => l.id)));

  const onSave = async () => {
    const toSave = results.filter(l => selected.has(l.id));
    if (!toSave.length) { setBanner({ kind: "info", text: "Select leads to save." }); return; }
    setSaving(true); setBanner(null);
    try {
      const res = await api.post<{ saved: number }>("/api/leads/save", toSave);
      setBanner({ kind: "success", text: `${res.saved} lead(s) saved to Prospects.` });
      setSelected(new Set());
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setSaving(false); }
  };

  const doEnrich = async (lead: Lead) => {
    setEnrichConfirm(null);
    if (!lead.apolloId) { setBanner({ kind: "info", text: "No Apollo ID — cannot enrich." }); return; }
    setRevealingId(lead.id); setBanner(null);
    try {
      await api.post("/api/leads/save", [lead]);
      const res = await api.post<{ emails: string[]; phones: string[]; fullName?: string; location?: string; autoSaved: boolean; phoneWebhookPending?: boolean }>(
        `/api/leads/${lead.id}/reveal-phone`, {});

      setResults(prev => prev.map(l => l.id === lead.id
        ? {
            ...l,
            name:     res.fullName  && res.fullName.trim()  ? res.fullName  : l.name,
            location: res.location  && res.location.trim()  ? res.location  : l.location,
            emails:   res.emails.length  ? res.emails  : l.emails,
            phones:   res.phones.length  ? res.phones  : l.phones,
          }
        : l));

      if (res.phoneWebhookPending) {
        setPhonePending(p => new Set([...p, lead.id]));
        setBanner({ kind: "info", text: `Phone request sent — polling…` });
        const leadId = lead.id;
        let attempts = 0;
        const timer = setInterval(async () => {
          attempts++;
          try {
            const updated = await api.get<Lead>(`/api/leads/${leadId}`);
            if (updated.phones && updated.phones.length > 0) {
              clearInterval(timer);
              setPhonePending(p => { const n = new Set(p); n.delete(leadId); return n; });
              setResults(prev => prev.map(l => l.id === leadId ? { ...l, phones: updated.phones } : l));
              setBanner({ kind: "success", text: `Phone: ${updated.phones[0]} — saved.` });
            }
          } catch { }
          if (attempts >= 24) { clearInterval(timer); setPhonePending(p => { const n = new Set(p); n.delete(leadId); return n; }); }
        }, 5000);
      } else if (res.phones.length > 0) {
        setBanner({ kind: "success", text: `Phone: ${res.phones.join(", ")} — auto-saved.` });
      } else if (res.emails.length > 0) {
        setBanner({ kind: "success", text: `Email: ${res.emails[0]} — saved.` });
      }
    } catch (e: any) {
      setBanner({ kind: "error", text: e.message });
    } finally { setRevealingId(null); }
  };

  const totalPages = Math.ceil(total / PER_PAGE);
  const allSelected = results.length > 0 && selected.size === results.length;

  return (
    <div className="page">
      {enrichConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: 380, margin: 0 }}>
            <div className="card-title">⚠ Enrich uses Apollo credits</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.6 }}>
              Enriching <strong>{enrichConfirm.name}</strong> consumes credits. Phone reveal is async.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEnrichConfirm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => doEnrich(enrichConfirm)}>Yes, Enrich</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Search</h1>
          <div className="page-sub">Search free · Enrich uses Apollo credits · Phone links open WhatsApp</div>
        </div>
        {selected.size > 0 && (
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {saving ? "Saving..." : `Save ${selected.size} Lead${selected.size > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      <div className="card">
        <div className="card-title">Search Filters</div>
        <div className="card-sub">No credits consumed · Similar matches included</div>
        <div className="grid-3">
          {([
            ["name",     "Person Name",  "e.g. John Wright"],
            ["title",    "Job Title",    "e.g. CTO"],
            ["company",  "Company",      "e.g. Acme Corp"],
            ["industry", "Industry",     "e.g. Software"],
            ["location", "Location",     "e.g. London"],
          ] as [keyof typeof form, string, string][]).map(([k, label, ph]) => (
            <div key={k}>
              <div className="field-label">{label}</div>
              <input className="input" placeholder={ph} value={form[k]}
                onChange={e => f(k, e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(1)} />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => doSearch(1)} disabled={searching}>
              {searching ? <><span className="spinner" />&nbsp;Searching…</> : "Search Apollo"}
            </button>
          </div>
        </div>
      </div>

      {searched && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {total > 0 ? `${total.toLocaleString()} total · page ${page} of ${totalPages}` : "No results"}
            </div>
            {results.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          {results.length > 0 && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                      <th>Name</th>
                      <th>Title</th>
                      <th>Company</th>
                      <th>Location</th>
                      <th>Email</th>
                      <th>Phone (WhatsApp)</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(lead => (
                      <tr key={lead.id} className={selected.has(lead.id) ? "selected" : ""}>
                        <td><input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelect(lead.id)} /></td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{lead.name || "—"}</div>
                          {lead.linkedinUrl && (
                            <a href={lead.linkedinUrl} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: "var(--accent)" }}>LinkedIn ↗</a>
                          )}
                        </td>
                        <td style={{ color: "var(--muted)", fontSize: 12 }}>{lead.title || "—"}</td>
                        <td style={{ fontSize: 12 }}>{lead.company || "—"}</td>
                        <td style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>{lead.location || "—"}</td>
                        <td style={{ fontSize: 12 }}>
                          {lead.emails?.[0]
                            ? <span className="chip chip-blue" style={{ fontSize: 11 }}>{lead.emails[0]}</span>
                            : <span style={{ color: "var(--dim)" }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {lead.phones?.[0]
                            ? <WaLink phone={lead.phones[0]} message={waTemplate} name={lead.name} />
                            : phonePending.has(lead.id)
                              ? <span className="chip chip-orange">pending…</span>
                              : <span style={{ color: "var(--dim)" }}>—</span>}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEnrichConfirm(lead)}
                            disabled={revealingId === lead.id} title="Uses Apollo credits">
                            {revealingId === lead.id ? <span className="spinner spinner-dark" /> : "Enrich"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 16 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => doSearch(page - 1)} disabled={page <= 1 || searching}>← Prev</button>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Page {page} / {totalPages}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => doSearch(page + 1)} disabled={page >= totalPages || searching}>Next →</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
