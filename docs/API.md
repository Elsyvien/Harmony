# API Quick Reference

Canonical details:

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`

## Base Endpoints

- HTTP: `http://localhost:4000`
- WebSocket: `ws://localhost:4000/ws`

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`

## Channels, Messages, Uploads

- `GET /channels`
- `POST /channels` (admin)
- `DELETE /channels/:id` (admin)
- `PATCH /channels/:id/voice-settings` (admin)
- `POST /channels/direct/:userId`
- `GET /channels/:id/messages`
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
- `GET /admin/users`
- `PATCH /admin/users/:id`
- `DELETE /admin/users/:id`

## WebSocket Client Events

- `auth`
- `channel:join`
- `channel:leave`
- `voice:join`
- `voice:leave`
- `voice:signal`
- `message:send`

## WebSocket Server Events

- `auth:ok`
- `channel:joined`
- `channel:left`
- `message:new`
- `message:updated`
- `message:deleted`
- `message:reaction`
- `friend:request:new`
- `friend:request:updated`
- `dm:new`
- `channel:updated`
- `presence:update`
- `voice:state`
- `voice:signal`
- `error`

## Error Shape

```json
{ "code": "SOME_CODE", "message": "Human readable message" }
```

## Related Docs

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/DATA_MODEL.md`
