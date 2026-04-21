"use client";
import { useState } from "react";
import Sidebar from "./components/Sidebar";
import PortfolioPage from "./pages/PortfolioPage";
import LeadSearchPage from "./pages/LeadSearchPage";
import EmailGenPage from "./pages/EmailGenPage";
import OutreachPage from "./pages/OutreachPage";
import SettingsPage from "./pages/SettingsPage";

const PAGES: Record<string, React.ReactNode> = {
  portfolio: <PortfolioPage />,
  leads: <LeadSearchPage />,
  "email-gen": <EmailGenPage />,
  outreach: <OutreachPage />,
  settings: <SettingsPage />,
};

export default function App() {
  const [active, setActive] = useState("portfolio");

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }} className="grid-bg">
      <Sidebar active={active} onChange={setActive} />
      <main style={{ flex: 1, overflow: "hidden", background: "var(--bg)" }}>
        {PAGES[active]}
      </main>
    </div>
  );
}
