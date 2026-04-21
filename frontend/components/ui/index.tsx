'use client';
import { ReactNode } from 'react';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
      {children}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false, size = 'md' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'button' | 'submit'; disabled?: boolean; size?: 'sm' | 'md';
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#fff', border: 'none' },
    secondary: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
    danger: { background: 'var(--danger)', color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      ...styles[variant], padding: size === 'sm' ? '6px 12px' : '9px 18px',
      borderRadius: '8px', fontSize: size === 'sm' ? '12px' : '14px', fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      transition: 'opacity 0.15s', fontFamily: 'Syne, sans-serif',
    }}>
      {children}
    </button>
  );
}

export function Input({ label, value, onChange, placeholder, type = 'text' }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '14px', outline: 'none', fontFamily: 'Syne, sans-serif', width: '100%' }} />
    </div>
  );
}

export function Textarea({ label, value, onChange, placeholder, rows = 4 }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>{label}</label>}
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '14px', outline: 'none', fontFamily: 'Syne, sans-serif', resize: 'vertical', width: '100%' }} />
    </div>
  );
}

export function Badge({ children, color = 'accent' }: { children: ReactNode; color?: 'accent' | 'success' | 'muted' }) {
  const colors = {
    accent: { bg: 'rgba(99,102,241,0.15)', color: 'var(--accent2)' },
    success: { bg: 'rgba(34,197,94,0.12)', color: 'var(--success)' },
    muted: { bg: 'rgba(107,107,138,0.12)', color: 'var(--muted)' },
  };
  return (
    <span style={{ ...colors[color], padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, fontFamily: 'DM Mono, monospace' }}>
      {children}
    </span>
  );
}
