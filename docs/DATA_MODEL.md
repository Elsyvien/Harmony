# Data Model Reference

Source of truth: `backend/prisma/schema.prisma`

## Provider And Runtime Notes

- Prisma datasource currently declares `provider = "postgresql"`.
- Repository also contains `backend/prisma/dev.db` and `.env.example` with `file:./dev.db`, which is a legacy mismatch.
- For accurate local setup under current schema, use a PostgreSQL `DATABASE_URL`.

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

## Models

### User

Purpose: identity, authentication, role, and moderation status.

Fields:

- `id` (UUID, PK)
- `username` (unique)
- `email` (unique)
- `passwordHash`
- `role` (`UserRole`, default `MEMBER`)
- `isAdmin` (boolean, default false)
- `isSuspended` (boolean, default false)
- `suspendedUntil` (nullable datetime)
- `createdAt`

Relations:

- One-to-many with `Message`.
- One-to-many with `MessageReaction`.
- Many-to-many to `Channel` through `ChannelMember`.
- Friendship relations through `Friendship` (`userA`, `userB`, `requestedBy`).

Behavior notes:

- Application treats admin permissions as role-derived (`OWNER|ADMIN`).
- `isAdmin` is still persisted and updated when role changes.

### Channel

Purpose: logical chat space for text, voice, or direct messaging.

Fields:

- `id` (UUID, PK)
- `name` (unique)
- `type` (`ChannelType`, default `PUBLIC`)
- `dmKey` (unique nullable)
- `voiceBitrateKbps` (nullable int)
- `createdAt`

Relations:

- One-to-many with `Message`.
- Many-to-many with `User` via `ChannelMember`.

Behavior notes:

- `PUBLIC` and `VOICE` channels are globally visible.
- `DIRECT` channels use deterministic `dmKey` and member rows for exactly two users.

### ChannelMember

Purpose: membership link for direct channels (and future extensibility).

Fields:

- `id` (UUID, PK)
- `createdAt`
- `channelId` FK -> `Channel.id` (`onDelete: Cascade`)
- `userId` FK -> `User.id` (`onDelete: Cascade`)

Constraints:

- unique composite: `[channelId, userId]`
- index: `[userId]`

### Message

Purpose: chat message payload with optional attachment and reply linkage.

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

- belongs to one `Channel` and one `User`.
- optional self-reference for replies.
- one-to-many with `MessageReaction`.

Indexes:

- `[channelId, createdAt]` for timeline pagination.
- `[replyToMessageId]` for reply resolution.

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

### AppSettings

Purpose: singleton runtime control row.

Fields:

- `id` (string PK, expected value `global`)
- `allowRegistrations` (boolean)
- `readOnlyMode` (boolean)
- `slowModeSeconds` (int)

Behavior notes:

- Row is auto-upserted by `AdminSettingsService` and seed.
- Slow mode per-user timestamps are not persisted in DB.

## Domain Invariants Enforced In Services

1. At least one public channel must remain.
2. `global` channel cannot be deleted.
3. Direct channels cannot be deleted via admin API.
4. Direct channel creation requires accepted friendship.
5. Reply target must exist in same channel and not be deleted.
6. Non-admin posting obeys `readOnlyMode` and `slowModeSeconds`.
7. Suspended users are denied across auth/channel/friend/admin routes and WS auth.

## Typical Data Access Paths

- Auth: `User` by email/username/id.
- Channel list: public+voice channels OR direct memberships.
- Message timeline: channel-scoped, `createdAt` cursor pagination.
- Reactions: per-message row toggling in transaction.
- Friend lists: `Friendship` by status and participant user id.

## Schema Change Checklist

When changing Prisma schema:

1. Update repositories selects/includes and mapping functions.
2. Update service logic that assumes old fields.
3. Update frontend types (`web/src/types/api.ts`) if API payload changes.
4. Update docs (`docs/DATA_MODEL.md`, `docs/BACKEND_REFERENCE.md`).
5. Run tests and smoke flows.
