# Setup Quick Reference

Canonical setup/runbook: `docs/OPERATIONS.md`

Use this page when you need the shortest reliable path from clone to running stack.

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL instance reachable from `DATABASE_URL`

Important note:

- `backend/prisma/schema.prisma` currently uses the `postgresql` provider.
- Root `npm test` runs the backend suite only.

## Install

```bash
npm install
```

## Create `.env` Files

### PowerShell

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item web\.env.example web\.env
```

### Bash

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

## Minimum Local Environment

Backend values that must be set correctly:

- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_ORIGIN`

Frontend values that usually work unchanged for local dev:

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000/ws
```

Recommended local backend baseline:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/harmony?schema=public
JWT_SECRET=change_this_to_a_long_random_secret_of_at_least_32_chars
CLIENT_ORIGIN=http://localhost:5173
```

Optional local voice profiles:

TURN-backed relay profile:

```env
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp
TURN_SHARED_SECRET=replace_me
TURN_CREDENTIAL_TTL_SECONDS=3600
RTC_FORCE_RELAY=true
```

Mediasoup SFU profile:

```env
SFU_ENABLED=true
SFU_PROVIDER=mediasoup
SFU_AUDIO_ONLY=true
SFU_LISTEN_IP=0.0.0.0
SFU_ANNOUNCED_IP=127.0.0.1
SFU_MIN_PORT=40000
SFU_MAX_PORT=49999
```

Cloudflare managed SFU profile:

```env
SFU_ENABLED=true
SFU_PROVIDER=cloudflare
CLOUDFLARE_SFU_APP_ID=...
CLOUDFLARE_SFU_APP_SECRET=...
CLOUDFLARE_SFU_ACCOUNT_ID=...
```

## Database

```bash
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
```

Seed effects:

- ensures the global settings row exists
- ensures the default server exists
- ensures default channels exist
- creates or upgrades the owner account `max@staneker.com` / `max123456`

## Run

```bash
npm run dev
```

Default local endpoints:

- Frontend: `http://localhost:5173`
- Backend HTTP: `http://localhost:4000`
- Backend WebSocket: `ws://localhost:4000/ws`

## Build, Lint, Test

```bash
npm run build
npm run lint
npm test
npm --workspace web run test
```

What those commands cover:

- `npm run build`: backend + web builds
- `npm run lint`: backend + web lint
- `npm test`: backend Vitest suite
- `npm --workspace web run test`: frontend Vitest suite

## Fast Sanity Checks

### Health

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{ "ok": true }
```

### RTC Configuration

```bash
curl http://localhost:4000/rtc/config
```

This confirms the backend started, env parsing worked, and voice transport config is being exposed.

### WebSocket Auth

After the app loads, the client should send:

```json
{ "type": "auth", "payload": { "token": "<jwt>" } }
```

Expected first success event:

```json
{ "type": "auth:ok", "payload": { "userId": "<current-user-id>" } }
```

## Troubleshooting

- `JWT_SECRET` validation error:
  set a value with at least 32 characters.
- Prisma/provider error:
  verify `DATABASE_URL` is a PostgreSQL DSN.
- Browser CORS error:
  ensure `CLIENT_ORIGIN` matches the frontend URL.
- WebSocket error with healthy REST:
  verify `VITE_WS_URL` points to `/ws`.
- Voice issues in production:
  configure TURN or SFU-related env vars from `docs/OPERATIONS.md`.
