# TEKLead AI — v2 (Phase 1: Settings)

Fresh rewrite. Phase 1 = Settings only. Save + verify works end-to-end before adding more.

## Structure

```
backend/TEKLead.Api/   .NET 8 API
frontend/              Next.js 14 (App Router)
```

## Railway Deploy

### Postgres
1. Add Postgres plugin to project.
2. Note the `DATABASE_URL` — you'll wire it as `PG_CONNECTION_STRING` on the API service.

### Backend service (root: `backend/TEKLead.Api`)
- Build/start: Railway auto-detects .NET via `Dockerfile`.
- Env vars:
  - `PG_CONNECTION_STRING` = (Railway Postgres connection string, `postgresql://...`)
  - `ASPNETCORE_URLS` = `http://0.0.0.0:${PORT}`
- Generate a public domain.

### Frontend service (root: `frontend`)
- Env var:
  - `NEXT_PUBLIC_API_URL` = `https://<backend-domain>` (set BEFORE first deploy — baked at build time)
- Generate public domain.

## Verify Phase 1

1. Open backend `/health` → `{"status":"ok"}`
2. Open backend `/api/settings/diag` → shows DB connectivity + table existence
3. Open frontend `/` → Settings page loads
4. Enter Apollo key + Azure OpenAI keys → Save
5. Reload page → secret fields show `✓ stored` badges
6. Open `/api/settings/diag` → shows `keysStored > 0`

## Phase 2 (next)
Lead search + save. Will be added only after Phase 1 is confirmed working.
