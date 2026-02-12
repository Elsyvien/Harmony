# Setup Quick Reference

Canonical setup/runbook: `docs/OPERATIONS.md`

## Prerequisites

- Node.js 20+
- npm 10+
- Database compatible with Prisma provider in `backend/prisma/schema.prisma`

## Install

```bash
npm install
```

## Environment

Backend:

```bash
cp backend/.env.example backend/.env
```

Frontend:

```bash
cp web/.env.example web/.env
```

Important note:

- Current Prisma schema uses PostgreSQL provider.
- Ensure `DATABASE_URL` in `backend/.env` matches PostgreSQL format.

## Database

```bash
npm --workspace backend exec prisma db push
npm --workspace backend run prisma:seed
```

## Run

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Build, Lint, Test

```bash
npm run build
npm run lint
npm test
```

## Troubleshooting

- JWT startup error: confirm `JWT_SECRET` length >= 32.
- DB errors: verify provider/URL compatibility.
- CORS errors: verify `CLIENT_ORIGIN` includes frontend origin.
- WS errors: verify `VITE_WS_URL` and backend `/ws` endpoint.
