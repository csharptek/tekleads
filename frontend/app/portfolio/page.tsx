'use client';
import { useState, useEffect } from 'react';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { PageHeader, Card, Button, Input, Textarea, Badge } from '@/components/ui';
import { get, post, del } from '@/lib/api';

interface Project {
  id: string; title: string; industry: string; tags: string[];
  problem: string; solution: string; techStack: string; outcomes: string; links: string;
}
const empty = () => ({ title: '', industry: '', tags: [] as string[], problem: '', solution: '', techStack: '', outcomes: '', links: '' });

export default function PortfolioPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState(empty());
  const [tagInput, setTagInput] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() { try { setProjects(await get('/api/portfolio')); } catch {} }

  async function handleSubmit() {
    setLoading(true);
    try { await post('/api/portfolio', form); setForm(empty()); setTagInput(''); setShowForm(false); load(); }
    catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete?')) return;
    try { await del(`/api/portfolio/${id}`); load(); } catch {}
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) setForm(f => ({ ...f, tags: [...f.tags, t] }));
    setTagInput('');
  }

  const f = (key: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [key]: v }));

  return (
    <div>
      <PageHeader title="Portfolio" subtitle="Manage projects for AI-powered outreach"
        action={<Button onClick={() => setShowForm(s => !s)}><Plus size={14} style={{ marginRight: 6, display: 'inline' }} />Add Project</Button>} />

      {showForm && (
        <Card className="mb-8">
          <h2 className="text-base font-semibold mb-5" style={{ color: 'var(--text)' }}>New Project</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <Input label="Project Title *" value={form.title} onChange={f('title')} placeholder="e.g. AI Invoice Processor" />
            <Input label="Industry *" value={form.industry} onChange={f('industry')} placeholder="e.g. Fintech" />
            <div style={{ gridColumn: '1/-1' }}><Textarea label="Problem Statement" value={form.problem} onChange={f('problem')} placeholder="What problem did you solve?" rows={2} /></div>
            <div style={{ gridColumn: '1/-1' }}><Textarea label="Solution" value={form.solution} onChange={f('solution')} placeholder="How did you solve it?" rows={2} /></div>
            <Input label="Tech Stack" value={form.techStack} onChange={f('techStack')} placeholder="React, .NET, Azure..." />
            <Input label="Outcomes" value={form.outcomes} onChange={f('outcomes')} placeholder="e.g. 40% cost reduction" />
            <div style={{ gridColumn: '1/-1' }}><Input label="Links" value={form.links} onChange={f('links')} placeholder="https://..." /></div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Tags</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                  placeholder="Type tag + Enter"
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'Syne, sans-serif' }} />
                <Button size="sm" variant="secondary" onClick={addTag}>Add</Button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {form.tags.map(t => (
                  <span key={t} onClick={() => setForm(f => ({ ...f, tags: f.tags.filter(x => x !== t) }))}
                    style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent2)', padding: '3px 10px', borderRadius: 4, fontSize: 12, fontFamily: 'DM Mono', cursor: 'pointer' }}>
                    {t} ×
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Saving...' : 'Save Project'}</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {projects.length === 0 && !showForm && (
        <Card><p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>No projects yet. Add your first project.</p></Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {projects.map(p => (
          <Card key={p.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text)', marginBottom: 4 }}>{p.title}</h3>
                <Badge color="muted">{p.industry}</Badge>
              </div>
              <button onClick={() => handleDelete(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                <Trash2 size={14} />
              </button>
            </div>
            {p.problem && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>{p.problem.slice(0, 100)}{p.problem.length > 100 ? '...' : ''}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {p.tags.map(t => <Badge key={t}>{t}</Badge>)}
            </div>
            {p.outcomes && (
              <div style={{ padding: '8px 10px', background: 'rgba(34,197,94,0.06)', borderRadius: 6, border: '1px solid rgba(34,197,94,0.15)' }}>
                <p style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'DM Mono' }}>{p.outcomes}</p>
              </div>
            )}
            {p.links && (
              <a href={p.links} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, fontSize: 12, color: 'var(--accent2)', textDecoration: 'none' }}>
                <ExternalLink size={11} /> View Project
              </a>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
