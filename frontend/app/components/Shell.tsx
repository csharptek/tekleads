"use client";
import { useState } from "react";
import SettingsView from "./SettingsView";
import LeadSearchView from "./LeadSearchView";
import SavedLeadsView from "./SavedLeadsView";

type Page = "leads" | "prospects" | "settings";

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  {
    id: "leads",
    label: "Lead Search",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  },
  {
    id: "prospects",
    label: "Saved Prospects",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
];

export default function Shell() {
  const [page, setPage] = useState<Page>("leads");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-logo">TEK<span>Lead</span> AI</div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="main">
        {page === "leads"     && <LeadSearchView />}
        {page === "prospects" && <SavedLeadsView />}
        {page === "settings"  && <SettingsView />}
      </div>
    </div>
  );
}
