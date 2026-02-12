# Harmony

Harmony chat app with:
- JWT auth (register/login/logout)
- Channel-based chat
- Realtime delivery via WebSocket with polling fallback
- Friend system (requests, accept/decline/cancel, remove)
- Admin runtime controls (registrations, read-only mode, slow mode)
- Admin stats dashboard and user management

## Documentation

- Setup and local development: `docs/SETUP.md`
- API and websocket contracts: `docs/API.md`
- Current feature map and next milestones: `docs/ROADMAP.md`
- Docs index: `docs/README.md`

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
