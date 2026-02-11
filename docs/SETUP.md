# Setup and Development

## Prerequisites

- Node.js 20+
- npm 10+

## Install

```bash
npm install
```

## Environment Files

Backend:

```bash
cp backend/.env.example backend/.env
```

Web:

```bash
cp web/.env.example web/.env
```

### Backend Variables

`backend/.env.example`:

- `NODE_ENV`: `development | test | production`
- `PORT`: backend port (default `4000`)
- `DATABASE_URL`: Prisma datasource URL
- `JWT_SECRET`: at least 32 chars
- `JWT_EXPIRES_IN`: JWT expiry string (default `15m`)
- `CLIENT_ORIGIN`: allowed frontend origin for CORS
- `BCRYPT_SALT_ROUNDS`: integer `8..15`
- `MESSAGE_MAX_LENGTH`: integer `1..4000`
- `RATE_LIMIT_MAX`: global max requests per window
- `RATE_LIMIT_WINDOW_MS`: global rate-limit window in ms

### Web Variables

`web/.env.example`:

- `VITE_API_URL` (default `http://localhost:4000`)
- `VITE_WS_URL` (default `ws://localhost:4000/ws`)

## Database Notes

Local development defaults to SQLite:

- `backend/prisma/schema.prisma` datasource provider: `sqlite`
- default `DATABASE_URL`: `file:./dev.db`

## Seed Data

Sync schema before seed (important on fresh databases):

```bash
npm --workspace backend exec prisma db push
```

Then seed:

```bash
npm --workspace backend run prisma:seed
```

Seed creates:

- user: `max@staneker.com` / password `max123456`
- default channel: `global`

## Run in Development

From repo root:

```bash
npm run dev
```

This runs:

- backend dev server: `npm --workspace backend run dev`
- web dev server: `npm --workspace web run dev`

Default URLs:

- backend: `http://localhost:4000`
- web: `http://localhost:5173`

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Tests

```bash
npm test
```

Runs backend tests (`vitest run` in `backend/`).
