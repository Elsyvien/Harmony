# API Quick Reference

Canonical details:

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/INTEGRATION_EXAMPLES.md`

This page is the condensed contract reference. Use it when you need routes, event names, auth rules, and a few working payload examples without reading the full backend reference.

## Base URLs

- HTTP: `http://localhost:4000`
- WebSocket: `ws://localhost:4000/ws`
- Health: `GET /health`

Auth header for protected HTTP routes:

```http
Authorization: Bearer <jwt>
```

WebSocket envelope:

```json
{ "type": "event:name", "payload": {} }
```

## Quick Start Calls

### Health Check

```bash
curl http://localhost:4000/health
```

### Register

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice_dev",
    "email": "alice@example.com",
    "password": "correct horse battery staple"
  }'
```

### Login

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "correct horse battery staple"
  }'
```

### Send A Message

```bash
curl -X POST http://localhost:4000/channels/<channel-id>/messages \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello from REST"
  }'
```

### Update Admin Settings

```bash
curl -X PUT http://localhost:4000/admin/settings \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "allowRegistrations": true,
    "readOnlyMode": false,
    "slowModeSeconds": 5,
    "idleTimeoutMinutes": 20,
    "voiceNoiseSuppressionDefault": true,
    "voiceEchoCancellationDefault": true,
    "voiceAutoGainControlDefault": false
  }'
```

## HTTP Routes

### Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | no | Username `3..24`, password `8..72`, returns `{ token, user }` |
| `POST` | `/auth/login` | no | Returns `{ token, user }` |
| `POST` | `/auth/logout` | yes | Returns `204` |
| `GET` | `/me` | yes | Returns `{ user }` |

### RTC And Media Transport

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/rtc/config` | no | Returns `{ rtc, sfu, voiceDefaults }` |
| `POST` | `/rtc/cloudflare/sessions/new` | yes | Cloudflare managed SFU passthrough |
| `GET` | `/rtc/cloudflare/sessions/:sessionId` | yes | Cloudflare managed SFU passthrough |
| `POST` | `/rtc/cloudflare/sessions/:sessionId/tracks/new` | yes | Cloudflare managed SFU passthrough |
| `PUT` | `/rtc/cloudflare/sessions/:sessionId/renegotiate` | yes | Cloudflare managed SFU passthrough |
| `PUT` | `/rtc/cloudflare/sessions/:sessionId/tracks/close` | yes | Cloudflare managed SFU passthrough |

### Users

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/users/me/avatar` | yes | Multipart upload |

### Analytics

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/analytics/events` | optional bearer | Accepts up to 50 events, returns `{ accepted, dropped }` |

### Servers

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/servers` | yes | List joined servers |
| `POST` | `/servers` | yes | Creates server and seeds default `general` + `voice` channels |
| `GET` | `/servers/:serverId` | yes | Member-scoped view |
| `GET` | `/servers/:serverId/channels` | yes | Member-scoped channel list |
| `GET` | `/servers/:serverId/members` | yes | Moderator+ |
| `GET` | `/servers/:serverId/analytics` | yes | Moderator+ |
| `GET` | `/servers/:serverId/audit-logs` | yes | Moderator+ |
| `POST` | `/servers/:serverId/moderation/actions` | yes | Moderator+ |
| `GET` | `/servers/:serverId/invites` | yes | Moderator+ |
| `POST` | `/servers/:serverId/invites` | yes | Moderator+ |
| `DELETE` | `/servers/:serverId/invites/:inviteId` | yes | Moderator+ |
| `POST` | `/servers/invites/:code/join` | yes | Join by invite code |

### Channels, Messages, Receipts, Uploads

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/channels` | yes | Includes accessible server + DM channels |
| `POST` | `/uploads` | yes | One file, 8 MB max |
| `POST` | `/channels` | yes | Moderator+ in target server |
| `DELETE` | `/channels/:id` | yes | Moderator+ in target server |
| `PATCH` | `/channels/:id/voice-settings` | yes | Moderator+ in target server |
| `POST` | `/channels/direct/:userId` | yes | Requires accepted friendship |
| `GET` | `/channels/:id/messages` | yes | Cursor by `before`, marks delivered receipts |
| `POST` | `/channels/:id/read` | yes | Marks read receipt |
| `POST` | `/channels/:id/messages` | yes | Creates message |
| `PATCH` | `/channels/:id/messages/:messageId` | yes | Owner or admin override |
| `DELETE` | `/channels/:id/messages/:messageId` | yes | Owner or admin override |
| `POST` | `/channels/:id/messages/:messageId/reactions` | yes | Toggle reaction |

### Friends

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/friends` | yes | List accepted friendships |
| `GET` | `/friends/requests` | yes | Returns `{ incoming, outgoing }` |
| `POST` | `/friends/requests` | yes | Body `{ username }` |
| `POST` | `/friends/requests/:id/accept` | yes | Accept request |
| `POST` | `/friends/requests/:id/decline` | yes | Decline request |
| `POST` | `/friends/requests/:id/cancel` | yes | Cancel request |
| `DELETE` | `/friends/:id` | yes | Remove friendship |

### Admin

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/admin/stats` | yes | Admin |
| `GET` | `/admin/settings` | yes | Admin |
| `PUT` | `/admin/settings` | yes | Admin |
| `GET` | `/admin/analytics/overview` | yes | Admin |
| `GET` | `/admin/analytics/timeseries` | yes | Admin |
| `GET` | `/admin/users` | yes | Owner/Admin |
| `PATCH` | `/admin/users/:id` | yes | Owner/Admin |
| `DELETE` | `/admin/users/:id` | yes | Owner/Admin |
| `POST` | `/admin/users/clear-others` | yes | Owner/Admin |

## Common Request Payloads

### Create Server

```json
{
  "name": "Design Review",
  "description": "Private server for UI reviews",
  "iconUrl": "https://example.com/icon.png"
}
```

### Create Channel

```json
{
  "name": "frontend-review",
  "serverId": "<server-id>",
  "type": "TEXT"
}
```

### Send Message

```json
{
  "content": "Can someone review the latest patch?",
  "replyToMessageId": "7a7626a4-c1d4-45d3-8b4b-bdc186846a86",
  "attachment": {
    "url": "/uploads/1741689322500-example.png",
    "name": "diagram.png",
    "type": "image/png",
    "size": 183204
  }
}
```

Validation rules worth remembering:

- Message `content` may be empty only when `attachment` exists.
- Channel names allow letters, numbers, `_`, and `-`.
- `PATCH /channels/:id/voice-settings` requires at least one of `voiceBitrateKbps` or `streamBitrateKbps`.
- `POST /servers/:serverId/moderation/actions` requires `type` from `WARN`, `TIMEOUT`, `KICK`, `BAN`, `UNBAN`.

### `/rtc/config` Response Shape

```json
{
  "rtc": {
    "iceServers": [
      { "urls": ["stun:stun.l.google.com:19302"] }
    ],
    "iceTransportPolicy": "all",
    "iceCandidatePoolSize": 2
  },
  "sfu": {
    "enabled": false,
    "provider": "mediasoup",
    "audioOnly": true,
    "preferTcp": false
  },
  "voiceDefaults": {
    "noiseSuppression": true,
    "echoCancellation": true,
    "autoGainControl": true
  }
}
```

## WebSocket Client Events

| Event | Payload |
|---|---|
| `auth` | `{ token }` |
| `presence:set` | `{ state }` |
| `channel:join` | `{ channelId }` |
| `channel:leave` | `{ channelId }` |
| `voice:join` | `{ channelId, requestId?, muted?, deafened? }` |
| `voice:leave` | `{ channelId? }` |
| `voice:self-state` | `{ channelId?, muted?, deafened? }` |
| `voice:sfu:request` | `{ requestId, channelId, action, data? }` |
| `voice:signal` | `{ channelId, targetUserId, data }` |
| `message:send` | `{ channelId, content }` |
| `ping` | any JSON payload |

### Example Handshake

```json
{ "type": "auth", "payload": { "token": "<jwt>" } }
{ "type": "channel:join", "payload": { "channelId": "<channel-id>" } }
{ "type": "message:send", "payload": { "channelId": "<channel-id>", "content": "hello" } }
```

### Voice Signal Example

```json
{
  "type": "voice:signal",
  "payload": {
    "channelId": "<voice-channel-id>",
    "targetUserId": "<peer-user-id>",
    "data": {
      "kind": "offer",
      "sdp": "<session-description>",
      "source": "screen"
    }
  }
}
```

### SFU Request Example

```json
{
  "type": "voice:sfu:request",
  "payload": {
    "requestId": "sfu-1",
    "channelId": "<voice-channel-id>",
    "action": "create-transport",
    "data": {
      "direction": "send"
    }
  }
}
```

## WebSocket Server Events

| Event | Payload |
|---|---|
| `auth:ok` | `{ userId }` |
| `channel:joined` | `{ channelId }` |
| `channel:left` | `{ channelId }` |
| `message:new` | `{ message }` |
| `message:updated` | `{ message }` |
| `message:deleted` | `{ message }` |
| `message:reaction` | `{ message, userId, emoji, reacted }` |
| `message:delivered` | `{ channelId, userId, upToMessageId, at }` |
| `message:read` | `{ channelId, userId, upToMessageId, at }` |
| `friend:request:new` | route-defined payload |
| `friend:request:updated` | route-defined payload |
| `dm:new` | `{ channel, from }` |
| `channel:updated` | `{ channel }` |
| `presence:update` | `{ users }` |
| `voice:join:ack` | `{ channelId, requestId? }` |
| `voice:state` | `{ channelId, participants }` |
| `voice:signal` | `{ channelId, fromUserId, data }` |
| `voice:sfu:event` | producer/event payload |
| `voice:sfu:response` | `{ requestId, ok, data?, code?, message? }` |
| `admin:settings:updated` | `{ settings }` |
| `pong` | echo of `ping` payload |
| `error` | `{ code, message }` |

## Common Error Shape

```json
{ "code": "SOME_CODE", "message": "Human readable message" }
```

Common codes:

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `INVALID_SESSION`
- `ACCOUNT_SUSPENDED`
- `CHANNEL_NOT_FOUND`
- `INVALID_VOICE_CHANNEL`
- `VOICE_NOT_JOINED`
- `VOICE_TARGET_NOT_AVAILABLE`
- `VOICE_SIGNAL_RATE_LIMITED`
- `SFU_DISABLED`
- `ATTACHMENT_TOO_LARGE`
- `CONFLICT`
- `INTERNAL_ERROR`

## Notes That Matter In Practice

- `GET /channels/:id/messages` advances delivered receipts for the fetched window.
- `POST /channels/:id/read` broadcasts `message:read` when progress moves forward.
- `POST /uploads` and `POST /channels/:id/messages` are always separate calls.
- `GET /rtc/config` already resolves the active TURN/STUN/SFU strategy. Clients should not try to rebuild that logic.
- Root `npm test` runs backend tests only. Run `npm --workspace web run test` for the frontend suite.

## Related Docs

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/INTEGRATION_EXAMPLES.md`
- `docs/OPERATIONS.md`
