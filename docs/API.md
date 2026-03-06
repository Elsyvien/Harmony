# API Quick Reference

Canonical details:

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`

## Base Endpoints

- HTTP: `http://localhost:4000`
- WebSocket: `ws://localhost:4000/ws`
- Health: `GET /health`

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`

## RTC And Media Transport

- `GET /rtc/config`
- `POST /rtc/cloudflare/sessions/new`
- `GET /rtc/cloudflare/sessions/:sessionId`
- `POST /rtc/cloudflare/sessions/:sessionId/tracks/new`
- `PUT /rtc/cloudflare/sessions/:sessionId/renegotiate`
- `PUT /rtc/cloudflare/sessions/:sessionId/tracks/close`

## Users

- `POST /users/me/avatar`

## Analytics

- `POST /analytics/events`

## Servers

- `GET /servers`
- `POST /servers`
- `GET /servers/:serverId`
- `GET /servers/:serverId/channels`
- `GET /servers/:serverId/members`
- `GET /servers/:serverId/analytics`
- `GET /servers/:serverId/audit-logs`
- `POST /servers/:serverId/moderation/actions`
- `GET /servers/:serverId/invites`
- `POST /servers/:serverId/invites`
- `DELETE /servers/:serverId/invites/:inviteId`
- `POST /servers/invites/:code/join`

## Channels, Messages, Receipts, Uploads

- `GET /channels`
- `POST /channels` (admin)
- `DELETE /channels/:id` (admin)
- `PATCH /channels/:id/voice-settings` (admin)
- `POST /channels/direct/:userId`
- `GET /channels/:id/messages`
- `POST /channels/:id/read`
- `POST /channels/:id/messages`
- `PATCH /channels/:id/messages/:messageId`
- `DELETE /channels/:id/messages/:messageId`
- `POST /channels/:id/messages/:messageId/reactions`
- `POST /uploads`

## Friends

- `GET /friends`
- `GET /friends/requests`
- `POST /friends/requests`
- `POST /friends/requests/:id/accept`
- `POST /friends/requests/:id/decline`
- `POST /friends/requests/:id/cancel`
- `DELETE /friends/:id`

## Admin

- `GET /admin/stats`
- `GET /admin/settings`
- `PUT /admin/settings`
- `GET /admin/analytics/overview`
- `GET /admin/analytics/timeseries`
- `GET /admin/users`
- `PATCH /admin/users/:id`
- `DELETE /admin/users/:id`
- `POST /admin/users/clear-others`

## WebSocket Client Events

- `auth`
- `presence:set`
- `channel:join`
- `channel:leave`
- `voice:join`
- `voice:leave`
- `voice:self-state`
- `voice:sfu:request`
- `voice:signal`
- `message:send`
- `ping`

## WebSocket Server Events

- `auth:ok`
- `channel:joined`
- `channel:left`
- `message:new`
- `message:updated`
- `message:deleted`
- `message:reaction`
- `message:delivered`
- `message:read`
- `friend:request:new`
- `friend:request:updated`
- `dm:new`
- `channel:updated`
- `presence:update`
- `voice:join:ack`
- `voice:state`
- `voice:signal`
- `voice:sfu:event`
- `voice:sfu:response`
- `admin:settings:updated`
- `pong`
- `error`

## Error Shape

```json
{ "code": "SOME_CODE", "message": "Human readable message" }
```

## Related Docs

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/DATA_MODEL.md`
