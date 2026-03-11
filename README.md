# Harmony
<img width="384" height="256" alt="logo" src="https://github.com/user-attachments/assets/589403ea-58bd-42ea-b4e8-f8eaa66142fa" />

Harmony chat app with:
- JWT auth (register/login/logout/session restore)
- Multi-server chat with default server bootstrap, server creation, and invite-based join
- Text, voice, and friend-gated direct-message channels
- Realtime delivery via WebSocket with polling fallback, presence states, and message receipts
- Replies, reactions, edit/delete, and file attachments
- Friend system (requests, accept/decline/cancel, remove)
- Voice with mute/deafen, screen or camera sharing, reconnect recovery, and optional SFU transport
- Server moderation, invite management, runtime admin controls, analytics, and user management

## Documentation

- Documentation hub: `docs/README.md`
- Current roadmap: `docs/ROADMAP.md`
- AI-agent-oriented guide: `docs/AI_AGENT_GUIDE.md`
- End-to-end architecture: `docs/ARCHITECTURE.md`
- Backend reference (REST + WS + services): `docs/BACKEND_REFERENCE.md`
- Frontend reference (state + components + flows): `docs/FRONTEND_REFERENCE.md`
- Integration examples (REST + WS + voice snippets): `docs/INTEGRATION_EXAMPLES.md`
- Data model reference: `docs/DATA_MODEL.md`
- Analytics reference: `docs/ANALYTICS.md`
- Operations and troubleshooting: `docs/OPERATIONS.md`
- Full file map: `docs/FILE_MAP.md`
- API quick reference: `docs/API.md`
- Setup quick reference: `docs/SETUP.md`

## Runtime Overview

- `backend/`: Fastify REST API, WebSocket gateway, Prisma persistence, analytics ingestion, and optional SFU support.
- `web/`: React SPA with optimistic message handling, polling fallback, and mesh/SFU voice orchestration.
- `backend/prisma/schema.prisma`: source of truth for users, servers, channels, messages, receipts, invites, moderation, and analytics.
- `docs/`: canonical technical documentation plus static docs UI assets.

## Quick Start

```bash
npm install
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:4000`

PowerShell env bootstrap:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item web\.env.example web\.env
```

Test commands:

- `npm test` runs backend tests.
- `npm --workspace web run test` runs frontend tests.

Local development defaults worth knowing:

- Prisma is configured for PostgreSQL, so `DATABASE_URL` must be a PostgreSQL DSN.
- `prisma:seed` creates or upgrades the owner account `max@staneker.com` / `max123456`.

Example WebSocket auth payload:

```json
{ "type": "auth", "payload": { "token": "<jwt>" } }
```

Example voice join payload:

```json
{
  "type": "voice:join",
  "payload": {
    "channelId": "<voice-channel-id>",
    "requestId": "join-1",
    "muted": false,
    "deafened": false
  }
}
```

## Tech Stack

- Backend: Fastify, TypeScript, Prisma
- Frontend: React, TypeScript, Vite
- Testing: Vitest (backend and web workspaces)
