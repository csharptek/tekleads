"use client";

import { useCallback, useEffect, useState } from "react";
import { api, API_BASE } from "../../lib/api";

const KEYS = {
  AzureOpenAiEndpoint: "azure_openai_endpoint",
  AzureOpenAiKey: "azure_openai_key",
  AzureOpenAiDeployment: "azure_openai_deployment",
  AzureOpenAiEmbeddingDeployment: "azure_openai_embedding_deployment",
  AzureBlobConnString: "azure_blob_conn",
  ApolloApiKey: "apollo_api_key",
  GraphTenantId: "graph_tenant_id",
  GraphClientId: "graph_client_id",
  GraphClientSecret: "graph_client_secret",
  GraphSenderEmail: "graph_sender_email",
  WhatsappCountryCode: "whatsapp_cc",
  WhatsappMessageTemplate: "whatsapp_message_template",
  EmailSignature: "email_signature",
  ArtifactCoverLetterPrompt: "artifact_cover_letter_prompt",
  ArtifactWhatsappPrompt: "artifact_whatsapp_prompt",
  ArtifactEmailPrompt: "artifact_email_prompt",
  AzureSearchEndpoint: "azure_search_endpoint",
  AzureSearchKey: "azure_search_key",
  AzureSearchIndex: "azure_search_index",
};

interface Field { key: string; label: string; placeholder: string; secret?: boolean; full?: boolean; textarea?: boolean; }
interface Group { title: string; subtitle: string; fields: Field[]; }

// Technical API keys — collapsible, hidden by default
const TECH_GROUPS: Group[] = [
  {
    title: "Azure OpenAI",
    subtitle: "AI email generation",
    fields: [
      { key: KEYS.AzureOpenAiEndpoint, label: "Endpoint", placeholder: "https://your-resource.openai.azure.com/", full: true },
      { key: KEYS.AzureOpenAiKey, label: "API Key", placeholder: "Enter to set / replace", secret: true },
      { key: KEYS.AzureOpenAiDeployment, label: "Deployment Name", placeholder: "gpt-4o" },
      { key: KEYS.AzureOpenAiEmbeddingDeployment, label: "Embedding Deployment", placeholder: "text-embedding-3-small" },
    ],
  },
  {
    title: "Apollo.io",
    subtitle: "Lead data provider",
    fields: [
      { key: KEYS.ApolloApiKey, label: "API Key", placeholder: "Enter to set / replace", secret: true, full: true },
    ],
  },
  {
    title: "Azure Blob Storage",
    subtitle: "File attachments",
    fields: [
      { key: KEYS.AzureBlobConnString, label: "Connection String", placeholder: "DefaultEndpointsProtocol=https;...", secret: true, full: true },
    ],
  },
  {
    title: "Azure AI Search",
    subtitle: "Portfolio embeddings for RAG",
    fields: [
      { key: KEYS.AzureSearchEndpoint, label: "Endpoint", placeholder: "https://your-search.search.windows.net", full: true },
      { key: KEYS.AzureSearchKey, label: "Admin Key", placeholder: "Enter to set / replace", secret: true },
      { key: KEYS.AzureSearchIndex, label: "Index Name", placeholder: "portfolio" },
    ],
  },
  {
    title: "Microsoft Graph (Email)",
    subtitle: "Primary email provider via Entra ID app registration",
    fields: [
      { key: KEYS.GraphTenantId, label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: KEYS.GraphClientId, label: "Client (App) ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: KEYS.GraphClientSecret, label: "Client Secret", placeholder: "Enter to set / replace", secret: true },
      { key: KEYS.GraphSenderEmail, label: "Sender Email", placeholder: "outreach@yourcompany.com" },
    ],
  },
];

// User-facing config — always visible
const USER_GROUPS: Group[] = [
  {
    title: "WhatsApp Outreach",
    subtitle: "Outreach via wa.me deep links. Use {name} and {phone} as variables in the message.",
    fields: [
      { key: KEYS.WhatsappCountryCode, label: "Default Country Code", placeholder: "+91" },
      { key: KEYS.WhatsappMessageTemplate, label: "Message Template", placeholder: "Hi {name}, I came across your profile and would love to connect!", full: true, textarea: true },
    ],
  },
  {
    title: "Artifact Prompts",
    subtitle: "Saved prompts used for all cover letter, WhatsApp, and email generation. Leave blank to use the built-in default.",
    fields: [
      { key: KEYS.ArtifactCoverLetterPrompt, label: "Cover Letter Prompt", placeholder: "Leave blank to use built-in default…", full: true, textarea: true },
      { key: KEYS.ArtifactWhatsappPrompt, label: "WhatsApp Prompt", placeholder: "Leave blank to use built-in default…", full: true, textarea: true },
      { key: KEYS.ArtifactEmailPrompt, label: "Email Prompt", placeholder: "Leave blank to use built-in default…", full: true, textarea: true },
    ],
  },
];

interface Diag {
  connStringSet: boolean; connStringNormalized: boolean;
  dbReachable: boolean; tableExists: boolean;
  rowCount: number; keysStored: number; error?: string | null;
}

function FieldGroup({ group, form, setVal, serverValues, isSet, reveal, setReveal }: {
  group: Group;
  form: Record<string, string>;
  setVal: (k: string, v: string) => void;
  serverValues: Record<string, string>;
  isSet: Record<string, boolean>;
  reveal: Record<string, boolean>;
  setReveal: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const valueShown = (f: Field) => {
    if (f.key in form) return form[f.key];
    if (f.secret) return "";
    return serverValues[f.key] || "";
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{group.title}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{group.subtitle}</div>
      <div className="grid-2">
        {group.fields.map(field => (
          <div key={field.key} className={field.full ? "full" : ""}>
            <div className="field-label">
              <span>{field.label}</span>
              {field.secret && isSet[field.key] && <span className="chip chip-green" style={{ fontSize: 10 }}>✓ stored</span>}
            </div>
            <div style={{ position: "relative" }}>
              {field.textarea ? (
                <textarea className="input" style={{ minHeight: 72, resize: "vertical", fontFamily: "inherit" }}
                  placeholder={field.placeholder} value={valueShown(field)}
                  onChange={e => setVal(field.key, e.target.value)} />
              ) : (
                <input className="input" style={{ paddingRight: field.secret ? 56 : 12 }}
                  type={field.secret && !reveal[field.key] ? "password" : "text"}
                  placeholder={field.placeholder} value={valueShown(field)}
                  onChange={e => setVal(field.key, e.target.value)} />
              )}
              {field.secret && (
                <button className="icon-btn"
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}
                  onClick={() => setReveal(p => ({ ...p, [field.key]: !p[field.key] }))}>
                  {reveal[field.key] ? "Hide" : "Show"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


const DEFAULT_SIGNATURE = `--\nThanks & Regards,\n\nManjika Tantia\nStrategic Partnership & Marketing Manager | Csharptek\nP: IND: (+91)-7667124920\nE: manjika.tantia@csharptek.com\nwww.csharptek.com`;

function SignatureEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <button className={`btn btn-sm ${tab === "edit" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("edit")}>Edit HTML</button>
        <button className={`btn btn-sm ${tab === "preview" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("preview")}>Preview</button>
        <button className="btn btn-ghost btn-sm" onClick={copy} style={{ marginLeft: "auto" }}>{copied ? "✓ Copied" : "Copy"}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => onChange(DEFAULT_SIGNATURE)}>Reset Default</button>
      </div>
      {tab === "edit" ? (
        <textarea
          className="input"
          style={{ minHeight: 160, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
          placeholder="Paste your HTML signature here, or use plain text with line breaks..."
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <div
          style={{ minHeight: 100, border: "1px solid var(--border)", borderRadius: 6, padding: 16, background: "#fff", fontSize: 13 }}
          dangerouslySetInnerHTML={{ __html: value.includes("<") ? value : value.replace(/\n/g, "<br/>") }}
        />
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--dim)" }}>
        Supports HTML (links, images, colors) or plain text. Auto-appended to all outreach emails.
      </div>
    </div>
  );
}

export default function SettingsView() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [serverValues, setServerValues] = useState<Record<string, string>>({});
  const [isSet, setIsSet] = useState<Record<string, boolean>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [techOpen, setTechOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ values: Record<string, string>; isSet: Record<string, boolean> }>("/api/settings");
      setServerValues(data.values || {});
      setIsSet(data.isSet || {});
      setForm({});
    } catch (e: any) { setBanner({ kind: "error", text: `Load failed: ${e.message}` }); }
    finally { setLoading(false); }
  }, []);

  const loadDiag = useCallback(async () => {
    try {
      const d = await api.get<Diag>("/api/settings/diag");
      setDiag(d);
    } catch (e: any) {
      setDiag({ connStringSet: false, connStringNormalized: false, dbReachable: false, tableExists: false, rowCount: 0, keysStored: 0, error: e.message });
    }
  }, []);

  useEffect(() => { load(); loadDiag(); }, [load, loadDiag]);

  const setVal = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const onSave = async () => {
    if (Object.keys(form).length === 0) { setBanner({ kind: "info", text: "Nothing to save." }); return; }
    setSaving(true); setBanner(null);
    try {
      const res = await api.post<{ ok: boolean; rowsAffected: number }>("/api/settings", { values: form });
      setBanner({ kind: "success", text: `Saved. ${res.rowsAffected} field(s) written.` });
      await load(); await loadDiag();
    } catch (e: any) { setBanner({ kind: "error", text: `Save failed: ${e.message}` }); }
    finally { setSaving(false); }
  };

  const sharedProps = { form, setVal, serverValues, isSet, reveal, setReveal };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Outreach config and API keys</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => { load(); loadDiag(); }} disabled={loading}>Reload</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving || loading}>
            {saving ? <span className="spinner" /> : null}{saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      {/* User config — always visible */}
      <div className="card">
        {USER_GROUPS.map(g => <FieldGroup key={g.title} group={g} {...sharedProps} />)}
      </div>

      {/* Email Signature */}
      <div className="card">
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>✍️ Email Signature</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Auto-appended to all outreach emails. Supports HTML or plain text.</div>
        </div>
        <SignatureEditor
          value={form[KEYS.EmailSignature] ?? serverValues[KEYS.EmailSignature] ?? ""}
          onChange={v => setVal(KEYS.EmailSignature, v)}
        />
      </div>

      {/* Tech config — collapsible */}
      <div className="card">
        <button onClick={() => setTechOpen(p => !p)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, textAlign: "left" }}>🔧 API Keys & Integrations</div>
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "left" }}>Apollo, Azure OpenAI, Blob, Microsoft Graph</div>
          </div>
          <span style={{ fontSize: 18, color: "var(--muted)" }}>{techOpen ? "▲" : "▼"}</span>
        </button>

        {techOpen && (
          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {TECH_GROUPS.map(g => <FieldGroup key={g.title} group={g} {...sharedProps} />)}
          </div>
        )}
      </div>

      {/* Diagnostics — collapsible */}
      <div className="card">
        <button onClick={() => setDiagOpen(p => !p)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>🩺 Diagnostics</div>
          <span style={{ fontSize: 18, color: "var(--muted)" }}>{diagOpen ? "▲" : "▼"}</span>
        </button>
        {diagOpen && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            {!diag ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div> : (
              <>
                <div className="diag-row">
                  <span className={`chip ${diag.connStringSet ? "chip-green" : "chip-red"}`}>{diag.connStringSet ? "●" : "○"} ENV var</span>
                  <span className={`chip ${diag.connStringNormalized ? "chip-green" : "chip-red"}`}>{diag.connStringNormalized ? "●" : "○"} Conn parsed</span>
                  <span className={`chip ${diag.dbReachable ? "chip-green" : "chip-red"}`}>{diag.dbReachable ? "●" : "○"} DB reachable</span>
                  <span className={`chip ${diag.tableExists ? "chip-green" : "chip-red"}`}>{diag.tableExists ? "●" : "○"} Table exists</span>
                  <span className="chip chip-blue">Rows: {diag.rowCount}</span>
                  <span className="chip chip-blue">Keys: {diag.keysStored}</span>
                </div>
                {diag.error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>Error: {diag.error}</div>}
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--dim)" }}>API: <code>{API_BASE || "(not set)"}</code></div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
