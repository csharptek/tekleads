# TEKLead AI

## Stack
- Frontend: Next.js → Railway
- Backend: .NET 8 API → Railway
- Database: Railway PostgreSQL + pgvector
- AI: Azure OpenAI
- Storage: Azure Blob
- Email: SendGrid | WhatsApp: Twilio | Leads: Apollo.io

## Deploy

### 1. Railway PostgreSQL
New project → Add PostgreSQL service → copy `DATABASE_URL`

### 2. Backend
Add service → GitHub repo (backend folder) → set env vars:
- `PG_CONNECTION_STRING` = DATABASE_URL from above

Generate domain → copy URL

### 3. Frontend
Add service → GitHub repo (frontend folder) → set env vars:
- `NEXT_PUBLIC_API_URL` = backend URL from above

Generate domain → open app

### 4. Settings page — enter:
- Azure OpenAI: endpoint, key, deployment name
- Azure Blob: connection string
- Apollo: API key
- SendGrid: API key, from email
- Twilio: account SID, auth token, WhatsApp from
- PostgreSQL: same connection string as PG_CONNECTION_STRING

DB tables and pgvector extension are auto-created on first run.
