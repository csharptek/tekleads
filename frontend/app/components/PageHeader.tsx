"use client";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div style={{
      padding: "20px 28px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "var(--bg-card)",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {icon && (
          <div style={{
            width: 40, height: 40,
            background: "var(--accent-light)",
            border: "1px solid var(--accent-light)",
            borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--accent)",
            flexShrink: 0,
          }}>{icon}</div>
        )}
        <div>
          <h1 style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text)",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}>{title}</h1>
          {subtitle && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{subtitle}</div>
          )}
        </div>
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}
