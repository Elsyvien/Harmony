# 🤖 AGENT.md - Project Context & Guidelines

This file is for AI agents to understand the context, conventions, and architectural decisions of the **Harmony** project.

## 🏗️ Tech Stack

### Backend (`/backend`)
- **Runtime:** Node.js (TypeScript)
- **Framework:** Fastify
- **Database:** SQLite (via Prisma ORM)
- **Real-time:** `ws` (Native WebSocket) via `fastify-websocket`
- **Auth:** JWT (Standard Bearer token)

### Frontend (`/web`)
- **Framework:** React 19 (Vite)
- **Language:** TypeScript
- **Styling:** Plain CSS (Modules/Global) with extensive CSS Variables. **No Tailwind.**
- **State Management:** `zustand` (via `auth-store.ts`), React Context/Hooks.

## 🎨 Design System: "Refined Brutalist"

The project adheres to a specific aesthetic direction. **Do not deviate to generic Material/Bootstrap styles.**

- **Theme:** Dark Mode Only.
- **Typography:**
  - Headers/UI: `Space Grotesk` (Geometric, sharp).
  - Body: `Inter` (Readable).
- **Core Colors:**
  - Backgrounds: `--bg-darkest` (#0b0c0e), `--bg-dark` (#1e1f23).
  - Accent: `--accent` (#5865F2 - Blurple).
  - Borders: High contrast, 1px solid `--panel-border`.
- **Shape Language:**
  - Sharp corners (2px - 4px radius).
  - Explicit borders defining a grid layout.
  - High density information.

## 📂 Key Architecture Notes

### 1. Data Model (`backend/prisma/schema.prisma`)
- **Current Scope:** Single-Tenant / Global.
- **Limitations:** All `Channel`s are global. There is no `Server`/`Guild` concept yet.
- **Users:** Have a `role` enum (OWNER, ADMIN, MEMBER).

### 2. Frontend Layout (`web/src/pages/chat-page.tsx`)
- **Structure:** 3-Column Grid (`260px 1fr 260px`).
- **Components:**
  - `ChannelSidebar`: Left nav + User controls footer.
  - `ChatView`: Main message history.
  - `UserSidebar`: Right online user list.
  - `UserProfile`: Modal overlay.

### 3. Real-time Logic (`web/src/hooks/use-chat-socket.ts`)
- Custom hook handling WebSocket connection.
- Auto-reconnect logic.
- Messages are optimistic but verified via socket events.

## 🛠️ Development Guidelines

1.  **CSS Over Utility:** We write semantic CSS in `global.css` or component files. Do not use inline styles for structural layout.
2.  **Explicit Types:** Always define interfaces for Props and API responses in `types/api.ts`.
3.  **Safety:** When modifying `ChatPage` or core components, ensure `read_file` is used first to respect the complex state (e.g., `activeView` switching).
4.  **Icons:** Use inline SVGs for icons. Do not install an icon library (Lucide/FontAwesome) unless requested. Keep it lightweight.

## 🚀 Common Commands
- `npm run dev` (in `/web`): Start frontend.
- `npm run dev` (in `/backend`): Start backend server.
- `npx prisma studio` (in `/backend`): View database.
