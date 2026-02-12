# File Map

This is a tracked-file map for the Harmony repository.

Scope:

- Includes source, config, test, and documentation files that are part of the repository.
- Excludes large generated/vendor paths (`node_modules`, `.git`, local build artifacts) from detailed mapping.

## Root Files

- `.gitignore` - ignore patterns for dependencies, builds, and local artifacts.
- `.prettierrc` - shared formatting configuration.
- `AGENT.md` - legacy project context file (contains some outdated statements).
- `DesignerSkill.md` - design skill prompt metadata/reference.
- `README.md` - repository landing page and quick-start commands.
- `ROADMAP.md` - high-level roadmap notes at repo root.
- `package.json` - npm workspace orchestrator scripts (`backend`, `web`).
- `package-lock.json` - npm dependency lockfile.

## Backend Config And Environment

- `backend/.env.example` - sample backend environment variables.
- `backend/.eslintrc.cjs` - backend lint configuration.
- `backend/package.json` - backend package scripts and dependencies.
- `backend/tsconfig.json` - backend TypeScript compiler configuration.
- `backend/prisma.config.ts` - Prisma config including seed command mapping.

## Backend Prisma

- `backend/prisma/schema.prisma` - database schema (models, enums, constraints).
- `backend/prisma/seed.ts` - seed routine for owner user, settings row, and default channel.
- `backend/prisma/dev.db` - legacy local DB artifact.

## Backend Entrypoints

- `backend/src/server.ts` - backend process entrypoint and listener startup.
- `backend/src/app.ts` - Fastify app composition, plugin registration, route mounting, error handler.

## Backend Configuration

- `backend/src/config/env.ts` - Zod-based environment parsing and typed `Env` output.

## Backend Plugins

- `backend/src/plugins/ws.plugin.ts` - WebSocket protocol, subscriptions, presence, voice state/signaling, gateway broadcasts.

## Backend Repositories

- `backend/src/repositories/prisma.ts` - Prisma client singleton lifecycle.
- `backend/src/repositories/user.repository.ts` - user lookup/create data access methods.
- `backend/src/repositories/channel.repository.ts` - channel list/find/create/update/delete persistence.
- `backend/src/repositories/message.repository.ts` - message timeline/write/update/delete/reaction persistence.
- `backend/src/repositories/friendship.repository.ts` - friendship and request persistence methods.

## Backend Routes

- `backend/src/routes/auth.routes.ts` - auth and session endpoints.
- `backend/src/routes/channel.routes.ts` - channel, upload, message, reaction, and DM open endpoints.
- `backend/src/routes/friend.routes.ts` - friend list/request lifecycle endpoints.
- `backend/src/routes/admin.routes.ts` - admin stats/settings/user management endpoints.

## Backend Schemas

- `backend/src/schemas/auth.schema.ts` - register/login payload validation.
- `backend/src/schemas/message.schema.ts` - channel/message/reaction/voice-setting payload validation.
- `backend/src/schemas/friend.schema.ts` - friend request and id parameter validation.

## Backend Services

- `backend/src/services/auth.service.ts` - register/login/user retrieval business logic.
- `backend/src/services/channel.service.ts` - channel lifecycle and DM access logic.
- `backend/src/services/message.service.ts` - message validation, creation, updates, deletes, reactions.
- `backend/src/services/friend.service.ts` - friend request lifecycle and friendship management.
- `backend/src/services/admin.service.ts` - runtime stats aggregation.
- `backend/src/services/admin-settings.service.ts` - persistent runtime settings and slow-mode timing state.
- `backend/src/services/admin-user.service.ts` - role-aware user management operations.

## Backend Types And Utils

- `backend/src/types/api.ts` - backend API type interfaces.
- `backend/src/types/fastify.d.ts` - Fastify module augmentation for JWT payload and websocket gateway.
- `backend/src/utils/app-error.ts` - custom typed application error class.
- `backend/src/utils/roles.ts` - role helper functions (`isAdminRole`, `isPrivilegedRole`).
- `backend/src/utils/suspension.ts` - suspension-status helper.

## Backend Tests

- `backend/tests/auth.service.test.ts` - auth service behavior tests.
- `backend/tests/channel.service.test.ts` - channel deletion and voice bitrate rule tests.
- `backend/tests/friend.service.test.ts` - friendship workflow tests.
- `backend/tests/message.service.test.ts` - message and reaction service tests.

## Web Config And Environment

- `web/.env.example` - sample frontend API and WebSocket URLs.
- `web/.env.production` - production frontend endpoint values.
- `web/.eslintrc.cjs` - frontend lint configuration.
- `web/package.json` - frontend package scripts and dependencies.
- `web/tsconfig.json` - frontend TS project references.
- `web/tsconfig.app.json` - browser/app TypeScript settings.
- `web/tsconfig.node.json` - node-side TS settings for Vite config.
- `web/vite.config.ts` - Vite dev/build configuration.
- `web/index.html` - Vite HTML entry document.
- `web/public/_redirects` - static host redirect rule configuration.

## Web Assets

- `web/ressources/logos/logo.png` - Harmony logo asset.

## Web Entrypoint And App Shell

- `web/src/main.tsx` - app mount, router/provider wiring, favicon generation.
- `web/src/App.tsx` - route definitions and default redirect.

## Web API And Transport

- `web/src/api/client.ts` - generic HTTP request wrapper and error parsing.
- `web/src/api/chat-api.ts` - typed endpoint wrappers for all backend API calls.

## Web State And Hooks

- `web/src/store/auth-store.tsx` - auth session context, persistence, hydration.
- `web/src/hooks/use-chat-socket.ts` - WebSocket lifecycle, subscriptions, and event parsing.
- `web/src/hooks/use-user-preferences.ts` - preference persistence and body class application.

## Web Pages

- `web/src/pages/login-page.tsx` - login page flow.
- `web/src/pages/register-page.tsx` - registration page flow.
- `web/src/pages/chat-page.tsx` - main application orchestrator (chat, friends, settings, admin, voice).

## Web Components

- `web/src/components/auth-form.tsx` - shared login/register form component.
- `web/src/components/channel-sidebar.tsx` - channel list, nav controls, admin channel actions.
- `web/src/components/chat-view.tsx` - message timeline rendering and context actions.
- `web/src/components/message-composer.tsx` - message input, reply UI, attachment sending.
- `web/src/components/friends-panel.tsx` - friend list/request tabs and actions.
- `web/src/components/settings-panel.tsx` - user settings and preferences UI.
- `web/src/components/admin-settings-panel.tsx` - admin runtime settings, stats, and user management UI.
- `web/src/components/voice-channel-panel.tsx` - voice participant panel and quality controls.
- `web/src/components/user-sidebar.tsx` - online user list panel.
- `web/src/components/user-profile.tsx` - user profile modal and friend actions.
- `web/src/components/dropdown-select.tsx` - custom dropdown UI primitive.
- `web/src/components/markdown-message.tsx` - markdown rendering with mention token handling.

## Web Types, Styles, Utils

- `web/src/types/api.ts` - frontend API contract types.
- `web/src/types/preferences.ts` - preference type definitions and defaults.
- `web/src/styles/global.css` - main application styling and responsive layout.
- `web/src/styles/user-sidebar.css` - sidebar-specific style overrides.
- `web/src/utils/error-message.ts` - error normalization helper.
- `web/src/utils/smooth-scroll.ts` - cancellable smooth-scroll utility.

## Documentation Files

- `docs/README.md` - documentation hub and navigation.
- `docs/AI_AGENT_GUIDE.md` - AI-agent-focused invariants and safe change workflows.
- `docs/ARCHITECTURE.md` - end-to-end architecture reference.
- `docs/BACKEND_REFERENCE.md` - backend contracts and behavior.
- `docs/FRONTEND_REFERENCE.md` - frontend contracts and behavior.
- `docs/DATA_MODEL.md` - schema and data invariant reference.
- `docs/OPERATIONS.md` - setup/run/deploy/troubleshooting guide.
- `docs/API.md` - compact API quick reference.
- `docs/SETUP.md` - compact setup quick reference.
- `docs/structure.md` - concise project structure map.
- `docs/ROADMAP.md` - product and engineering roadmap.
- `docs/index.html` - static docs landing page.
- `docs/styles.css` - static docs page styles.
- `docs/app.js` - static docs page search/nav behavior.

## Generated Or Local-Only Artifacts To Be Aware Of

- `web/dist/*` - frontend build output (may exist locally).
- `web/tsconfig.*.tsbuildinfo` - TypeScript incremental cache files.
- local `.env` files - environment-specific and not fully tracked in all cases.
