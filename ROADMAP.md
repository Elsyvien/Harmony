# Project Roadmap

This file is the high-level overview. The canonical detailed roadmap lives in `docs/ROADMAP.md`.

## Phase 1: Foundation (Completed)
**Goal:** A functional real-time chat application with persistent storage, authentication, and core messaging.
- [x] **Backend Setup:** Fastify + Node.js + WebSocket (ws).
- [x] **Database:** Prisma-backed persistence.
- [x] **Authentication:** JWT-based auth (Login/Register).
- [x] **Real-time Messaging:** WebSocket broadcasting.
- [x] **Basic UI:** React + Vite frontend with channel switching.

## Phase 2: Servers, Social, And Messaging (Completed)
**Goal:** Move beyond a single global chat into a server-based social product.
- [x] **Server Model:** Default server bootstrap, server creation, membership, and server-scoped channels.
- [x] **Invite Flow:** Create, revoke, and join by invite code.
- [x] **Direct Messages:** Friend-gated 1:1 conversations.
- [x] **Friend System:** Send/accept/decline/cancel requests and remove friends.
- [x] **Message Features:** Replies, reactions, edit/delete, receipts, and attachments.

## Phase 3: Voice, Media, And Admin (Completed)
**Goal:** Realtime voice/media and operational controls.
- [x] **"Refined Brutalist" Design:** Custom CSS, Space Grotesk typography, dark mode.
- [x] **3-Pane Layout:** Channels | Chat | Online Users.
- [x] **Admin System:** Runtime settings, role-based access, user management, server stats.
- [x] **Server Moderation:** Server moderation actions, audit logs, analytics, and invite management.
- [x] **User Profiles:** Modals for user details, clickable avatars.
- [x] **Optimistic UI:** Instant message rendering before server confirmation.
- [x] **Message Composer:** Dynamic auto-expanding textarea, SVG icons.
- [x] **Voice Channels:** Mesh plus optional SFU transport.
- [x] **Screen Sharing And Camera:** Desktop capture and video publishing in voice rooms.

---

## Phase 4: Discovery And Trust (Next Steps)
**Goal:** Make the existing product easier to navigate and safer to operate.
- [ ] **Message Search:** Go beyond local filtering to real message discovery.
- [ ] **Pinned Messages:** Surface key content per channel/server.
- [ ] **Block List:** User-side moderation.
- [ ] **Advanced Permissions:** Granular server and channel permissions.
- [ ] **Invite UX Hardening:** Clearer visibility and membership flow polish.

## Phase 5: Collaboration Depth
**Goal:** Add richer conversation structure without regressing reliability.
- [ ] **Threads:** Reply chains with dedicated navigation.
- [ ] **Group DMs / Private Channels:** Broader private conversation model.
- [ ] **Notifications:** Richer server/channel notification controls.
- [ ] **Composer Enhancements:** Emoji picker, richer markdown controls, link previews.

## Phase 6: Platform Scale And Reliability
**Goal:** Remove single-node assumptions and harden media/realtime behavior.
- [ ] **Realtime Reconciliation:** Better replay after reconnect.
- [ ] **Distributed Realtime State:** Presence, fanout, and voice ownership beyond in-memory single-node state.
- [ ] **Voice At Scale:** Larger-room SFU strategy and stronger reconnect recovery.
- [ ] **Operational Maturity:** Health checks, metrics, and stronger audit/compliance surfaces.
