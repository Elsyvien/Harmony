# AGENTS.md - Harmony Contributor Guide

This file is the root orientation guide for human and AI contributors.
It is intentionally concise and points to canonical docs for detail.

Last updated: 2026-02-18

## Scope And Source Of Truth

When sources conflict, use this order:

1. `backend/src` and `web/src` code.
2. `backend/prisma/schema.prisma`.
3. `docs/AI_AGENT_GUIDE.md` and the docs folder.
4. This file.

## Repository Overview

- Monorepo with npm workspaces: `backend`, `web`.
- Backend: Fastify + TypeScript + Prisma + PostgreSQL + WebSocket (`@fastify/websocket`) + mediasoup.
- Frontend: React 19 + TypeScript + Vite.
- Tests: backend Vitest suite; frontend has Vitest config but backend tests are the primary enforced path.

## Current Product Surface

- JWT auth (`register`, `login`, `me`) and role-based admin behavior.
- Channel chat with realtime WebSocket events and polling fallback.
- Friend system and friend-gated DM channel creation.
- Voice channel signaling/transport integration.
- Admin runtime settings (registration lock, read-only mode, slow mode).
- Message attachments (single file, size-limited).

## Critical Runtime Invariants

Do not break these without coordinated updates across backend, frontend, tests, and docs:

1. Owner bootstrap for username `max`/`Max` is enforced in startup/seed flows.
2. Admin authority is role-derived (`OWNER`, `ADMIN`).
3. Global channel must exist and cannot be deleted.
4. DM channel creation requires accepted friendship.
5. WebSocket actions other than `auth` require authenticated socket context.
6. Non-admin sends respect runtime settings (`readOnlyMode`, `slowModeSeconds`).
7. Message deletion is soft-delete behavior.
8. Uploads are limited to one file and max 8 MB.
9. Slow mode cooldown state is process-memory only.
10. Frontend message polling fallback must work when socket is disconnected.

For implementation references, see `docs/AI_AGENT_GUIDE.md`.

## High-Risk Files

Read these fully before editing:

- `web/src/pages/chat-page.tsx`
- `web/src/hooks/use-chat-socket.ts`
- `backend/src/plugins/ws.plugin.ts`
- `backend/src/services/message.service.ts`
- `backend/src/services/channel.service.ts`
- `backend/prisma/schema.prisma`

## Change Workflow

Use this default sequence for behavior changes:

1. Update backend schemas/services/repositories/routes as needed.
2. Update frontend API client + types + state handling.
3. Update WebSocket handling on both ends if event contracts changed.
4. Run verification commands.
5. Update docs in the same change set.

## Verification Checklist

Run from repo root:

```bash
npm test
npm run lint
npm run build
```

If runtime behavior changed, smoke test:

- login flow
- channel messaging
- DM/friend flows
- voice join/leave path (when relevant)

## Documentation Update Rule

Behavior changes must update at least one relevant doc in `docs/`:

- Backend/API contract: `docs/BACKEND_REFERENCE.md`, `docs/API.md`
- Frontend flow/state: `docs/FRONTEND_REFERENCE.md`
- Schema/invariants: `docs/DATA_MODEL.md`
- Setup/operations: `docs/OPERATIONS.md`, `docs/SETUP.md`
- New files/modules: `docs/FILE_MAP.md`, `docs/structure.md`

## Known Pitfall

The repository still includes a legacy SQLite artifact (`backend/prisma/dev.db`). Use PostgreSQL `DATABASE_URL` values (see `backend/.env.example`) as canonical.
