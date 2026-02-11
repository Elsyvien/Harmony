# Product Roadmap

This roadmap is based on current code in `backend/` and `web/`.

## Implemented

- Auth: register, login, logout, `GET /me`
- JWT-protected API and websocket auth handshake
- Channel list and admin-only channel creation
- Message history with pagination (`before`, `limit`)
- Realtime delivery (`message:new`) with frontend polling fallback
- Optimistic sending UX with server reconciliation
- Admin runtime controls:
  - disable registrations
  - read-only chat mode for non-admin users
  - slow mode (0-60s) for non-admin users
- Admin stats dashboard (process/system/database counters)
- Role-based admin foundation with persisted user roles
- Admin user management endpoints + frontend controls for role updates and account deletion

## Priority Next Features

1. Database migrations and environment profiles
- Formalize migration strategy (`db push` -> versioned migrations).
- Add explicit migration history and deployment-ready DB workflow.
- Add separate local/dev/test database profiles.

2. Message quality improvements
- Edit/delete own messages.
- Delivery/read receipts states for optimistic + realtime flow.
- Retry UX for failed optimistic messages.

3. Channel moderation and governance
- Channel archive/lock/delete endpoints.
- Per-channel slow mode overrides.
- Basic moderation audit log.

4. Realtime robustness
- Presence (`user:online`, `user:offline`).
- Typing indicators.
- Rejoin/replay strategy after reconnect to avoid missed events.

5. Test coverage expansion
- Integration tests for auth + channel + message routes.
- Websocket event flow tests.
- Admin settings behavior tests (registration lock/read-only/slow mode).

## Later Milestones

- DMs and group DMs
- Threads and replies
- Reactions and mentions
- File uploads
- Push notifications
- Voice/video
