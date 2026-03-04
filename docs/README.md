# Harmony Documentation Hub

This directory is the canonical documentation source for the Harmony codebase.

If documentation and implementation disagree, treat code as source of truth and update docs immediately.

## Audience

- Maintainers who need exact runtime behavior, not feature marketing.
- Contributors who need safe change workflows.
- AI agents that need explicit invariants, extension points, and file ownership guidance.

## Read This First

1. `docs/AI_AGENT_GUIDE.md` - invariants, safe-edit workflows, high-risk files, and known pitfalls.
2. `docs/DOCUMENTATION_GUIDE.md` - documentation authoring, update matrix, docs UI/codebase maintenance, and design guidance usage notes.
3. `docs/ARCHITECTURE.md` - end-to-end runtime architecture and lifecycle diagrams (textual).
4. `docs/BACKEND_REFERENCE.md` - complete backend contract, including REST + WebSocket behavior.
5. `docs/FRONTEND_REFERENCE.md` - frontend state flow, socket/polling behavior, and component contracts.
6. `docs/DATA_MODEL.md` - Prisma schema, constraints, and domain invariants.
7. `docs/ANALYTICS.md` - analytics taxonomy, ingestion contract, retention, and privacy boundaries.
8. `docs/OPERATIONS.md` - environment setup, local runbook, test and release operations.
9. `docs/FILE_MAP.md` - file-by-file repository map (tracked files only).

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
- `docs/DOCUMENTATION_GUIDE.md`
  - Documentation authoring/maintenance guide, docs update matrix, docs UI codebase ownership, and `DesignerSkill.md` usage notes for docs presentation.
- `docs/ARCHITECTURE.md`
  - Runtime layers, state ownership, message and voice flows, fallback paths.
- `docs/BACKEND_REFERENCE.md`
  - Environment, routes, schemas, services, repositories, errors, and tests.
- `docs/FRONTEND_REFERENCE.md`
  - Routing, auth/session handling, API client, hooks, `ChatPage` orchestration, UI module contracts.
- `docs/DATA_MODEL.md`
  - Prisma enums/models, relationships, indexes, and behavior constraints.
- `docs/ANALYTICS.md`
  - Analytics event taxonomy, ingestion limits, admin analytics APIs, retention, and privacy policy surfaces.
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
- Canonical documentation content: `docs/*.md`
- Static documentation UI codebase: `docs/index.html`, `docs/styles.css`, `docs/app.js`
- Workspace scripts: `package.json`

## Documentation Design And Docs UI

- Use `docs/DOCUMENTATION_GUIDE.md` when changing docs content organization, docs update policy, or the static docs UI.
- Use `DesignerSkill.md` as a local design guidance artifact when improving the visual design of documentation pages (`docs/*.html`, `docs/styles.css`).
- `DesignerSkill.md` is not a registered Codex skill in this repo/session; treat it as reference material unless a real skill is installed and listed.
- Technical correctness for docs content still comes from source code (`backend/src`, `web/src`) and detailed docs in this folder.

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

6. Documentation UI/presentation change (`docs/*.html`, `docs/styles.css`, `docs/app.js`):
- update the changed docs UI files and review `docs/DOCUMENTATION_GUIDE.md` if the maintenance workflow or file ownership notes changed.
- update `docs/README.md` if docs navigation or reading order changed.

## Important Consistency Notes

- The Prisma schema currently declares `provider = "postgresql"` in `backend/prisma/schema.prisma`.
- `backend/.env.example` uses PostgreSQL DSN format. Set host/credentials for your local environment.
- `AGENT.md` at repository root contains some stale stack notes (for example, SQLite and Zustand). Use `docs/AI_AGENT_GUIDE.md` + source code as authoritative references.
- `DesignerSkill.md` is a design reference file for documentation/frontend presentation work, not a registered Codex skill in this repository by default.
