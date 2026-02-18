# Backend Reference

This document describes backend runtime behavior from source code in `backend/src`.

## Runtime Stack

- Framework: Fastify 5
- Auth: `@fastify/jwt`
- Validation: Zod at route boundaries
- ORM: Prisma Client
- Realtime: `@fastify/websocket`
- Uploads: `@fastify/multipart`
- Static file serving: `@fastify/static`

## Entrypoints

- Process start: `backend/src/server.ts`
- App composition: `backend/src/app.ts`
- Environment parser: `backend/src/config/env.ts`

## Environment Variables

Validated in `backend/src/config/env.ts`.

| Variable | Type | Constraints / Default |
|---|---|---|
| `NODE_ENV` | enum | `development` \| `test` \| `production`, default `development` |
| `PORT` | int | positive, default `4000` |
| `DATABASE_URL` | string | required |
| `JWT_SECRET` | string | min length `32` |
| `JWT_EXPIRES_IN` | string | default `15m` |
| `CLIENT_ORIGIN` | string | default `http://localhost:5173`, comma-separated list accepted |
| `BCRYPT_SALT_ROUNDS` | int | `8..15`, default `12` |
| `MESSAGE_MAX_LENGTH` | int | `1..4000`, default `2000` |
| `RATE_LIMIT_MAX` | int | min `10`, default `120` |
| `RATE_LIMIT_WINDOW_MS` | int | min `1000`, default `60000` |
| `RTC_STUN_URL` | string | default `stun:stun.l.google.com:19302` |
| `TURN_URLS` | string | comma-separated `turn:`/`turns:` URLs, default empty |
| `TURN_USERNAME` | string | static TURN username, default empty |
| `TURN_CREDENTIAL` | string | static TURN password, default empty |
| `TURN_SHARED_SECRET` | string | coturn REST shared secret for short-lived credentials, default empty |
| `TURN_CREDENTIAL_TTL_SECONDS` | int | `60..86400`, default `3600` |
| `RTC_FORCE_RELAY` | boolean | default `false` |
| `RTC_ENABLE_PUBLIC_FALLBACK_TURN` | boolean | default `true`; ignored in production when no TURN configured |
| `SFU_ENABLED` | boolean | default `false` |
| `SFU_AUDIO_ONLY` | boolean | default `true` |
| `SFU_ANNOUNCED_IP` | string | optional public IP/DNS for mediasoup candidates |
| `SFU_LISTEN_IP` | string | default `0.0.0.0` |
| `SFU_MIN_PORT` | int | `1024..65535`, default `40000`, must be `<= SFU_MAX_PORT` |
| `SFU_MAX_PORT` | int | `1024..65535`, default `49999`, must be `>= SFU_MIN_PORT` |
| `SFU_WEBRTC_TCP` | boolean | default `true` |
| `SFU_WEBRTC_UDP` | boolean | default `true` |
| `SFU_PREFER_TCP` | boolean | default `false` |

## Boot Sequence (`buildApp`)

`backend/src/app.ts` performs:

1. Create uploads directory (`uploads/`).
2. Register CORS with `CLIENT_ORIGIN` support for comma-separated origins.
3. Register global rate limit (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`).
4. Register JWT plugin.
5. Register multipart limits (8 MB file size, 1 file max).
6. Serve uploads at `/uploads/*`.
7. Construct repositories and services.
8. Enforce owner role for usernames `max` and `Max`.
9. Ensure default public channel `global`.
10. Register WebSocket plugin and route groups.
11. Add `/health` endpoint.
12. Install centralized error handler.

## Error Handling

All errors are normalized to `{ code, message }` with HTTP status.

Handled cases:

- `AppError` -> exact code + status.
- `ZodError` -> `400` with `VALIDATION_ERROR`.
- Fastify JWT unauthorized -> `401` with `UNAUTHORIZED`.
- Prisma `P2003` -> `401` with `INVALID_SESSION`.
- Prisma `P2002` -> `409` with `CONFLICT`.
- Unknown -> `500` with `INTERNAL_ERROR`.

## Authentication And Session Behavior

- JWT payload includes `userId`, `email`, `username`, `role`, `isAdmin`.
- Protected routes generally run `request.jwtVerify()`.
- Most authenticated route groups refresh user role/suspension from DB per request.
- Suspended users are blocked in channel/friend/admin routes and WS auth.

## HTTP API Contract

Base URL: `http://localhost:4000`

### Auth Routes (`backend/src/routes/auth.routes.ts`)

| Method | Path | Auth | Rate Limit | Request Schema | Response |
|---|---|---|---|---|---|
| `POST` | `/auth/register` | no | `8/min` | `registerBodySchema` (`username`, `email`, `password`) | `201 { token, user }` |
| `POST` | `/auth/login` | no | `12/min` | `loginBodySchema` (`email`, `password`) | `200 { token, user }` |
| `POST` | `/auth/logout` | yes | global | none | `204` |
| `GET` | `/me` | yes | global | none | `200 { user }` |

Validation highlights:

- Username: 3..24, alphanumeric + underscore.
- Password: 8..72 chars.

### Channel And Message Routes (`backend/src/routes/channel.routes.ts`)

Auth prehandler for this group:

- Verifies JWT.
- Loads user from DB.
- Rejects suspended users.
- Refreshes `request.user.role` and `request.user.isAdmin`.

| Method | Path | Role | Rate Limit | Request Schema | Response |
|---|---|---|---|---|---|
| `GET` | `/channels` | user | `120/min` | none | `{ channels }` |
| `POST` | `/uploads` | user | `30/min` | multipart file | `201 { attachment }` |
| `POST` | `/channels` | admin | `10/min` | `createChannelBodySchema` | `201 { channel }` |
| `DELETE` | `/channels/:id` | admin | `20/min` | `channelIdParamsSchema` | `{ deletedChannelId }` |
| `PATCH` | `/channels/:id/voice-settings` | admin | `30/min` | params + `updateVoiceSettingsBodySchema` | `{ channel }` |
| `POST` | `/channels/direct/:userId` | user | `30/min` | `directChannelParamsSchema` | `{ channel }` |
| `GET` | `/channels/:id/messages` | user | `120/min` | params + `listMessagesQuerySchema` | `{ messages }` |
| `POST` | `/channels/:id/messages` | user | `30/min` | params + `createMessageBodySchema` | `201 { message }` |
| `PATCH` | `/channels/:id/messages/:messageId` | user/owner/admin | `30/min` | params + `updateMessageBodySchema` | `{ message }` |
| `DELETE` | `/channels/:id/messages/:messageId` | user/owner/admin | `30/min` | params | `{ message }` |
| `POST` | `/channels/:id/messages/:messageId/reactions` | user | `80/min` | params + `toggleReactionBodySchema` | `{ message, reacted, emoji }` |

Upload behavior:

- Accepts one file.
- Rejects empty file and file > 8 MB.
- Stored filename is generated (`timestamp-uuid.ext`).
- Response attachment payload:

```json
{
  "attachment": {
    "url": "/uploads/<generated-name>",
    "name": "<cleaned-original>",
    "type": "<mime>",
    "size": 12345
  }
}
```

### Friend Routes (`backend/src/routes/friend.routes.ts`)

Auth prehandler:

- Verifies JWT.
- Ensures user exists and is not suspended.

| Method | Path | Rate Limit | Request | Response |
|---|---|---|---|---|
| `GET` | `/friends` | `40/min` | none | `{ friends }` |
| `GET` | `/friends/requests` | `40/min` | none | `{ incoming, outgoing }` |
| `POST` | `/friends/requests` | `20/min` | `{ username }` | `201 { request }` |
| `POST` | `/friends/requests/:id/accept` | `25/min` | path param | `{ friendship }` |
| `POST` | `/friends/requests/:id/decline` | `25/min` | path param | `204` |
| `POST` | `/friends/requests/:id/cancel` | `25/min` | path param | `204` |
| `DELETE` | `/friends/:id` | `20/min` | path param | `204` |

### Admin Routes (`backend/src/routes/admin.routes.ts`)

Auth prehandler:

- Verifies JWT.
- Ensures user exists and is not suspended.
- Refreshes role/admin status from DB.

| Method | Path | Role | Rate Limit | Request | Response |
|---|---|---|---|---|---|
| `GET` | `/admin/stats` | admin | `30/min` | none | `{ stats }` |
| `GET` | `/admin/settings` | admin | `30/min` | none | `{ settings }` |
| `PUT` | `/admin/settings` | admin | `20/min` | `updateAdminSettingsSchema` | `{ settings }` |
| `GET` | `/admin/users` | owner/admin | `30/min` | none | `{ users }` |
| `PATCH` | `/admin/users/:id` | owner/admin | `25/min` | params + `updateAdminUserSchema` | `{ user }` |
| `DELETE` | `/admin/users/:id` | owner/admin | `15/min` | params | `{ deletedUserId }` |

## WebSocket Protocol (`backend/src/plugins/ws.plugin.ts`)

Endpoint: `ws://localhost:4000/ws`

Message envelope:

```json
{ "type": "event:name", "payload": { } }
```

### Connection State

Server keeps in-memory maps for:

- `channelSubscribers`: channel -> sockets
- `userSubscribers`: user -> sockets
- `voiceParticipants`: channel -> map(user)
- `activeVoiceChannelByUser`: user -> channel

### Client -> Server Events

| Event | Payload | Notes |
|---|---|---|
| `auth` | `{ token }` | Required first; validates JWT and suspension state. |
| `channel:join` | `{ channelId }` | Subscribes client to channel message broadcasts if accessible. |
| `channel:leave` | `{ channelId }` | Unsubscribes client from channel. |
| `voice:join` | `{ channelId }` | Joins voice state for voice channels only. |
| `voice:leave` | `{ channelId? }` | Leaves active/specified voice channel. |
| `voice:signal` | `{ channelId, targetUserId, data }` | Relays WebRTC signaling to target user in same voice channel. |
| `message:send` | `{ channelId, content }` | Creates message and broadcasts `message:new`. |

### Server -> Client Events

| Event | Payload |
|---|---|
| `auth:ok` | `{ userId }` |
| `channel:joined` | `{ channelId }` |
| `channel:left` | `{ channelId }` |
| `message:new` | `{ message }` |
| `message:updated` | `{ message }` |
| `message:deleted` | `{ message }` |
| `message:reaction` | `{ message, userId, emoji, reacted }` |
| `friend:request:new` | route-defined payload |
| `friend:request:updated` | route-defined payload |
| `dm:new` | `{ channel, from }` |
| `channel:updated` | `{ channel }` |
| `presence:update` | `{ users: [{ id, username }] }` |
| `voice:state` | `{ channelId, participants }` |
| `voice:signal` | `{ channelId, fromUserId, data }` |
| `error` | `{ code, message }` |

### WS Error Codes (Common)

- `INVALID_EVENT`
- `INVALID_AUTH`
- `UNAUTHORIZED`
- `INVALID_CHANNEL`
- `CHANNEL_NOT_FOUND`
- `INVALID_VOICE_CHANNEL`
- `VOICE_NOT_JOINED`
- `VOICE_TARGET_NOT_AVAILABLE`
- `INVALID_SIGNAL`
- `INVALID_MESSAGE`
- `UNKNOWN_EVENT`
- `WS_ERROR` (generic fallback)

## Service Layer API

### `AuthService`

File: `backend/src/services/auth.service.ts`

Methods:

- `register(input)`
- `login(input)`
- `getById(userId)`

Rules:

- Registration blocked when `allowRegistrations=false`.
- Duplicate email/username rejected.
- Passwords hashed with bcrypt.
- Username `max` (case-insensitive via normalization) bootstraps role `OWNER`.
- Suspended users cannot login.

### `ChannelService`

File: `backend/src/services/channel.service.ts`

Methods:

- `ensureDefaultChannel()`
- `listChannels(userId)`
- `createChannel(name, type)`
- `deleteChannel(channelId)`
- `updateVoiceChannelBitrate(channelId, voiceBitrateKbps)`
- `ensureChannelExists(channelId)`
- `ensureChannelAccess(channelId, userId)`
- `getChannelSummaryForUser(channelId, userId)`
- `openDirectChannel(userId, targetUserId)`

Rules:

- Channel names are normalized to lowercase on creation.
- Cannot delete direct channels.
- Cannot delete `global` public channel.
- Must keep at least one public channel.
- DM channel creation requires accepted friendship.

### `MessageService`

File: `backend/src/services/message.service.ts`

Methods:

- `listMessages(input)`
- `createMessage(input)`
- `updateMessage(input)`
- `deleteMessage(input)`
- `toggleReaction(input)`

Rules:

- Access check required for all operations.
- Read-only and slow mode enforced for non-admin senders.
- Message must have content or attachment.
- Reply target must exist in same channel and not be deleted.
- Edit/delete allowed for owner or admin override.
- Deleted messages cannot be reacted to.

### `FriendService`

File: `backend/src/services/friend.service.ts`

Methods:

- `listFriends(userId)`
- `listRequests(userId)`
- `sendRequest(userId, targetUsername)`
- `acceptRequest(userId, requestId)`
- `declineRequest(userId, requestId)`
- `cancelRequest(userId, requestId)`
- `removeFriend(userId, friendshipId)`

Rules:

- Request target lookup has case fallback strategy.
- Self-friending is blocked.
- Pending request direction determines allowed accept/decline/cancel actions.

### `AdminService`

File: `backend/src/services/admin.service.ts`

Methods:

- `getServerStats()`

Returns node, system, and database counters for dashboard.

### `AdminSettingsService`

File: `backend/src/services/admin-settings.service.ts`

Methods:

- `getSettings()`
- `updateSettings(partial)`
- `getSlowModeRetrySeconds(userId, channelId, slowModeSeconds)`
- `markMessageSent(userId, channelId)`

Notes:

- Ensures singleton row `id="global"` exists.
- Slow mode timestamp map is in-memory.

### `AdminUserService`

File: `backend/src/services/admin-user.service.ts`

Methods:

- `listUsers(actorRole)`
- `updateUser(actor, targetUserId, input)`
- `deleteUser(actor, targetUserId)`

Rules:

- Only `OWNER`/`ADMIN` may manage users.
- No self-modification.
- Non-owner cannot modify owner/admin accounts or grant owner/admin.

## Repository Layer API

### `PrismaUserRepository`

- `findById`
- `findByEmail`
- `findByUsername`
- `create`

### `PrismaChannelRepository`

- list/find helpers for user-scoped and direct channels
- create/delete/update for public/voice/direct channels
- ensures global channel existence

### `PrismaMessageRepository`

- timeline list with cursor pagination
- create/update soft-delete
- reaction toggle transaction
- response mapping into `MessageWithAuthor`

### `PrismaFriendshipRepository`

- pair/id lookup
- list by user+status
- create pending, accept, delete

## Type Extensions

Fastify instance is decorated with `wsGateway` methods.

File: `backend/src/types/fastify.d.ts`

Methods include:

- `broadcastMessage`
- `broadcastMessageUpdated`
- `broadcastMessageDeleted`
- `broadcastMessageReaction`
- `notifyUsers`
- `broadcastSystem`

## Tests

Backend service tests live in `backend/tests`:

- auth service behavior and password/role logic
- channel deletion and bitrate update rules
- friend request lifecycle and permission checks
- message create/edit/delete/reaction behavior

Run:

```bash
npm test
```

## Backend Extension Checklist

When implementing backend changes:

1. Add/update route schema.
2. Add/update service rule.
3. Add/update repository methods.
4. Keep error codes stable or document change.
5. Update frontend API/types if payload changed.
6. Update docs and tests.
