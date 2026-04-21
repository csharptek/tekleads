'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Search, Mail, Send, Settings, Zap } from 'lucide-react';

const nav = [
  { href: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
  { href: '/leads', label: 'Leads', icon: Search },
  { href: '/email', label: 'AI Email', icon: Mail },
  { href: '/outreach', label: 'Outreach', icon: Send },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="fixed left-0 top-0 h-full w-56 flex flex-col z-50"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-5 py-5 mb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: 'var(--accent)' }}>
          <Zap size={14} color="#fff" fill="#fff" />
        </div>
        <span className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          TEKLead<span style={{ color: 'var(--accent)' }}> AI</span>
        </span>
      </div>
      <nav className="flex-1 px-3 py-2 flex flex-col gap-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                color: active ? 'var(--accent2)' : 'var(--muted)',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
              <Icon size={16} />{label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="mono text-xs" style={{ color: 'var(--muted)' }}>v1.0.0</span>
      </div>
    </aside>
  );
}
