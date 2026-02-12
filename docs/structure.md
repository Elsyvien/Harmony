# Project Structure

Canonical detailed map: `docs/FILE_MAP.md`

## Top-Level

- `backend/` - Fastify API, WebSocket gateway, services, repositories, Prisma schema.
- `web/` - React app, API client, socket hook, UI components, styles.
- `docs/` - full documentation set.
- `package.json` - workspace orchestration scripts.

## Backend (`backend/src`)

- `server.ts` - process entrypoint.
- `app.ts` - app composition and plugin/route registration.
- `config/` - env parsing.
- `plugins/` - WebSocket protocol implementation.
- `routes/` - HTTP endpoint groups.
- `schemas/` - route input validation schemas.
- `services/` - business logic.
- `repositories/` - Prisma access layer.
- `types/` - backend API and Fastify augmentations.
- `utils/` - shared helpers.

## Frontend (`web/src`)

- `main.tsx` - app bootstrapping.
- `App.tsx` - route shell.
- `pages/` - page-level orchestration.
- `components/` - UI and interaction components.
- `api/` - HTTP client and typed API wrappers.
- `hooks/` - socket and preference hooks.
- `store/` - auth session context.
- `types/` - frontend contract types.
- `styles/` - CSS stylesheets.
- `utils/` - helper utilities.

## Related Docs

- `docs/ARCHITECTURE.md`
- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/DATA_MODEL.md`
- `docs/OPERATIONS.md`
