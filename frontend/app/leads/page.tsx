'use client';
import { useState } from 'react';
import { Search, Save, Phone, ChevronLeft, ChevronRight, Mail, Linkedin, MapPin, Building2, Briefcase, Users, X } from 'lucide-react';
import { post } from '@/lib/api';

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
  const [error, setError] = useState<string>('');

  const f = (key: keyof typeof filters) => (v: string) => setFilters(p => ({ ...p, [key]: v }));

  async function search(p: number) {
    setLoading(true);
    setError('');
    try {
      const data = await post('/api/leads/search', { ...filters, page: p, perPage: 25 });
      setResults(data.leads || []);
      setHasMore(data.hasMore);
      setPage(p);
      setSaved(new Set());
      setSavedIds(new Map());
    } catch (e: any) { setError(e.message || 'Search failed'); }
    finally { setLoading(false); }
  }

  async function handleSave(lead: Lead, idx: number) {
    try {
      const s = await post('/api/leads/save', lead);
      setSaved(n => new Set(n).add(idx));
      setSavedIds(m => new Map(m).set(idx, s.id));
    } catch (e: any) { setError(e.message); }
  }

  async function handleReveal(idx: number, apolloId: string) {
    const savedId = savedIds.get(idx);
    if (!savedId) { setError('Save this lead first before revealing phones.'); return; }
    setRevealing(r => new Set(r).add(savedId));
    try {
      const data = await post(`/api/leads/${savedId}/reveal-phones`, { apolloPersonId: apolloId });
      setResults(prev => prev.map((l, i) => i === idx ? { ...l, phones: data.phones || [] } : l));
    } catch (e: any) { setError(e.message); }
    finally { setRevealing(r => { const n = new Set(r); n.delete(savedId); return n; }); }
  }

  return (
    <div style={{ padding: '32px 40px 60px' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 14, color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>Lead Discovery</span>
        <span className="badge badge-blue">APOLLO</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
            Lead Discovery
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Search Apollo's database for prospects and save them to your outreach list
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 80,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{results.length}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>Results</div>
          </div>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 80,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{saved.size}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>Saved</div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
          padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#991B1B', fontSize: 13 }}>
            <X size={16} /> <span style={{ wordBreak: 'break-word' }}>{error}</span>
          </div>
          <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: '#991B1B', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filters card */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: 'var(--accent-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Search size={18} color="var(--accent)" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Search Filters</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Narrow down your lead search</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 20 }}>
          <Field icon={Building2} label="Company" value={filters.company} onChange={f('company')} placeholder="e.g. Stripe" onEnter={() => search(1)} />
          <Field icon={Users} label="Person Name" value={filters.personName} onChange={f('personName')} placeholder="e.g. John Doe" onEnter={() => search(1)} />
          <Field icon={Briefcase} label="Job Title" value={filters.jobTitle} onChange={f('jobTitle')} placeholder="e.g. VP Engineering" onEnter={() => search(1)} />
          <Field icon={Building2} label="Industry" value={filters.industry} onChange={f('industry')} placeholder="e.g. Fintech" onEnter={() => search(1)} />
          <Field icon={MapPin} label="Location" value={filters.location} onChange={f('location')} placeholder="e.g. San Francisco" onEnter={() => search(1)} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={loading} onClick={() => search(1)}>
            {loading ? <><span className="spinner" /> Searching…</> : <><Search size={16} /> Search Leads</>}
          </button>
          <button className="btn" onClick={() => {
            setFilters({ company: '', personName: '', jobTitle: '', industry: '', location: '' });
            setResults([]);
            setError('');
          }}>
            Clear
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{
            padding: '18px 24px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>
              Results <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>· Page {page}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" disabled={page <= 1 || loading} onClick={() => search(page - 1)}>
                <ChevronLeft size={14} /> Prev
              </button>
              <button className="btn btn-sm" disabled={!hasMore || loading} onClick={() => search(page + 1)}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div>
            {results.map((lead, idx) => {
              const isSaved = saved.has(idx);
              const isRevealing = savedIds.has(idx) && revealing.has(savedIds.get(idx)!);
              return (
                <div key={idx} style={{
                  padding: '18px 24px',
                  borderBottom: idx === results.length - 1 ? 'none' : '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 20,
                  alignItems: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-muted)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{lead.name || '—'}</div>
                      {lead.linkedinUrl && (
                        <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" style={{ color: '#0A66C2', display: 'flex' }}>
                          <Linkedin size={14} />
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>{lead.title || '—'}</span>
                      <span style={{ color: 'var(--text-dim)' }}>·</span>
                      <span style={{ fontWeight: 500, color: 'var(--text)' }}>{lead.company || '—'}</span>
                      <span style={{ color: 'var(--text-dim)' }}>·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={11} /> {lead.location || '—'}
                      </span>
                      {lead.industry && (<>
                        <span style={{ color: 'var(--text-dim)' }}>·</span>
                        <span>{lead.industry}</span>
                      </>)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {lead.emails?.map((em, i) => (
                        <span key={i} className="badge badge-blue" style={{ textTransform: 'none', letterSpacing: 0 }}>
                          <Mail size={10} /> {em}
                        </span>
                      ))}
                      {lead.phones?.map((ph, i) => (
                        <span key={i} className="badge badge-green" style={{ textTransform: 'none', letterSpacing: 0 }}>
                          <Phone size={10} /> {ph}
                        </span>
                      ))}
                      {(!lead.emails || lead.emails.length === 0) && (
                        <span className="badge badge-gray" style={{ textTransform: 'none', letterSpacing: 0 }}>No email</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {!isSaved ? (
                      <button className="btn btn-sm btn-primary" onClick={() => handleSave(lead, idx)}>
                        <Save size={13} /> Save
                      </button>
                    ) : (
                      <span className="badge badge-green">✓ Saved</span>
                    )}
                    {isSaved && lead.apolloId && (lead.phones?.length ?? 0) === 0 && (
                      <button className="btn btn-sm" disabled={isRevealing} onClick={() => handleReveal(idx, lead.apolloId!)}>
                        {isRevealing ? <><span className="spinner spinner-dark" /> </> : <><Phone size={13} /> Reveal</>}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            padding: '14px 24px', borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <button className="btn btn-sm" disabled={page <= 1 || loading} onClick={() => search(page - 1)}>
              <ChevronLeft size={14} /> Previous
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page <strong style={{ color: 'var(--text)' }}>{page}</strong></span>
            <button className="btn btn-sm" disabled={!hasMore || loading} onClick={() => search(page + 1)}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {!loading && results.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 56 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          }}>
            <Search size={22} color="var(--text-dim)" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Start a lead search</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Enter filters above and click <strong>Search Leads</strong></div>
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, value, onChange, placeholder, onEnter }: any) {
  return (
    <div>
      <label className="label">{label}</label>
      <div style={{ position: 'relative' }}>
        <Icon size={15} style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-dim)', pointerEvents: 'none',
        }} />
        <input
          className="input"
          style={{ paddingLeft: 36 }}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        />
      </div>
    </div>
  );
}
