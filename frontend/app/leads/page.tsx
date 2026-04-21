'use client';
import { useState } from 'react';
import { Search, UserPlus, Bookmark, Phone, ChevronLeft, ChevronRight, Mail } from 'lucide-react';
import { PageHeader, Card, Button, Input, Badge } from '@/components/ui';
import { post, get } from '@/lib/api';

interface Lead {
  id?: string; apolloId?: string; name: string; title: string; company: string;
  industry: string; location: string; emails: string[]; phones: string[]; linkedinUrl?: string;
}

export default function LeadsPage() {
  const [filters, setFilters] = useState({ company: '', personName: '', jobTitle: '', industry: '', location: '' });
  const [results, setResults] = useState<Lead[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Map<number, string>>(new Map());
  const [revealing, setRevealing] = useState<Set<string>>(new Set());

  const f = (key: keyof typeof filters) => (v: string) => setFilters(p => ({ ...p, [key]: v }));

  async function search(p: number) {
    setLoading(true);
    try {
      const data = await post('/api/leads/search', { ...filters, page: p, perPage: 25 });
      setResults(data.leads);
      setHasMore(data.hasMore);
      setPage(p);
      setSaved(new Set());
      setSavedIds(new Map());
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function handleSave(lead: Lead, idx: number) {
    try {
      const saved = await post('/api/leads/save', lead);
      setSaved(s => new Set(s).add(idx));
      setSavedIds(m => new Map(m).set(idx, saved.id));
    } catch (e: any) { alert(e.message); }
  }

  async function handleReveal(idx: number, apolloId: string) {
    const savedId = savedIds.get(idx);
    if (!savedId) { alert('Save this lead first before revealing phones.'); return; }
    setRevealing(r => new Set(r).add(savedId));
    try {
      const data = await post(`/api/leads/${savedId}/reveal-phones`, { apolloPersonId: apolloId });
      setResults(r => r.map((lead, i) => i === idx ? { ...lead, phones: data.phones } : lead));
    } catch (e: any) { alert(e.message); }
    finally { setRevealing(r => { const n = new Set(r); n.delete(savedId); return n; }); }
  }

  return (
    <div>
      <PageHeader title="Lead Search" subtitle="Discover leads via Apollo" />

      <Card className="mb-8">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
          <Input label="Company" value={filters.company} onChange={f('company')} placeholder="e.g. Stripe" />
          <Input label="Person Name" value={filters.personName} onChange={f('personName')} placeholder="e.g. John Smith" />
          <Input label="Job Title" value={filters.jobTitle} onChange={f('jobTitle')} placeholder="e.g. CTO" />
          <Input label="Industry" value={filters.industry} onChange={f('industry')} placeholder="e.g. Fintech" />
          <Input label="Location" value={filters.location} onChange={f('location')} placeholder="e.g. New York" />
        </div>
        <Button onClick={() => search(1)} disabled={loading}>
          <Search size={14} style={{ marginRight: 6, display: 'inline' }} />
          {loading ? 'Searching...' : 'Search Leads'}
        </Button>
      </Card>

      {results.length > 0 && (
        <div>
          {/* Pagination bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <p className="text-sm mono" style={{ color: 'var(--muted)' }}>
              Page {page} · {results.length} results
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={() => search(page - 1)} disabled={page === 1 || loading}>
                <ChevronLeft size={14} style={{ display: 'inline' }} /> Prev
              </Button>
              <Button size="sm" variant="ghost" onClick={() => search(page + 1)} disabled={!hasMore || loading}>
                Next <ChevronRight size={14} style={{ display: 'inline' }} />
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((lead, i) => {
              const isSaved = saved.has(i);
              const savedId = savedIds.get(i);
              const isRevealing = savedId ? revealing.has(savedId) : false;

              return (
                <Card key={i}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1 }}>
                      {/* Avatar */}
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--accent2)', flexShrink: 0 }}>
                        {lead.name?.[0] || '?'}
                      </div>

                      <div style={{ flex: 1 }}>
                        {/* Name + badges */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{lead.name}</p>
                          <Badge color="muted">{lead.industry}</Badge>
                          <Badge color="muted">{lead.location}</Badge>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--muted)', marginBottom: 8 }}>{lead.title} · {lead.company}</p>

                        {/* Emails */}
                        {lead.emails?.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                            {lead.emails.map(e => (
                              <span key={e} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent2)', fontFamily: 'DM Mono, monospace', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                                <Mail size={10} />{e}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Phones */}
                        {lead.phones?.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {lead.phones.map(p => (
                              <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--success)', fontFamily: 'DM Mono, monospace', background: 'rgba(34,197,94,0.08)', padding: '2px 8px', borderRadius: 4 }}>
                                <Phone size={10} />{p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <Button size="sm" variant={isSaved ? 'ghost' : 'secondary'} onClick={() => handleSave(lead, i)} disabled={isSaved}>
                        <Bookmark size={12} style={{ marginRight: 4, display: 'inline' }} />
                        {isSaved ? 'Saved' : 'Save'}
                      </Button>
                      {isSaved && lead.phones?.length === 0 && lead.apolloId && (
                        <Button size="sm" variant="ghost" onClick={() => handleReveal(i, lead.apolloId!)} disabled={isRevealing}>
                          <Phone size={12} style={{ marginRight: 4, display: 'inline' }} />
                          {isRevealing ? 'Revealing...' : 'Reveal Phone'}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Bottom pagination */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
            <Button size="sm" variant="secondary" onClick={() => search(page - 1)} disabled={page === 1 || loading}>
              <ChevronLeft size={14} style={{ display: 'inline' }} /> Previous
            </Button>
            <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center', fontFamily: 'DM Mono' }}>Page {page}</span>
            <Button size="sm" variant="secondary" onClick={() => search(page + 1)} disabled={!hasMore || loading}>
              Next <ChevronRight size={14} style={{ display: 'inline' }} />
            </Button>
          </div>
        </div>
      )}

      {results.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <UserPlus size={32} style={{ color: 'var(--muted)', margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Search for leads using the filters above</p>
        </div>
      )}
    </div>
  );
}
