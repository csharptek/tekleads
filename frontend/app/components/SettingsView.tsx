"use client";

import { useCallback, useEffect, useState } from "react";
import { api, API_BASE } from "../../lib/api";

// Mirror SettingKeys.cs exactly.
const KEYS = {
  AzureOpenAiEndpoint: "azure_openai_endpoint",
  AzureOpenAiKey: "azure_openai_key",
  AzureOpenAiDeployment: "azure_openai_deployment",
  AzureBlobConnString: "azure_blob_conn",
  ApolloApiKey: "apollo_api_key",
  GraphTenantId: "graph_tenant_id",
  GraphClientId: "graph_client_id",
  GraphClientSecret: "graph_client_secret",
  GraphSenderEmail: "graph_sender_email",
  WhatsappCountryCode: "whatsapp_cc",
};

interface Field {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  full?: boolean;
}

interface Group {
  title: string;
  subtitle: string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    title: "Azure OpenAI",
    subtitle: "AI email generation",
    fields: [
      { key: KEYS.AzureOpenAiEndpoint, label: "Endpoint", placeholder: "https://your-resource.openai.azure.com/", full: true },
      { key: KEYS.AzureOpenAiKey, label: "API Key", placeholder: "Enter to set / replace", secret: true },
      { key: KEYS.AzureOpenAiDeployment, label: "Deployment Name", placeholder: "gpt-4o" },
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
    title: "Microsoft Graph (Email)",
    subtitle: "Primary email provider via Entra ID app registration",
    fields: [
      { key: KEYS.GraphTenantId, label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: KEYS.GraphClientId, label: "Client (App) ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: KEYS.GraphClientSecret, label: "Client Secret", placeholder: "Enter to set / replace", secret: true },
      { key: KEYS.GraphSenderEmail, label: "Sender Email", placeholder: "outreach@yourcompany.com" },
    ],
  },
  {
    title: "WhatsApp",
    subtitle: "Outreach via wa.me deep links",
    fields: [
      { key: KEYS.WhatsappCountryCode, label: "Default Country Code", placeholder: "+91" },
    ],
  },
];

interface Diag {
  connStringSet: boolean;
  connStringNormalized: boolean;
  dbReachable: boolean;
  tableExists: boolean;
  rowCount: number;
  keysStored: number;
  error?: string | null;
}

export default function SettingsView() {
  // form: only the values the user has edited. Keys not in form = "leave as-is".
  const [form, setForm] = useState<Record<string, string>>({});
  // baseline: what backend reports for non-secret keys (so the UI can show current value).
  const [serverValues, setServerValues] = useState<Record<string, string>>({});
  const [isSet, setIsSet] = useState<Record<string, boolean>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ values: Record<string, string>; isSet: Record<string, boolean> }>("/api/settings");
      setServerValues(data.values || {});
      setIsSet(data.isSet || {});
      setForm({}); // start empty form on every load
    } catch (e: any) {
      setBanner({ kind: "error", text: `Load failed: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiag = useCallback(async () => {
    try {
      const d = await api.get<Diag>("/api/settings/diag");
      setDiag(d);
    } catch (e: any) {
      setDiag({
        connStringSet: false, connStringNormalized: false,
        dbReachable: false, tableExists: false, rowCount: 0, keysStored: 0,
        error: e.message,
      });
    }
  }, []);

  useEffect(() => { load(); loadDiag(); }, [load, loadDiag]);

  const setVal = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const valueShown = (f: Field): string => {
    if (f.key in form) return form[f.key];
    if (f.secret) return ""; // never echo secrets
    return serverValues[f.key] || "";
  };

  const onSave = async () => {
    if (Object.keys(form).length === 0) {
      setBanner({ kind: "info", text: "Nothing to save — no fields changed." });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.post<{ ok: boolean; rowsAffected: number }>("/api/settings", { values: form });
      setBanner({ kind: "success", text: `Saved. ${res.rowsAffected} field(s) written to DB.` });
      await load();
      await loadDiag();
    } catch (e: any) {
      setBanner({ kind: "error", text: `Save failed: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h1">TEKLead AI — Settings</h1>
          <div className="sub">Configure API keys. Phase 1: Settings persistence.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => { load(); loadDiag(); }} disabled={loading}>
            Reload
          </button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving || loading}>
            {saving ? <span className="spinner" /> : null}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      <div className="card" style={{ background: "var(--accent-light)", borderColor: "#bfdbfe" }}>
        <div className="card-title" style={{ color: "var(--accent)" }}>How saving works</div>
        <div style={{ fontSize: 12, color: "var(--accent)", lineHeight: 1.6 }}>
          Leave a secret field empty to keep the existing stored value (✓ stored badge). Type a new value only to set or replace.
          Empty fields you didn't touch are not sent to the server.
        </div>
      </div>

      <div className="card">
        <div className="card-title">Diagnostics</div>
        <div className="card-sub">Live status from <code>/api/settings/diag</code></div>
        {!diag ? <div className="sub">Loading…</div> : (
          <>
            <div className="diag-row">
              <span className={`chip ${diag.connStringSet ? "chip-green" : "chip-red"}`}>{diag.connStringSet ? "●" : "○"} ENV var</span>
              <span className={`chip ${diag.connStringNormalized ? "chip-green" : "chip-red"}`}>{diag.connStringNormalized ? "●" : "○"} Conn parsed</span>
              <span className={`chip ${diag.dbReachable ? "chip-green" : "chip-red"}`}>{diag.dbReachable ? "●" : "○"} DB reachable</span>
              <span className={`chip ${diag.tableExists ? "chip-green" : "chip-red"}`}>{diag.tableExists ? "●" : "○"} Table exists</span>
              <span className="chip chip-blue">Rows: {diag.rowCount}</span>
              <span className="chip chip-blue">Keys stored: {diag.keysStored}</span>
            </div>
            {diag.error && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)" }}>Error: {diag.error}</div>
            )}
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--dim)" }}>
              API: <code>{API_BASE || "(not set)"}</code>
            </div>
          </>
        )}
      </div>

      {GROUPS.map(group => (
        <div key={group.title} className="card">
          <div className="card-title">{group.title}</div>
          <div className="card-sub">{group.subtitle}</div>

          <div className="grid-2">
            {group.fields.map(f => (
              <div key={f.key} className={f.full ? "full" : ""}>
                <div className="field-label">
                  <span>{f.label}</span>
                  {f.secret && isSet[f.key] && <span className="chip chip-green">✓ stored</span>}
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    className="input"
                    style={{ paddingRight: f.secret ? 56 : 12 }}
                    type={f.secret && !reveal[f.key] ? "password" : "text"}
                    placeholder={f.placeholder}
                    value={valueShown(f)}
                    onChange={e => setVal(f.key, e.target.value)}
                  />
                  {f.secret && (
                    <button
                      className="icon-btn"
                      style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}
                      onClick={() => setReveal(p => ({ ...p, [f.key]: !p[f.key] }))}
                    >
                      {reveal[f.key] ? "Hide" : "Show"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ height: 40 }} />
    </div>
  );
}
