'use client';
import { useState, useEffect } from 'react';
import { Save, Eye, EyeOff } from 'lucide-react';
import { PageHeader, Card, Button, Input } from '@/components/ui';
import { get, post } from '@/lib/api';

interface Settings {
  azureOpenAiEndpoint: string; azureOpenAiKey: string; azureOpenAiDeployment: string;
  azureBlobConnectionString: string;
  apolloApiKey: string;
  sendgridApiKey: string; sendgridFromEmail: string;
  twilioAccountSid: string; twilioAuthToken: string; twilioWhatsappFrom: string;
  pgConnectionString: string;
}

const defaults: Settings = {
  azureOpenAiEndpoint: '', azureOpenAiKey: '', azureOpenAiDeployment: 'gpt-4',
  azureBlobConnectionString: '',
  apolloApiKey: '',
  sendgridApiKey: '', sendgridFromEmail: '',
  twilioAccountSid: '', twilioAuthToken: '', twilioWhatsappFrom: 'whatsapp:+14155238886',
  pgConnectionString: '',
};

const sections = [
  { title: '🤖 Azure OpenAI', fields: [
    { key: 'azureOpenAiEndpoint', label: 'Endpoint', placeholder: 'https://your-resource.openai.azure.com/', secret: false },
    { key: 'azureOpenAiKey', label: 'API Key', placeholder: 'your-api-key', secret: true },
    { key: 'azureOpenAiDeployment', label: 'Deployment Name', placeholder: 'gpt-4', secret: false },
  ]},
  { title: '📦 Azure Blob Storage', fields: [
    { key: 'azureBlobConnectionString', label: 'Connection String', placeholder: 'DefaultEndpointsProtocol=https;AccountName=...', secret: true },
  ]},
  { title: '🗄️ PostgreSQL', fields: [
    { key: 'pgConnectionString', label: 'Connection String', placeholder: 'Host=...;Database=teklead;Username=...;Password=...', secret: true },
  ]},
  { title: '🚀 Apollo.io', fields: [
    { key: 'apolloApiKey', label: 'API Key', placeholder: 'your-apollo-key', secret: true },
  ]},
  { title: '📧 SendGrid', fields: [
    { key: 'sendgridApiKey', label: 'API Key', placeholder: 'SG.xxxxx', secret: true },
    { key: 'sendgridFromEmail', label: 'From Email', placeholder: 'you@yourdomain.com', secret: false },
  ]},
  { title: '💬 Twilio (WhatsApp)', fields: [
    { key: 'twilioAccountSid', label: 'Account SID', placeholder: 'ACxxxxxx', secret: false },
    { key: 'twilioAuthToken', label: 'Auth Token', placeholder: 'your-auth-token', secret: true },
    { key: 'twilioWhatsappFrom', label: 'WhatsApp From', placeholder: 'whatsapp:+14155238886', secret: false },
  ]},
] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { get('/api/settings').then(d => { if (d) setSettings({ ...defaults, ...d }); }).catch(() => {}); }, []);

  const set = (key: keyof Settings) => (v: string) => setSettings(p => ({ ...p, [key]: v }));
  const toggleVisible = (key: string) => setVisible(v => { const n = new Set(v); n.has(key) ? n.delete(key) : n.add(key); return n; });

  async function save() {
    setSaving(true);
    try { await post('/api/settings', settings); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure API keys and service connections"
        action={<Button onClick={save} disabled={saving}><Save size={14} style={{ marginRight: 6, display: 'inline' }} />{saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Settings'}</Button>} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
        {sections.map(section => (
          <Card key={section.title}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>{section.title}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {section.fields.map(field => (
                <div key={field.key}>
                  {field.secret ? (
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{field.label}</label>
                      <div style={{ position: 'relative' }}>
                        <input type={visible.has(field.key) ? 'text' : 'password'} value={settings[field.key as keyof Settings]} onChange={e => set(field.key as keyof Settings)(e.target.value)} placeholder={field.placeholder}
                          style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 40px 9px 12px', color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'DM Mono, monospace' }} />
                        <button onClick={() => toggleVisible(field.key)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
                          {visible.has(field.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Input label={field.label} value={settings[field.key as keyof Settings]} onChange={set(field.key as keyof Settings)} placeholder={field.placeholder} />
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
