# Project Structure

This document maps the Harmony codebase so contributors can quickly find where features live.

## Top-Level Layout

- `backend/`: Fastify API, websocket server, business logic, Prisma data access.
- `web/`: React/Vite frontend (chat UI, auth UI, settings, realtime client).
- `docs/`: setup, API references, roadmap, and static docs site assets.
- `README.md`: quick start and high-level project intro.
- `package.json`: workspace scripts for running backend + frontend together.

## Backend (`backend/src`)

- `server.ts`: backend entrypoint.
- `app.ts`: Fastify app composition (routes/plugins).
- `config/env.ts`: environment configuration.
- `plugins/ws.plugin.ts`: websocket registration and event handling.
- `routes/*.routes.ts`: HTTP endpoints by domain (`auth`, `channel`, `friend`, `admin`).
- `services/*.service.ts`: business logic layer for each feature area.
- `repositories/*.repository.ts`: Prisma data-access layer.
- `schemas/*.schema.ts`: request/response validation schemas.
- `types/api.ts`: shared backend API typing.
- `utils/`: shared helpers (`roles`, `suspension`, app errors).

## Frontend (`web/src`)

- `main.tsx`: React entrypoint.
- `App.tsx`: router shell and global route wiring.
- `pages/`:
  - `chat-page.tsx`: main app shell, view switching, socket orchestration, voice lifecycle.
  - `login-page.tsx`, `register-page.tsx`: authentication screens.
- `components/`:
  - `auth-form.tsx`: shared auth form UI.
  - `channel-sidebar.tsx`: channel list, voice controls, main navigation controls.
  - `chat-view.tsx`: message list rendering, context menu actions, reactions, citations/replies.
  - `message-composer.tsx`: text input, attachments, reply target UI.
  - `voice-channel-panel.tsx`: in-channel voice participant UI/controls.
  - `settings-panel.tsx`: user/account/preferences UI.
  - `friends-panel.tsx`, `user-sidebar.tsx`, `user-profile.tsx`, `admin-settings-panel.tsx`: domain-specific panels.
- `hooks/`:
  - `use-chat-socket.ts`: websocket client transport and event dispatch.
  - `use-user-preferences.ts`: persisted frontend preference management.
- `api/`:
  - `client.ts`: base fetch wrapper.
  - `chat-api.ts`: typed API calls for auth/chat/friends/admin.
- `store/auth-store.tsx`: auth session state (token + current user).
- `types/`: shared frontend types (`api`, `preferences`).
- `styles/`:
  - `global.css`: primary app styling and responsive behavior.

## Feature Location Map

- Authentication:
  - Backend: `backend/src/routes/auth.routes.ts`, `backend/src/services/auth.service.ts`
  - Frontend: `web/src/pages/login-page.tsx`, `web/src/pages/register-page.tsx`, `web/src/components/auth-form.tsx`
- Text chat and message actions (reply/reaction/edit/delete):
  - Backend: `backend/src/routes/channel.routes.ts`, `backend/src/services/message.service.ts`
  - Frontend: `web/src/components/chat-view.tsx`, `web/src/components/message-composer.tsx`, `web/src/pages/chat-page.tsx`
- Voice chat (join/leave/mute/deafen, RTC signaling):
  - Backend: `backend/src/plugins/ws.plugin.ts`, `backend/src/services/channel.service.ts`
  - Frontend: `web/src/pages/chat-page.tsx`, `web/src/components/voice-channel-panel.tsx`, `web/src/components/channel-sidebar.tsx`
- Friends and DMs:
  - Backend: `backend/src/routes/friend.routes.ts`, `backend/src/services/friend.service.ts`
  - Frontend: `web/src/components/friends-panel.tsx`, `web/src/pages/chat-page.tsx`
- Admin settings and moderation:
  - Backend: `backend/src/routes/admin.routes.ts`, `backend/src/services/admin*.service.ts`
  - Frontend: `web/src/components/admin-settings-panel.tsx`, `web/src/pages/chat-page.tsx`

## Update Guidance

When adding a new feature:

1. Add/adjust route + service + repository on backend as needed.
2. Add/adjust API client method in `web/src/api/chat-api.ts`.
3. Wire frontend state/events in `web/src/pages/chat-page.tsx` or related page.
4. Add/adjust focused component in `web/src/components/`.
5. Update this file if new top-level modules or major feature entrypoints are introduced.
