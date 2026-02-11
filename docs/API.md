# API Reference

Base URL (default): `http://localhost:4000`

## Auth

Auth uses Bearer JWT in `Authorization` header:

```http
Authorization: Bearer <token>
```

Response error shape:

```json
{ "code": "SOME_CODE", "message": "Human readable text" }
```

## REST Endpoints

### Health

- `GET /health`
- Auth: no
- Response:

```json
{ "ok": true }
```

### Register

- `POST /auth/register`
- Auth: no
- Body:

```json
{
  "username": "alice_01",
  "email": "alice@example.com",
  "password": "Password123"
}
```

Validation:

- `username`: 3-24 chars, `[a-zA-Z0-9_]+`
- `email`: valid email, max 254 chars
- `password`: 8-72 chars

Returns `201`:

```json
{ "token": "<jwt>", "user": { "...": "..." } }
```

Can return `403 REGISTRATION_DISABLED` if admin setting disables signups.

### Login

- `POST /auth/login`
- Auth: no
- Body:

```json
{ "email": "alice@example.com", "password": "Password123" }
```

Returns `200`:

```json
{ "token": "<jwt>", "user": { "...": "..." } }
```

### Logout

- `POST /auth/logout`
- Auth: yes
- Returns: `204 No Content`

### Current User

- `GET /me`
- Auth: yes
- Returns:

```json
{ "user": { "...": "..." } }
```

### List Channels

- `GET /channels`
- Auth: yes
- Returns:

```json
{
  "channels": [
    { "id": "uuid", "name": "global", "createdAt": "ISO_DATE" }
  ]
}
```

### Create Channel (Admin only)

- `POST /channels`
- Auth: yes
- Requires admin
- Body:

```json
{ "name": "announcements" }
```

Validation:

- trimmed + normalized to lowercase
- 2-64 chars
- regex: `[a-zA-Z0-9_-]+`

Returns `201`:

```json
{ "channel": { "...": "..." } }
```

### List Channel Messages

- `GET /channels/:id/messages?before=<ISO_DATE>&limit=<1..100>`
- Auth: yes
- `:id`: UUID channel id
- `before`: optional ISO datetime
- `limit`: optional, default `50`, min `1`, max `100`

Returns:

```json
{
  "messages": [
    {
      "id": "uuid",
      "channelId": "uuid",
      "userId": "uuid",
      "content": "hello",
      "createdAt": "ISO_DATE",
      "user": { "id": "uuid", "username": "alice_01" }
    }
  ]
}
```

### Send Message

- `POST /channels/:id/messages`
- Auth: yes
- Body:

```json
{ "content": "Hello world" }
```

Validation:

- body schema max is 2000 chars
- service also enforces trim, non-empty, and `MESSAGE_MAX_LENGTH`

Admin runtime controls affect sending:

- `READ_ONLY_MODE` (`403`) for non-admin users
- `SLOW_MODE_ACTIVE` (`429`) for non-admin users

Returns `201`:

```json
{ "message": { "...": "..." } }
```

### Admin Stats (Admin only)

- `GET /admin/stats`
- Auth: yes
- Requires admin
- Returns:

```json
{
  "stats": {
    "serverTime": "ISO_DATE",
    "uptimeSec": 123,
    "node": { "...": "..." },
    "system": { "...": "..." },
    "database": { "...": "..." }
  }
}
```

### Admin Settings (Admin only)

- `GET /admin/settings`
- Auth: yes
- Requires admin
- Returns:

```json
{
  "settings": {
    "allowRegistrations": true,
    "readOnlyMode": false,
    "slowModeSeconds": 0
  }
}
```

- `PUT /admin/settings`
- Auth: yes
- Requires admin
- Body (any subset, at least one field required):

```json
{
  "allowRegistrations": true,
  "readOnlyMode": false,
  "slowModeSeconds": 10
}
```

Constraints:

- `slowModeSeconds`: integer `0..60`

### Admin Users (Admin only)

- `GET /admin/users`
- Auth: yes
- Requires `OWNER` or `ADMIN`
- Returns:

```json
{
  "users": [
    {
      "id": "uuid",
      "username": "alice",
      "email": "alice@example.com",
      "role": "MEMBER",
      "isAdmin": false,
      "isSuspended": false,
      "suspendedUntil": null,
      "createdAt": "ISO_DATE"
    }
  ]
}
```

- `PATCH /admin/users/:id`
- Auth: yes
- Requires `OWNER` or `ADMIN`
- Body:

```json
{
  "role": "MODERATOR"
}
```

- Response:

```json
{ "user": { "...": "..." } }
```

- `DELETE /admin/users/:id`
- Auth: yes
- Requires `OWNER` or `ADMIN`
- Response:

```json
{ "deletedUserId": "uuid" }
```

## WebSocket API

Endpoint: `ws://localhost:4000/ws`

Envelope:

```json
{ "type": "event:name", "payload": { "...": "..." } }
```

### Client -> Server

- `auth` payload: `{ "token": "<jwt>" }`
- `channel:join` payload: `{ "channelId": "<uuid>" }`
- `channel:leave` payload: `{ "channelId": "<uuid>" }`
- `message:send` payload: `{ "channelId": "<uuid>", "content": "text" }`

### Server -> Client

- `auth:ok` payload: `{ "userId": "<uuid>" }`
- `channel:joined` payload: `{ "channelId": "<uuid>" }`
- `channel:left` payload: `{ "channelId": "<uuid>" }`
- `message:new` payload: `{ "message": { "...": "..." } }`
- `error` payload: `{ "code": "SOME_CODE", "message": "..." }`

## Authorization Model Notes

- Authorization uses persisted DB roles: `OWNER`, `ADMIN`, `MODERATOR`, `MEMBER`.
- Admin endpoints require `OWNER` or `ADMIN`.
- User management endpoints (`PATCH /admin/users/:id`, `DELETE /admin/users/:id`) enforce hierarchy rules:
  - non-owner cannot modify owner/admin accounts
  - users cannot modify their own admin state
- Bootstrap rule: username `Max`/`max` is promoted to `OWNER` in seed/startup safeguards.
