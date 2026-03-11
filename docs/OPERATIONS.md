# Operations Guide

This document covers local setup, day-to-day commands, environment profiles, validation steps, and troubleshooting.

## Repository Layout

- Root workspace: orchestration for backend and frontend commands
- `backend`: Fastify API, Prisma persistence, WebSocket gateway, voice/SFU services
- `web`: React SPA, REST client, WebSocket client, voice UI/orchestration
- `docs`: canonical technical documentation

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL instance that matches the Prisma provider in `backend/prisma/schema.prisma`

## Install

From repo root:

```bash
npm install
```

## Environment Setup

### Copy Example Files

PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item web\.env.example web\.env
```

Bash:

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

### Backend Environment

Example file: `backend/.env.example`

Minimum required variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_ORIGIN`

Useful local baseline:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/harmony?schema=public
JWT_SECRET=change_this_to_a_long_random_secret_of_at_least_32_chars
CLIENT_ORIGIN=http://localhost:5173
RTC_STUN_URL=stun:stun.l.google.com:19302
RTC_FORCE_RELAY=false
SFU_ENABLED=false
SFU_PROVIDER=mediasoup
```

Environment groups that matter operationally:

- core runtime:
  `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`
- request limits and message policy:
  `BCRYPT_SALT_ROUNDS`, `MESSAGE_MAX_LENGTH`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`
- TURN and relay:
  `RTC_STUN_URL`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`, `TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL_SECONDS`, `RTC_FORCE_RELAY`, `RTC_ENABLE_PUBLIC_FALLBACK_TURN`
- Cloudflare TURN:
  `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`, `CLOUDFLARE_TURN_FILTER_PORT_53`
- SFU:
  `SFU_ENABLED`, `SFU_PROVIDER`, `SFU_AUDIO_ONLY`, `SFU_ANNOUNCED_IP`, `SFU_LISTEN_IP`, `SFU_MIN_PORT`, `SFU_MAX_PORT`, `SFU_WEBRTC_TCP`, `SFU_WEBRTC_UDP`, `SFU_PREFER_TCP`
- Cloudflare managed SFU:
  `CLOUDFLARE_SFU_APP_ID`, `CLOUDFLARE_SFU_APP_SECRET`, `CLOUDFLARE_SFU_ACCOUNT_ID`, `CLOUDFLARE_SFU_API_BASE_URL`

Important runtime behaviors:

- In production, mediasoup SFU startup fails if `SFU_ENABLED=true` and `SFU_ANNOUNCED_IP` cannot resolve to a reachable public address.
- In production, the backend warns when no TURN provider is configured.
- `/rtc/config` is the source of truth for the client-side voice transport profile.

### Frontend Environment

Example file: `web/.env.example`

Typical local values:

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000/ws
```

Operational note:

- Frontend TURN variables in `web/.env.example` are optional and are not the main source of truth for runtime ICE policy. The client still reads `GET /rtc/config`.

## Database Setup

Apply schema:

```bash
npm --workspace backend exec prisma db push
```

Seed baseline data:

```bash
npm --workspace backend run prisma:seed
```

Seed/runtime effects:

- ensures a global app settings row exists
- bootstraps the default server
- ensures default channels exist

## Run Commands

### Root Workspace Commands

| Command | Scope | Notes |
|---|---|---|
| `npm run dev` | backend + web | Runs both workspaces in parallel |
| `npm run build` | backend + web | Backend build runs Prisma generate first |
| `npm run lint` | backend + web | Lints both workspaces |
| `npm test` | backend only | Runs `backend` Vitest suite |

### Workspace Commands

| Command | Scope |
|---|---|
| `npm --workspace backend run dev` | backend dev server |
| `npm --workspace web run dev` | frontend dev server |
| `npm --workspace backend run build` | backend build |
| `npm --workspace web run build` | frontend build |
| `npm --workspace backend run lint` | backend lint |
| `npm --workspace web run lint` | frontend lint |
| `npm --workspace backend run test` | backend tests |
| `npm --workspace web run test` | frontend tests |

Default ports:

- Backend HTTP: `4000`
- Frontend: `5173`
- Backend WebSocket: `ws://localhost:4000/ws`

## Backend Production Run

```bash
npm --workspace backend run build
npm --workspace backend run start
```

## Environment Profiles

### 1. Local Default: Mesh Voice, Minimal Setup

Use this when you only need local development.

```env
NODE_ENV=development
RTC_FORCE_RELAY=false
SFU_ENABLED=false
```

Behavior:

- `GET /rtc/config` returns STUN plus development-only fallback TURN when no other relay is configured
- voice uses mesh signaling

### 2. Production Relay Profile

Use this when you want browser-to-browser voice with a reliable relay path.

```env
NODE_ENV=production
RTC_FORCE_RELAY=true
TURN_URLS=turn:your-turn-server:3478?transport=udp,turns:your-turn-server:5349?transport=tcp
TURN_SHARED_SECRET=replace-me
```

Behavior:

- `/rtc/config` returns generated short-lived TURN credentials
- browsers are forced to relay candidates only

### 3. Cloudflare TURN Profile

```env
NODE_ENV=production
RTC_FORCE_RELAY=true
CLOUDFLARE_TURN_KEY_ID=...
CLOUDFLARE_TURN_API_TOKEN=...
```

Behavior:

- backend fetches ephemeral ICE servers from Cloudflare
- configured TURN URLs are only used as fallback

### 4. Mediasoup SFU Profile

```env
NODE_ENV=production
SFU_ENABLED=true
SFU_PROVIDER=mediasoup
SFU_AUDIO_ONLY=true
SFU_ANNOUNCED_IP=voice.example.com
SFU_WEBRTC_TCP=true
SFU_WEBRTC_UDP=false
SFU_PREFER_TCP=true
```

Behavior:

- WebSocket voice flow remains the control plane
- media transport switches from mesh to backend-managed SFU

### 5. Cloudflare Managed SFU Profile

```env
NODE_ENV=production
SFU_ENABLED=true
SFU_PROVIDER=cloudflare
CLOUDFLARE_SFU_APP_ID=...
CLOUDFLARE_SFU_APP_SECRET=...
```

Behavior:

- managed SFU session routes under `/rtc/cloudflare/*` become relevant
- frontend still uses the same control-plane auth and voice events

## Validation And Smoke Tests

### HTTP

```bash
curl http://localhost:4000/health
curl http://localhost:4000/rtc/config
```

### Auth

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "ops_tester",
    "email": "ops@example.com",
    "password": "correct horse battery staple"
  }'
```

### Suggested Manual Verification Order

1. `GET /health`
2. `POST /auth/register` or `POST /auth/login`
3. `GET /servers`
4. `GET /channels`
5. `POST /channels/:id/messages`
6. open the frontend and confirm login/session restore
7. confirm WebSocket auth by observing live message delivery
8. call `GET /rtc/config`
9. if voice is enabled, join a voice channel and confirm `voice:join:ack`

## Docs Site Preview

```bash
npx serve docs
```

Open the returned URL and navigate to `index.html`.

## Deployment Considerations

1. Set a strong `JWT_SECRET` with 32+ characters.
2. Restrict `CLIENT_ORIGIN` to trusted frontend origins. Comma-separated values and wildcard patterns are supported.
3. Treat the local `uploads/` directory as ephemeral unless your deploy target persists it.
4. Keep backend and frontend origins aligned with `CLIENT_ORIGIN`, `VITE_API_URL`, and `VITE_WS_URL`.
5. Run a proper migration workflow for production data changes. `prisma db push` is appropriate for local development, not for every production change.
6. Behind a proxy or PaaS, keep Fastify `trustProxy` behavior intact so rate limiting uses real client IPs.
7. For production voice, do not rely on the development-only public fallback TURN path.

## Troubleshooting

### `JWT_SECRET` validation error

Cause:

- secret shorter than 32 characters

Fix:

- set a longer random secret in `backend/.env`

### Prisma provider or database connection errors

Cause:

- `DATABASE_URL` does not match the `postgresql` provider

Fix:

- use a PostgreSQL DSN and verify the database is reachable

### Browser CORS errors

Cause:

- frontend origin does not match `CLIENT_ORIGIN`

Fix:

- set `CLIENT_ORIGIN` to the correct frontend URL or comma-separated list

### WebSocket fails while REST works

Cause:

- wrong `VITE_WS_URL`
- TLS mismatch (`ws://` vs `wss://`)

Fix:

- point `VITE_WS_URL` at the backend `/ws` endpoint and match the deployment protocol

### Attachment upload rejected

Cause:

- file is empty
- file exceeds 8 MB

Fix:

- keep uploads non-empty and at or below 8 MB

### Voice works locally but fails in production

Cause:

- no TURN relay configured
- mediasoup `SFU_ANNOUNCED_IP` is missing or unreachable
- deployment platform blocks UDP while SFU is UDP-first

Fix:

- configure TURN or Cloudflare TURN
- set `SFU_ANNOUNCED_IP` to a reachable public DNS name or IP
- on restricted platforms, prefer TCP with `SFU_WEBRTC_TCP=true`, `SFU_WEBRTC_UDP=false`, `SFU_PREFER_TCP=true`

### Frontend tests are not running from the root test script

Cause:

- root `npm test` is intentionally mapped to the backend workspace only

Fix:

- run `npm --workspace web run test` separately

## Maintenance Checklist For Behavior Changes

When changing runtime behavior:

1. Update the matching docs in `docs/`.
2. Run the relevant build, lint, and test commands.
3. Smoke test the impacted flow.
4. Commit documentation and implementation changes together.
