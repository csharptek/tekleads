'use client';
import { useState, useEffect } from 'react';
import { Send, MessageSquare, Clock, CheckCircle, XCircle } from 'lucide-react';
import { PageHeader, Card, Button, Input, Textarea, Badge } from '@/components/ui';
import { get, post } from '@/lib/api';

interface Lead { id: string; name: string; email?: string; company: string; }
interface OutreachRecord { id: string; leadName: string; channel: string; subject?: string; sentAt: string; status: string; }

export default function OutreachPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email');
  const [selectedLead, setSelectedLead] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [history, setHistory] = useState<OutreachRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    get('/api/leads/saved').then(setLeads).catch(() => {});
    get('/api/outreach/history').then(setHistory).catch(() => {});
  }, []);

  async function sendEmail() {
    if (!selectedLead || !subject || !body) return alert('Fill all fields');
    setLoading(true);
    try { await post('/api/outreach/email', { leadId: selectedLead, subject, body }); setSubject(''); setBody(''); get('/api/outreach/history').then(setHistory).catch(() => {}); alert('Sent!'); }
    catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function sendWhatsApp() {
    if (!whatsappNumber || !body) return alert('Fill all fields');
    setLoading(true);
    try { await post('/api/outreach/whatsapp', { to: whatsappNumber, message: body }); setWhatsappNumber(''); setBody(''); get('/api/outreach/history').then(setHistory).catch(() => {}); alert('Sent!'); }
    catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  }

  const selectStyle: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'Syne, sans-serif' };

  return (
    <div>
      <PageHeader title="Outreach" subtitle="Send emails and WhatsApp messages" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', marginBottom: 16, background: 'var(--surface2)', borderRadius: 10, padding: 4, border: '1px solid var(--border)' }}>
            {(['email', 'whatsapp'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === t ? 'var(--accent)' : 'transparent', color: tab === t ? '#fff' : 'var(--muted)', border: 'none' }}>
                {t === 'email' ? '✉️ Email' : '💬 WhatsApp'}
              </button>
            ))}
          </div>
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {tab === 'email' ? (
                <>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Lead</label>
                    <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)} style={selectStyle}>
                      <option value="">-- Select lead --</option>
                      {leads.map(l => <option key={l.id} value={l.id}>{l.name} · {l.email || 'no email'}</option>)}
                    </select>
                  </div>
                  <Input label="Subject" value={subject} onChange={setSubject} placeholder="Email subject" />
                  <Textarea label="Body" value={body} onChange={setBody} placeholder="Email body..." rows={8} />
                  <Button onClick={sendEmail} disabled={loading}><Send size={14} style={{ marginRight: 6, display: 'inline' }} />{loading ? 'Sending...' : 'Send Email'}</Button>
                </>
              ) : (
                <>
                  <Input label="WhatsApp Number" value={whatsappNumber} onChange={setWhatsappNumber} placeholder="+1234567890" />
                  <Textarea label="Message" value={body} onChange={setBody} placeholder="Your message..." rows={8} />
                  <Button onClick={sendWhatsApp} disabled={loading}><MessageSquare size={14} style={{ marginRight: 6, display: 'inline' }} />{loading ? 'Sending...' : 'Send WhatsApp'}</Button>
                </>
              )}
            </div>
          </Card>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Send History</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.length === 0 && <Card><p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No outreach sent yet</p></Card>}
            {history.map(h => (
              <Card key={h.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text)', marginBottom: 4 }}>{h.leadName}</p>
                    {h.subject && <p className="text-xs" style={{ color: 'var(--muted)', marginBottom: 4 }}>{h.subject}</p>}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Badge color="muted">{h.channel}</Badge>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'DM Mono' }}>
                        <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />{new Date(h.sentAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {h.status === 'sent' ? <CheckCircle size={16} style={{ color: 'var(--success)' }} /> : <XCircle size={16} style={{ color: 'var(--danger)' }} />}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
