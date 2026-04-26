"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";

type LogEntry = {
  id: number;
  method: string;
  path: string;
  queryString?: string;
  requestBody?: string;
  statusCode: number;
  responseBody?: string;
  durationMs: number;
  error?: string;
  createdAt: string;
};

type PagedResult = {
  items: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const METHOD_COLORS: Record<string, string> = {
  GET: "#16a34a", POST: "#2563eb", PUT: "#d97706", DELETE: "#dc2626", PATCH: "#7c3aed",
};

const STATUS_COLOR = (s: number) => {
  if (s >= 500) return { color: "#dc2626", bg: "#fee2e2" };
  if (s >= 400) return { color: "#d97706", bg: "#fffbeb" };
  if (s >= 300) return { color: "#7c3aed", bg: "#f5f3ff" };
  return { color: "#16a34a", bg: "#dcfce7" };
};

function tryPrettyJson(s?: string) {
  if (!s) return "";
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

export default function LogsView() {
  const [data, setData] = useState<PagedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [clearing, setClearing] = useState(false);

  // Filters
  const [method, setMethod] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: "50" });
      if (method) params.set("method", method);
      if (pathFilter) params.set("path", pathFilter);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res: any = await api.get(`/api/logs?${params}`);
      setData(res);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [method, pathFilter, status, from, to, page]);

  useEffect(() => { load(1); setPage(1); }, [method, pathFilter, status, from, to]);
  useEffect(() => { load(page); }, [page]);

  // Auto-refresh every 5s
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(1), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const handleClear = async () => {
    if (!confirm("Clear all logs?")) return;
    setClearing(true);
    try { await api.del("/api/logs", {}); load(1); } catch (e: any) { setError(e.message); }
    finally { setClearing(false); }
  };

  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " +
      dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">API Logs</div>
          <div className="page-sub">{data ? `${data.total.toLocaleString()} total entries` : "Loading..."}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => load(page)} disabled={loading}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh
          </button>
          <button className="btn btn-sm" onClick={handleClear} disabled={clearing} style={{ background: "var(--red-light)", color: "var(--red)", border: "1px solid #fecaca" }}>
            {clearing ? <span className="spinner spinner-dark" /> : null}
            Clear All
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <div>
            <div className="field-label">Method</div>
            <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
              <option value="">All</option>
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Path contains</div>
            <input className="input" placeholder="/api/proposals" value={pathFilter} onChange={e => setPathFilter(e.target.value)} />
          </div>
          <div>
            <div className="field-label">Status Code</div>
            <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="200">200</option>
              <option value="201">201</option>
              <option value="400">400</option>
              <option value="401">401</option>
              <option value="404">404</option>
              <option value="500">500</option>
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
            <button className="btn btn-ghost btn-sm" style={{ width: "100%" }} onClick={() => { setMethod(""); setPathFilter(""); setStatus(""); setFrom(""); setTo(""); }}>
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
                  <th style={th}>Time</th>
                  <th style={th}>Method</th>
                  <th style={th}>Path</th>
                  <th style={th}>Status</th>
                  <th style={th}>Duration</th>
                  <th style={th} className="hide-mobile">Error</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((log, i) => {
                  const sc = STATUS_COLOR(log.statusCode);
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelected(selected?.id === log.id ? null : log)}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                        background: selected?.id === log.id ? "var(--accent-light)" : i % 2 === 0 ? "white" : "#fafafa",
                      }}
                    >
                      <td style={td}>{fmt(log.createdAt)}</td>
                      <td style={td}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: METHOD_COLORS[log.method] || "var(--muted)", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>
                          {log.method}
                        </span>
                      </td>
                      <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span title={log.path + (log.queryString || "")}>{log.path}{log.queryString ? <span style={{ color: "var(--muted)" }}>{log.queryString}</span> : null}</span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, color: sc.color, background: sc.bg }}>
                          {log.statusCode}
                        </span>
                      </td>
                      <td style={{ ...td, color: log.durationMs > 1000 ? "var(--red)" : log.durationMs > 300 ? "var(--orange)" : "var(--green)" }}>
                        {log.durationMs}ms
                      </td>
                      <td style={{ ...td, color: "var(--red)", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="hide-mobile">
                        {log.error || ""}
                      </td>
                    </tr>
                  );
                })}
                {data?.items.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No logs found.</td></tr>
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

      {/* Detail panel */}
      {selected && (
        <div style={{ marginTop: 20 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: METHOD_COLORS[selected.method] }}>{selected.method}</span>
                <span style={{ fontSize: 13, fontFamily: "monospace" }}>{selected.path}{selected.queryString}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, color: STATUS_COLOR(selected.statusCode).color, background: STATUS_COLOR(selected.statusCode).bg }}>{selected.statusCode}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{selected.durationMs}ms · {fmt(selected.createdAt)}</span>
              </div>
              <button className="icon-btn" onClick={() => setSelected(null)}>✕</button>
            </div>

            {selected.error && (
              <div style={{ padding: "10px 18px", background: "#fee2e2", color: "var(--red)", fontSize: 13, borderBottom: "1px solid #fecaca" }}>
                ⚠ {selected.error}
              </div>
            )}

            {/* Body panels */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {/* Request */}
              <div style={{ borderRight: "1px solid var(--border)" }}>
                <div style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                  Request Body
                </div>
                <pre style={{
                  margin: 0, padding: "14px 16px", fontSize: 11, lineHeight: 1.6,
                  overflowX: "auto", overflowY: "auto", maxHeight: 400,
                  background: "#0f172a", color: "#e2e8f0", fontFamily: "monospace",
                }}>
                  {tryPrettyJson(selected.requestBody) || <span style={{ color: "#475569" }}>(empty)</span>}
                </pre>
              </div>
              {/* Response */}
              <div>
                <div style={{ padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                  Response Body
                </div>
                <pre style={{
                  margin: 0, padding: "14px 16px", fontSize: 11, lineHeight: 1.6,
                  overflowX: "auto", overflowY: "auto", maxHeight: 400,
                  background: "#0f172a", color: "#e2e8f0", fontFamily: "monospace",
                }}>
                  {tryPrettyJson(selected.responseBody) || <span style={{ color: "#475569" }}>(empty)</span>}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 14px", verticalAlign: "middle" };
