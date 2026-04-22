"use client";
import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { get, post } from "../../lib/api";

interface SettingField {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
  hint?: string;
  full?: boolean;
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
      { key: "azureOpenAiKey", label: "API Key", placeholder: "••••••••••••", type: "password" },
      { key: "azureOpenAiDeployment", label: "Deployment Name", placeholder: "gpt-4o", hint: "Azure OpenAI deployment name" },
    ],
  },
  {
    title: "Azure Blob Storage",
    subtitle: "File attachments",
    fields: [
      { key: "azureBlobConnectionString", label: "Connection String", placeholder: "DefaultEndpointsProtocol=https;AccountName=...", type: "password", full: true },
    ],
  },
  {
    title: "Apollo.io",
    subtitle: "Lead data provider",
    fields: [
      { key: "apolloApiKey", label: "API Key", placeholder: "••••••••••••", type: "password", full: true },
    ],
  },
  {
    title: "SendGrid",
    subtitle: "Email delivery",
    fields: [
      { key: "sendgridApiKey", label: "API Key", placeholder: "SG.••••••••••••", type: "password" },
      { key: "sendgridFromEmail", label: "From Email", placeholder: "outreach@yourcompany.com" },
    ],
  },
  {
    title: "Twilio WhatsApp",
    subtitle: "WhatsApp messaging",
    fields: [
      { key: "twilioAccountSid", label: "Account SID", placeholder: "AC••••••••••••", type: "password" },
      { key: "twilioAuthToken", label: "Auth Token", placeholder: "••••••••••••", type: "password" },
      { key: "twilioWhatsappFrom", label: "WhatsApp Number", placeholder: "whatsapp:+14155238886", full: true },
    ],
  },
  {
    title: "PostgreSQL",
    subtitle: "Primary data store (Railway)",
    fields: [
      { key: "pgConnectionString", label: "Connection String", placeholder: "Host=...;Database=...;Username=...;Password=...", type: "password", full: true, hint: "Usually set via PG_CONNECTION_STRING env var on Railway" },
    ],
  },
];

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
);

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const data: Record<string, string> = await get("/api/settings");
      setValues(data || {});
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await post("/api/settings", values);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

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
              <strong>Note:</strong> All keys stored encrypted in PostgreSQL. Loaded at runtime by the .NET API — never exposed to the frontend. Masked values shown as dots won't overwrite stored keys on save.
            </div>
          </div>

          {SETTING_GROUPS.map(group => (
            <div key={group.title} className="card" style={{ padding: "20px 22px" }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{group.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{group.subtitle}</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {group.fields.map(field => (
                  <div key={field.key} style={{ gridColumn: field.full ? "1 / -1" : undefined }}>
                    <div className="label">{field.label}</div>
                    <div style={{ position: "relative" }}>
                      <input
                        className="input"
                        style={{ paddingRight: field.type === "password" ? 56 : 12 }}
                        type={field.type === "password" && !reveal[field.key] ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={values[field.key] || ""}
                        onChange={e => setValues(p => ({ ...p, [field.key]: e.target.value }))}
                      />
                      {field.type === "password" && (
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
                ))}
              </div>
            </div>
          ))}

          <div style={{ height: 20 }} />
        </div>
      </div>
    </div>
  );
}
