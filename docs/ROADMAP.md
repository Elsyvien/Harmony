# Product And Engineering Roadmap

This roadmap reflects current repository behavior as of the latest documentation update.

## Implemented

### Core Platform

- JWT auth: register, login, logout, session restore (`/me`).
- Public channel and voice channel support.
- Friend-gated direct message channels.
- Message timeline with pagination (`before`, `limit`).
- File uploads with attachment metadata and static serving.
- Message edit, soft delete, and reaction toggling.

### Realtime

- WebSocket auth handshake.
- Channel subscription events.
- Realtime message create/update/delete/reaction events.
- Friend request realtime notifications.
- Presence updates.
- Voice participant state updates and signaling relay.

### Voice

- Voice channel join/leave.
- WebRTC mesh signaling transport.
- Local mute/deafen and speaking indicators.
- Configurable channel voice bitrate (admin).
- Local per-user playback controls (volume/mute).

### Administration

- Runtime settings:
- registrations on/off
- chat read-only mode
- slow mode

- Server stats dashboard.
- User role management and account deletion with role hierarchy controls.

### Social

- Friend request send/accept/decline/cancel.
- Friend removal.
- DM creation restricted to accepted friends.

## Near-Term Priorities

1. Data workflow hardening
- Move fully to explicit migration workflow and remove provider/env ambiguity.
- Add clear environment profiles for local/test/production.

2. Realtime robustness
- Add event replay/reconciliation strategy after reconnect.
- Add delivery/read receipt semantics.
- Add richer presence states (idle/dnd/offline intent).

3. Moderation depth
- Channel-level moderation controls (lock/archive/delete audit).
- Expand user moderation actions (suspension UI, audit logs).

4. Frontend maintainability
- Split `ChatPage` orchestration into domain-specific hooks/modules.
- Increase component-level and integration test coverage.

## Mid-Term Priorities

1. Messaging quality
- Retry and resend UX for failed optimistic messages.
- Advanced composer tooling (emoji picker, richer markdown controls).

2. Voice quality
- Better peer reconnection behavior.
- Optional server-assisted media strategy for larger rooms.

3. Security and operations
- Harden upload validation and storage strategy.
- Add deployment health checks and metrics instrumentation.

## Long-Term Direction

1. Multi-tenant/guild model
- Introduce server/guild entity and scoped channels/roles.

2. Advanced collaboration features
- Threads, mentions expansion, pinned messages, and richer notifications.

3. Enterprise and reliability
- Formal observability, auditability, and operational SLO targets.
