'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, Search, Mail, Send, Settings, Zap, LogOut, ChevronDown
} from 'lucide-react';

const nav = [
  {
    section: 'OVERVIEW',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutGrid },
    ],
  },
  {
    section: 'WORKSPACE',
    items: [
      { href: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
      { href: '/leads', label: 'Leads', icon: Search },
      { href: '/email', label: 'AI Email', icon: Mail },
      { href: '/outreach', label: 'Outreach', icon: Send },
    ],
  },
  {
    section: 'SYSTEM',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside
      style={{
        position: 'fixed',
        left: 0, top: 0, bottom: 0,
        width: 240,
        background: 'var(--sidebar-bg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
      }}
    >
      {/* Brand */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'linear-gradient(135deg, #2563EB, #1E40AF)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
          }}>
            <Zap size={18} color="#fff" fill="#fff" />
          </div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>
              TEKLead
            </div>
            <div style={{ color: 'var(--sidebar-text-dim)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 1 }}>
              AI · Outreach
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>
        {nav.map((group) => (
          <div key={group.section} style={{ marginBottom: 24 }}>
            <div style={{
              padding: '0 12px 8px',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--sidebar-section)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              {group.section}
              <ChevronDown size={13} opacity={0.6} />
            </div>
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? path === '/' : path.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    color: active ? 'var(--sidebar-text-bright)' : 'var(--sidebar-text)',
                    background: active ? 'var(--sidebar-active)' : 'transparent',
                    textDecoration: 'none',
                    marginBottom: 2,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget.style.background = 'var(--sidebar-hover)');
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget.style.background = 'transparent');
                  }}
                >
                  <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid var(--sidebar-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: '#1E4372',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 600, fontSize: 13,
          flexShrink: 0,
        }}>
          B
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Bhanu | CEO
          </div>
          <div style={{ color: 'var(--sidebar-text-dim)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Admin
          </div>
        </div>
        <button style={{
          background: 'transparent', border: 'none', color: 'var(--sidebar-text-dim)',
          cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex',
        }}>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
