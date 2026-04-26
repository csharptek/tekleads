## Changes to ProposalView.tsx

### 1. Update props signature (line ~187):
```
export default function ProposalView({ onViewList, onGenerateProposal }: { 
  onViewList?: () => void; 
  onGenerateProposal?: (ctx: { proposalId: string; proposalHeadline?: string; clientName?: string; clientCompany?: string }) => void 
})
```

### 2. Add before SaveButtons component definition:
```tsx
const handleGenerateProposal = async () => {
  if (!form.jobPostBody.trim()) { setError("Job post is required to generate a proposal."); return; }
  if (!savedId) await handleSave(false);
  if (onGenerateProposal) {
    onGenerateProposal({
      proposalId: savedId || "new",
      proposalHeadline: form.jobPostHeadline || form.jobPostBody.slice(0, 60),
      clientName: form.clientName,
      clientCompany: form.clientCompany,
    });
  }
};
```

### 3. Add to SaveButtons (after "Save Draft" button):
```tsx
<button
  className={`btn ${sm ? "btn-sm" : ""}`}
  onClick={handleGenerateProposal}
  disabled={saving}
  style={{ background: "#0f172a", color: "white", border: "none" }}>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
  Generate Proposal
</button>
```
