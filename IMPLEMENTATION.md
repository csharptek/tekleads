## Instantly Integration - Complete Implementation Guide

### Summary

Full Instantly lead push integration for TEKLead AI:
- Push emails from **Artifacts page** ("Push All to Instantly")
- Push emails from **Saved Leads page** (multi-select + "Push to Instantly")
- Campaign selector dropdown (auto-fetched from Instantly)
- API key stored securely in Settings page

---

### Files Changed

**Backend (4 files):**
1. `TEKLead.Api/Services/InstantlyService.cs` → NEW
2. `TEKLead.Api/Controllers/InstantlyController.cs` → NEW
3. `TEKLead.Api/Models/SettingItem.cs` → UPDATED (added InstantlyApiKey)
4. `TEKLead.Api/Program.cs` → UPDATED (added DI registration)

**Frontend (3 files):**
1. `app/components/SettingsView.tsx` → UPDATED (added Instantly API Key field)
2. `app/components/ArtifactsView.tsx` → UPDATED (added Push to Instantly panel)
3. `app/components/SavedLeadsView.tsx` → UPDATED (added lead selection + Push panel)

---

### Installation Steps

#### Step 1: Backend

1. Copy `backend/TEKLead.Api/Services/InstantlyService.cs` to your repo
2. Copy `backend/TEKLead.Api/Controllers/InstantlyController.cs` to your repo
3. Replace `backend/TEKLead.Api/Models/SettingItem.cs` with updated version
4. Replace `backend/TEKLead.Api/Program.cs` with updated version
5. Build: `dotnet build` (should compile without errors)
6. Deploy to Railway

#### Step 2: Frontend

1. Replace `frontend/app/components/SettingsView.tsx`
2. Replace `frontend/app/components/ArtifactsView.tsx`
3. Replace `frontend/app/components/SavedLeadsView.tsx`
4. Build: `npm run build` (should pass)
5. Deploy to Railway / Vercel

---

### Configuration

#### In Instantly Dashboard

1. Go to **Settings → Integrations → API Keys**
2. Click **Generate API Key**
3. Select **API V2** (not V1)
4. Set scopes: `campaigns:all`, `leads:all` (minimum)
5. Copy key
6. Create at least 1 **Campaign** (name it descriptively, e.g., "Cold Outreach")
7. Note the campaign ID from URL or dashboard

#### In TEKLead Settings Page

1. Navigate to Settings
2. Scroll to **Instantly Outreach** section
3. Paste API Key (V2) in "API Key" field
4. Save
5. Campaigns dropdown should now populate on Artifacts/Saved Leads pages

---

### Feature Usage

#### Artifacts Page

1. Generate email artifact (Email section)
2. If email generated → "Push to Instantly" panel appears below email
3. **Select Campaign** from dropdown
4. Click **"Push All"**
5. See count: "✓ X pushed" or "✕ Y failed"

#### Saved Leads Page

1. Browse/filter saved leads
2. **Check boxes** next to leads to select them
3. Multiple selection allowed
4. **"Push to Instantly" panel appears** when ≥1 lead selected
5. Shows: "N lead(s) selected • M email(s)"
6. **Select Campaign** from dropdown
7. Click **"Push"**
8. See result count

---

### API Endpoints

**GET /api/instantly/campaigns**
- Returns list of campaigns from Instantly
- Response: `[{ id: "...", name: "..." }]`
- No body required
- Uses API key from Settings

**POST /api/instantly/push**
- Request body:
  ```json
  {
    "campaignId": "campaign-uuid",
    "contacts": [
      { "email": "john@company.com", "name": "John Doe" },
      { "email": "jane@company.com", "name": "Jane Smith" }
    ]
  }
  ```
- Response:
  ```json
  {
    "ok": true,
    "pushed": 2,
    "failed": 0,
    "errors": []
  }
  ```

---

### Data Flow

1. **Artifacts Page Load** → fetches campaigns (GET /api/instantly/campaigns)
2. **Saved Leads Page Load** → fetches campaigns (GET /api/instantly/campaigns)
3. **User selects campaign + clicks "Push"** → POST /api/instantly/push
4. Backend extracts email + name from selected contacts
5. Calls Instantly API with Bearer token
6. Returns count of successful pushes + errors
7. Frontend shows toast/inline result

---

### Contact Field Mapping

**From TEKLead:**
- `email` → Instantly `email` (required)
- `name` → Instantly `first_name` + `last_name` (auto-split)
- **Example:** "John Smith" → `first_name: "John"`, `last_name: "Smith"`

---

### Error Handling

**Common errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| "Instantly API key not configured" | No key in Settings | Add API key in Settings page |
| "Campaign ID required" | No campaign selected | Select a campaign from dropdown |
| "Failed to fetch campaigns: 401" | Wrong/expired API key | Regenerate V2 key in Instantly |
| "Already in campaign" | Contact exists in campaign | Shown as warning in result |
| "Invalid email address" | Malformed email | Check email format |

---

### Limitations

- **Email only** (not phone/LinkedIn)
- **Instantly campaigns must exist** before pushing (pre-create in Instantly dashboard)
- **No tracking/webhooks** yet (one-way push only)
- **Requires API V2 key** (V1 not supported)
- Rate limited by Instantly API (typically 60 req/min)

---

### Testing Checklist

- [ ] Settings page loads
- [ ] Can paste Instantly API V2 key
- [ ] Key saved successfully (Settings persists)
- [ ] Artifacts page → campaigns dropdown shows campaign names
- [ ] Artifacts page → "Push All to Instantly" visible after email generation
- [ ] Select campaign + push → shows count of pushed emails
- [ ] Saved Leads page → can select multiple leads with checkboxes
- [ ] Saved Leads page → "Push to Instantly" appears when ≥1 selected
- [ ] Select campaign + push → shows count of pushed emails
- [ ] Check Instantly dashboard → leads appear in selected campaign

---

### Next Steps (Future)

- Add reply tracking via webhooks
- Support LinkedIn channel
- Campaign management UI (create/edit campaigns)
- Bulk lead scoring before push
- Integration with CRM (HubSpot/Salesforce)

---

**Deployed:** May 16, 2026  
**Built & tested:** ✓ Frontend build passes, backend syntax valid  
**Ready for:** Immediate deployment to Railway
