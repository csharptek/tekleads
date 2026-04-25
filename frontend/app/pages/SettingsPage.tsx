"use client";
import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { get, post } from "../../lib/api";

interface SettingField {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  hint?: string;
  full?: boolean;
  secret?: boolean;
}

interface SettingGroup {
  title: string;
  subtitle: string;
  fields: SettingField[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: "Azure OpenAI",
    subtitle: "AI email generation",
    fields: [
      { key: "azureOpenAiEndpoint", label: "Endpoint URL", placeholder: "https://your-resource.openai.azure.com/", full: true },
      { key: "azureOpenAiKey", label: "API Key", placeholder: "Enter key to set / replace", type: "password", secret: true },
      { key: "azureOpenAiDeployment", label: "Deployment Name", placeholder: "gpt-4o" },
    ],
  },
  {
    title: "Azure Blob Storage",
    subtitle: "File attachments",
    fields: [
      { key: "azureBlobConnectionString", label: "Connection String", placeholder: "DefaultEndpointsProtocol=https;AccountName=...", type: "password", secret: true, full: true },
    ],
  },
  {
    title: "Apollo.io",
    subtitle: "Lead data provider",
    fields: [
      { key: "apolloApiKey", label: "API Key", placeholder: "Enter key to set / replace", type: "password", secret: true, full: true },
    ],
  },
  {
    title: "Microsoft Graph (Email)",
    subtitle: "Primary email provider via Entra ID app registration",
    fields: [
      { key: "graphTenantId", label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "graphClientId", label: "Client (App) ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "graphClientSecret", label: "Client Secret", placeholder: "Enter secret to set / replace", type: "password", secret: true },
      { key: "graphSenderEmail", label: "Sender Email", placeholder: "outreach@yourcompany.com" },
    ],
  },
  {
    title: "WhatsApp",
    subtitle: "Outreach via wa.me deep links",
    fields: [
      { key: "whatsappDefaultCountryCode", label: "Default Country Code", placeholder: "+91", hint: "Used when a lead's number has no country code" },
    ],
  },
];

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
);

interface SettingsState {
  values: Record<string, string>;
  isSet: Record<string, boolean>;
}

export default function SettingsPage() {
  const [state, setState] = useState<SettingsState>({ values: {}, isSet: {} });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const data: any = await get("/api/settings");
      const { isSet = {}, ...values } = data || {};
      setState({ values, isSet });
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await get("/api/settings/status");
      setStatus(data);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadSettings(); loadStatus(); }, [loadSettings, loadStatus]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only send non-empty values; empty secrets = keep existing
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(state.values)) {
        if (v !== undefined && v !== null && String(v).length > 0) payload[k] = String(v);
      }
      await post("/api/settings", payload);
      setSaved(true);
      await loadSettings();
      await loadStatus();
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setValue = (key: string, v: string) =>
    setState(p => ({ ...p, values: { ...p.values, [key]: v } }));

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Settings"
        subtitle="Configure API keys and service connections"
        icon={ICON}
        actions={
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {saved ? "✓ Saved" : saving ? "Saving..." : "Save All"}
          </button>
        }
      />

      {error && (
        <div style={{ margin: "12px 20px 0", padding: "10px 14px", background: "var(--red-light)", border: "1px solid var(--red-light)", borderRadius: 8, fontSize: 12, color: "var(--red)", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>✕</button>
        </div>
      )}

      <div className="scroll-y" style={{ flex: 1, padding: "24px 28px" }}>
        <div style={{ maxWidth: 840, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: "14px 18px", background: "var(--accent-light)", borderColor: "var(--accent-light)" }}>
            <div style={{ fontSize: 12, color: "var(--accent-text)", lineHeight: 1.6 }}>
              <strong>How saving works:</strong> Leave a secret field empty to keep the existing stored value. Enter a new value only when you want to set or replace it. A <strong>✓ stored</strong> badge means that secret is already saved in the database.
            </div>
          </div>

          {status && (
            <div className="card" style={{ padding: "14px 18px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Integration Status</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <StatusChip label="DB Reachable" ok={status.dbReachable} />
                <StatusChip label="Azure OpenAI" ok={status.azureOpenAi} />
                <StatusChip label="Apollo" ok={status.apollo} />
                <StatusChip label="Graph Email" ok={status.graphEmail} />
                <StatusChip label="WhatsApp" ok={status.whatsapp} />
              </div>
            </div>
          )}

          {SETTING_GROUPS.map(group => (
            <div key={group.title} className="card" style={{ padding: "20px 22px" }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{group.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{group.subtitle}</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {group.fields.map(field => {
                  const isStored = !!state.isSet[field.key];
                  const isPassword = field.type === "password";
                  return (
                    <div key={field.key} style={{ gridColumn: field.full ? "1 / -1" : undefined }}>
                      <div className="label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{field.label}</span>
                        {field.secret && isStored && (
                          <span className="chip chip-green" style={{ fontSize: 10 }}>✓ stored</span>
                        )}
                      </div>
                      <div style={{ position: "relative" }}>
                        <input
                          className="input"
                          style={{ paddingRight: isPassword ? 56 : 12 }}
                          type={isPassword && !reveal[field.key] ? "password" : "text"}
                          placeholder={field.placeholder}
                          value={state.values[field.key] || ""}
                          onChange={e => setValue(field.key, e.target.value)}
                        />
                        {isPassword && (
                          <button
                            onClick={() => setReveal(p => ({ ...p, [field.key]: !p[field.key] }))}
                            style={{
                              position: "absolute", right: 8, top: "50%",
                              transform: "translateY(-50%)",
                              background: "none", border: "none",
                              cursor: "pointer",
                              fontSize: 11,
                              color: "var(--text-muted)",
                              fontWeight: 500,
                            }}
                          >
                            {reveal[field.key] ? "Hide" : "Show"}
                          </button>
                        )}
                      </div>
                      {field.hint && (
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 5 }}>{field.hint}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ height: 20 }} />
        </div>
      </div>
    </div>
  );
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`chip ${ok ? "chip-green" : "chip-red"}`} style={{ fontSize: 11 }}>
      {ok ? "●" : "○"} {label}
    </span>
  );
}
