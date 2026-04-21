"use client";
import { useState } from "react";
import PageHeader from "../components/PageHeader";

interface SettingGroup {
  title: string;
  subtitle: string;
  icon: string;
  fields: { key: string; label: string; placeholder: string; type?: string; hint?: string }[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: "Azure OpenAI",
    subtitle: "AI email generation",
    icon: "◆",
    fields: [
      { key: "azureOpenAiEndpoint", label: "Endpoint URL", placeholder: "https://your-resource.openai.azure.com/" },
      { key: "azureOpenAiKey", label: "API Key", placeholder: "••••••••••••", type: "password" },
      { key: "azureOpenAiModel", label: "Deployment Name", placeholder: "gpt-4o", hint: "Your Azure OpenAI deployment name" },
    ],
  },
  {
    title: "Azure AI Search",
    subtitle: "RAG vector search",
    icon: "◎",
    fields: [
      { key: "azureSearchEndpoint", label: "Endpoint", placeholder: "https://your-search.search.windows.net" },
      { key: "azureSearchKey", label: "Admin Key", placeholder: "••••••••••••", type: "password" },
      { key: "azureSearchIndex", label: "Index Name", placeholder: "portfolio-index" },
    ],
  },
  {
    title: "Azure Cosmos DB",
    subtitle: "Primary data store",
    icon: "⊞",
    fields: [
      { key: "cosmosEndpoint", label: "Endpoint", placeholder: "https://your-account.documents.azure.com:443/" },
      { key: "cosmosKey", label: "Primary Key", placeholder: "••••••••••••", type: "password" },
      { key: "cosmosDatabase", label: "Database Name", placeholder: "teklead" },
    ],
  },
  {
    title: "Azure Blob Storage",
    subtitle: "File attachments",
    icon: "◈",
    fields: [
      { key: "blobConnectionString", label: "Connection String", placeholder: "DefaultEndpointsProtocol=https;AccountName=...", type: "password" },
      { key: "blobContainer", label: "Container Name", placeholder: "portfolio-assets" },
    ],
  },
  {
    title: "Apollo.io",
    subtitle: "Lead data provider",
    icon: "◉",
    fields: [
      { key: "apolloApiKey", label: "API Key", placeholder: "••••••••••••", type: "password" },
    ],
  },
  {
    title: "SendGrid",
    subtitle: "Email delivery",
    icon: "✉",
    fields: [
      { key: "sendgridApiKey", label: "API Key", placeholder: "SG.••••••••••••", type: "password" },
      { key: "sendgridFromEmail", label: "From Email", placeholder: "outreach@yourcompany.com" },
      { key: "sendgridFromName", label: "From Name", placeholder: "Your Name / Company" },
    ],
  },
  {
    title: "Twilio WhatsApp",
    subtitle: "WhatsApp messaging",
    icon: "◈",
    fields: [
      { key: "twilioAccountSid", label: "Account SID", placeholder: "AC••••••••••••", type: "password" },
      { key: "twilioAuthToken", label: "Auth Token", placeholder: "••••••••••••", type: "password" },
      { key: "twilioWhatsappNumber", label: "WhatsApp Number", placeholder: "whatsapp:+14155238886" },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const handleSave = async () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Settings"
        subtitle="Configure API keys and service connections"
        icon="⊞"
        actions={
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? "✓ Saved" : "Save All"}
          </button>
        }
      />

      <div className="scroll-y" style={{ flex: 1, padding: "20px 28px" }}>
        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Info banner */}
          <div className="card" style={{
            padding: "12px 16px",
            borderColor: "rgba(0,212,255,0.2)",
            background: "rgba(0,212,255,0.04)",
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
              All keys stored encrypted in <span style={{ color: "var(--accent)" }}>Azure Cosmos DB</span>.
              Loaded at runtime by the .NET API — never exposed to the frontend.
            </div>
          </div>

          {SETTING_GROUPS.map((group) => (
            <div key={group.title} className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 16, color: "var(--accent)" }}>{group.icon}</span>
                <div>
                  <div style={{ fontFamily: "Syne, sans-serif", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {group.title}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{group.subtitle}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {group.fields.map(field => (
                  <div key={field.key} style={{ gridColumn: field.key.includes("ConnectionString") ? "1 / -1" : undefined }}>
                    <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>{field.label}</div>
                    <div style={{ position: "relative" }}>
                      <input
                        className="input"
                        style={{ fontSize: 11, paddingRight: field.type === "password" ? 40 : 12 }}
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
                            fontSize: 10,
                            color: "var(--text-dim)",
                          }}
                        >
                          {reveal[field.key] ? "hide" : "show"}
                        </button>
                      )}
                    </div>
                    {field.hint && (
                      <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 3 }}>{field.hint}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ height: 24 }} />
        </div>
      </div>
    </div>
  );
}
