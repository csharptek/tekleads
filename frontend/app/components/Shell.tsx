"use client";
import { useState, useEffect } from "react";
import SettingsView from "./SettingsView";
import LeadSearchView from "./LeadSearchView";
import SavedLeadsView from "./SavedLeadsView";
import PortfolioView from "./PortfolioView";
import ProposalView from "./ProposalView";
import ProposalList from "./ProposalList";
import LogsView from "./LogsView";
import ProposalEditor from "./ProposalEditor";
import ProposalSettings from "./ProposalSettings";
import ArtifactsView from "./ArtifactsView";
import NewProposalView from "./NewProposalView";

type Page = "leads" | "prospects" | "portfolio" | "proposals" | "new-proposal" | "proposal-list" | "proposal-settings" | "proposal-editor" | "artifacts" | "settings" | "logs";

type EditorContext = { proposalId: string; proposalHeadline?: string; clientName?: string; clientCompany?: string; };
type ArtifactsContext = { proposalId: string; proposalHeadline?: string; clientName?: string; clientEmail?: string; clientPhone?: string; allEmails?: string[]; allPhones?: string[]; allEmailNames?: string[]; allPhoneNames?: string[]; autoGenerate?: boolean; };

type NavItem = { id: Page; label: string; icon: React.ReactNode; };
type NavCategory = { label: string; items: NavItem[]; };

const CATEGORIES: NavCategory[] = [
  {
    label: "Prospecting",
    items: [
      { id: "leads", label: "Lead Search", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> },
      { id: "prospects", label: "Saved Leads", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { id: "portfolio", label: "My Portfolio", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg> },
    ],
  },
  {
    label: "Proposals",
    items: [
      { id: "new-proposal", label: "New Prospect", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="2"/><line x1="12" y1="11" x2="12" y2="12"/></svg> },
      { id: "proposal-list", label: "All Prospects", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
      { id: "proposal-settings", label: "Proposal Settings", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="10" cy="15" r="2"/></svg> },
    ],
  },
  {
    label: "System",
    items: [
      { id: "logs", label: "API Logs", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
      { id: "settings", label: "Settings", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
    ],
  },
];

const ChevronLeft = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>;
const ChevronRight = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>;
const MenuIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
const CloseIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;

export default function Shell() {
  const [page, setPage] = useState<Page>("leads");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [editorCtx, setEditorCtx] = useState<EditorContext | null>(null);
  const [editProposalId, setEditProposalId] = useState<string | null>(null);
  const [artifactsCtx, setArtifactsCtx] = useState<ArtifactsContext | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const navigate = (id: Page) => { setPage(id); setMobileOpen(false); };

  const openEditor = (ctx: EditorContext) => {
    setEditorCtx(ctx);
    navigate("proposal-editor");
  };

  const openEdit = (proposalId: string) => {
    setEditProposalId(proposalId);
    navigate("proposals");
  };

  const openArtifacts = (ctx: ArtifactsContext) => {
    setArtifactsCtx(ctx);
    navigate("artifacts");
  };

  // If proposal editor is full-screen, render without shell
  if (page === "proposal-editor" && editorCtx) {
    return (
      <ProposalEditor
        {...editorCtx}
        onBack={() => { navigate("proposal-list"); setEditorCtx(null); }}
      />
    );
  }

  const sidebarClass = [
    "sidebar",
    collapsed && !isMobile ? "collapsed" : "",
    isMobile && mobileOpen ? "mobile-open" : "",
  ].filter(Boolean).join(" ");

  const currentLabel = CATEGORIES.flatMap(c => c.items).find(i => i.id === page)?.label || "";

  return (
    <div className="shell">
      <div className="topbar">
        <button className="hamburger" onClick={() => setMobileOpen(o => !o)} aria-label="Toggle menu"
          style={{ background: "none", border: "none", cursor: "pointer", color: "white", display: "flex", alignItems: "center" }}>
          {mobileOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
        <div className="topbar-logo">TEK<span>Lead</span> AI</div>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--sidebar-text)" }}>{currentLabel}</div>
      </div>

      <div className={`sidebar-overlay ${mobileOpen ? "mobile-open" : ""}`} onClick={() => setMobileOpen(false)} />

      <aside className={sidebarClass}>
        <div className="sidebar-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--sidebar-active)" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <span className="logo-text">TEK<span>Lead</span> AI</span>
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </button>
        </div>
        <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {CATEGORIES.map((cat, ci) => (
            <div key={cat.label} className="nav-section">
              {ci > 0 && <div className="nav-divider" />}
              <div className="nav-section-label">{cat.label}</div>
              {cat.items.map(item => (
                <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`}
                  onClick={() => navigate(item.id)} data-label={item.label}>
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: "12px 10px", borderTop: "1px solid #1e293b" }}>
          <div style={{ fontSize: 11, color: "#475569", textAlign: "center" }} className="nav-label">TEKLead AI v1.0</div>
        </div>
      </aside>

      <div className="main">
        {page === "leads"             && <LeadSearchView />}
        {page === "prospects"         && <SavedLeadsView />}
        {page === "portfolio"         && <PortfolioView />}
        {page === "proposals"         && <ProposalView onViewList={() => navigate("proposal-list")} onGenerateProposal={openEditor} onGenerateArtifacts={openArtifacts} editProposalId={editProposalId} onEditDone={() => setEditProposalId(null)} />}
        {page === "new-proposal"      && <NewProposalView onViewList={() => navigate("proposal-list")} onGenerateArtifacts={openArtifacts} />}
        {page === "proposal-list"     && <ProposalList onNew={() => navigate("proposals")} onEdit={openEdit} onGenerateProposal={openEditor} onGenerateArtifacts={openArtifacts} />}
        {page === "proposal-settings" && <ProposalSettings />}
        {page === "artifacts"         && artifactsCtx && <ArtifactsView {...artifactsCtx} onBack={() => navigate("proposal-list")} />}
        {page === "settings"          && <SettingsView />}
        {page === "logs"              && <LogsView />}
      </div>
    </div>
  );
}
