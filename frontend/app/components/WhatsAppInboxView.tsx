"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api, API_BASE } from "../../lib/api";

function proxyMedia(url: string | null) {
  if (!url) return null;
  return `${API_BASE}/api/whatsapp/media?url=${encodeURIComponent(url)}`;
}

interface Thread {
  phone: string;
  contactName: string | null;
  lastMessage: string | null;
  lastTemplate: string | null;
  lastAt: string;
  messageCount: number;
  unreadCount: number;
  isHotLead: boolean;
  hasInbound: boolean;
  lastOutboundStatus: string | null;
}

interface InboxPage {
  items: Thread[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  toPhone: string;
  fromPhone: string;
  messageType: string;
  templateName: string | null;
  body: string | null;
  wamid: string | null;
  status: string;
  errorMessage: string | null;
  mediaUrl: string | null;
  mediaCaption: string | null;
  createdAt: string;
}

interface Props {
  inboxType?: "sales" | "hr";
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

function dateGroupLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return "Today";
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

// WhatsApp-style status ticks
function StatusTick({ status }: { status: string | null }) {
  if (!status) return null;
  if (status === "failed" || status === "undelivered") {
    return <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 2 }} title="Not delivered">✗</span>;
  }
  if (status === "read") {
    return <span style={{ fontSize: 12, color: "#34d399", fontWeight: 700, marginLeft: 2 }} title="Read">✓✓</span>;
  }
  if (status === "delivered") {
    return <span style={{ fontSize: 12, color: "#374151", fontWeight: 700, marginLeft: 2 }} title="Delivered">✓✓</span>;
  }
  if (status === "sent" || status === "queued") {
    return <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginLeft: 2 }} title="Sent">✓</span>;
  }
  return null;
}

export default function WhatsAppInboxView({ inboxType = "sales" }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachType, setAttachType] = useState("document");
  const [attachCaption, setAttachCaption] = useState("");
  const [attachUploading, setAttachUploading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Thread[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const loadInbox = async (resetPage = true) => {
    const p = resetPage ? 1 : page;
    if (resetPage) setLoading(true);
    try {
      const data = await api.get<InboxPage>(`/api/whatsapp/inbox?inbox=${inboxType}&page=${p}&pageSize=50`);
      if (data) {
        if (resetPage) {
          setThreads(data.items || []);
          setPage(1);
        } else {
          setThreads(prev => [...prev, ...(data.items || [])]);
        }
        setTotal(data.total);
        setHasMore(data.hasMore);
      }
    } catch { }
    setLoading(false);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const data = await api.get<InboxPage>(`/api/whatsapp/inbox?inbox=${inboxType}&page=${nextPage}&pageSize=50`);
      if (data) {
        setThreads(prev => [...prev, ...(data.items || [])]);
        setPage(nextPage);
        setHasMore(data.hasMore);
        setTotal(data.total);
      }
    } catch { }
    setLoadingMore(false);
  };

  const loadConversation = async (phone: string) => {
    setMsgLoading(true);
    try {
      const data = await api.get<Message[]>(`/api/whatsapp/conversation/${phone}`);
      setMessages(data || []);
    } catch { }
    setMsgLoading(false);
  };

  useEffect(() => { loadInbox(); }, [inboxType]);

  useEffect(() => {
    if (selected) loadConversation(selected.phone);
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Search with debounce
  useEffect(() => {
    if (!showSearch) { setSearchResults(null); return; }
    if (!searchQ.trim()) { setSearchResults(null); return; }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get<Thread[]>(`/api/whatsapp/conversations/search?q=${encodeURIComponent(searchQ)}&inbox=${inboxType}`);
        setSearchResults(data || []);
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 400);
  }, [searchQ, showSearch, inboxType]);

  const toggleHotLead = async (t: Thread, isHot: boolean) => {
    try {
      await api.patch(`/api/whatsapp/conversations/${t.phone}/hot-lead`, { isHot });
      // Update local state
      setThreads(prev => prev.map(x => x.phone === t.phone ? { ...x, isHotLead: isHot } : x));
      if (selected?.phone === t.phone) setSelected(s => s ? { ...s, isHotLead: isHot } : s);
    } catch { }
  };

  const sendAttachment = async () => {
    if (!selected || !attachFile) return;
    setSending(true); setAttachUploading(true); setSendResult(null);
    try {
      const formData = new FormData();
      formData.append("file", attachFile);
      const uploadJson = await api.upload<{ url: string; name: string }>("/api/blob/upload", formData);
      const fileUrl: string = uploadJson.url;
      const res = await api.post<any>("/api/whatsapp/send-attachment", {
        to: selected.phone, fileUrl, attachmentType: attachType,
        caption: attachCaption.trim() || undefined, filename: attachFile.name,
      });
      if (res?.ok) {
        setSendResult({ ok: true, msg: "Attachment sent" });
        setAttachFile(null); setAttachCaption(""); setShowAttach(false);
        if (attachInputRef.current) attachInputRef.current.value = "";
      } else {
        setSendResult({ ok: false, msg: res?.error || "Failed" });
      }
      await loadConversation(selected.phone);
      await loadInbox();
    } catch (e: any) { setSendResult({ ok: false, msg: e?.message || "Error" }); }
    setSending(false); setAttachUploading(false);
  };

  const sendReply = async (mode: "text" | "template") => {
    if (!selected) return;
    if (mode === "text" && !replyText.trim()) return;
    setSending(true); setSendResult(null);
    try {
      if (mode === "text") {
        const res = await api.post<any>("/api/whatsapp/send-text", { to: selected.phone, body: replyText.trim() });
        if (res?.ok) { setSendResult({ ok: true, msg: "Sent" }); setReplyText(""); }
        else setSendResult({ ok: false, msg: res?.error || "Failed (free-form only works within 24hr reply window)" });
      } else {
        const res = await api.post<any>("/api/whatsapp/send-template", { to: selected.phone, templateName: "csharptek_intro_v2", languageCode: "en" });
        if (res?.ok) setSendResult({ ok: true, msg: "Template sent" });
        else setSendResult({ ok: false, msg: res?.error || "Failed" });
      }
      await loadConversation(selected.phone);
      await loadInbox();
    } catch (e: any) { setSendResult({ ok: false, msg: e?.message || "Error" }); }
    setSending(false);
  };

  // Group non-hot threads by date
  const hotThreads = threads.filter(t => t.isHotLead);
  const normalThreads = threads.filter(t => !t.isHotLead);

  const groupedNormal: { label: string; items: Thread[] }[] = [];
  for (const t of normalThreads) {
    const label = dateGroupLabel(t.lastAt);
    const existing = groupedNormal.find(g => g.label === label);
    if (existing) existing.items.push(t);
    else groupedNormal.push({ label, items: [t] });
  }

  const displayThreads = searchResults !== null ? searchResults : null;

  const renderThread = (t: Thread, showHotControls = false) => (
    <div key={t.phone}
      onClick={() => { setSelected(t); setSendResult(null); }}
      style={{
        padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)",
        background: selected?.phone === t.phone ? "var(--primary-light, #eff6ff)" : "transparent",
        transition: "background 0.1s"
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 5 }}>
          {t.isHotLead && <span style={{ fontSize: 11 }}>🔥</span>}
          {t.contactName || `+${t.phone}`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <StatusTick status={t.lastOutboundStatus} />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{fmtTime(t.lastAt)}</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {t.lastMessage || (t.lastTemplate ? `Template: ${t.lastTemplate}` : "—")}
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{t.messageCount} msg{t.messageCount !== 1 ? "s" : ""}</span>
          {t.unreadCount > 0 && (
            <span style={{ background: "#25D366", color: "white", borderRadius: 999, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
              {t.unreadCount} reply
            </span>
          )}
        </div>
        {showHotControls && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10, padding: "2px 6px", color: "var(--muted)" }}
            onClick={e => { e.stopPropagation(); toggleHotLead(t, false); }}
            title="Remove from Hot Leads"
          >
            ✕ Remove
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="page" style={{ padding: 0, display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Thread list */}
      <div style={{ width: isMobile ? "100%" : 300, minWidth: isMobile ? "unset" : 240, borderRight: "1px solid var(--border)", display: isMobile && selected ? "none" : "flex", flexDirection: "column", background: "var(--surface)" }}>
        {/* Header */}
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showSearch ? 8 : 0 }}>
            <div>
              <div className="page-title" style={{ fontSize: 15, margin: 0 }}>
                {inboxType === "hr" ? "HR Inbox" : "WA Inbox"}
              </div>
              <div className="page-sub" style={{ fontSize: 11 }}>{total} conversations</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowSearch(v => {
                    if (!v) setTimeout(() => searchInputRef.current?.focus(), 50);
                    else { setSearchQ(""); setSearchResults(null); }
                    return !v;
                  });
                }}
                title="Search"
                style={{ color: showSearch ? "var(--primary)" : undefined }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => loadInbox()} title="Refresh">↻</button>
            </div>
          </div>
          {showSearch && (
            <input
              ref={searchInputRef}
              className="input"
              style={{ width: "100%", fontSize: 12, boxSizing: "border-box", padding: "6px 10px" }}
              placeholder="Search name or number…"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading…</div>}

          {/* Search results */}
          {showSearch && searchQ.trim() && (
            <>
              {searching && <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>Searching…</div>}
              {!searching && searchResults !== null && searchResults.length === 0 && (
                <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>No results</div>
              )}
              {!searching && searchResults && searchResults.map(t => renderThread(t, t.isHotLead))}
            </>
          )}

          {/* Normal inbox (when not searching) */}
          {!(showSearch && searchQ.trim()) && !loading && threads.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No messages yet.<br />Send a template from Artifacts to get started.
            </div>
          )}

          {!(showSearch && searchQ.trim()) && !loading && (
            <>
              {/* Hot Leads section */}
              {hotThreads.length > 0 && (
                <>
                  <div style={{ padding: "8px 14px 4px", fontSize: 11, fontWeight: 700, color: "#ef4444", borderBottom: "1px solid var(--border)", background: "#fff7f7", letterSpacing: "0.04em" }}>
                    🔥 HOT LEADS ({hotThreads.length})
                  </div>
                  {hotThreads.map(t => renderThread(t, true))}
                </>
              )}

              {/* Date groups */}
              {groupedNormal.map(group => (
                <div key={group.label}>
                  <div style={{ padding: "7px 14px 4px", fontSize: 11, fontWeight: 600, color: "var(--muted)", background: "var(--surface2, #f8fafc)", borderBottom: "1px solid var(--border)", borderTop: hotThreads.length > 0 || group !== groupedNormal[0] ? "1px solid var(--border)" : undefined, letterSpacing: "0.03em" }}>
                    {group.label}
                  </div>
                  {group.items.map(t => renderThread(t, false))}
                </div>
              ))}

              {hasMore && (
                <div style={{ padding: "12px 14px", textAlign: "center" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={loadMore}
                    disabled={loadingMore}
                    style={{ width: "100%", fontSize: 12 }}
                  >
                    {loadingMore ? "Loading…" : `Load more (${total - threads.length} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Conversation panel */}
      <div style={{ flex: 1, display: isMobile && !selected ? "none" : "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selected ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 14 }}>
            Select a conversation
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, background: "var(--surface)" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                  {selected.isHotLead && <span>🔥</span>}
                  {selected.contactName || `+${selected.phone}`}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>+{selected.phone} · {selected.messageCount} messages</div>
              </div>
              {selected.hasInbound && !selected.isHotLead && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 11, background: "#fff7f0", color: "#ef4444", border: "1px solid #fecaca" }}
                  onClick={() => toggleHotLead(selected, true)}
                  title="Mark as Hot Lead"
                >
                  🔥 Hot
                </button>
              )}
              {selected.isHotLead && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11 }}
                  onClick={() => toggleHotLead(selected, false)}
                  title="Remove from Hot Leads"
                >
                  ✕ Hot
                </button>
              )}
              {isMobile && <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>← Back</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => loadConversation(selected.phone)}>↻</button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10, background: "#f0f2f5" }}>
              {msgLoading && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
              {messages.map(m => {
                const isOut = m.direction === "outbound";
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "70%", background: isOut ? "#dcf8c6" : "white",
                      borderRadius: isOut ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                      padding: "8px 12px", boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                    }}>
                      {m.templateName && (
                        <div style={{ fontSize: 10, color: "#128C7E", fontWeight: 600, marginBottom: 4 }}>
                          Template: {m.templateName}
                        </div>
                      )}
                      {m.mediaUrl && m.messageType === "image" && (
                        <a href={proxyMedia(m.mediaUrl)!} target="_blank" rel="noreferrer">
                          <img src={proxyMedia(m.mediaUrl)!} alt="image" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, display: "block", marginBottom: 4 }} />
                        </a>
                      )}
                      {m.mediaUrl && m.messageType === "video" && (
                        <video controls style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, display: "block", marginBottom: 4 }}>
                          <source src={proxyMedia(m.mediaUrl)!} />
                        </video>
                      )}
                      {m.mediaUrl && m.messageType === "audio" && (
                        <audio controls style={{ width: "100%", marginBottom: 4 }}>
                          <source src={proxyMedia(m.mediaUrl)!} />
                        </audio>
                      )}
                      {m.mediaUrl && m.messageType === "document" && (
                        <a href={proxyMedia(m.mediaUrl)!} target="_blank" rel="noreferrer"
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "rgba(0,0,0,0.05)", borderRadius: 6, marginBottom: 4, textDecoration: "none", color: "#111" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          <span style={{ fontSize: 12 }}>Download document</span>
                        </a>
                      )}
                      {!m.mediaUrl && m.messageType === "document" && m.body === "[document]" && (
                        <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>📎 Document (preview unavailable)</div>
                      )}
                      {m.mediaCaption && <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>{m.mediaCaption}</div>}
                      <div style={{ fontSize: 13, color: "#111", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                        {m.mediaUrl ? null : (m.body || (m.templateName ? `[${m.templateName}]` : "—"))}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtTime(m.createdAt)}</span>
                        {isOut && <StatusTick status={m.status} />}
                      </div>
                      {m.errorMessage && (
                        <div style={{ fontSize: 10, color: "#f87171", marginTop: 2 }}>✗ {m.errorMessage.slice(0, 80)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Reply box */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
              {sendResult && (
                <div className={`banner ${sendResult.ok ? "banner-success" : "banner-error"}`} style={{ marginBottom: 8, fontSize: 12 }}>
                  {sendResult.ok ? "✓ " : "✗ "}{sendResult.msg}
                </div>
              )}
              {showAttach && (
                <div style={{ marginBottom: 10, padding: 12, background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <select className="input" style={{ width: 120, fontSize: 12, padding: "4px 8px" }} value={attachType} onChange={e => setAttachType(e.target.value)}>
                      <option value="document">Document</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                    </select>
                    <input ref={attachInputRef} type="file"
                      accept={attachType === "image" ? "image/*" : attachType === "video" ? "video/*" : attachType === "audio" ? "audio/*" : ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
                      onChange={e => setAttachFile(e.target.files?.[0] ?? null)}
                      style={{ flex: 1, fontSize: 12 }}
                    />
                  </div>
                  {(attachType === "document" || attachType === "image") && (
                    <div style={{ marginBottom: 8 }}>
                      <input className="input" style={{ width: "100%", fontSize: 12, boxSizing: "border-box" }} placeholder="Caption (optional)" value={attachCaption} onChange={e => setAttachCaption(e.target.value)} />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    {attachFile && <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center", flex: 1 }}>{attachFile.name} ({(attachFile.size / 1024).toFixed(0)} KB)</span>}
                    <button className="btn btn-sm btn-primary" onClick={sendAttachment} disabled={sending || !attachFile}>{attachUploading ? "Uploading…" : sending ? "Sending…" : "Send"}</button>
                    <button className="btn btn-sm" onClick={() => { setShowAttach(false); setAttachFile(null); if (attachInputRef.current) attachInputRef.current.value = ""; }} style={{ fontSize: 11 }}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <textarea className="input"
                    style={{ width: "100%", minHeight: 60, resize: "none", fontSize: 13, paddingRight: 36, boxSizing: "border-box" }}
                    placeholder="Type a reply… (only works within 24hr reply window)"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply("text"); } }}
                  />
                  <button onClick={() => { setShowAttach(v => !v); setSendResult(null); }} title="Send attachment"
                    style={{ position: "absolute", bottom: 8, right: 8, background: "none", border: "none", cursor: "pointer", color: showAttach ? "#6366f1" : "var(--muted)", padding: 2, lineHeight: 1, transition: "color 0.15s" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => sendReply("text")} disabled={sending || !replyText.trim()}>{sending ? "…" : "Send"}</button>
                  <button className="btn btn-sm" onClick={() => sendReply("template")} disabled={sending} style={{ background: "#128C7E", color: "white", border: "none", fontSize: 11 }} title="Send csharptek_intro_v2 template">Template</button>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
                Free-form text only works within 24hr after recipient replies.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
