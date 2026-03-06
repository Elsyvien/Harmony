# Data Model Reference

Source of truth: `backend/prisma/schema.prisma`

## Provider And Runtime Notes

- Prisma datasource currently declares `provider = "postgresql"`.
- Repository still contains `backend/prisma/dev.db` as a legacy artifact.
- `backend/.env.example` uses PostgreSQL DSN format for local setup.

## Enums

### UserRole

- `OWNER`
- `ADMIN`
- `MODERATOR`
- `MEMBER`

### FriendshipStatus

- `PENDING`
- `ACCEPTED`

### ChannelType

- `PUBLIC`
- `VOICE`
- `DIRECT`

### AnalyticsSource

- `WEB_CLIENT`
- `BACKEND_HTTP`
- `BACKEND_WS`
- `BACKEND_VOICE`
- `BACKEND_SYSTEM`

### AnalyticsCategory

- `RELIABILITY`
- `USAGE`
- `MODERATION`
- `OPERATIONS`

### AnalyticsLevel

- `INFO`
- `WARN`
- `ERROR`

### ServerVisibility

- `INVITE_ONLY`
- `PUBLIC`

### ModerationActionType

- `WARN`
- `TIMEOUT`
- `KICK`
- `BAN`
- `UNBAN`

## Models

### User

Purpose: identity, authentication, profile, role, and moderation status.

Fields:

- `id` (UUID, PK)
- `username` (unique)
- `email` (unique)
- `passwordHash`
- `role` (`UserRole`, default `MEMBER`)
- `isAdmin` (boolean, default false)
- `isSuspended` (boolean, default false)
- `suspendedUntil` (nullable datetime)
- `avatarUrl` (nullable)
- `createdAt`

Relations:

- One-to-many with `Message`.
- One-to-many with `MessageReaction`.
- One-to-many with `MessageReceipt`.
- Many-to-many to `Channel` through `ChannelMember`.
- Friendship relations through `Friendship` (`userA`, `userB`, `requestedBy`).
- Owns many `Server` rows through `ownerId`.
- Many-to-many to `Server` through `ServerMember`.
- One-to-many with `ServerInvite` as creator.
- One-to-many with `ModerationAction` as actor and target.
- One-to-many with `AuditLog` as actor and target.

Behavior notes:

- Application treats elevated permissions as role-derived in service logic.
- `isAdmin` is still persisted and updated when role changes.

### Channel

Purpose: logical chat space for server text, server voice, or direct messaging.

Fields:

- `id` (UUID, PK)
- `name`
- `type` (`ChannelType`, default `PUBLIC`)
- `dmKey` (unique nullable)
- `serverId` (nullable FK -> `Server.id`, `onDelete: Cascade`)
- `voiceBitrateKbps` (nullable int)
- `streamBitrateKbps` (nullable int)
- `createdAt`

Relations:

- optional belongs-to `Server`
- one-to-many with `Message`
- many-to-many with `User` via `ChannelMember`

Constraints:

- unique composite: `[serverId, name]`
- index: `[serverId, type]`
- `dmKey` unique for direct channels

Behavior notes:

- `PUBLIC` and `VOICE` channels are server-scoped.
- `DIRECT` channels are serverless, use deterministic `dmKey`, and store exactly two member rows.
- Voice channels persist both audio bitrate and stream bitrate configuration.

### ChannelMember

Purpose: membership link for direct channels and channel-scoped membership overlays.

Fields:

- `id` (UUID, PK)
- `createdAt`
- `channelId` FK -> `Channel.id` (`onDelete: Cascade`)
- `userId` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- unique composite: `[channelId, userId]`
- index: `[userId]`

### Message

Purpose: chat message payload with optional attachment, reply linkage, and receipt aggregation.

Fields:

- `id` (UUID, PK)
- `content`
- `attachmentUrl` (nullable)
- `attachmentName` (nullable)
- `attachmentType` (nullable)
- `attachmentSize` (nullable)
- `editedAt` (nullable)
- `deletedAt` (nullable)
- `replyToMessageId` (nullable FK -> `Message.id`, `onDelete: SetNull`)
- `createdAt`
- `channelId` FK -> `Channel.id` (`onDelete: Cascade`)
- `userId` FK -> `User.id` (`onDelete: Cascade`)

Relations:

- belongs to one `Channel` and one `User`
- optional self-reference for replies
- one-to-many with `MessageReaction`
- one-to-many with `MessageReceipt`

Indexes:

- `[channelId, createdAt]` for timeline pagination
- `[replyToMessageId]` for reply resolution

Behavior notes:

- Deletion is soft: content + attachment fields cleared, `deletedAt` set.
- Editing sets `editedAt`.

### MessageReaction

Purpose: user-level emoji reaction records.

Fields:

- `id` (UUID, PK)
- `emoji`
- `createdAt`
- `messageId` FK -> `Message.id` (`onDelete: Cascade`)
- `userId` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- unique composite: `[messageId, userId, emoji]`
- indexes: `[messageId]`, `[userId]`

Behavior notes:

- Toggle behavior inserts/removes this row.
- API aggregates reactions into `{ emoji, userIds[] }`.

### MessageReceipt

Purpose: per-user delivery and read tracking for messages.

Fields:

- `id` (UUID, PK)
- `deliveredAt` (nullable datetime)
- `readAt` (nullable datetime)
- `createdAt`
- `updatedAt`
- `messageId` FK -> `Message.id` (`onDelete: Cascade`)
- `userId` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- unique composite: `[messageId, userId]`
- indexes: `[userId, readAt]`, `[userId, deliveredAt]`

Behavior notes:

- Message list and channel subscription flows mark delivery up to the latest visible message.
- Explicit read calls mark read up to a message boundary and broadcast receipt updates.

### Friendship

Purpose: symmetric friend relationship and request lifecycle.

Fields:

- `id` (UUID, PK)
- `status` (`FriendshipStatus`, default `PENDING`)
- `acceptedAt` (nullable)
- `createdAt`
- `updatedAt`
- `userAId` FK -> `User.id`
- `userBId` FK -> `User.id`
- `requestedById` FK -> `User.id`

Constraints:

- unique composite: `[userAId, userBId]`

Behavior notes:

- Pair is normalized lexicographically in service logic.
- `requestedById` determines incoming/outgoing semantics.
- Accepted friendship is required for direct channel creation.

### Server

Purpose: top-level collaboration space that owns channels, members, invites, moderation, and audit history.

Fields:

- `id` (UUID, PK)
- `slug` (unique)
- `name`
- `description` (nullable)
- `iconUrl` (nullable)
- `tags` (string array)
- `visibility` (`ServerVisibility`, default `INVITE_ONLY`)
- `createdAt`
- `updatedAt`
- `ownerId` FK -> `User.id` (`onDelete: Cascade`)

Relations:

- belongs to one owner `User`
- one-to-many with `ServerMember`
- one-to-many with `Channel`
- one-to-many with `ServerInvite`
- one-to-many with `ModerationAction`
- one-to-many with `AuditLog`

Behavior notes:

- The app bootstraps a default server (`harmony-default`) and backfills existing users/channels into it.
- New servers are seeded with `general` and `voice` channels.
- `visibility` is persisted, but membership flow is currently centered on invites and existing membership checks.

### ServerMember

Purpose: membership link and server-scoped role assignment.

Fields:

- `id` (UUID, PK)
- `createdAt`
- `updatedAt`
- `role` (`UserRole`, default `MEMBER`)
- `serverId` FK -> `Server.id` (`onDelete: Cascade`)
- `userId` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- unique composite: `[serverId, userId]`
- indexes: `[userId]`, `[serverId, role]`

Behavior notes:

- Moderator-or-higher roles manage server invites, moderation actions, audit review, and channel administration.
- Owners are also server members and remain the source of ownership metadata.

### ServerInvite

Purpose: invite code used to join a server.

Fields:

- `id` (UUID, PK)
- `code` (unique)
- `createdAt`
- `expiresAt` (nullable)
- `maxUses` (nullable)
- `usesCount` (int, default `0`)
- `revokedAt` (nullable)
- `serverId` FK -> `Server.id` (`onDelete: Cascade`)
- `createdById` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- indexes: `[serverId, revokedAt]`, `[expiresAt]`

Behavior notes:

- Join flow validates revoked, expired, and exhausted invites before membership is granted.
- Invite consumption increments `usesCount` only when a new member joins.
- Revocation is soft via `revokedAt`.

### ModerationAction

Purpose: server-scoped moderation timeline for actions against members.

Fields:

- `id` (UUID, PK)
- `type` (`ModerationActionType`)
- `reason` (nullable)
- `createdAt`
- `expiresAt` (nullable)
- `serverId` FK -> `Server.id` (`onDelete: Cascade`)
- `actorId` FK -> `User.id` (`onDelete: Cascade`)
- `targetUserId` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- indexes: `[serverId, createdAt]`, `[targetUserId, createdAt]`

Behavior notes:

- Supports warn, timeout, kick, ban, and unban actions.
- Timeout actions may carry `expiresAt`; other actions are point-in-time records unless domain logic interprets them further.

### AuditLog

Purpose: append-only server audit trail for operational and moderation events.

Fields:

- `id` (UUID, PK)
- `action`
- `metadata` (nullable JSON)
- `createdAt`
- `serverId` FK -> `Server.id` (`onDelete: Cascade`)
- `actorId` nullable FK -> `User.id` (`onDelete: SetNull`)
- `targetUserId` nullable FK -> `User.id` (`onDelete: SetNull`)

Constraints:

- indexes: `[serverId, createdAt]`, `[targetUserId, createdAt]`

Behavior notes:

- Invite creation/revocation, server creation, default-server bootstrap, moderation actions, and invite joins all append audit entries.

### AppSettings

Purpose: singleton runtime control row.

Fields:

- `id` (string PK, expected value `global`)
- `allowRegistrations` (boolean)
- `readOnlyMode` (boolean)
- `slowModeSeconds` (int)
- `idleTimeoutMinutes` (int)
- `voiceNoiseSuppressionDefault` (boolean)
- `voiceEchoCancellationDefault` (boolean)
- `voiceAutoGainControlDefault` (boolean)

Behavior notes:

- Row is auto-upserted by `AdminSettingsService` and seed.
- Slow mode per-user timestamps are not persisted in DB.

### AnalyticsEvent

Purpose: normalized client and server telemetry event storage.

Fields:

- `id` (UUID, PK)
- `receivedAt`
- `occurredAt` (nullable)
- `source` (`AnalyticsSource`)
- `category` (`AnalyticsCategory`)
- `name`
- `level` (`AnalyticsLevel`, default `INFO`)
- `userId` (nullable)
- `sessionId` (nullable)
- `channelId` (nullable)
- `requestId` (nullable)
- `success` (nullable)
- `durationMs` (nullable)
- `statusCode` (nullable)
- `context` (nullable JSON)

Indexes:

- `[receivedAt]`
- `[category, receivedAt]`
- `[name, receivedAt]`
- `[level, receivedAt]`
- `[source, receivedAt]`
- `[userId, receivedAt]`
- `[channelId, receivedAt]`
- `[success, receivedAt]`

Behavior notes:

- Client ingestion is allowlisted and bounded by analytics schema validation.
- Server telemetry is best-effort and should never fail the core request path.

## Domain Invariants Enforced In Services

1. A default server is bootstrapped and legacy users/channels are attached to it.
2. At least one public text channel must remain per server.
3. Direct channels cannot be deleted via the admin channel API.
4. Direct channel creation requires accepted friendship.
5. Server-scoped channel management requires moderator-or-higher server membership.
6. Reply target must exist in same channel and not be deleted.
7. Non-admin posting obeys `readOnlyMode` and `slowModeSeconds`.
8. Invite joins validate revocation, expiry, and max-use limits before membership is granted.
9. Suspended users are denied across auth/channel/friend/admin/server routes and WS auth.

## Typical Data Access Paths

- Auth: `User` by email/username/id.
- Server list: `Server` by `ServerMember.userId`.
- Channel list: server-scoped channels plus direct memberships.
- Message timeline: channel-scoped, `createdAt` cursor pagination with receipt hydration.
- Reactions: per-message row toggling in transaction.
- Friend lists: `Friendship` by status and participant user id.
- Moderation/audit views: `Server`, `ServerMember`, `ModerationAction`, `AuditLog`, and `ServerInvite`.

## Schema Change Checklist

When changing Prisma schema:

1. Update repositories selects/includes and mapping functions.
2. Update service logic that assumes old fields.
3. Update frontend types (`web/src/types/api.ts`) if API payload changes.
4. Update docs (`docs/DATA_MODEL.md`, `docs/BACKEND_REFERENCE.md`).
5. Run tests and smoke flows.
