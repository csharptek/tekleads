"use client";
import { useState } from "react";

const NAV = [
  { id: "portfolio", label: "Portfolio", icon: "◈", sub: "Intelligence Engine" },
  { id: "leads", label: "Lead Search", icon: "◎", sub: "Apollo Integration" },
  { id: "email-gen", label: "AI Email Gen", icon: "◆", sub: "RAG Powered" },
  { id: "outreach", label: "Outreach", icon: "◉", sub: "Email + WhatsApp" },
  { id: "settings", label: "Settings", icon: "⊞", sub: "Configuration" },
];

interface SidebarProps {
  active: string;
  onChange: (id: string) => void;
}

export default function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside style={{
      width: 220,
      minWidth: 220,
      background: "var(--bg-2)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "relative",
      zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{
        padding: "20px 16px 16px",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 28, height: 28,
            background: "var(--accent)",
            borderRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 800,
            color: "var(--bg)",
            fontFamily: "Syne, sans-serif",
          }}>T</div>
          <span style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            fontSize: 15,
            color: "var(--text)",
            letterSpacing: "-0.02em",
          }}>TEKLead <span style={{ color: "var(--accent)" }}>AI</span></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 2 }}>
          <span className="status-dot" />
          <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            System Online
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div className="label" style={{ padding: "4px 8px 8px", fontSize: 9 }}>Navigation</div>
        {NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 6,
                background: isActive ? "rgba(0,212,255,0.08)" : "transparent",
                border: isActive ? "1px solid rgba(0,212,255,0.2)" : "1px solid transparent",
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                transition: "all 0.15s",
              }}
              className={!isActive ? "btn-ghost" : ""}
            >
              <span style={{
                fontSize: 14,
                color: isActive ? "var(--accent)" : "var(--text-dim)",
                width: 18,
                textAlign: "center",
                flexShrink: 0,
              }}>{item.icon}</span>
              <div>
                <div style={{
                  fontFamily: "Syne, sans-serif",
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  letterSpacing: "-0.01em",
                }}>{item.label}</div>
                <div style={{
                  fontSize: 9,
                  color: isActive ? "rgba(0,212,255,0.6)" : "var(--text-dim)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  marginTop: 1,
                }}>{item.sub}</div>
              </div>
              {isActive && (
                <div style={{
                  marginLeft: "auto",
                  width: 3, height: 20,
                  background: "var(--accent)",
                  borderRadius: 2,
                  boxShadow: "0 0 8px var(--accent)",
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}>
        <div className="label" style={{ fontSize: 9 }}>Version</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>v1.0.0 — MVP</div>
      </div>
    </aside>
  );
}
