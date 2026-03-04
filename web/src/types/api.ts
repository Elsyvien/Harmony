export interface ApiError {
  code: string;
  message: string;
}

export type UserRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isAdmin: boolean;
  createdAt: string;
  avatarUrl?: string;
}

export interface Channel {
  id: string;
  name: string;
  createdAt: string;
  serverId?: string | null;
  isDirect: boolean;
  isVoice: boolean;
  voiceBitrateKbps: number | null;
  streamBitrateKbps: number | null;
  directUser: {
    id: string;
    username: string;
  } | null;
}

export interface ServerSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  visibility: 'INVITE_ONLY' | 'PUBLIC';
  createdAt: string;
  owner: {
    id: string;
    username: string;
    avatarUrl?: string | null;
  };
  memberRole: UserRole | null;
  memberCount: number;
}

export interface ServerInviteSummary {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  usesCount: number;
  revokedAt: string | null;
  server: {
    id: string;
    slug: string;
    name: string;
  };
  createdBy: {
    id: string;
    username: string;
  };
}

export interface ServerAnalytics {
  memberCount: number;
  channelCount: number;
  messageCount24h: number;
  messageCount7d: number;
  activeMembers24h: number;
  moderationActions30d: number;
  inviteJoins30d: number;
}

export interface ServerAuditLog {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  actor: {
    id: string;
    username: string;
  } | null;
  targetUser: {
    id: string;
    username: string;
  } | null;
}

export interface ModerationActionSummary {
  id: string;
  type: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN';
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  actor: {
    id: string;
    username: string;
  };
  targetUser: {
    id: string;
    username: string;
  };
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  attachment: MessageAttachment | null;
  editedAt: string | null;
  deletedAt: string | null;
  replyToMessageId: string | null;
  replyTo: {
    id: string;
    userId: string;
    content: string;
    createdAt: string;
    deletedAt: string | null;
    user: {
      id: string;
      username: string;
      avatarUrl?: string;
    };
  } | null;
  reactions: Array<{
    emoji: string;
    userIds: string[];
  }>;
  deliveredUserIds: string[];
  readUserIds: string[];
  deliveredUsers?: Array<{
    id: string;
    username: string;
    avatarUrl?: string | null;
  }>;
  readUsers?: Array<{
    id: string;
    username: string;
    avatarUrl?: string | null;
  }>;
  createdAt: string;
  optimistic?: boolean;
  failed?: boolean;
  user: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
}

export interface MessageAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface AdminStats {
  serverTime: string;
  uptimeSec: number;
  node: {
    version: string;
    pid: number;
    memoryMB: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  };
  system: {
    platform: string;
    arch: string;
    cpuCores: number;
    loadAverage: number[];
    memoryMB: {
      total: number;
      used: number;
      free: number;
      usagePercent: number;
    };
  };
  database: {
    users: number;
    channels: number;
    messages: number;
    messagesLastHour: number;
  };
}

export interface AdminSettings {
  allowRegistrations: boolean;
  readOnlyMode: boolean;
  slowModeSeconds: number;
  idleTimeoutMinutes: number;
}

export interface AdminUserSummary {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isAdmin: boolean;
  avatarUrl: string | null;
  isSuspended: boolean;
  suspendedUntil: string | null;
  createdAt: string;
}

export interface FriendSummary {
  id: string;
  user: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  friendsSince: string;
}

export interface FriendRequestSummary {
  id: string;
  status: 'PENDING' | 'ACCEPTED';
  from: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  to: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  requestedById: string;
  createdAt: string;
}


