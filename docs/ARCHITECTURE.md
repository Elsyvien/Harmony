# Architecture Reference

This document explains how Harmony works end-to-end across backend, database, and frontend.

## System Topology

Harmony is a two-application workspace:

- Backend service (`backend`): Fastify REST API + WebSocket gateway + Prisma persistence.
- Frontend SPA (`web`): React + Vite client that consumes REST and WebSocket.

Primary local endpoints:

- Frontend: `http://localhost:5173`
- Backend HTTP: `http://localhost:4000`
- Backend WebSocket: `ws://localhost:4000/ws`

## Backend Layering

Backend follows a layered structure:

1. Transport layer.
- HTTP routes in `backend/src/routes/*.routes.ts`
- WebSocket plugin in `backend/src/plugins/ws.plugin.ts`

2. Service layer.
- Domain rules in `backend/src/services/*.service.ts`

3. Repository layer.
- Prisma data access in `backend/src/repositories/*.repository.ts`

4. Shared infra.
- Env parsing in `backend/src/config/env.ts`
- Typed app errors in `backend/src/utils/app-error.ts`
- Role and suspension helpers in `backend/src/utils/*.ts`

## Frontend Layering

Frontend responsibilities are split as:

1. App bootstrap and route shell.
- `web/src/main.tsx`
- `web/src/App.tsx`

2. Session and transport state.
- Auth context: `web/src/store/auth-store.tsx`
- API client: `web/src/api/client.ts`
- API methods: `web/src/api/chat-api.ts`
- Socket hook: `web/src/hooks/use-chat-socket.ts`

3. Domain orchestration.
- Primary state machine: `web/src/pages/chat-page.tsx`

4. Presentational and interaction components.
- `web/src/components/*.tsx`

5. Type contracts and preferences.
- `web/src/types/*.ts`
- `web/src/hooks/use-user-preferences.ts`

## Startup Lifecycle

### Backend Startup

1. `backend/src/server.ts` loads env and builds app.
2. `buildApp()` in `backend/src/app.ts` registers:
- CORS
- rate limiting
- JWT
- multipart file upload
- static `/uploads` serving

3. App composes repositories and services.
4. Owner bootstrap updates are applied for username `max`/`Max`.
5. Default server bootstrap/backfill runs and ensures the default `global` channel exists.
6. Routes and WebSocket plugin are registered.
7. Error handler normalizes known exceptions into `{ code, message }` payloads.

### Frontend Startup

1. `web/src/main.tsx` mounts React tree under `HashRouter` + `AuthProvider`.
2. Favicon is generated from app logo.
3. `AuthProvider` restores token/user from localStorage.
4. If token exists without valid user object, provider hydrates via `GET /me`.
5. `App.tsx` routes user to login/register/chat screens.

## Transport Selection Summary

Harmony uses one application-level realtime control plane and chooses the media path separately.

### HTTP vs WebSocket

- HTTP owns bootstrap, durable fetches, uploads, and mutation fallback.
- WebSocket owns live fanout, presence, receipts, voice control, and optimistic reconciliation.
- Frontend keeps the chat usable when the WebSocket drops by falling back to timed REST refreshes.

### Voice Transport Decision

1. Frontend fetches `GET /rtc/config`.
2. Backend returns normalized ICE servers, relay policy, SFU enablement, and default audio-processing flags.
3. Frontend decides:
- `sfu.enabled=false`: mesh WebRTC with `voice:signal`
- `sfu.enabled=true`: request SFU capabilities and transports through `voice:sfu:request`
4. Voice presence and room membership still flow through WebSocket in both modes.

Practical consequence:

- Mesh and SFU share the same authentication and channel-membership control plane.
- Only the media path changes.

## Authentication Model

- JWT token is minted on register/login.
- Protected HTTP routes use `request.jwtVerify()`.
- WebSocket requires initial `auth` event containing token.
- Unauthorized HTTP calls return 401 and frontend clears auth state.
- Unauthorized socket events receive `error` events.

## Server And Membership Model

- Harmony now uses a server-scoped model for public text and voice channels.
- App startup bootstraps a default server and backfills legacy users/channels into it.
- Each new server is created with default `general` and `voice` channels.
- Server membership gates access to server channels, invites, moderation tools, analytics, and audit logs.
- Invite join flow is handled over REST and records audit activity when a new member joins.

## Channel Access Model

Channel types:

- `PUBLIC`: server-scoped text channels.
- `VOICE`: server-scoped voice/media channels.
- `DIRECT`: 1:1 channels created only for accepted friends.

Access checks:

- REST message/channel actions call `ChannelService.ensureChannelAccess(...)`.
- WS `channel:join` and `voice:join` enforce same access via service calls.
- Server-scoped channel creation, deletion, and moderation operations require privileged server membership.

## Messaging Lifecycle

### HTTP Path

1. Client posts `POST /channels/:id/messages`.
2. Route validates payload and auth.
3. `MessageService.createMessage(...)` enforces:
- read-only mode
- slow mode
- non-empty content/attachment
- max message length
- reply target validity

4. Repository writes message.
5. Route broadcasts `message:new` to channel subscribers.
6. API returns `{ message }`.

Concrete request body:

```json
{
  "content": "Latest build is ready for QA",
  "replyToMessageId": "7a7626a4-c1d4-45d3-8b4b-bdc186846a86",
  "attachment": {
    "url": "/uploads/1741689322500-example.png",
    "name": "release-notes.png",
    "type": "image/png",
    "size": 183204
  }
}
```

Receipt side effects:

- `GET /channels/:id/messages` marks delivered progress for the visible window.
- `POST /channels/:id/read` marks read progress and broadcasts `message:read`.

### WebSocket Path

1. Client sends `message:send` with `{ channelId, content }`.
2. Plugin validates auth and payload.
3. Same service path creates message.
4. Plugin broadcasts `message:new`.

Concrete envelopes:

```json
{ "type": "auth", "payload": { "token": "<jwt>" } }
{ "type": "channel:join", "payload": { "channelId": "<channel-id>" } }
{ "type": "message:send", "payload": { "channelId": "<channel-id>", "content": "hello" } }
```

### Frontend Reconciliation

`ChatPage` uses optimistic messages:

- Temporary message is inserted immediately.
- Duplicate sends are guarded by signature tracking.
- WS ack or REST response replaces optimistic entry.
- Fallback verification fetch resolves ambiguous failures.
- Failed sends are marked with `failed: true`.
- Realtime receipt events update delivered/read state without reloading the whole timeline.

## Voice Lifecycle

Voice control plane and media plane are separated.

1. Control plane (WebSocket):
- `voice:join`, `voice:leave`, `voice:self-state`, `voice:sfu:request`, `voice:signal`
- server broadcasts `voice:join:ack`, `voice:state`, `voice:sfu:event`, and `voice:sfu:response`

2. Media plane:
- Mesh mode creates `RTCPeerConnection` per peer and relays SDP/ICE through `voice:signal`.
- SFU mode uses negotiated transports and producer/consumer events over WS/REST support surfaces.
- Local media includes mic capture plus optional screen/camera publishing.

Representative control-plane exchange:

```json
{ "type": "voice:join", "payload": { "requestId": "join-1", "channelId": "<voice-channel-id>" } }
{ "type": "voice:join:ack", "payload": { "requestId": "join-1", "channelId": "<voice-channel-id>" } }
{ "type": "voice:sfu:request", "payload": { "requestId": "caps-1", "channelId": "<voice-channel-id>", "action": "get-rtp-capabilities" } }
{ "type": "voice:sfu:response", "payload": { "requestId": "caps-1", "ok": true, "data": { "rtpCapabilities": {}, "audioOnly": true } } }
```

3. QoS:
- Voice bitrate and stream bitrate are configured per channel.
- Admin users can update bitrate through REST.
- `GET /rtc/config` delivers STUN/TURN config and voice default processing flags.

4. UX resilience:
- Backend keeps a short reconnect grace period for active voice membership.
- Frontend stores reconnect intent and auto-rejoins after socket recovery.
- If mic access fails during join, client leaves voice channel.

Reconnect detail:

- Voice disconnect grace period is `15_000 ms` in `backend/src/handlers/voice-ws.handler.ts`.
- Re-authenticating before the timer expires restores the active voice channel instead of tearing it down immediately.

## Friends And DM Lifecycle

1. Friend requests are sent by username.
2. Pending requests are accepted/declined/cancelled.
3. Accepted friendships can open or reuse deterministic DM channels.
4. On new DM creation, target user receives `dm:new` socket event.
5. Frontend merges DM channel into channel list and can navigate into it.

## Admin Runtime Controls

Global settings are stored in `AppSettings` row `id = "global"`:

- `allowRegistrations`
- `readOnlyMode`
- `slowModeSeconds`

Runtime behavior:

- `AuthService.register` blocks when registrations are disabled.
- `MessageService.createMessage` blocks/throttles non-admin users based on settings.
- Frontend admin panel polls stats/settings/users while admin view is active.

## Presence And Realtime Fanout

Presence is derived from active authenticated WebSocket subscribers:

- Authenticated socket adds user to `userSubscribers` map.
- Disconnect removes subscriber.
- Presence list is broadcast via `presence:update`.
- Presence state can be set explicitly to `online`, `idle`, or `dnd`.

Channel message fanout is scoped by `channelSubscribers` map.

Friend/admin system notifications use targeted `notifyUsers` or broadcast methods on Fastify `wsGateway` decorator.

## Persistence And State Scope

### Persistent State

- Database: users, servers, server memberships, server invites, channels, channel memberships, messages, message receipts, reactions, friendships, moderation actions, audit logs, app settings, analytics events.
- Browser localStorage: token, user object, user preferences, per-user audio settings.

### In-Memory Ephemeral State

- WS subscriber maps and voice participant/reconnect state.
- Slow mode last-message timestamps (`AdminSettingsService`).
- Frontend runtime UI state in `ChatPage`.

## Failure And Fallback Strategy

- WS disconnect -> frontend keeps chat usable with periodic REST polling.
- REST 401 with token -> frontend clears auth and redirects to login.
- Optimistic send mismatch -> client verifies recent history and reconciles.
- Voice transport failures are handled as best-effort and retried on the next reconnect or voice-state sync path.

## Security Boundaries

- JWT auth required for all protected routes.
- Role checks gate admin routes and channel mutation.
- Server membership and privileged server roles gate invite, moderation, analytics, and audit surfaces.
- Ownership checks gate message edit/delete.
- Friendship checks gate DM creation.
- Suspension checks run across route groups and WS auth.

## Observability Surface

- `/health` for basic health checks.
- `/admin/stats` exposes node/system/db metrics.
- `/admin/analytics/*` exposes aggregated analytics views.
- Fastify logger enabled with sensitive field redaction in `buildApp()`.

## Analytics And Telemetry Flow

1. Frontend normalizes telemetry in `web/src/utils/telemetry.ts`.
2. Allowed client event names and context keys are defined in `web/src/utils/analytics-catalog.ts`.
3. Batched events are posted to `POST /analytics/events`.
4. Backend allowlists and normalizes events in `backend/src/services/analytics.service.ts`.
5. Server-side request, websocket, and voice reliability events are also recorded through the same analytics service.

Result:

- Admin analytics views combine browser-originated telemetry with server-originated operational events.
