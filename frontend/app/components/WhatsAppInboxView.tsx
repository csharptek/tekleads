"use client";
import { useState, useEffect, useRef } from "react";
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

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

function statusColor(s: string) {
  if (s === "read") return "#34d399";
  if (s === "delivered") return "#60a5fa";
  if (s === "sent") return "#94a3b8";
  if (s === "failed") return "#f87171";
  return "#94a3b8";
}

export default function WhatsAppInboxView() {
  const [threads, setThreads] = useState<Thread[]>([]);
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
  const attachInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadInbox = async () => {
    try {
      const data = await api.get<Thread[]>("/api/whatsapp/inbox");
      setThreads(data || []);
    } catch { }
    setLoading(false);
  };

  const loadConversation = async (phone: string) => {
    setMsgLoading(true);
    try {
      const data = await api.get<Message[]>(`/api/whatsapp/conversation/${phone}`);
      setMessages(data || []);
    } catch { }
    setMsgLoading(false);
  };

  useEffect(() => { loadInbox(); }, []);

  useEffect(() => {
    if (selected) loadConversation(selected.phone);
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendAttachment = async () => {
    if (!selected || !attachFile) return;
    setSending(true);
    setAttachUploading(true);
    setSendResult(null);
    try {
      // 1. Upload to blob
      const formData = new FormData();
      formData.append("file", attachFile);
      const uploadJson = await api.upload<{ url: string; name: string }>("/api/blob/upload", formData);
      const fileUrl: string = uploadJson.url;

      // 2. Send via WhatsApp
      const res = await api.post<any>("/api/whatsapp/send-attachment", {
        to: selected.phone,
        fileUrl,
        attachmentType: attachType,
        caption: attachCaption.trim() || undefined,
        filename: attachFile.name,
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
    } catch (e: any) {
      setSendResult({ ok: false, msg: e?.message || "Error" });
    }
    setSending(false);
    setAttachUploading(false);
  };

  const sendReply = async (mode: "text" | "template") => {
    if (!selected) return;
    if (mode === "text" && !replyText.trim()) return;
    setSending(true);
    setSendResult(null);
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
    } catch (e: any) {
      setSendResult({ ok: false, msg: e?.message || "Error" });
    }
    setSending(false);
  };

  return (
    <div className="page" style={{ padding: 0, display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Thread list */}
      <div style={{ width: 300, minWidth: 240, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title" style={{ fontSize: 16, margin: 0 }}>WA Inbox</div>
            <div className="page-sub" style={{ fontSize: 11 }}>{threads.length} conversations</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadInbox} title="Refresh">↻</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
          {!loading && threads.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No messages yet.<br />Send a template from Artifacts to get started.
            </div>
          )}
          {threads.map(t => (
            <div key={t.phone}
              onClick={() => { setSelected(t); setSendResult(null); }}
              style={{
                padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border)",
                background: selected?.phone === t.phone ? "var(--primary-light, #eff6ff)" : "transparent",
                transition: "background 0.1s"
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                  {t.contactName || `+${t.phone}`}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtTime(t.lastAt)}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.lastMessage || (t.lastTemplate ? `Template: ${t.lastTemplate}` : "—")}
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{t.messageCount} msg{t.messageCount !== 1 ? "s" : ""}</span>
                {t.unreadCount > 0 && (
                  <span style={{ background: "#25D366", color: "white", borderRadius: 999, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
                    {t.unreadCount} reply
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selected ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 14 }}>
            Select a conversation
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, background: "var(--surface)" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.contactName || `+${selected.phone}`}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>+{selected.phone} · {selected.messageCount} messages</div>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => loadConversation(selected.phone)}>↻ Refresh</button>
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
                      {/* Media rendering */}
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
                      {m.mediaCaption && (
                        <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>{m.mediaCaption}</div>
                      )}
                      <div style={{ fontSize: 13, color: "#111", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                        {m.mediaUrl ? null : (m.body || (m.templateName ? `[${m.templateName}]` : "—"))}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtTime(m.createdAt)}</span>
                        {isOut && (
                          <span style={{ fontSize: 10, color: statusColor(m.status), fontWeight: 600 }}>
                            {m.status}
                          </span>
                        )}
                      </div>
                      {m.errorMessage && (
                        <div style={{ fontSize: 10, color: "#f87171", marginTop: 2 }}>
                          ✗ {m.errorMessage.slice(0, 80)}
                        </div>
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

              {/* Attachment panel */}
              {showAttach && (
                <div style={{ marginBottom: 10, padding: 12, background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <select
                      className="input"
                      style={{ width: 120, fontSize: 12, padding: "4px 8px" }}
                      value={attachType}
                      onChange={e => setAttachType(e.target.value)}
                    >
                      <option value="document">Document</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                    </select>
                    <input
                      ref={attachInputRef}
                      type="file"
                      accept={
                        attachType === "image" ? "image/*" :
                        attachType === "video" ? "video/*" :
                        attachType === "audio" ? "audio/*" :
                        ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      }
                      onChange={e => setAttachFile(e.target.files?.[0] ?? null)}
                      style={{ flex: 1, fontSize: 12 }}
                    />
                  </div>
                  {(attachType === "document" || attachType === "image") && (
                    <div style={{ marginBottom: 8 }}>
                      <input
                        className="input"
                        style={{ width: "100%", fontSize: 12, boxSizing: "border-box" }}
                        placeholder="Caption (optional)"
                        value={attachCaption}
                        onChange={e => setAttachCaption(e.target.value)}
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    {attachFile && (
                      <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center", flex: 1 }}>
                        {attachFile.name} ({(attachFile.size / 1024).toFixed(0)} KB)
                      </span>
                    )}
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={sendAttachment}
                      disabled={sending || !attachFile}
                    >
                      {attachUploading ? "Uploading…" : sending ? "Sending…" : "Send"}
                    </button>
                    <button className="btn btn-sm" onClick={() => { setShowAttach(false); setAttachFile(null); if (attachInputRef.current) attachInputRef.current.value = ""; }} style={{ fontSize: 11 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <textarea
                    className="input"
                    style={{ width: "100%", minHeight: 60, resize: "none", fontSize: 13, paddingRight: 36, boxSizing: "border-box" }}
                    placeholder="Type a reply… (only works within 24hr reply window)"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply("text"); } }}
                  />
                  <button
                    onClick={() => { setShowAttach(v => !v); setSendResult(null); }}
                    title="Send attachment"
                    style={{
                      position: "absolute", bottom: 8, right: 8,
                      background: "none", border: "none", cursor: "pointer",
                      color: showAttach ? "#6366f1" : "var(--muted)",
                      padding: 2, lineHeight: 1, transition: "color 0.15s"
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => sendReply("text")} disabled={sending || !replyText.trim()}>
                    {sending ? "…" : "Send"}
                  </button>
                  <button className="btn btn-sm" onClick={() => sendReply("template")} disabled={sending}
                    style={{ background: "#128C7E", color: "white", border: "none", fontSize: 11 }}
                    title="Send csharptek_intro_v2 template">
                    Template
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
                Free-form text only works within 24hr after recipient replies. Use Template for cold outreach.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
