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
  isDirect: boolean;
  isVoice: boolean;
  voiceBitrateKbps: number | null;
  streamBitrateKbps: number | null;
  directUser: {
    id: string;
    username: string;
  } | null;
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

export type AnalyticsWindow = '24h' | '7d' | '30d';
export type AnalyticsCategory = 'reliability' | 'usage' | 'moderation' | 'operations';
export type AnalyticsLevel = 'info' | 'warn' | 'error';

export interface AnalyticsEventEnvelope {
  name: string;
  category: AnalyticsCategory;
  level: AnalyticsLevel;
  timestamp?: string;
  source?: 'web_client';
  sessionId?: string;
  requestId?: string;
  channelId?: string;
  success?: boolean;
  durationMs?: number;
  statusCode?: number;
  context?: Record<string, string | number | boolean | null>;
}

export interface AdminAnalyticsOverview {
  window: AnalyticsWindow;
  range: {
    start: string;
    end: string;
  };
  totals: {
    events: number;
    errors: number;
    warnings: number;
    uniqueUsers: number;
  };
  reliability: {
    errorRatePercent: number;
    p95LatencyMs: number | null;
    voiceJoinSuccessRatePercent: number | null;
    wsReconnectSuccessRatePercent: number | null;
    topFailures: Array<{ name: string; count: number }>;
  };
  usage: {
    dau: number;
    wau: number;
    signupToFirstMessageRatePercent: number | null;
  };
  moderation: {
    totalActions: number;
    byEvent: Array<{ name: string; count: number }>;
  };
  operations: {
    eventsPerMinute: number;
  };
}

export interface AdminAnalyticsTimeseries {
  window: AnalyticsWindow;
  interval: 'hourly' | '6h' | 'daily';
  range: {
    start: string;
    end: string;
  };
  points: Array<{
    bucketStart: string;
    totalEvents: number;
    errorEvents: number;
    p95LatencyMs: number | null;
    moderationActions: number;
  }>;
  topEvents: Array<{ name: string; count: number }>;
  topFailures: Array<{ name: string; count: number }>;
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


