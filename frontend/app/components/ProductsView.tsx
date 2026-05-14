"use client";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface Product {
  id?: string;
  name: string;
  tagline: string;
  targetIndustry: string;
  targetRole: string;
  problemSolved: string;
  deliverables: string;
  excludes: string;
  timeline: string;
  price: string;
  tags: string[];
  productType: string;
  status?: string;
  createdAt?: string;
}

type ViewState = "list" | "edit";

const Spinner = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ animation: "spin 1s linear infinite" }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TagIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>
);

function DeliverableList({ text }: { text: string }) {
  const items = text.split("|").map(s => s.trim()).filter(Boolean);
  return (
    <ul style={{ margin: "4px 0 0 0", padding: 0, listStyle: "none" }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--text)", marginBottom: 3 }}>
          <span style={{ color: "var(--green)", marginTop: 2, flexShrink: 0 }}>✓</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ProductCard({
  product,
  onSave,
  onDiscard,
  isSaving,
  mode,
}: {
  product: Product;
  onSave: (p: Product) => void;
  onDiscard?: () => void;
  isSaving: boolean;
  mode: "suggest" | "saved";
}) {
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [current, setCurrent] = useState<Product>(product);
  const [showRefine, setShowRefine] = useState(false);
  const [err, setErr] = useState("");

  const handleRefine = async () => {
    if (!refinePrompt.trim()) return;
    setRefining(true);
    setErr("");
    try {
      const refined = await api.postLong<Product>("/api/products/refine", {
        product: current,
        prompt: refinePrompt,
      });
      setCurrent(refined);
      setRefinePrompt("");
      setShowRefine(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRefining(false);
    }
  };

  const statusColor = (s?: string) => {
    if (s === "active") return "chip-green";
    if (s === "disabled") return "chip-red";
    return "chip-blue";
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{current.name || "Untitled Product"}</span>
            <span className={`chip ${current.productType === "addon" ? "chip-orange" : "chip-blue"}`} style={{ fontSize: 10 }}>
              {current.productType === "addon" ? "Add-on" : "Core"}
            </span>
            {mode === "saved" && (
              <span className={`chip ${statusColor(current.status)}`} style={{ fontSize: 10 }}>
                {current.status}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>{current.tagline}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{current.price}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{current.timeline}</div>
        </div>
      </div>

      {/* Target */}
      <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        {current.targetIndustry && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            🏭 <strong>{current.targetIndustry}</strong>
          </span>
        )}
        {current.targetRole && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            👤 <strong>{current.targetRole}</strong>
          </span>
        )}
      </div>

      {/* Problem */}
      {current.problemSolved && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
          {current.problemSolved}
        </div>
      )}

      {/* Deliverables */}
      {current.deliverables && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            Deliverables
          </div>
          <DeliverableList text={current.deliverables} />
        </div>
      )}

      {/* Excludes */}
      {current.excludes && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            Not included
          </div>
          <div style={{ fontSize: 12, color: "var(--dim)" }}>
            {current.excludes.split("|").map(s => s.trim()).filter(Boolean).join(" · ")}
          </div>
        </div>
      )}

      {/* Tags */}
      {current.tags && current.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
          {current.tags.map((t, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", color: "var(--muted)" }}>
              <TagIcon />{t}
            </span>
          ))}
        </div>
      )}

      {/* Refine area */}
      {showRefine && (
        <div style={{ marginBottom: 10, background: "var(--bg)", borderRadius: 8, padding: 10 }}>
          <textarea
            className="input"
            placeholder="e.g. Change price to $3,500, add Power BI reporting as a deliverable, target NHS hospitals"
            value={refinePrompt}
            onChange={e => setRefinePrompt(e.target.value)}
            rows={2}
            style={{ fontSize: 12, marginBottom: 8, resize: "vertical" }}
          />
          {err && <div style={{ color: "var(--red)", fontSize: 11, marginBottom: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={handleRefine} disabled={refining || !refinePrompt.trim()}>
              {refining ? <><Spinner /> Refining...</> : "Refine"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowRefine(false); setRefinePrompt(""); setErr(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 4 }}>
        {mode === "suggest" && (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => onSave(current)} disabled={isSaving}>
              {isSaving ? <><Spinner /> Saving...</> : "Save Product"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowRefine(s => !s)} disabled={refining}>
              ✏️ Refine
            </button>
            {onDiscard && (
              <button className="btn btn-ghost btn-sm" onClick={onDiscard}>Discard</button>
            )}
          </>
        )}
        {mode === "saved" && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowRefine(s => !s)} disabled={refining}>
              ✏️ Refine & Update
            </button>
            {refining === false && showRefine === false && (
              <button className="btn btn-primary btn-sm" onClick={() => onSave(current)} disabled={isSaving}>
                {isSaving ? <><Spinner /> Saving...</> : "Save Changes"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ProductsView() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [saved, setSaved] = useState<Product[]>([]);
  const [suggested, setSuggested] = useState<Product[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewState, setViewState] = useState<ViewState>("list");
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // ── Load saved ─────────────────────────────────────────────────────────────
  useEffect(() => { loadSaved(); }, []);

  const loadSaved = async () => {
    setLoadingSaved(true);
    try {
      const list = await api.get<Product[]>("/api/products");
      setSaved(list);
    } catch (e: any) {
      showBanner("error", e.message);
    } finally {
      setLoadingSaved(false);
    }
  };

  const showBanner = (kind: "success" | "error", text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 4000);
  };

  // ── Keywords ───────────────────────────────────────────────────────────────
  const addKeyword = () => {
    const v = kwInput.trim();
    if (!v || keywords.includes(v)) return;
    setKeywords(k => [...k, v]);
    setKwInput("");
  };

  const removeKeyword = (kw: string) => setKeywords(k => k.filter(x => x !== kw));

  const handleKwKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKeyword(); }
  };

  // ── Generate ───────────────────────────────────────────────────────────────
  const generate = async () => {
    if (keywords.length === 0) return;
    setGenerating(true);
    setGenErr("");
    setSuggested([]);
    try {
      const products = await api.postLong<Product[]>("/api/products/generate", { keywords });
      setSuggested(products);
    } catch (e: any) {
      setGenErr(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // ── Save suggested ─────────────────────────────────────────────────────────
  const saveSuggested = async (p: Product, idx: number) => {
    const key = `suggest-${idx}`;
    setSavingId(key);
    try {
      await api.post<Product>("/api/products", p);
      setSuggested(s => s.filter((_, i) => i !== idx));
      await loadSaved();
      showBanner("success", `"${p.name}" saved.`);
    } catch (e: any) {
      showBanner("error", e.message);
    } finally {
      setSavingId(null);
    }
  };

  const discardSuggested = (idx: number) => setSuggested(s => s.filter((_, i) => i !== idx));

  // ── Update saved ───────────────────────────────────────────────────────────
  const updateSaved = async (p: Product) => {
    if (!p.id) return;
    setSavingId(p.id);
    try {
      await api.put<Product>(`/api/products/${p.id}`, p);
      await loadSaved();
      setEditingProduct(null);
      setViewState("list");
      showBanner("success", `"${p.name}" updated.`);
    } catch (e: any) {
      showBanner("error", e.message);
    } finally {
      setSavingId(null);
    }
  };

  // ── Toggle status ──────────────────────────────────────────────────────────
  const toggleStatus = async (p: Product) => {
    if (!p.id) return;
    setTogglingId(p.id);
    const newStatus = p.status === "active" ? "disabled" : "active";
    try {
      await api.put<Product>(`/api/products/${p.id}`, { ...p, status: newStatus });
      await loadSaved();
    } catch (e: any) {
      showBanner("error", e.message);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteProduct = async (p: Product) => {
    if (!p.id) return;
    if (!confirm(`Delete "${p.name}"?`)) return;
    setDeletingId(p.id);
    try {
      await api.delete(`/api/products/${p.id}`);
      setSaved(s => s.filter(x => x.id !== p.id));
      showBanner("success", `"${p.name}" deleted.`);
    } catch (e: any) {
      showBanner("error", e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setViewState("edit");
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Banner */}
      {banner && (
        <div className={`banner banner-${banner.kind}`} style={{ marginBottom: 16 }}>
          <span>{banner.text}</span>
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div className="page-title">Products</div>
        <div className="page-sub">Generate and manage your productised service packages</div>
      </div>

      {/* ── Generator section ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Generate Products from Keywords</div>
        <div className="card-sub">AI will search your portfolio and create tailored service packages</div>

        {/* Keyword input */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            className="input"
            placeholder="e.g. AI Integration, Azure AD, FHIR (press Enter to add)"
            value={kwInput}
            onChange={e => setKwInput(e.target.value)}
            onKeyDown={handleKwKey}
            style={{ flex: 1 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={addKeyword} disabled={!kwInput.trim()}>
            <PlusIcon /> Add
          </button>
        </div>

        {/* Keywords chips */}
        {keywords.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {keywords.map(kw => (
              <span key={kw} style={{
                display: "flex", alignItems: "center", gap: 4, fontSize: 12,
                background: "var(--accent-light)", color: "var(--accent-text)",
                border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 8px", fontWeight: 500
              }}>
                {kw}
                <button onClick={() => removeKeyword(kw)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
              </span>
            ))}
          </div>
        )}

        {genErr && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 10 }}>{genErr}</div>}

        <button
          className="btn btn-primary"
          onClick={generate}
          disabled={generating || keywords.length === 0}
          style={{ width: "fit-content" }}
        >
          {generating ? <><Spinner /> Generating Products...</> : "✨ Generate Products"}
        </button>
      </div>

      {/* ── Suggested products ── */}
      {suggested.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: "var(--accent)", color: "white", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{suggested.length}</span>
            Suggested Products — review, refine, then save
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {suggested.map((p, i) => (
              <ProductCard
                key={i}
                product={p}
                mode="suggest"
                isSaving={savingId === `suggest-${i}`}
                onSave={(updated) => saveSuggested(updated, i)}
                onDiscard={() => discardSuggested(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Saved products ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            Saved Products
            {saved.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>
                {saved.filter(p => p.status === "active").length} active · {saved.filter(p => p.status === "disabled").length} disabled
              </span>
            )}
          </div>
        </div>

        {loadingSaved ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
            <Spinner /> Loading...
          </div>
        ) : saved.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)", fontSize: 13 }}>
            No products yet. Generate some above.
          </div>
        ) : viewState === "edit" && editingProduct ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setViewState("list"); setEditingProduct(null); }}>
                ← Back
              </button>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Editing: {editingProduct.name}</span>
            </div>
            <div style={{ maxWidth: 480 }}>
              <ProductCard
                product={editingProduct}
                mode="saved"
                isSaving={savingId === editingProduct.id}
                onSave={updateSaved}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {saved.map(p => (
              <div key={p.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                {/* Left */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <span className={`chip ${p.productType === "addon" ? "chip-orange" : "chip-blue"}`} style={{ fontSize: 10 }}>
                      {p.productType === "addon" ? "Add-on" : "Core"}
                    </span>
                    <span className={`chip ${p.status === "active" ? "chip-green" : "chip-red"}`} style={{ fontSize: 10 }}>
                      {p.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{p.tagline}</div>
                </div>

                {/* Meta */}
                <div style={{ display: "flex", gap: 16, flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ fontWeight: 600, color: "var(--accent)" }}>{p.price}</span>
                  <span>{p.timeline}</span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)} title="Edit">
                    ✏️
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleStatus(p)}
                    disabled={togglingId === p.id}
                    title={p.status === "active" ? "Disable" : "Enable"}
                  >
                    {togglingId === p.id ? <Spinner /> : p.status === "active" ? "🔴" : "🟢"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => deleteProduct(p)}
                    disabled={deletingId === p.id}
                    title="Delete"
                    style={{ color: "var(--red)" }}
                  >
                    {deletingId === p.id ? <Spinner /> : "🗑"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
