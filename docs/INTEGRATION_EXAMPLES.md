# Integration Examples

This document provides copy-paste examples for the most common Harmony integration flows.

Canonical contracts still live in:

- `docs/BACKEND_REFERENCE.md`
- `docs/FRONTEND_REFERENCE.md`
- `docs/API.md`

Assumptions used below:

- Backend base URL: `http://localhost:4000`
- WebSocket URL: `ws://localhost:4000/ws`
- Example bearer token variable: `TOKEN`

## 1. Register And Reuse The Token

### cURL

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice_dev",
    "email": "alice@example.com",
    "password": "correct horse battery staple"
  }'
```

Expected response shape:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "9d5c2f7d-5e58-4a11-9132-7d7b7e6b9350",
    "username": "alice_dev",
    "email": "alice@example.com",
    "role": "MEMBER",
    "isAdmin": false,
    "createdAt": "2026-03-11T10:15:00.000Z",
    "avatarUrl": null
  }
}
```

### JavaScript (`fetch`)

```js
const baseUrl = "http://localhost:4000";

const registerResponse = await fetch(`${baseUrl}/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "alice_dev",
    email: "alice@example.com",
    password: "correct horse battery staple",
  }),
});

if (!registerResponse.ok) {
  throw new Error(`Register failed: ${registerResponse.status}`);
}

const { token, user } = await registerResponse.json();
console.log({ token, user });
```

## 2. List Servers And Channels

The server boots a default server and ensures default channels exist. A newly registered user should be able to query them immediately.

```bash
curl http://localhost:4000/servers \
  -H "Authorization: Bearer $TOKEN"
```

```bash
curl http://localhost:4000/channels \
  -H "Authorization: Bearer $TOKEN"
```

Relevant fields in the returned channel objects:

```json
{
  "id": "5cd92234-f85f-4a08-88ae-7a24586f8265",
  "name": "general",
  "serverId": "3638cc65-9b01-49ca-94e5-21cb986a6df5",
  "isDirect": false,
  "isVoice": false,
  "voiceBitrateKbps": null,
  "streamBitrateKbps": null
}
```

## 3. Upload An Attachment Then Send A Message

Uploads are always a separate step. First send the file to `/uploads`, then embed the returned attachment object in `POST /channels/:id/messages`.

### Upload

```bash
curl -X POST http://localhost:4000/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./design-notes.png"
```

Response:

```json
{
  "attachment": {
    "url": "/uploads/1741689322500-7d0c1f54-45b7-4bc2-80a6-5fc5d1f66f1c.png",
    "name": "design-notes.png",
    "type": "image/png",
    "size": 183204
  }
}
```

### Message Create

```bash
curl -X POST http://localhost:4000/channels/<channel-id>/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Latest wireframe attached.",
    "attachment": {
      "url": "/uploads/1741689322500-7d0c1f54-45b7-4bc2-80a6-5fc5d1f66f1c.png",
      "name": "design-notes.png",
      "type": "image/png",
      "size": 183204
    }
  }'
```

Message bodies must satisfy at least one of:

- non-empty `content`
- valid `attachment`

Optional reply payload:

```json
{
  "content": "Following up on that suggestion.",
  "replyToMessageId": "9a27b8f8-d6e8-4dcf-b4b3-49df596950fa"
}
```

## 4. Mark A Channel As Read

```bash
curl -X POST http://localhost:4000/channels/<channel-id>/read \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "upToMessageId": "9a27b8f8-d6e8-4dcf-b4b3-49df596950fa"
  }'
```

Response shape:

```json
{
  "receipt": {
    "channelId": "<channel-id>",
    "userId": "<current-user-id>",
    "upToMessageId": "9a27b8f8-d6e8-4dcf-b4b3-49df596950fa",
    "at": "2026-03-11T10:18:00.000Z"
  }
}
```

## 5. Create A Server And Invite Another User

### Create The Server

```bash
curl -X POST http://localhost:4000/servers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Design Review",
    "description": "Private server for reviewing UI changes"
  }'
```

The backend seeds `general` and `voice` channels automatically for new servers.

### Create An Invite

```bash
curl -X POST http://localhost:4000/servers/<server-id>/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxUses": 10,
    "expiresInHours": 24
  }'
```

### Join By Invite Code

```bash
curl -X POST http://localhost:4000/servers/invites/<invite-code>/join \
  -H "Authorization: Bearer $TOKEN"
```

## 6. Read RTC Configuration Before Joining Voice

Voice-capable clients should fetch `GET /rtc/config` before creating peer connections or SFU transports.

```bash
curl http://localhost:4000/rtc/config
```

Response shape:

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

Interpretation rules:

- `rtc.iceServers` is already normalized by the backend.
- `rtc.iceTransportPolicy` becomes `"relay"` when `RTC_FORCE_RELAY=true`.
- `sfu.enabled=false` means the client should stay in mesh mode.
- `voiceDefaults` comes from admin settings when available.

## 7. Authenticate Over WebSocket And Subscribe To A Channel

Harmony WebSocket messages use a simple envelope:

```json
{ "type": "event:name", "payload": {} }
```

### Minimal Browser Example

```js
const token = "<jwt>";
const socket = new WebSocket("ws://localhost:4000/ws");

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "auth",
    payload: { token },
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  console.log("ws", message.type, message.payload);

  if (message.type === "auth:ok") {
    socket.send(JSON.stringify({
      type: "channel:join",
      payload: { channelId: "<channel-id>" },
    }));
  }
});
```

Expected early events:

```json
{ "type": "auth:ok", "payload": { "userId": "<current-user-id>" } }
{ "type": "presence:update", "payload": { "users": [] } }
{ "type": "channel:joined", "payload": { "channelId": "<channel-id>" } }
```

## 8. Send A Message Over WebSocket

```js
socket.send(JSON.stringify({
  type: "message:send",
  payload: {
    channelId: "<channel-id>",
    content: "Hello from the websocket transport",
  },
}));
```

Successful sends fan out as:

```json
{
  "type": "message:new",
  "payload": {
    "message": {
      "id": "<message-id>",
      "channelId": "<channel-id>",
      "content": "Hello from the websocket transport"
    }
  }
}
```

## 9. Join Voice And Request SFU Capabilities

### Join Voice

```js
socket.send(JSON.stringify({
  type: "voice:join",
  payload: {
    requestId: "join-1",
    channelId: "<voice-channel-id>",
    muted: false,
    deafened: false,
  },
}));
```

Join acknowledgement:

```json
{
  "type": "voice:join:ack",
  "payload": {
    "requestId": "join-1",
    "channelId": "<voice-channel-id>"
  }
}
```

Participant snapshots are broadcast as:

```json
{
  "type": "voice:state",
  "payload": {
    "channelId": "<voice-channel-id>",
    "participants": [
      {
        "userId": "<user-id>",
        "username": "alice_dev",
        "muted": false,
        "deafened": false
      }
    ]
  }
}
```

### Ask The SFU For RTP Capabilities

Only do this when `/rtc/config` returns `sfu.enabled=true`.

```js
socket.send(JSON.stringify({
  type: "voice:sfu:request",
  payload: {
    requestId: "sfu-capabilities-1",
    channelId: "<voice-channel-id>",
    action: "get-rtp-capabilities",
  },
}));
```

Success response:

```json
{
  "type": "voice:sfu:response",
  "payload": {
    "requestId": "sfu-capabilities-1",
    "ok": true,
    "data": {
      "rtpCapabilities": {},
      "audioOnly": true
    }
  }
}
```

## 10. Ingest Analytics Events

Analytics ingestion accepts up to 50 events per request and silently drops unknown event names.

```bash
curl -X POST http://localhost:4000/analytics/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "name": "message.send.acked",
        "category": "usage",
        "source": "web_client",
        "success": true,
        "durationMs": 84,
        "statusCode": 201,
        "channelId": "5cd92234-f85f-4a08-88ae-7a24586f8265",
        "context": {
          "channelId": "5cd92234-f85f-4a08-88ae-7a24586f8265",
          "transport": "rest",
          "hasAttachment": false,
          "hasReply": false,
          "statusCode": 201
        }
      }
    ]
  }'
```

Expected response:

```json
{
  "accepted": 1,
  "dropped": 0
}
```

## 11. Common Failure Shapes

HTTP and WebSocket errors share the same basic structure:

```json
{
  "code": "UNAUTHORIZED",
  "message": "Unauthorized"
}
```

Examples you should handle explicitly:

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `ACCOUNT_SUSPENDED`
- `CHANNEL_NOT_FOUND`
- `VOICE_NOT_JOINED`
- `VOICE_SIGNAL_RATE_LIMITED`
- `SFU_DISABLED`
- `ATTACHMENT_TOO_LARGE`

## 12. Suggested Smoke Test Sequence

When you need to verify a local stack quickly, use this order:

1. `GET /health`
2. `POST /auth/register`
3. `GET /servers`
4. `GET /channels`
5. `POST /channels/:id/messages`
6. open WebSocket, send `auth`
7. send `channel:join`
8. send `message:send`
9. `GET /rtc/config`

That sequence exercises the HTTP path, realtime path, persistence layer, and voice transport configuration surface.
