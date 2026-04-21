"use client";
import { useState } from "react";
import PageHeader from "../components/PageHeader";

interface Lead {
  id: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  email?: string;
  saved?: boolean;
}

const MOCK_RESULTS: Lead[] = [
  { id: "1", name: "Sarah Chen", title: "VP of Engineering", company: "Nexora Systems", industry: "SaaS", location: "San Francisco, CA", email: "s.chen@nexora.com" },
  { id: "2", name: "Marcus Webb", title: "CTO", company: "HealthBridge Inc.", industry: "Healthcare", location: "Austin, TX", email: "m.webb@healthbridge.io" },
  { id: "3", name: "Priya Nair", title: "Head of Digital Transformation", company: "Apex Logistics", industry: "Logistics", location: "Chicago, IL", email: "" },
  { id: "4", name: "James Folarin", title: "Director of IT", company: "ClearBank", industry: "Finance", location: "New York, NY", email: "j.folarin@clearbank.com" },
  { id: "5", name: "Lena Hoffmann", title: "Chief Digital Officer", company: "EuroTech AG", industry: "Manufacturing", location: "Berlin, DE", email: "" },
];

export default function LeadSearchPage() {
  const [filters, setFilters] = useState({ company: "", person: "", title: "", industry: "", location: "" });
  const [results, setResults] = useState<Lead[]>([]);
  const [saved, setSaved] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"search" | "saved">("search");
  const [selected, setSelected] = useState<Lead | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setResults(MOCK_RESULTS);
    setLoading(false);
  };

  const toggleSave = (lead: Lead) => {
    setSaved(prev => {
      const exists = prev.find(l => l.id === lead.id);
      return exists ? prev.filter(l => l.id !== lead.id) : [...prev, lead];
    });
  };

  const isSaved = (id: string) => saved.some(l => l.id === id);
  const displayList = tab === "saved" ? saved : results;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Lead Search"
        subtitle="Discover prospects via Apollo integration"
        icon="◎"
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Filters */}
        <div style={{
          width: 260,
          borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "16px 14px", borderBottom: "1px solid var(--border)" }}>
            <div className="label" style={{ marginBottom: 12 }}>Search Filters</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { key: "company", placeholder: "Company name" },
                { key: "person", placeholder: "Person name" },
                { key: "title", placeholder: "Job title" },
                { key: "industry", placeholder: "Industry" },
                { key: "location", placeholder: "Location" },
              ].map(({ key, placeholder }) => (
                <div key={key}>
                  <div className="label" style={{ marginBottom: 4, fontSize: 9 }}>{key.toUpperCase()}</div>
                  <input
                    className="input"
                    style={{ fontSize: 11 }}
                    placeholder={placeholder}
                    value={(filters as any)[key]}
                    onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <button
                className="btn btn-primary"
                style={{ marginTop: 4, justifyContent: "center" }}
                onClick={handleSearch}
                disabled={loading}
              >
                {loading ? "Searching..." : "Search Apollo"}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Results", value: results.length },
                { label: "Saved", value: saved.length },
              ].map(({ label, value }) => (
                <div key={label} className="card" style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 18, fontFamily: "Syne, sans-serif", fontWeight: 700, color: "var(--accent)" }}>{value}</div>
                  <div className="label" style={{ fontSize: 9, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tabs */}
          <div style={{
            display: "flex", gap: 0,
            borderBottom: "1px solid var(--border)",
            padding: "0 16px",
          }}>
            {(["search", "saved"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  fontFamily: "DM Mono, monospace",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  padding: "12px 16px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: tab === t ? "var(--accent)" : "var(--text-muted)",
                  borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                {t === "search" ? `Results (${results.length})` : `Saved (${saved.length})`}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* List */}
            <div className="scroll-y" style={{ width: 320, borderRight: "1px solid var(--border)", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {displayList.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-dim)" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>◎</div>
                  <div style={{ fontSize: 11 }}>
                    {tab === "search" ? "Run a search to see results" : "No saved leads yet"}
                  </div>
                </div>
              ) : displayList.map(lead => (
                <div
                  key={lead.id}
                  className={`card ${selected?.id === lead.id ? "card-active" : ""}`}
                  style={{ padding: "11px 13px", cursor: "pointer" }}
                  onClick={() => setSelected(lead)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontFamily: "Syne, sans-serif", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{lead.name}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>{lead.title}</div>
                      <div style={{ fontSize: 10, color: "var(--accent)" }}>{lead.company}</div>
                    </div>
                    <button
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: 9 }}
                      onClick={e => { e.stopPropagation(); toggleSave(lead); }}
                    >
                      {isSaved(lead.id) ? "★" : "☆"}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                    <span className="chip">{lead.industry}</span>
                    <span className="chip">{lead.location}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Detail */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {selected ? (
                <div className="fade-in" style={{ padding: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{selected.name}</h2>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{selected.title}</div>
                      <div style={{ fontSize: 12, color: "var(--accent)" }}>{selected.company}</div>
                    </div>
                    <button
                      className="btn"
                      style={{ fontSize: 10 }}
                      onClick={() => toggleSave(selected)}
                    >
                      {isSaved(selected.id) ? "★ Saved" : "☆ Save"}
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    {[
                      { label: "Industry", value: selected.industry },
                      { label: "Location", value: selected.location },
                      { label: "Email", value: selected.email || "—" },
                      { label: "Company", value: selected.company },
                    ].map(({ label, value }) => (
                      <div key={label} className="card" style={{ padding: "11px 13px" }}>
                        <div className="label" style={{ fontSize: 9, marginBottom: 5 }}>{label}</div>
                        <div style={{ fontSize: 12, color: "var(--text)" }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <button className="btn btn-primary">
                    ◆ Generate AI Email
                  </button>
                </div>
              ) : (
                <div style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  height: "100%", color: "var(--text-dim)",
                }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>◎</div>
                  <div style={{ fontSize: 11 }}>Select a lead to view details</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
