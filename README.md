# DiscordClone MVP (Web + Backend)

Discord-aehnliches MVP mit:
- Registrierung/Login/Logout
- Channels (inkl. Default `global`)
- Nachrichten senden/lesen mit Paging
- Realtime via WebSocket (`/ws`) und Polling-Fallback im Web-Client

## Architektur

- `backend/`: Fastify + TypeScript + Prisma + PostgreSQL
- `web/`: React + TypeScript + Vite

## Projektstruktur

```text
.
|- backend/
|  |- prisma/
|  |  |- migrations/0001_init/migration.sql
|  |  |- schema.prisma
|  |  \- seed.ts
|  |- src/
|  |  |- config/env.ts
|  |  |- plugins/ws.plugin.ts
|  |  |- repositories/
|  |  |- routes/
|  |  |- services/
|  |  |- schemas/
|  |  |- types/
|  |  |- utils/
|  |  |- app.ts
|  |  \- server.ts
|  \- tests/
|- web/
|  |- src/
|  |  |- api/
|  |  |- components/
|  |  |- hooks/
|  |  |- pages/
|  |  |- store/
|  |  |- styles/
|  |  |- types/
|  |  |- App.tsx
|  |  \- main.tsx
|  \- index.html
\- package.json
```

## Voraussetzungen

- Node.js 20+
- PostgreSQL 14+

## Setup

1. Dependencies installieren:
```bash
npm install
```

2. Env-Dateien anlegen:
```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

3. Datenbank-Migration + Seed:
```bash
npm --workspace backend run prisma:migrate
npm --workspace backend run prisma:seed
```

4. Dev-Server starten:
```bash
npm run dev
```

- Backend: `http://localhost:4000`
- Web: `http://localhost:5173`

## API Contracts (MVP)

### REST

- `POST /auth/register` `{ username, email, password }`
- `POST /auth/login` `{ email, password }`
- `POST /auth/logout` (auth required)
- `GET /me` (auth required)
- `GET /channels` (auth required)
- `GET /channels/:id/messages?before=<ISO>&limit=<1..100>` (auth required)
- `POST /channels/:id/messages` `{ content }` (auth required)

Error-Format:
```json
{ "code": "SOME_CODE", "message": "Human readable text" }
```

### WebSocket

Endpoint: `ws://localhost:4000/ws`

Client -> Server:
- `auth` `{ token }`
- `channel:join` `{ channelId }`
- `channel:leave` `{ channelId }`
- `message:send` `{ channelId, content }`

Server -> Client:
- `auth:ok` `{ userId }`
- `channel:joined` `{ channelId }`
- `channel:left` `{ channelId }`
- `message:new` `{ message }`
- `error` `{ code, message }`

## Tests und Qualitaet

- Backend Unit Tests:
```bash
npm --workspace backend run test
```

- Lint:
```bash
npm run lint
```

## Beispiel-Requests (curl)

1. Register:
```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice_01","email":"alice@example.com","password":"Password123"}'
```

2. Login:
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Password123"}'
```

3. Message senden (mit Token):
```bash
curl -X POST http://localhost:4000/channels/<channel-id>/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"content":"Hallo aus dem MVP"}'
```

## Later (Out of Scope)

- DMs und Gruppen
- Rollen/Rechte und Server-Hierarchien
- Voice/Video/Screen-Share
- Reactions, Threads, Mentions, Uploads
- Push Notifications
