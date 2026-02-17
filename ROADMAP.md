# Project Roadmap

## Phase 1: Foundation (Completed)
**Goal:** A functional real-time chat application with persistent storage and authentication.
- [x] **Backend Setup:** Fastify + Node.js + WebSocket (ws).
- [x] **Database:** SQLite with Prisma ORM.
- [x] **Authentication:** JWT-based auth (Login/Register).
- [x] **Real-time Messaging:** WebSocket broadcasting.
- [x] **Basic UI:** React + Vite frontend with channel switching.

## Phase 2: Refinement & UI (Completed)
**Goal:** A high-fidelity, polished user experience with administrative controls.
- [x] **"Refined Brutalist" Design:** Custom CSS, Space Grotesk typography, dark mode.
- [x] **3-Pane Layout:** Channels | Chat | Online Users.
- [x] **Admin System:** Role-based access, channel management, server stats.
- [x] **User Profiles:** Modals for user details, clickable avatars.
- [x] **Optimistic UI:** Instant message rendering before server confirmation.
- [x] **Message Composer:** Dynamic auto-expanding textarea, SVG icons.

---

## Phase 3: Rich Interactions (Next Steps)
**Goal:** Enhance communication beyond plain text.
- [ ] **Rich Text Support:** Markdown rendering (bold, italic, code blocks).
- [ ] **Emoji Picker:** Integration of a standard emoji selector.
- [ ] **File Attachments:** Image/file upload support (Local storage or S3).
- [ ] **Link Previews:** OpenGraph scraping for shared URLs.
- [ ] **Message Reactions:** Add reactions to messages.

## Phase 4: Social & Privacy
**Goal:** Personal connections and user status.
- [ ] **Direct Messages (DMs):** Private 1:1 conversations.
- [ ] **User Status:** Real-time Online/Idle/DND indicators.
- [x] **Friend System:** Send/Accept friend requests, manage incoming/outgoing queues, remove friends.
- [ ] **Block List:** User-side moderation.

## Phase 5: Architecture Expansion
**Goal:** Transform from a "Team Chat" to a multi-server, guild-based "Platform" (Discord-like).
- [ ] **Multi-Server Support (Guilds):**
    - Create `Server` model.
    - Scoping channels and roles to specific servers.
    - Invite system.
- [ ] **Advanced Permissions:** Granular channel-level permissions.

## Phase 6: Real-Time Media
**Goal:** Voice and Video capabilities.
- [ ] **Voice Channels:** WebRTC integration (SFU or Mesh).
- [ ] **Screen Sharing:** Desktop capture and streaming.
- [ ] **Video Calls:** Camera stream handling.
