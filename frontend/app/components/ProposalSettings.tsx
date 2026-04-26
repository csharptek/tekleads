"use client";
import { useState } from "react";

const DEFAULT_PROMPT = `You are a professional proposal writer for CSharpTek, a specialist software development company.

Generate a compelling, personalized proposal based on:
1. The client's job post and requirements
2. Relevant portfolio projects (provided as context)
3. CSharpTek's expertise in AI, .NET, React, and cloud platforms

Guidelines:
- Write in a professional but approachable tone
- Always reference specific portfolio projects with links
- Include a clear project scope breakdown
- Add a sprint-based timeline table
- Mention HIPAA compliance if healthcare-related
- End with "Why CSharpTek" section
- Use markdown formatting with tables where appropriate
- Keep total length between 800-1200 words`;

export default function ProposalSettings() {
  const [form, setForm] = useState({
    companyName: "CSharpTek",
    tagline: "AI-Powered Software Development",
    website: "https://csharptek2026.vercel.app",
    email: "",
    phone: "",
    address: "",
    signerName: "Bhanu",
    signerTitle: "Lead Developer & Project Manager",
    confidentialityText: "This document is intended solely for the recipient and may not be shared without written consent.",
    footerText: "Confidential · CSharpTek",
    linkedin: "",
    youtube: "",
    github: "",
    defaultPrompt: DEFAULT_PROMPT,
  });
  const [logoName, setLogoName] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => { setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); }, 800);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Proposal Settings</div>
          <div className="page-sub">Branding, signer info, and default AI prompt for all proposals</div>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : null}
          {saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>

      {/* Company Info */}
      <div className="card">
        <div className="card-title">Company Information</div>
        <div className="card-sub">Used in proposal header and footer</div>
        <div className="grid-2">
          <div><div className="field-label">Company Name</div><input className="input" value={form.companyName} onChange={e => set("companyName", e.target.value)} placeholder="CSharpTek" /></div>
          <div><div className="field-label">Tagline</div><input className="input" value={form.tagline} onChange={e => set("tagline", e.target.value)} placeholder="AI-Powered Software Development" /></div>
          <div><div className="field-label">Website</div><input className="input" value={form.website} onChange={e => set("website", e.target.value)} placeholder="https://yoursite.com" /></div>
          <div><div className="field-label">Email</div><input className="input" type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="hello@company.com" /></div>
          <div><div className="field-label">Phone</div><input className="input" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+1 555 000 0000" /></div>
          <div><div className="field-label">Address</div><input className="input" value={form.address} onChange={e => set("address", e.target.value)} placeholder="City, Country" /></div>
        </div>
      </div>

      {/* Branding */}
      <div className="card">
        <div className="card-title">Branding</div>
        <div className="card-sub">Logos and signature used in Word/PDF export</div>
        <div className="grid-2">
          <div>
            <div className="field-label">Company Logo</div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px dashed #cbd5e1", borderRadius: 7, cursor: "pointer", background: "#f8fafc" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span style={{ fontSize: 13, color: "#64748b" }}>{logoName || "Upload logo (PNG, SVG)"}</span>
              <input type="file" accept=".png,.svg,.jpg,.jpeg" style={{ display: "none" }} onChange={e => setLogoName(e.target.files?.[0]?.name || "")} />
            </label>
          </div>
          <div>
            <div className="field-label">Signature Image</div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px dashed #cbd5e1", borderRadius: 7, cursor: "pointer", background: "#f8fafc" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span style={{ fontSize: 13, color: "#64748b" }}>{signatureName || "Upload signature (PNG)"}</span>
              <input type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }} onChange={e => setSignatureName(e.target.files?.[0]?.name || "")} />
            </label>
          </div>
        </div>
      </div>

      {/* Signer */}
      <div className="card">
        <div className="card-title">Proposal Signer</div>
        <div className="grid-2">
          <div><div className="field-label">Signer Name</div><input className="input" value={form.signerName} onChange={e => set("signerName", e.target.value)} placeholder="Your Name" /></div>
          <div><div className="field-label">Signer Title</div><input className="input" value={form.signerTitle} onChange={e => set("signerTitle", e.target.value)} placeholder="Lead Developer" /></div>
        </div>
      </div>

      {/* Proposal Defaults */}
      <div className="card">
        <div className="card-title">Proposal Defaults</div>
        <div style={{ marginBottom: 12 }}>
          <div className="field-label">Confidentiality Text</div>
          <textarea className="input" rows={2} value={form.confidentialityText} onChange={e => set("confidentialityText", e.target.value)} style={{ resize: "vertical" }} />
        </div>
        <div>
          <div className="field-label">Footer Text</div>
          <input className="input" value={form.footerText} onChange={e => set("footerText", e.target.value)} placeholder="Confidential · Company Name" />
        </div>
      </div>

      {/* Social Links */}
      <div className="card">
        <div className="card-title">Social & Links</div>
        <div className="grid-2">
          <div><div className="field-label">LinkedIn</div><input className="input" value={form.linkedin} onChange={e => set("linkedin", e.target.value)} placeholder="https://linkedin.com/company/..." /></div>
          <div><div className="field-label">YouTube</div><input className="input" value={form.youtube} onChange={e => set("youtube", e.target.value)} placeholder="https://youtube.com/@..." /></div>
          <div><div className="field-label">GitHub</div><input className="input" value={form.github} onChange={e => set("github", e.target.value)} placeholder="https://github.com/..." /></div>
        </div>
      </div>

      {/* Default AI Prompt */}
      <div className="card">
        <div className="card-title">Default AI Prompt</div>
        <div className="card-sub">Applied to all proposal generations unless overridden per proposal</div>
        <textarea
          className="input"
          rows={14}
          value={form.defaultPrompt}
          onChange={e => set("defaultPrompt", e.target.value)}
          style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.7 }}
        />
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          Available variables: <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>{"{job_post}"}</code>{" "}
          <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>{"{client_name}"}</code>{" "}
          <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>{"{portfolio_items}"}</code>{" "}
          <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>{"{budget}"}</code>{" "}
          <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>{"{timeline}"}</code>
        </div>
      </div>
    </div>
  );
}
