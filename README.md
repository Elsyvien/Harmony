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
- Data model reference: `docs/DATA_MODEL.md`
- Analytics reference: `docs/ANALYTICS.md`
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
