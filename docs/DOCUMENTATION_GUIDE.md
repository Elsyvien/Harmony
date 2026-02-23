# Documentation Authoring and Maintenance Guide

This guide defines how to author and maintain documentation in the Harmony repository.

Use it when you change runtime behavior, add files, adjust operations/setup, or modify the static docs UI in `docs/`.

If docs and code disagree, code is the source of truth. Update docs in the same change set.

## Scope And Ground Rules

- Canonical docs content lives in `docs/*.md`.
- The static docs UI is implemented in `docs/index.html`, `docs/styles.css`, and `docs/app.js`.
- Hand-maintained HTML companion pages currently include `docs/ai-agent-guide.html` (for `docs/AI_AGENT_GUIDE.md`) and `docs/file-map.html` (for `docs/FILE_MAP.md`).
- Keep documentation maintainer-focused: exact behavior, invariants, constraints, paths, and operational impact.
- Prefer concrete file paths over general statements (for example `backend/src/plugins/ws.plugin.ts` instead of "websocket code").

## Documentation Map (What Each File Owns)

- `docs/README.md` - documentation hub, reading order, and cross-doc update policy.
- `docs/AI_AGENT_GUIDE.md` - high-risk files, invariants, and safe change playbooks for autonomous/semi-autonomous contributors.
- `docs/ARCHITECTURE.md` - end-to-end runtime architecture and lifecycle behavior.
- `docs/BACKEND_REFERENCE.md` - backend route contracts, WebSocket behavior, services, repositories, and error behavior.
- `docs/FRONTEND_REFERENCE.md` - frontend state flow, transport behavior, orchestration, and UI module contracts.
- `docs/DATA_MODEL.md` - Prisma schema semantics, constraints, and domain invariants.
- `docs/OPERATIONS.md` - local setup, commands, environment variables, deployment checks, troubleshooting.
- `docs/API.md` - condensed API and WebSocket quick reference.
- `docs/SETUP.md` - condensed setup commands/checklist.
- `docs/FILE_MAP.md` - tracked-file map with responsibilities, including docs files.
- `docs/structure.md` - compact repository structure summary.
- `docs/ROADMAP.md` - current roadmap notes (product/engineering direction, not runtime truth).
- `docs/index.html` - static docs landing page and navigation shell linking into markdown docs and HTML companion pages.
- `docs/styles.css` - shared visual system/layout/styles for the static docs HTML pages.
- `docs/app.js` - shared client-side behavior for docs pages that opt in (search/filter + scroll spy in `docs/index.html`).

## Change-To-Docs Update Matrix

Use the sections below as the default "what must be updated" checklist.

### 1. REST Endpoint Or Payload Contract Changes

Examples:
- New route in `backend/src/routes/*.routes.ts`
- Request/response payload change
- Error code/status change
- Auth requirement change

Required updates:
- `docs/BACKEND_REFERENCE.md`
- `docs/API.md`

Usually review/update:
- `docs/ARCHITECTURE.md` (if flow or lifecycle changes)
- `docs/FRONTEND_REFERENCE.md` (if frontend call/handling changes)
- `docs/AI_AGENT_GUIDE.md` (if safe playbook/high-risk guidance changes)
- `docs/index.html` (if a new major reference doc is added, renamed, or repositioned)

Checklist:
- [ ] Document route path, method, auth rules, payload fields, and error behavior in `docs/BACKEND_REFERENCE.md`.
- [ ] Update compact endpoint summary in `docs/API.md`.
- [ ] Confirm terminology matches `backend/src/schemas/*.ts` and `backend/src/services/*.ts`.
- [ ] If frontend behavior changed, update `docs/FRONTEND_REFERENCE.md` with state/UI handling.

### 2. WebSocket Event / Realtime Protocol Changes

Examples:
- New action in `backend/src/plugins/ws.plugin.ts`
- Event payload change
- Subscription/auth behavior change
- Presence/voice event semantics change

Required updates:
- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/API.md`

Usually review/update:
- `docs/ARCHITECTURE.md`
- `docs/AI_AGENT_GUIDE.md`

Checklist:
- [ ] Document server action/event names and payload shape in `docs/BACKEND_REFERENCE.md`.
- [ ] Document frontend socket parsing/state impact in `docs/FRONTEND_REFERENCE.md`.
- [ ] Update quick event list in `docs/API.md`.
- [ ] Call out fallback behavior if polling or offline behavior changes.

### 3. Backend Business Rules / Permissions / Validation Changes

Examples:
- Role checks in `backend/src/utils/roles.ts`
- Message restrictions in `backend/src/services/message.service.ts`
- Channel/DM constraints in `backend/src/services/channel.service.ts`
- Admin runtime controls behavior

Required updates (minimum one, usually more than one):
- `docs/BACKEND_REFERENCE.md`
- `docs/AI_AGENT_GUIDE.md` (when invariants, playbooks, or high-risk notes change)

Usually review/update:
- `docs/API.md` (if API-visible behavior/errors changed)
- `docs/ARCHITECTURE.md` (if flow changes)
- `docs/FRONTEND_REFERENCE.md` (if UI handling/permissions surface changed)

Checklist:
- [ ] Update exact rule semantics and exceptions in `docs/BACKEND_REFERENCE.md`.
- [ ] Update `docs/AI_AGENT_GUIDE.md` if an invariant or high-risk file note changed.
- [ ] Document user-visible impact (blocked actions, new conditions, new errors).
- [ ] Verify wording does not contradict implementation edge cases.

### 4. Frontend UX / State Flow / Client Transport Changes

Examples:
- `web/src/pages/chat-page.tsx` orchestration changes
- `web/src/hooks/use-chat-socket.ts` behavior changes
- `web/src/api/chat-api.ts` request semantics changed
- Preference handling in `web/src/hooks/use-user-preferences.ts`
- Component contract changes in `web/src/components/*`

Required updates:
- `docs/FRONTEND_REFERENCE.md`

Usually review/update:
- `docs/API.md` (if contract changed)
- `docs/BACKEND_REFERENCE.md` (if frontend change reflects backend change)
- `docs/AI_AGENT_GUIDE.md` (if safe playbooks/high-risk notes changed)
- `docs/ARCHITECTURE.md` (if end-to-end flow changed)

Checklist:
- [ ] Update state ownership and data flow descriptions in `docs/FRONTEND_REFERENCE.md`.
- [ ] Update component/module contract notes if props/responsibilities changed materially.
- [ ] Document socket fallback/polling behavior if affected.
- [ ] Update examples or file references if code moved.

### 5. Schema / Data Model / Domain Invariant Changes

Examples:
- `backend/prisma/schema.prisma` model/field/index changes
- New enum values
- Relationship semantics change
- Persistence invariants changed in repositories/services

Required updates:
- `docs/DATA_MODEL.md`

Usually review/update:
- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/API.md`
- `docs/AI_AGENT_GUIDE.md` (if invariants/high-risk notes changed)

Checklist:
- [ ] Update model fields, relationships, and constraints in `docs/DATA_MODEL.md`.
- [ ] Document runtime invariants introduced by the schema change (not just field names).
- [ ] Update API/reference docs if the field is exposed via routes/events.
- [ ] Update file references if related repositories/services changed paths.

### 6. Setup / Commands / Environment / Deployment Changes

Examples:
- `package.json` script changes
- `backend/.env.example` or `web/.env.example` changes
- Build/run/test command changes
- Deployment flow changes

Required updates:
- `docs/OPERATIONS.md`
- `docs/SETUP.md` (if quick-start commands changed)

Usually review/update:
- `docs/README.md` (Quick Start or consistency notes)
- `docs/index.html` (Quick Start table or overview)

Checklist:
- [ ] Update full runbook and command details in `docs/OPERATIONS.md`.
- [ ] Update quick setup commands in `docs/SETUP.md`.
- [ ] Update `docs/README.md` Quick Start if command sequence changed.
- [ ] Update `docs/index.html` Quick Start table if static docs landing page shows changed commands.

### 7. New Files / Moves / Renames / Deletions In The Codebase

Examples:
- New backend service/module
- Refactor moving `web/src/...` files
- New docs files
- Removed deprecated modules

Required updates:
- `docs/FILE_MAP.md`
- `docs/structure.md`

Usually review/update:
- `docs/README.md` (index/navigation if a major doc is added)
- `docs/AI_AGENT_GUIDE.md` (orientation map/high-risk references if paths changed)
- `docs/index.html`
- `docs/file-map.html` (if `docs/FILE_MAP.md` changed and HTML companion should remain aligned)

Checklist:
- [ ] Add/move/remove entries in `docs/FILE_MAP.md` with accurate descriptions.
- [ ] Update `docs/structure.md` if top-level or major module structure changed.
- [ ] Update path references in other docs that mention moved files.
- [ ] If `docs/FILE_MAP.md` changed materially, update `docs/file-map.html` companion page.

### 8. New Invariants / High-Risk Areas / AI Contributor Workflow Changes

Examples:
- New high-risk orchestration file
- New "safe change playbook"
- Changed testing expectations
- Changed ground-truth order or known pitfalls

Required updates:
- `docs/AI_AGENT_GUIDE.md`

Usually review/update:
- `docs/README.md` (if reading order or "Read This First" changes)
- `docs/ai-agent-guide.html` (companion page should mirror `docs/AI_AGENT_GUIDE.md`)

Checklist:
- [ ] Update invariant statements with exact file paths and behavior.
- [ ] Update playbook steps when workflow changed.
- [ ] Update testing expectations if required commands/checks changed.
- [ ] Sync `docs/ai-agent-guide.html` if the markdown source changed.

### 9. Documentation UI / Presentation Changes (`docs/*.html`, `docs/styles.css`, `docs/app.js`)

Examples:
- Landing page content changes in `docs/index.html`
- Visual theme/layout changes in `docs/styles.css`
- Search/scroll behavior changes in `docs/app.js`
- New HTML companion page

Required updates:
- The changed UI file(s): `docs/index.html`, `docs/styles.css`, `docs/app.js`

Usually review/update:
- `docs/README.md` (if docs navigation/read order is changed)
- `docs/FILE_MAP.md` (if adding/removing docs UI files)
- `docs/DOCUMENTATION_GUIDE.md` (this file, if maintenance rules changed)

Checklist:
- [ ] Keep labels/links in `docs/index.html` consistent with actual markdown docs and companion pages.
- [ ] Ensure section IDs and sidebar links in `docs/index.html` still match (required for `docs/app.js` scroll spy).
- [ ] If adding new shared UI classes/components, document intent with clear naming in `docs/styles.css`.
- [ ] Verify `docs/app.js` selectors still match HTML (`#doc-search`, `.nav-link`, section IDs).
- [ ] Smoke test the docs pages in a browser (search, navigation, responsive layout, link targets).

## `DesignerSkill.md` (Design Guidance Artifact) Status And Usage

`DesignerSkill.md` at the repository root is a local design guidance artifact that can be used as a reference when improving the visual presentation of the static docs UI.

Important clarification:
- `DesignerSkill.md` is not a registered Codex skill in this repository/session.
- It is a repo file (`DesignerSkill.md`), not a skill installed under the Codex skills directories.
- Do not treat it as an invokable skill name unless it is explicitly installed and listed as a skill in the active environment.

What it is useful for:
- Visual direction and aesthetic constraints when editing `docs/index.html`.
- Shared presentation decisions when extending `docs/styles.css`.
- UI polish decisions for companion pages such as `docs/ai-agent-guide.html` and `docs/file-map.html`.

What it does not replace:
- It does not define Harmony runtime behavior.
- It does not replace `docs/README.md`, `docs/AI_AGENT_GUIDE.md`, or API/data-model references.
- It does not change the rule that markdown docs are the canonical content source.

Practical usage checklist:
- [ ] Use `DesignerSkill.md` only for presentation/design guidance when editing docs HTML/CSS.
- [ ] Keep technical content and behavioral truth anchored to `docs/*.md` and source code.
- [ ] If design changes alter docs navigation/discoverability, update `docs/README.md` and `docs/index.html` content accordingly.

## Documentation Codebase: Static Docs UI + Markdown Relationship

### Canonical Content Model

- `docs/*.md` files are the canonical documentation source.
- `docs/index.html` is a static navigation/summary UI that links to canonical markdown docs and selected companion HTML pages.
- `docs/ai-agent-guide.html` and `docs/file-map.html` are hand-maintained HTML companions derived from `docs/AI_AGENT_GUIDE.md` and `docs/FILE_MAP.md`.
- These companion pages include explicit source references in their footers (for example `Source: docs/AI_AGENT_GUIDE.md`).

Maintenance implication:
- When `docs/AI_AGENT_GUIDE.md` changes, check and update `docs/ai-agent-guide.html`.
- When `docs/FILE_MAP.md` changes, check and update `docs/file-map.html`.
- There is no tracked repository generator script for these HTML companion pages at the time of writing; treat synchronization as manual work.

### Static Docs UI File Responsibilities

#### `docs/index.html`

Responsibilities:
- Documentation landing page ("Documentation Hub") for browser-based navigation.
- Curated summaries of the docs set (overview, quick start, reading order, all documents, consistency notes).
- Link routing to markdown docs (`.md`) and HTML companions (`.html`).
- Provides sidebar anchors (`.nav-link`) and section IDs used by `docs/app.js`.

Authoring notes:
- If you add a new sidebar entry, create a matching `<section id="...">`.
- If you rename a link target, update both the href and the destination file.
- Keep quick-start commands consistent with `docs/README.md`, `docs/SETUP.md`, and `docs/OPERATIONS.md`.

#### `docs/styles.css`

Responsibilities:
- Shared visual tokens (colors, fonts, radii, shadows) and core layout.
- Shared components/styles for sidebar, sections, cards, tables, chips, and responsive behavior.
- Shared styling used by `docs/index.html` and other docs HTML pages that import it.

Authoring notes:
- Prefer extending existing variables/classes before adding page-specific duplication.
- Preserve readability and contrast for code-heavy, maintainer-focused content.
- Re-test `docs/index.html`, `docs/ai-agent-guide.html`, and `docs/file-map.html` after shared style changes.

#### `docs/app.js`

Responsibilities:
- Search/filter behavior for `docs/index.html` via `#doc-search`.
- Section visibility filtering based on text content and section IDs.
- Sidebar scroll-spy highlighting for `.nav-link` anchors tied to in-page sections.

Current usage:
- `docs/index.html` loads `docs/app.js`.
- `docs/ai-agent-guide.html` and `docs/file-map.html` currently use their own inline scripts for page-specific behavior.

Authoring notes:
- Keep selectors in sync with HTML (`#doc-search`, `.nav-link`, section IDs).
- If you generalize behavior for reuse, document which pages now depend on `docs/app.js`.
- Avoid breaking pages that have non-anchor sidebar links (the shared script expects in-page hash links for observed sections).

## Authoring Standards (Tone And Content)

- Write for maintainers and contributors, not end-user marketing.
- Prefer exact behavior statements ("slow mode timestamps are process-memory only") over vague descriptions.
- Include affected paths when documenting invariants, risks, or workflows.
- Call out exceptions and fallback behavior explicitly.
- Keep quick-reference docs (`docs/API.md`, `docs/SETUP.md`) concise, but ensure they match detailed references.
- When a source is known stale, say so directly and point to the authoritative path.

## Documentation Update Workflow (Recommended)

1. Identify the code change category (contract, schema, frontend flow, ops, file map, docs UI).
2. Apply the matching checklist from this guide.
3. Update canonical markdown docs first (`docs/*.md`).
4. Update static docs UI pages (`docs/index.html`, companion HTML pages) if navigation/summaries/presentations are affected.
5. Re-read changed docs for path accuracy and consistency with code.
6. Smoke test docs UI pages in a browser if any `docs/*.html`, `docs/styles.css`, or `docs/app.js` changed.

## Docs UI Smoke Test Checklist

Use this after changing `docs/index.html`, `docs/styles.css`, `docs/app.js`, `docs/ai-agent-guide.html`, or `docs/file-map.html`.

- [ ] Open `docs/index.html` in a browser.
- [ ] Verify sidebar anchor navigation scrolls to the correct sections.
- [ ] Verify active sidebar link highlight updates while scrolling.
- [ ] Verify docs search/filter (`#doc-search`) hides/shows sections correctly.
- [ ] Verify links to markdown docs (`.md`) and companion pages (`.html`) resolve.
- [ ] Verify layout remains readable on narrow viewport widths.
- [ ] Open `docs/ai-agent-guide.html` and `docs/file-map.html` if shared CSS changed.
- [ ] Confirm companion page source footer still points to the correct markdown source file.

## When To Update This Guide

Update `docs/DOCUMENTATION_GUIDE.md` when any of the following change:

- The docs file set or ownership boundaries change (new canonical docs, renamed docs, removed docs).
- The static docs UI architecture changes (`docs/index.html`, `docs/styles.css`, `docs/app.js`, or companion pages).
- The sync model between markdown and HTML pages changes (for example a generator is added).
- The documentation maintenance policy changes (required update rules, checklists, or authoring standards).
