# Setup Quick Reference

Primary documentation site: `docs/index.html`

## Prerequisites

- Node.js 20+
- npm 10+

## Install

```bash
npm install
```

## Environment

Backend env file:

```bash
cp backend/.env.example backend/.env
```

Frontend env file:

```bash
cp web/.env.example web/.env
```

Important backend variables:

- `DATABASE_URL`
- `JWT_SECRET` (min 32 chars)
- `CLIENT_ORIGIN`
- `MESSAGE_MAX_LENGTH`
- rate limit settings

## Database

Apply schema:

```bash
npm --workspace backend exec prisma db push
```

Seed:

```bash
npm --workspace backend run prisma:seed
```

## Run

```bash
npm run dev
```

- frontend: `http://localhost:5173`
- backend: `http://localhost:4000`

## Build / Lint / Test

```bash
npm run build
npm run lint
npm test
```
