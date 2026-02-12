# API Quick Reference

Full API and function-level docs live in `docs/index.html`.

Base URL: `http://localhost:4000`  
WebSocket URL: `ws://localhost:4000/ws`

## REST Groups

- Auth: `/auth/register`, `/auth/login`, `/auth/logout`, `/me`
- Channels: `/channels`, `/channels/:id`, `/channels/direct/:userId`
- Messages: `/channels/:id/messages`
- Uploads: `/uploads` (multipart, 8MB max)
- Friends: `/friends`, `/friends/requests`, request action endpoints
- Admin: `/admin/stats`, `/admin/settings`, `/admin/users`

## WebSocket Event Groups

- Client events: `auth`, `channel:join`, `channel:leave`, `voice:join`, `voice:leave`, `voice:signal`, `message:send`
- Server events: `auth:ok`, `message:new`, `dm:new`, `channel:updated`, `presence:update`, `voice:state`, `voice:signal`, `friend:request:new`, `friend:request:updated`, `error`

## Error Shape

```json
{ "code": "SOME_CODE", "message": "Human readable message" }
```
