# Operations Guide

This document covers setup, day-to-day commands, and troubleshooting.

## Prerequisites

- Node.js 20+
- npm 10+
- Database matching Prisma provider (`postgresql` in `backend/prisma/schema.prisma`)

## Repository Layout

- Root workspace: orchestrates backend and web commands.
- `backend`: Fastify + Prisma service.
- `web`: React + Vite application.

## Install

From repo root:

```bash
npm install
```

## Environment Setup

### Backend

Example file exists at `backend/.env.example`.

```bash
cp backend/.env.example backend/.env
```

Important variables:

- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CLIENT_ORIGIN`
- `BCRYPT_SALT_ROUNDS`
- `MESSAGE_MAX_LENGTH`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW_MS`

Important note:

- Current Prisma schema provider is PostgreSQL.
- Ensure `DATABASE_URL` matches PostgreSQL DSN format.

### Frontend

Example file exists at `web/.env.example`.

```bash
cp web/.env.example web/.env
```

Variables:

- `VITE_API_URL`
- `VITE_WS_URL`

Production sample: `web/.env.production`.

## Database Setup

Apply schema:

```bash
npm --workspace backend exec prisma db push
```

Seed baseline data:

```bash
npm --workspace backend run prisma:seed
```

Seed behavior:

- Ensures owner account defaults.
- Ensures global app settings row.
- Ensures `global` channel.

## Run Commands

From repo root:

```bash
npm run dev
```

Workspace script fan-out:

- backend dev: `npm --workspace backend run dev`
- web dev: `npm --workspace web run dev`

Default ports:

- Backend: `4000`
- Frontend: `5173`

## Build, Lint, Test

Root-level commands:

```bash
npm run build
npm run lint
npm test
```

Equivalent workspace commands:

- Backend build: `npm --workspace backend run build`
- Web build: `npm --workspace web run build`
- Backend lint: `npm --workspace backend run lint`
- Web lint: `npm --workspace web run lint`
- Backend tests: `npm --workspace backend run test`

## Backend Production Run

Build backend:

```bash
npm --workspace backend run build
```

Start backend:

```bash
npm --workspace backend run start
```

## Docs Site Preview

Render docs folder as static site:

```bash
npx serve docs
```

Open returned URL and navigate to `index.html`.

## Deployment Considerations

1. Set strong `JWT_SECRET` (32+ chars).
2. Restrict `CLIENT_ORIGIN` to trusted frontend origins.
3. Configure persistent uploads strategy if local filesystem is ephemeral.
4. Use proper DB migration workflow for production (see Prisma migrate commands).
5. Verify CORS and WebSocket endpoints match frontend env.

## Operational Checks

After deploy, verify:

1. `GET /health` returns `{ ok: true }`.
2. Login and `/me` work.
3. `GET /channels` returns expected set.
4. WebSocket auth handshake returns `auth:ok`.
5. Message send/receive works over WS and fallback REST path.
6. Admin stats/settings endpoints function for admin roles.

## Troubleshooting

### 1) `JWT_SECRET` validation error

Cause:

- secret shorter than 32 chars.

Fix:

- set longer random value in `backend/.env`.

### 2) Database connection or Prisma provider errors

Cause:

- `DATABASE_URL` does not match provider in schema.

Fix:

- align URL format with `postgresql` provider.

### 3) CORS errors in browser

Cause:

- frontend origin not in `CLIENT_ORIGIN`.

Fix:

- add correct frontend URL to `CLIENT_ORIGIN` (comma-separated supported).

### 4) WebSocket fails while REST works

Cause:

- wrong `VITE_WS_URL`.
- proxy/SSL mismatch (`ws://` vs `wss://`).

Fix:

- set `VITE_WS_URL` to correct backend WS endpoint.

### 5) File upload rejected

Cause:

- file > 8 MB or empty upload.

Fix:

- keep attachment <= 8 MB and ensure non-empty content.

### 6) Voice join issues

Cause:

- browser mic permissions denied.
- insecure context for permission requests.
- no active WS connection.

Fix:

- allow mic permissions.
- use localhost or HTTPS.
- verify websocket connection is active.

## Maintenance Checklist For Behavior Changes

When changing behavior in code:

1. Update corresponding docs in `docs/`.
2. Run lint/test/build.
3. Smoke test impacted flows.
4. Commit docs and code together.
