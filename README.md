# Harmony
<img width="384" height="256" alt="logo" src="https://github.com/user-attachments/assets/589403ea-58bd-42ea-b4e8-f8eaa66142fa" />

Harmony chat app with:
- JWT auth (register/login/logout)
- Channel-based chat
- Realtime delivery via WebSocket with polling fallback
- Friend system (requests, accept/decline/cancel, remove)
- Admin runtime controls (registrations, read-only mode, slow mode)
- Admin stats dashboard and user management

## Documentation

- Documentation hub: `docs/README.md`
- AI-agent-oriented guide: `docs/AI_AGENT_GUIDE.md`
- End-to-end architecture: `docs/ARCHITECTURE.md`
- Backend reference (REST + WS + services): `docs/BACKEND_REFERENCE.md`
- Frontend reference (state + components + flows): `docs/FRONTEND_REFERENCE.md`
- Data model reference: `docs/DATA_MODEL.md`
- Operations and troubleshooting: `docs/OPERATIONS.md`
- Full file map: `docs/FILE_MAP.md`
- API quick reference: `docs/API.md`
- Setup quick reference: `docs/SETUP.md`

## Quick Start

```bash
npm install
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:4000`

## Tech Stack

- Backend: Fastify, TypeScript, Prisma
- Frontend: React, TypeScript, Vite
- Testing: Vitest (backend)
