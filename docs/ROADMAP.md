# Product And Engineering Roadmap

This roadmap reflects current repository behavior as of the latest documentation update.

## Implemented

### Core Platform

- JWT auth: register, login, logout, session restore (`/me`).
- Server model with default-server bootstrap, server creation, membership, and invite-based join.
- Server-scoped text and voice channels plus friend-gated direct message channels.
- Message timeline with pagination (`before`, `limit`).
- File uploads with attachment metadata, avatar upload, and static serving.
- Message replies, edit, soft delete, reactions, and delivery/read receipts.

### Realtime

- WebSocket auth handshake.
- Channel subscription events.
- Realtime message create/update/delete/reaction/delivery/read events.
- Friend request realtime notifications.
- Presence updates (`online`, `idle`, `dnd`).
- Voice participant state updates, join acknowledgements, signaling relay, and SFU event forwarding.

### Voice

- Voice channel join/leave.
- WebRTC mesh transport plus optional SFU transport.
- Local mute/deafen and speaking indicators.
- Configurable channel voice and stream bitrate (admin).
- Screen-share and camera-share publishing in voice rooms.
- Voice reconnect grace period and client auto-rejoin intent handling.
- Local per-user playback controls (volume/mute).

### Administration

- Runtime settings:
- registrations on/off
- chat read-only mode
- slow mode
- idle timeout
- default voice capture processing flags

- Server stats dashboard.
- User role management and account deletion with role hierarchy controls.
- Server invite management, moderation actions, audit logs, and server analytics.

### Social

- Friend request send/accept/decline/cancel.
- Friend removal.
- DM creation restricted to accepted friends.

## Near-Term Priorities

1. Search and discovery
- Message search that moves beyond local filtering.
- Pinned messages and stronger unread/jump navigation.

2. Trust and access
- Block list / user-side moderation.
- Granular server and channel permissions beyond role-derived moderator gates.
- Invite UX hardening around visibility, copy/share flow, and clearer membership states.

3. Realtime robustness
- Add event replay/reconciliation strategy after reconnect.
- Polish delivery/read receipt UX and unread state derivation.
- Add richer presence states (idle/dnd/offline intent).

4. Frontend maintainability
- Split `ChatPage` orchestration into domain-specific hooks/modules. (In progress: friends/presence/channel/effects hooks + shell extraction landed)
- Increase component-level, integration, and reconnect/voice end-to-end coverage.

## Mid-Term Priorities

1. Conversation structure
- Threads and richer mention flows.
- Group DM or private-channel model beyond current 1:1 direct messages.
- Richer notification controls and server-level notification routing.

2. Messaging quality
- Retry and resend UX for failed optimistic messages.
- Advanced composer tooling (emoji picker, richer markdown controls, link previews).

3. Voice quality and scale
- Harden reconnect behavior across device changes and WS interruptions.
- Expand larger-room SFU strategy and media observability.
- Continue stream-quality and transport diagnostics work.

4. Moderation, compliance, and operations
- Consent persistence and policy-gated onboarding surfaces.
- Better audit-log review ergonomics and moderation tooling depth.
- Harden upload validation and storage strategy.
- Add deployment health checks and metrics instrumentation.

## Long-Term Direction

1. Distributed realtime platform
- Move presence, voice session ownership, and realtime fanout beyond single-node memory assumptions.

2. Advanced collaboration features
- Deeper search, discovery, and workspace knowledge surfaces.
- Richer collaborative channel affordances on top of threads, pins, and notifications.

3. Enterprise and reliability
- Formal observability, auditability, and operational SLO targets.

