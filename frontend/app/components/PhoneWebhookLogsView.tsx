"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

type LogEntry = {
  id: string;
  source: string;
  entityId: string;
  phones: string[];
  waSent: boolean;
  waResult: string | null;
  waPickedAt: string | null;
  processedAt: string | null;
  createdAt: string;
  contactName: string;
  contactCompany: string;
};

type PagedResult = {
  items: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const fmt = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  return (
    dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " +
    dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );
};

const WaResultBadge = ({ result, sent }: { result: string | null; sent: boolean }) => {
  if (!result) return <span style={badge("#6b7280", "#f3f4f6")}>Pending</span>;
  if (result === "no_phone") return <span style={badge("#6b7280", "#f3f4f6")}>No Phone</span>;
  if (result === "sent" || sent) return <span style={badge("#16a34a", "#dcfce7")}>✓ Sent</span>;
  if (result.startsWith("failed:")) return <span style={badge("#dc2626", "#fee2e2")} title={result}>✗ Failed</span>;
  return <span style={badge("#d97706", "#fffbeb")}>{result}</span>;
};

function badge(color: string, bg: string): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, color, background: bg, whiteSpace: "nowrap" };
}

export default function PhoneWebhookLogsView() {
  const [data, setData] = useState<PagedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Filters
  const [source, setSource] = useState("");
  const [waFilter, setWaFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: "50" });
      if (source)   params.set("source", source);
      if (waFilter) params.set("waResult", waFilter);
      if (from)     params.set("from", from);
      if (to)       params.set("to", to);
      const res: any = await api.get(`/api/phone-webhook-logs?${params}`);
      setData(res);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [source, waFilter, from, to, page]);

  useEffect(() => { load(1); setPage(1); }, [source, waFilter, from, to]);
  useEffect(() => { load(page); }, [page]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(1), 10_000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Phone Webhook Logs</div>
          <div className="page-sub">
            {data ? `${data.total.toLocaleString()} events` : "Loading..."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => load(page)} disabled={loading}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <div>
            <div className="field-label">Source</div>
            <select className="input" value={source} onChange={e => setSource(e.target.value)}>
              <option value="">All</option>
              <option value="lead">Lead</option>
              <option value="contact">Contact</option>
            </select>
          </div>
          <div>
            <div className="field-label">WA Status</div>
            <select className="input" value={waFilter} onChange={e => setWaFilter(e.target.value)}>
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="no_phone">No Phone</option>
            </select>
          </div>
          <div>
            <div className="field-label">From</div>
            <input className="input" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="field-label">To</div>
            <input className="input" type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-ghost btn-sm" style={{ width: "100%" }}
              onClick={() => { setSource(""); setWaFilter(""); setFrom(""); setTo(""); }}>
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading && !data ? (
        <div style={{ textAlign: "center", padding: 40 }}><span className="spinner spinner-dark" /></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>Contact</th>
                  <th style={th}>Phone Received</th>
                  <th style={th}>Phone Number(s)</th>
                  <th style={th}>Picked for WA</th>
                  <th style={th}>WA Sent At</th>
                  <th style={th}>WA Status</th>
                  <th style={th}>Source</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((log, i) => (
                  <tr
                    key={log.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "white" : "#fafafa",
                    }}
                  >
                    {/* Contact */}
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: "var(--fg)" }}>
                        {log.contactName || <span style={{ color: "var(--muted)" }}>Unknown</span>}
                      </div>
                      {log.contactCompany && (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{log.contactCompany}</div>
                      )}
                    </td>

                    {/* Phone received timestamp */}
                    <td style={td}>
                      <div style={{ color: "var(--fg)" }}>{fmt(log.createdAt)}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>webhook arrived</div>
                    </td>

                    {/* Phone numbers */}
                    <td style={td}>
                      {log.phones.map((ph, idx) => (
                        <div key={idx} style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#2563eb" }}>
                          {ph}
                        </div>
                      ))}
                    </td>

                    {/* Picked for WA */}
                    <td style={td}>
                      {log.waPickedAt ? (
                        <>
                          <div style={{ color: "var(--fg)" }}>{fmt(log.waPickedAt)}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                            +{Math.round((new Date(log.waPickedAt).getTime() - new Date(log.createdAt).getTime()) / 1000)}s after receipt
                          </div>
                        </>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>

                    {/* WA sent at */}
                    <td style={td}>
                      {log.processedAt ? (
                        <>
                          <div style={{ color: "var(--fg)" }}>{fmt(log.processedAt)}</div>
                          {log.waPickedAt && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              +{Math.round((new Date(log.processedAt).getTime() - new Date(log.waPickedAt).getTime()) / 1000)}s to send
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "var(--orange)", fontSize: 11 }}>Queued…</span>
                      )}
                    </td>

                    {/* WA status */}
                    <td style={td}>
                      <WaResultBadge result={log.waResult} sent={log.waSent} />
                      {log.waResult?.startsWith("failed:") && (
                        <div style={{ fontSize: 10, color: "var(--red)", marginTop: 3, maxWidth: 160, wordBreak: "break-word" }}>
                          {log.waResult.replace("failed:", "")}
                        </div>
                      )}
                    </td>

                    {/* Source */}
                    <td style={td}>
                      <span style={badge(log.source === "lead" ? "#7c3aed" : "#0891b2", log.source === "lead" ? "#f5f3ff" : "#ecfeff")}>
                        {log.source}
                      </span>
                    </td>
                  </tr>
                ))}
                {data?.items.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
                      No phone webhook events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(1)} disabled={page === 1}>«</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={{ padding: "5px 12px", fontSize: 13, color: "var(--muted)" }}>Page {page} of {data.totalPages}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>Next →</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(data.totalPages)} disabled={page === data.totalPages}>»</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 14px", verticalAlign: "middle" };
