"use client";

const NAV = [
  { id: "portfolio", label: "Portfolio", sub: "Intelligence Engine", icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/><path d="M15 2H6a2 2 0 0 0-2 2v11"/><path d="M16 18h4a2 2 0 0 0 2-2V7l-5-5"/><circle cx="12" cy="13" r="2"/></svg>
  ) },
  { id: "leads", label: "Lead Search", sub: "Apollo Integration", icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
  ) },
  { id: "email-gen", label: "AI Email Gen", sub: "RAG Powered", icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
  ) },
  { id: "outreach", label: "Outreach", sub: "Email + WhatsApp", icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
  ) },
  { id: "settings", label: "Settings", sub: "Configuration", icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  ) },
];

interface SidebarProps {
  active: string;
  onChange: (id: string) => void;
}

export default function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside style={{
      width: 240, minWidth: 240,
      background: "var(--sidebar-bg)",
      display: "flex", flexDirection: "column",
      height: "100vh",
      borderRight: "1px solid var(--sidebar-border)",
    }}>
      {/* Logo */}
      <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid var(--sidebar-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34,
            background: "linear-gradient(135deg, #2563EB 0%, #1E4372 100%)",
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 16,
            color: "#fff",
            letterSpacing: "-0.03em",
          }}>T</div>
          <div>
            <div style={{
              fontFamily: "Inter, sans-serif",
              fontWeight: 700, fontSize: 15,
              color: "var(--sidebar-text-bright)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}>TEKLead<span style={{ color: "#60A5FA" }}>.AI</span></div>
            <div style={{
              fontSize: 10, color: "var(--sidebar-text-dim)",
              letterSpacing: "0.08em", textTransform: "uppercase",
              marginTop: 2,
            }}>B2B Intelligence</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "16px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{
          padding: "4px 10px 10px",
          fontSize: 10,
          fontWeight: 600,
          color: "var(--sidebar-section)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}>Workspace</div>
        {NAV.map(item => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: isActive ? "var(--sidebar-active)" : "transparent",
                border: "none",
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                transition: "all 0.15s",
                position: "relative",
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--sidebar-hover)"; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{
                color: isActive ? "#60A5FA" : "var(--sidebar-text-dim)",
                flexShrink: 0,
                display: "flex",
              }}>{item.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--sidebar-text-bright)" : "var(--sidebar-text)",
                  lineHeight: 1.2,
                }}>{item.label}</div>
                <div style={{
                  fontSize: 10,
                  color: isActive ? "#93C5FD" : "var(--sidebar-text-dim)",
                  marginTop: 2,
                  letterSpacing: "0.02em",
                }}>{item.sub}</div>
              </div>
              {isActive && (
                <div style={{
                  position: "absolute", left: 0, top: "50%",
                  transform: "translateY(-50%)",
                  width: 3, height: 22,
                  background: "#60A5FA",
                  borderRadius: "0 3px 3px 0",
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "14px 20px",
        borderTop: "1px solid var(--sidebar-border)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="status-dot" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--sidebar-text)", fontWeight: 500 }}>System Online</div>
          <div style={{ fontSize: 9, color: "var(--sidebar-text-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>v1.0 · MVP</div>
        </div>
      </div>
    </aside>
  );
}
