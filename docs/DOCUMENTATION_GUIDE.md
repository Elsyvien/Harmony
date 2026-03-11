# Documentation Authoring and Maintenance Guide

This guide defines how to author and maintain documentation in the Harmony repository.

Use it when you change runtime behavior, add files, adjust operations/setup, or modify the static docs UI in `docs/`.

If docs and code disagree, code is the source of truth. Update docs in the same change set.

## Scope And Ground Rules

- Canonical docs content lives in `docs/*.md`.
- The static docs UI is implemented in `docs/index.html`, `docs/styles.css`, and `docs/app.js`.
- `docs/ai-agent-guide.html` and `docs/file-map.html` are compatibility redirect entrypoints into the main docs viewer.
- Keep documentation maintainer-focused: exact behavior, invariants, constraints, paths, and operational impact.
- Prefer concrete file paths over general statements (for example `backend/src/plugins/ws.plugin.ts` instead of "websocket code").

## Documentation Map (What Each File Owns)

- `docs/README.md` - documentation hub, reading order, and cross-doc update policy.
- `docs/AI_AGENT_GUIDE.md` - high-risk files, invariants, and safe change playbooks for autonomous/semi-autonomous contributors.
- `docs/ARCHITECTURE.md` - end-to-end runtime architecture and lifecycle behavior.
- `docs/INTEGRATION_EXAMPLES.md` - copy-paste request/response, WebSocket, voice, and analytics workflow examples.
- `docs/BACKEND_REFERENCE.md` - backend route contracts, WebSocket behavior, services, repositories, and error behavior.
- `docs/FRONTEND_REFERENCE.md` - frontend state flow, transport behavior, orchestration, and UI module contracts.
- `docs/DATA_MODEL.md` - Prisma schema semantics, constraints, and domain invariants.
- `docs/OPERATIONS.md` - local setup, commands, environment variables, deployment checks, troubleshooting.
- `docs/API.md` - condensed API and WebSocket quick reference.
- `docs/SETUP.md` - condensed setup commands/checklist.
- `docs/FILE_MAP.md` - tracked-file map with responsibilities, including docs files.
- `docs/structure.md` - compact repository structure summary.
- `docs/ROADMAP.md` - current roadmap notes (product/engineering direction, not runtime truth).
- `docs/index.html` - route-based documentation website shell that renders canonical markdown docs inside the browser.
- `docs/styles.css` - shared visual system/layout/styles for the docs viewer shell and rendered markdown content.
- `docs/app.js` - docs manifest, route handling, markdown loading/rendering, link rewriting, search, and outline behavior.

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
- `docs/INTEGRATION_EXAMPLES.md` (if a copy-paste example or workflow changed)
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
- `docs/INTEGRATION_EXAMPLES.md`
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
- `docs/INTEGRATION_EXAMPLES.md` (if setup or verification snippets changed)
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
- compatibility redirect files if an alias route changed

Checklist:
- [ ] Add/move/remove entries in `docs/FILE_MAP.md` with accurate descriptions.
- [ ] Update `docs/structure.md` if top-level or major module structure changed.
- [ ] Update path references in other docs that mention moved files.
- [ ] If a docs alias route changed, update any redirect entrypoints that depend on it.

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
- redirect entrypoints if the route slug changed

Checklist:
- [ ] Update invariant statements with exact file paths and behavior.
- [ ] Update playbook steps when workflow changed.
- [ ] Update testing expectations if required commands/checks changed.
- [ ] Verify the docs viewer still routes to `AI_AGENT_GUIDE.md` correctly.

### 9. Documentation UI / Presentation Changes (`docs/*.html`, `docs/styles.css`, `docs/app.js`)

Examples:
- Landing page content changes in `docs/index.html`
- Visual theme/layout changes in `docs/styles.css`
- Search/scroll behavior changes in `docs/app.js`
- New redirect entrypoint or viewer route

Required updates:
- The changed UI file(s): `docs/index.html`, `docs/styles.css`, `docs/app.js`

Usually review/update:
- `docs/README.md` (if docs navigation/read order is changed)
- `docs/FILE_MAP.md` (if adding/removing docs UI files)
- `docs/DOCUMENTATION_GUIDE.md` (this file, if maintenance rules changed)

Checklist:
- [ ] Keep labels/routes in `docs/index.html` consistent with the canonical markdown docs set.
- [ ] Ensure rendered doc routes, search, and outline behavior still match `docs/app.js`.
- [ ] If adding new shared UI classes/components, document intent with clear naming in `docs/styles.css`.
- [ ] Verify `docs/app.js` selectors still match HTML (`#doc-search`, `#content`, `#outline`, and mobile toggle controls).
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
- UI polish decisions for the route-based docs viewer shell.

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
- `docs/index.html` is the browser entrypoint for the documentation website.
- `docs/app.js` loads markdown docs on demand, renders them in the site shell, rewrites internal markdown links to viewer routes, and builds the right-rail outline.
- `docs/ai-agent-guide.html` and `docs/file-map.html` are redirect aliases into the main viewer for compatibility with older links.

Maintenance implication:
- When markdown doc filenames or route slugs change, update `docs/app.js`.
- When alias routes change, update the redirect files that point into the viewer.

### Static Docs UI File Responsibilities

#### `docs/index.html`

Responsibilities:
- Browser entrypoint for the documentation website.
- Hosts the shell layout for left navigation, central content, and right-rail outline.
- Loads the viewer assets and external rendering dependencies used by `docs/app.js`.

Authoring notes:
- Keep structural container IDs used by `docs/app.js` stable.
- Keep typography/CDN asset choices intentional and compatible with the viewer.
- Keep the site framing aligned with `docs/README.md`, `docs/SETUP.md`, and `docs/OPERATIONS.md`.

#### `docs/styles.css`

Responsibilities:
- Shared visual tokens (colors, fonts, radii, shadows) and core layout.
- Shared components/styles for the viewer shell, markdown article content, cards, tables, TOC, and responsive behavior.
- Shared styling used by `docs/index.html` and redirect pages.

Authoring notes:
- Prefer extending existing variables/classes before adding page-specific duplication.
- Preserve readability and contrast for code-heavy, maintainer-focused content.
- Re-test the main viewer and the redirect entrypoints after shared style changes.

#### `docs/app.js`

Responsibilities:
- Docs manifest and route definitions.
- Markdown fetch/render pipeline for canonical docs.
- Internal-link rewriting so markdown references stay inside the viewer.
- Search/filter behavior for the doc list.
- Right-rail outline generation and active-section tracking.
- Mobile navigation and outline panel toggles.

Current usage:
- `docs/index.html` loads `docs/app.js`.
- Redirect files forward into viewer routes instead of carrying their own docs UI.

Authoring notes:
- Keep selectors in sync with HTML (`#doc-search`, `#doc-nav`, `#content`, `#outline`, mobile toggles).
- Keep route IDs, markdown filenames, and compatibility aliases aligned.
- Avoid linking directly to raw `.md` files from the viewer unless the intent is explicitly "Open Raw Source".

## Authoring Standards (Tone And Content)

- Write for maintainers and contributors, not end-user marketing.
- Prefer exact behavior statements ("slow mode timestamps are process-memory only") over vague descriptions.
- Include affected paths when documenting invariants, risks, or workflows.
- Call out exceptions and fallback behavior explicitly.
- Keep quick-reference docs (`docs/API.md`, `docs/SETUP.md`) concise, but ensure they match detailed references.
- Keep `docs/INTEGRATION_EXAMPLES.md` runnable. Prefer complete snippets over pseudo-code when documenting common flows.
- When a source is known stale, say so directly and point to the authoritative path.

## Documentation Update Workflow (Recommended)

1. Identify the code change category (contract, schema, frontend flow, ops, file map, docs UI).
2. Apply the matching checklist from this guide.
3. Update canonical markdown docs first (`docs/*.md`).
4. Update static docs UI pages (`docs/index.html`, redirect aliases, shared styles/scripts) if navigation/summaries/presentations are affected.
5. Re-read changed docs for path accuracy and consistency with code.
6. Smoke test docs UI pages in a browser if any `docs/*.html`, `docs/styles.css`, or `docs/app.js` changed.

## Docs UI Smoke Test Checklist

Use this after changing `docs/index.html`, `docs/styles.css`, `docs/app.js`, `docs/ai-agent-guide.html`, or `docs/file-map.html`.

- [ ] Open `docs/index.html` in a browser.
- [ ] Verify docs search/filter (`#doc-search`) narrows the doc navigation correctly.
- [ ] Verify opening multiple docs updates the main article, top bar, and right-rail outline.
- [ ] Verify internal markdown links route into the viewer instead of opening raw `.md` pages.
- [ ] Verify right-rail active section highlighting updates while scrolling a rendered doc.
- [ ] Verify layout remains readable on narrow viewport widths.
- [ ] Open `docs/ai-agent-guide.html` and `docs/file-map.html` and confirm they redirect into the correct viewer routes.

## When To Update This Guide

Update `docs/DOCUMENTATION_GUIDE.md` when any of the following change:

- The docs file set or ownership boundaries change (new canonical docs, renamed docs, removed docs).
- The static docs UI architecture changes (`docs/index.html`, `docs/styles.css`, `docs/app.js`, or companion pages).
- The sync model between markdown and HTML pages changes (for example a generator is added).
- The documentation maintenance policy changes (required update rules, checklists, or authoring standards).
