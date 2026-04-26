## Changes to ProposalList.tsx

### 1. Update props signature:
```
export default function ProposalList({ onNew, onGenerateProposal }: { 
  onNew: () => void; 
  onGenerateProposal?: (ctx: { proposalId: string; proposalHeadline?: string; clientName?: string; clientCompany?: string }) => void 
})
```

### 2. In the drawer footer, after "Save Changes" button add:
```tsx
{onGenerateProposal && (
  <button className="btn btn-sm"
    onClick={() => onGenerateProposal({ 
      proposalId: drawer.id, 
      proposalHeadline: drawer.jobPostHeadline || drawer.jobPostBody?.slice(0, 60), 
      clientName: drawer.clientName, 
      clientCompany: drawer.clientCompany 
    })}
    style={{ background: "#0f172a", color: "white", border: "none" }}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
    Generate
  </button>
)}
```
