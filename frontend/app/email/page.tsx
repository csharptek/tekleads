'use client';
import { useState, useEffect } from 'react';
import { Sparkles, Copy, CheckCheck } from 'lucide-react';
import { PageHeader, Card, Button, Input, Textarea } from '@/components/ui';
import { get, post } from '@/lib/api';

interface Lead { id: string; name: string; title: string; company: string; }

export default function EmailPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState('');
  const [context, setContext] = useState('');
  const [tone, setTone] = useState('professional');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { get('/api/leads/saved').then(setLeads).catch(() => {}); }, []);

  async function generate() {
    if (!selectedLead) return alert('Select a lead first');
    setLoading(true);
    try {
      const res = await post('/api/email/generate', { leadId: selectedLead, additionalContext: context, tone });
      setSubject(res.subject); setBody(res.body);
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  }

  function copy() {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const tones = ['professional', 'friendly', 'concise', 'persuasive'];

  return (
    <div>
      <PageHeader title="AI Email Generator" subtitle="Generate personalized emails using portfolio RAG" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Select Lead</h3>
            <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'Syne, sans-serif' }}>
              <option value="">-- Select a saved lead --</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.name} · {l.company}</option>)}
            </select>
            {leads.length === 0 && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>No saved leads. Search and save leads first.</p>}
          </Card>
          <Card>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Tone</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tones.map(t => (
                <button key={t} onClick={() => setTone(t)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tone === t ? 'var(--accent)' : 'var(--surface2)', color: tone === t ? '#fff' : 'var(--muted)', border: tone === t ? 'none' : '1px solid var(--border)' }}>
                  {t}
                </button>
              ))}
            </div>
          </Card>
          <Card><Textarea label="Additional Context (optional)" value={context} onChange={setContext} placeholder="e.g. They recently raised Series B..." rows={4} /></Card>
          <Button onClick={generate} disabled={loading}>
            <Sparkles size={14} style={{ marginRight: 6, display: 'inline' }} />{loading ? 'Generating...' : 'Generate Email'}
          </Button>
        </div>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Generated Email</h3>
            {body && <Button size="sm" variant="ghost" onClick={copy}>{copied ? <CheckCheck size={12} style={{ marginRight: 4, display: 'inline' }} /> : <Copy size={12} style={{ marginRight: 4, display: 'inline' }} />}{copied ? 'Copied' : 'Copy'}</Button>}
          </div>
          {!body ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <Sparkles size={28} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Configure options and generate</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'DM Mono', display: 'block', marginBottom: 6 }}>SUBJECT</span>
                <Input value={subject} onChange={setSubject} />
              </div>
              <div style={{ padding: '12px', background: 'var(--surface2)', borderRadius: 8, minHeight: 300 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'DM Mono', display: 'block', marginBottom: 8 }}>BODY</span>
                <textarea value={body} onChange={e => setBody(e.target.value)}
                  style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', lineHeight: 1.7, resize: 'none', minHeight: 260 }} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
