# Frontend Reference

Source of truth: `web/src`

## Stack

- React 19
- React Router (hash routing)
- TypeScript
- Vite
- Plain CSS (`global.css`, `user-sidebar.css`)

## Entrypoints

- `web/src/main.tsx`
- `web/src/App.tsx`

### `main.tsx`

Responsibilities:

- Mount React app using `React.StrictMode`.
- Wrap app with `HashRouter` and `AuthProvider`.
- Apply logo-derived square favicon at runtime.
- Load global stylesheets.

### `App.tsx`

Route map:

- `/login` -> `LoginPage`
- `/register` -> `RegisterPage`
- `/chat` -> `ChatPage`
- `*` -> redirect to `/chat`

## Session And Auth State

File: `web/src/store/auth-store.tsx`

Persistent keys:

- `discordclone_token`
- `discordclone_user`

Behavior:

- Parses stored user defensively.
- Derives fallback role/admin fields for legacy stored payloads.
- If token exists but user is missing/invalid, hydrates with `chatApi.me(token)`.
- Clears token and user on hydration failure.

Public API:

- `AuthProvider`
- `useAuth()` returning:
- `token`, `user`, `hydrating`, `setAuth(token, user)`, `clearAuth()`

## API Client Layer

### `apiRequest` (`web/src/api/client.ts`)

- Uses `VITE_API_URL` with fallback `http://localhost:4000`.
- Adds JSON `Content-Type` automatically unless body is `FormData`.
- Adds `Authorization: Bearer <token>` when token provided.
- On non-OK responses, parses API error payload.
- Retries idempotent requests (`GET`/`HEAD`/`OPTIONS`) up to 3 attempts for `429`, `502`, `503`, and `504`, honoring `Retry-After` when present.
- On `401` with token, clears auth localStorage and redirects to `/login`.

### `chatApi` (`web/src/api/chat-api.ts`)

Complete typed REST method surface:

- Auth: `register`, `login`, `logout`, `me`
- Channels: `channels`, `createChannel`, `deleteChannel`, `updateVoiceChannelSettings`, `createDirectChannel`
- Uploads: `uploadAttachment`
- Admin: `adminStats`, `adminSettings`, `updateAdminSettings`, `adminUsers`, `updateAdminUser`, `deleteAdminUser`
- Friends: `friends`, `friendRequests`, `sendFriendRequest`, `acceptFriendRequest`, `declineFriendRequest`, `cancelFriendRequest`, `removeFriend`
- Messages: `messages`, `sendMessage`, `updateMessage`, `deleteMessage`, `toggleMessageReaction`

## WebSocket Transport Hook

File: `web/src/hooks/use-chat-socket.ts`

### Inputs

- `token`
- `subscribedChannelIds`
- callbacks:
- `onMessageNew`
- `onMessageUpdated`
- `onMessageDeleted`
- `onMessageReaction`
- `onFriendEvent`
- `onDmEvent`
- `onChannelUpdated`
- `onPresenceUpdate`
- `onVoiceState`
- `onVoiceSignal`

### Internal behavior

- Opens WS to `VITE_WS_URL` (default `ws://localhost:4000/ws`).
- On open:
- sends `auth` event
- joins all subscribed channels

- Handles server events and forwards parsed payloads via callbacks.
- Reconnects after 2 seconds on close.
- Maintains join/leave diffs when `subscribedChannelIds` changes.

### Returned API

- `connected`
- `sendMessage(channelId, content)`
- `joinVoice(channelId)`
- `leaveVoice(channelId?)`
- `sendVoiceSignal(channelId, targetUserId, data)`

## User Preferences Hook

File: `web/src/hooks/use-user-preferences.ts`

Storage key:

- `discordclone_user_preferences_v4`

Responsibilities:

- Parse and normalize persisted preferences.
- Clamp numeric ranges (voice sensitivity, output volume).
- Persist updates to localStorage.
- Apply global body classes:
- theme class
- compact mode
- reduced motion
- 24h clock
- font scale

## Page Components

## `LoginPage` (`web/src/pages/login-page.tsx`)

- Redirects authenticated users to `/chat`.
- Submits credentials through `chatApi.login`.
- Stores session with `auth.setAuth`.

## `RegisterPage` (`web/src/pages/register-page.tsx`)

- Redirects authenticated users to `/chat`.
- Submits registration through `chatApi.register`.
- Stores session with `auth.setAuth`.

## `ChatPage` (`web/src/pages/chat-page.tsx`)

`ChatPage` is now a thinner orchestration layer.

### High-level responsibilities

- Wire auth/session state to page-level features.
- Coordinate channel/message/friend/admin/voice state.
- Own voice signaling/transport lifecycle and socket event integration.
- Keep polling fallback active when WebSocket is offline.

### Internal modularization

- `web/src/pages/chat/hooks/use-friends-feature.ts`:
- friend list/request loading and mutation actions.

- `web/src/pages/chat/hooks/use-chat-presence-feature.ts`:
- presence state normalization, hidden-unread tracking, and title updates.

- `web/src/pages/chat/hooks/use-channel-management-feature.ts`:
- create/delete channel, voice quality updates, attachment upload.

- `web/src/pages/chat/hooks/use-chat-page-effects.ts`:
- cross-cutting page effects (view resets, polling intervals, keyboard shortcut, notices).

- `web/src/pages/chat/components/chat-page-shell.tsx`:
- presentational shell for sidebar/panel layout and major view rendering.

### Realtime and fallback strategy

- Uses `useChatSocket` for live events.
- Polls active channel messages on a non-overlapping ~5s loop (with small jitter) when socket is disconnected.
- Admin and friends views use non-overlapping refresh loops while active.

### Voice workflow summary

- WebSocket voice state events drive membership and signaling.
- Per-peer WebRTC connections are maintained in `ChatPage`.
- SDP/ICE signaling is relayed through `sendVoiceSignal`.
- Transport teardown happens on disconnect/leave/not-present transitions.

## Component Contracts

### `AuthForm`

File: `web/src/components/auth-form.tsx`

- Shared login/register form.
- Emits `onSubmit({ username?, email, password })`.

### `ChannelSidebar`

File: `web/src/components/channel-sidebar.tsx`

- Displays DM, text, and voice channel groups.
- Handles channel search/filter.
- Admin controls for channel create/delete.
- Voice join/leave controls and self mute/deafen controls.
- Navigation switches between chat/friends/settings/admin views.

### `ChatView`

File: `web/src/components/chat-view.tsx`

- Renders message list, timestamps, markdown, attachments, reactions.
- Context menu for quick reactions, profile open, mention, reply, edit, delete, copy.
- Smooth scroll behavior with "jump to latest" CTA.

### `MessageComposer`

File: `web/src/components/message-composer.tsx`

- Auto-expanding textarea.
- Enter-to-send or Ctrl/Cmd+Enter mode.
- Reply-pill support.
- Attachment upload integration.
- Optimized UX with immediate clear and restore-on-failure.

### `FriendsPanel`

File: `web/src/components/friends-panel.tsx`

- Tabbed friend management (`friends`, `incoming`, `outgoing`, `add`).
- Friend search and action controls.
- DM start action from friend list.

### `SettingsPanel`

File: `web/src/components/settings-panel.tsx`

- Multi-section user preferences UI.
- Theme, layout, timestamp, sound, voice, and notification settings.
- Mic permission request and device selection.
- Logout action.

### `AdminSettingsPanel`

File: `web/src/components/admin-settings-panel.tsx`

- Runtime setting toggles with save action.
- User management table with role changes and guarded delete flow.
- Stats dashboard cards (server/system/node/database).

### `VoiceChannelPanel`

File: `web/src/components/voice-channel-panel.tsx`

- Voice join/leave and mute controls.
- Quality (bitrate) selection.
- Participant list with speaking indicators and local audio status.
- Participant context menu hook for per-user local volume/mute controls.

### `UserSidebar`

File: `web/src/components/user-sidebar.tsx`

- Presence list with click and context-menu actions.
- Supports long-press context action on touch devices.

### `UserProfile`

File: `web/src/components/user-profile.tsx`

- Profile modal for selected user.
- Displays friend relationship state and action button.
- Supports send/accept friend request actions.

### `DropdownSelect`

File: `web/src/components/dropdown-select.tsx`

- Lightweight custom dropdown with outside click and Escape close behavior.

### `MarkdownMessage`

File: `web/src/components/markdown-message.tsx`

- Markdown render via `react-markdown` + `remark-gfm`.
- Converts `@username` patterns to mention tokens.
- External links open in new tab.

## Type Contracts

### `web/src/types/api.ts`

Defines frontend contract types for:

- API errors
- users/roles
- channels
- messages and attachments
- admin stats/settings/users
- friend summaries and friend requests

### `web/src/types/preferences.ts`

Defines:

- `UserPreferences`
- defaults
- font scale and theme enums

## Utility Modules

- `web/src/utils/error-message.ts`
- normalizes unknown errors into display strings.

- `web/src/utils/smooth-scroll.ts`
- cancellable animation-frame based smooth scrolling helper.

## Styling System

- Main UI styles: `web/src/styles/global.css`
- User sidebar styles: `web/src/styles/user-sidebar.css`

Behavior-driven CSS classes are toggled on `document.body` by preferences hook.

## Frontend Change Checklist

When changing frontend behavior:

1. Keep `web/src/types/api.ts` in sync with backend payloads.
2. Update `chatApi` methods if route contract changed.
3. Update `use-chat-socket` parser for new socket events.
4. Verify fallback polling path still covers non-realtime operation.
5. Update docs (`docs/FRONTEND_REFERENCE.md` and `docs/API.md` if contract changed).
