# Harmony Documentation Hub

This directory is the canonical documentation source for the Harmony codebase.

If documentation and implementation disagree, treat code as source of truth and update docs immediately.

## Audience

- Maintainers who need exact runtime behavior, not feature marketing.
- Contributors who need safe change workflows.
- AI agents that need explicit invariants, extension points, and file ownership guidance.

## Read This First

1. `docs/AI_AGENT_GUIDE.md` - invariants, safe-edit workflows, high-risk files, and known pitfalls.
2. `docs/ARCHITECTURE.md` - end-to-end runtime architecture and lifecycle diagrams (textual).
3. `docs/BACKEND_REFERENCE.md` - complete backend contract, including REST + WebSocket behavior.
4. `docs/FRONTEND_REFERENCE.md` - frontend state flow, socket/polling behavior, and component contracts.
5. `docs/DATA_MODEL.md` - Prisma schema, constraints, and domain invariants.
6. `docs/OPERATIONS.md` - environment setup, local runbook, test and release operations.
7. `docs/FILE_MAP.md` - file-by-file repository map (tracked files only).

## Quick Start

```bash
npm install
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- WebSocket: `ws://localhost:4000/ws`

## Documentation Index

- `docs/AI_AGENT_GUIDE.md`
  - Change safety rules, invariants, extension playbooks, and consistency checks.
- `docs/ARCHITECTURE.md`
  - Runtime layers, state ownership, message and voice flows, fallback paths.
- `docs/BACKEND_REFERENCE.md`
  - Environment, routes, schemas, services, repositories, errors, and tests.
- `docs/FRONTEND_REFERENCE.md`
  - Routing, auth/session handling, API client, hooks, `ChatPage` orchestration, UI module contracts.
- `docs/DATA_MODEL.md`
  - Prisma enums/models, relationships, indexes, and behavior constraints.
- `docs/OPERATIONS.md`
  - Setup, scripts, env vars, DB workflows, build/deploy/checklist, troubleshooting.
- `docs/FILE_MAP.md`
  - Full tracked-file map with responsibilities.
- `docs/API.md`
  - Fast quick-reference for endpoints and WebSocket events.
- `docs/SETUP.md`
  - Fast setup checklist.
- `docs/structure.md`
  - Compact project structure summary.
- `docs/ROADMAP.md`
  - Current product and engineering roadmap.

## Source Boundaries

- Backend implementation: `backend/src`
- Database schema + seed: `backend/prisma`
- Frontend implementation: `web/src`
- Workspace scripts: `package.json`

## Versioning Policy For Docs

When changing behavior, update docs in the same change set:

1. Contract change (route, payload, error code, event):
- update `docs/BACKEND_REFERENCE.md` and `docs/API.md`.

2. Frontend state/UX flow change:
- update `docs/FRONTEND_REFERENCE.md`.

3. Schema or data invariant change:
- update `docs/DATA_MODEL.md`.

4. Setup/runtime command change:
- update `docs/OPERATIONS.md` and `docs/SETUP.md`.

5. New file/module:
- update `docs/FILE_MAP.md` and `docs/structure.md`.

## Important Consistency Notes

- The Prisma schema currently declares `provider = "postgresql"` in `backend/prisma/schema.prisma`.
- `backend/.env.example` uses PostgreSQL DSN format. Set host/credentials for your local environment.
- `AGENT.md` at repository root contains some stale stack notes (for example, SQLite and Zustand). Use `docs/AI_AGENT_GUIDE.md` + source code as authoritative references.
