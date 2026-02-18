# AI Agent Guide

This document is optimized for autonomous and semi-autonomous contributors.

Use this guide before editing Harmony.

## What Harmony Is

Harmony is a workspace chat application with:

- JWT authentication.
- Public channels, voice channels, and friend-gated direct message channels.
- Realtime message/friend/presence/voice events over WebSocket.
- REST fallback flows for reliability.
- Admin runtime controls (registration lock, read-only mode, slow mode).

## Ground Truth Order

When sources conflict, trust in this order:

1. `backend/src` and `web/src` code.
2. `backend/prisma/schema.prisma`.
3. This docs folder.
4. Root marketing/context docs.

## Core Runtime Invariants

These are high-impact invariants that must not be broken.

1. Owner bootstrap for username `max`/`Max` is enforced on startup and seed.
- Files: `backend/src/app.ts`, `backend/prisma/seed.ts`.

2. Admin ability is role-derived, not arbitrary.
- `OWNER` and `ADMIN` are admin roles.
- File: `backend/src/utils/roles.ts`.

3. Global channel must exist and cannot be deleted.
- Files: `backend/src/services/channel.service.ts`, `backend/src/repositories/channel.repository.ts`.

4. Direct message channel creation requires accepted friendship.
- File: `backend/src/services/channel.service.ts`.

5. WebSocket actions except `auth` require authenticated socket context.
- File: `backend/src/plugins/ws.plugin.ts`.

6. Non-admin write controls depend on runtime settings.
- `readOnlyMode` blocks non-admin message creation.
- `slowModeSeconds` throttles non-admin send frequency per user+channel.
- File: `backend/src/services/message.service.ts`.

7. Message deletion is soft delete.
- Content and attachment metadata are cleared, `deletedAt` is set.
- File: `backend/src/repositories/message.repository.ts`.

8. Attachment uploads are limited to one file, max 8 MB.
- Stored under `/uploads/<generated-name>` and served by static route.
- Files: `backend/src/app.ts`, `backend/src/routes/channel.routes.ts`.

9. Slow mode timestamps are process-memory only.
- Cooldown state resets on process restart.
- File: `backend/src/services/admin-settings.service.ts`.

10. Frontend messaging remains functional without WebSocket.
- Chat polls messages every 5s when socket is disconnected.
- File: `web/src/pages/chat-page.tsx`.

## High-Risk Files

Edit these only with full context.

- `web/src/pages/chat-page.tsx`
  - Central orchestration for channels, messaging, DMs, admin views, friends, voice signaling/transport, unread counts, and fallback behavior.

- `backend/src/plugins/ws.plugin.ts`
  - WebSocket auth/session, channel subscriptions, presence fanout, voice participant state, and WebRTC signaling relay.

- `backend/src/services/message.service.ts`
  - Read-only mode, slow mode, content and reply validation, edit/delete/reaction authorization rules.

- `backend/src/services/channel.service.ts`
  - Channel creation/deletion constraints, voice bitrate updates, DM friendship gate.

- `backend/prisma/schema.prisma`
  - Any schema change cascades into repositories, services, route payloads, frontend types, and docs.

## Safe Change Playbooks

### Add a REST endpoint

1. Add/extend schema in `backend/src/schemas`.
2. Implement behavior in service (`backend/src/services`).
3. Add persistence method in repository (`backend/src/repositories`) if needed.
4. Wire route in `backend/src/routes/*.routes.ts`.
5. Update frontend client in `web/src/api/chat-api.ts`.
6. Update frontend types in `web/src/types/api.ts` if payload changed.
7. Update docs: `docs/BACKEND_REFERENCE.md`, `docs/API.md`, and any affected module docs.

### Add or change WebSocket event

1. Define server-side handling/broadcast in `backend/src/plugins/ws.plugin.ts`.
2. Add Fastify decoration typing if gateway method changes: `backend/src/types/fastify.d.ts`.
3. Extend frontend socket parsing in `web/src/hooks/use-chat-socket.ts`.
4. Wire state updates in `web/src/pages/chat-page.tsx`.
5. Update docs: `docs/BACKEND_REFERENCE.md`, `docs/FRONTEND_REFERENCE.md`, `docs/API.md`.

### Add user preference

1. Extend `UserPreferences` and defaults in `web/src/types/preferences.ts`.
2. Add parse/normalize support in `web/src/hooks/use-user-preferences.ts`.
3. Add UI controls in `web/src/components/settings-panel.tsx`.
4. Apply behavior in consumer modules (`ChatPage`, `ChatView`, or others).
5. Update docs: `docs/FRONTEND_REFERENCE.md`.

### Add schema field

1. Edit `backend/prisma/schema.prisma`.
2. Regenerate/apply DB changes.
3. Update repository selects/returns.
4. Update service logic and route outputs.
5. Update frontend types and UI if exposed.
6. Update `docs/DATA_MODEL.md` and affected references.

### Change role/permission logic

1. Update role helper functions (`backend/src/utils/roles.ts`) if role semantics change.
2. Review all `isAdminRole(...)` checks in routes/services.
3. Review admin user management constraints in `backend/src/services/admin-user.service.ts`.
4. Update docs and tests.

## Backend Consistency Checks Before Finishing

- Route input schemas still match service expectations.
- Error codes remain stable and documented.
- Role checks protect all privileged paths.
- WebSocket events have deterministic payloads.
- Attachment limits and message constraints are preserved.

## Frontend Consistency Checks Before Finishing

- `web/src/types/api.ts` still matches backend response/event payloads.
- `chatApi` methods match current routes.
- Socket event handlers update state only for relevant channel/context.
- Polling fallback still works when `ws.connected === false`.
- Preferences are backward-compatible with old localStorage payloads.

## Testing Expectations

Current automated tests focus on backend service logic:

- `backend/tests/auth.service.test.ts`
- `backend/tests/channel.service.test.ts`
- `backend/tests/friend.service.test.ts`
- `backend/tests/message.service.test.ts`

Before merging behavior changes:

1. Run `npm test`.
2. Run `npm run lint`.
3. Run `npm run build`.
4. Smoke test login, chat, and voice flows in browser if change touches runtime behavior.

## Known Gaps And Pitfalls

- `backend/.env.example` now uses PostgreSQL DSN format; set real credentials/host per environment.
- `backend/prisma/dev.db` exists as a legacy artifact and does not match PostgreSQL runtime semantics.
- Root `AGENT.md` includes stale statements (for example database and state-library notes); prefer this docs folder.
- `web/src/pages/chat-page.tsx` is large and coupled. Make isolated changes with careful dependency review.

## Quick Orientation Map

- Backend entrypoint: `backend/src/server.ts`
- Backend app composition: `backend/src/app.ts`
- WebSocket protocol: `backend/src/plugins/ws.plugin.ts`
- Primary frontend orchestration: `web/src/pages/chat-page.tsx`
- API client surface: `web/src/api/chat-api.ts`
- Socket transport hook: `web/src/hooks/use-chat-socket.ts`
- Auth/session store: `web/src/store/auth-store.tsx`

## Minimum Docs Update Rule

If you change behavior, update at least one of:

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/DATA_MODEL.md`
- `docs/OPERATIONS.md`
- `docs/API.md`

Do not leave behavior changes undocumented.
