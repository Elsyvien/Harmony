import { apiRequest } from './client';
import type {
  AdminAnalyticsOverview,
  AdminAnalyticsTimeseries,
  AnalyticsCategory,
  AnalyticsEventEnvelope,
  AnalyticsWindow,
  AdminSettings,
  AdminStats,
  AdminUserSummary,
  Channel,
  FriendRequestSummary,
  FriendSummary,
  Message,
  MessageAttachment,
  ModerationActionSummary,
  ServerAnalytics,
  ServerAuditLog,
  ServerInviteSummary,
  ServerSummary,
  User,
  UserRole,
} from '../types/api';

export interface AuthResponse {
  token: string;
  user: User;
}

export const chatApi = {
  analyticsIngest(events: AnalyticsEventEnvelope[], token?: string) {
    return apiRequest<{ accepted: number; dropped: number }>(
      '/analytics/events',
      {
        method: 'POST',
        body: JSON.stringify({ events }),
      },
      token,
    );
  },

  rtcConfig() {
    return apiRequest<{
      rtc: {
        iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
        iceTransportPolicy?: RTCIceTransportPolicy;
        iceCandidatePoolSize?: number;
      };
      sfu?: {
        enabled?: boolean;
        provider?: 'mediasoup' | 'cloudflare';
        audioOnly?: boolean;
        preferTcp?: boolean;
      };
      voiceDefaults?: {
        noiseSuppression?: boolean;
        echoCancellation?: boolean;
        autoGainControl?: boolean;
      };
    }>('/rtc/config');
  },

  cloudflareSfuCreateSession(token: string, input: Record<string, unknown>) {
    return apiRequest<Record<string, unknown>>(
      '/rtc/cloudflare/sessions/new',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  cloudflareSfuGetSession(token: string, sessionId: string) {
    return apiRequest<Record<string, unknown>>(`/rtc/cloudflare/sessions/${sessionId}`, {}, token);
  },

  cloudflareSfuAddTracks(token: string, sessionId: string, input: Record<string, unknown>) {
    return apiRequest<Record<string, unknown>>(
      `/rtc/cloudflare/sessions/${sessionId}/tracks/new`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  cloudflareSfuRenegotiate(token: string, sessionId: string, input: Record<string, unknown>) {
    return apiRequest<Record<string, unknown>>(
      `/rtc/cloudflare/sessions/${sessionId}/renegotiate`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  cloudflareSfuCloseTracks(token: string, sessionId: string, input: Record<string, unknown>) {
    return apiRequest<Record<string, unknown>>(
      `/rtc/cloudflare/sessions/${sessionId}/tracks/close`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  register(input: { username: string; email: string; password: string }) {
    return apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  login(input: { email: string; password: string }) {
    return apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  logout(token: string) {
    return apiRequest<void>(
      '/auth/logout',
      {
        method: 'POST',
      },
      token,
    );
  },

  me(token: string) {
    return apiRequest<{ user: User }>('/me', {}, token);
  },

  uploadAvatar(token: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<{ user: User }>(
      '/users/me/avatar',
      {
        method: 'POST',
        body: formData,
      },
      token,
    );
  },

  channels(token: string) {
    return apiRequest<{ channels: Channel[] }>('/channels', {}, token);
  },

  createChannel(
    token: string,
    name: string,
    type: 'TEXT' | 'VOICE' = 'TEXT',
    serverId?: string,
  ) {
    return apiRequest<{ channel: Channel }>(
      '/channels',
      {
        method: 'POST',
        body: JSON.stringify({ name, type, ...(serverId ? { serverId } : {}) }),
      },
      token,
    );
  },

  servers(token: string) {
    return apiRequest<{ servers: ServerSummary[] }>('/servers', {}, token);
  },

  createServer(
    token: string,
    input: { name: string; description?: string; iconUrl?: string },
  ) {
    return apiRequest<{ server: ServerSummary }>(
      '/servers',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  server(token: string, serverId: string) {
    return apiRequest<{ server: ServerSummary }>(`/servers/${serverId}`, {}, token);
  },

  serverChannels(token: string, serverId: string) {
    return apiRequest<{ channels: Channel[] }>(`/servers/${serverId}/channels`, {}, token);
  },

  serverAnalytics(token: string, serverId: string) {
    return apiRequest<{ analytics: ServerAnalytics }>(`/servers/${serverId}/analytics`, {}, token);
  },

  serverAuditLogs(token: string, serverId: string, limit = 50) {
    return apiRequest<{ logs: ServerAuditLog[] }>(
      `/servers/${serverId}/audit-logs?limit=${encodeURIComponent(String(limit))}`,
      {},
      token,
    );
  },

  serverInvites(token: string, serverId: string) {
    return apiRequest<{ invites: ServerInviteSummary[] }>(`/servers/${serverId}/invites`, {}, token);
  },

  createServerInvite(
    token: string,
    serverId: string,
    input?: { maxUses?: number; expiresInHours?: number },
  ) {
    return apiRequest<{ invite: ServerInviteSummary }>(
      `/servers/${serverId}/invites`,
      {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      },
      token,
    );
  },

  revokeServerInvite(token: string, serverId: string, inviteId: string) {
    return apiRequest<void>(
      `/servers/${serverId}/invites/${inviteId}`,
      {
        method: 'DELETE',
      },
      token,
    );
  },

  joinServerByInvite(token: string, code: string) {
    return apiRequest<{ server: ServerSummary }>(
      `/servers/invites/${encodeURIComponent(code)}/join`,
      {
        method: 'POST',
      },
      token,
    );
  },

  moderateServerUser(
    token: string,
    serverId: string,
    input: {
      targetUserId: string;
      type: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN';
      reason?: string;
      durationHours?: number;
    },
  ) {
    return apiRequest<{ action: ModerationActionSummary }>(
      `/servers/${serverId}/moderation/actions`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  deleteChannel(token: string, channelId: string) {
    return apiRequest<{ deletedChannelId: string }>(
      `/channels/${channelId}`,
      {
        method: 'DELETE',
      },
      token,
    );
  },

  updateVoiceChannelSettings(
    token: string,
    channelId: string,
    input: { voiceBitrateKbps?: number; streamBitrateKbps?: number },
  ) {
    return apiRequest<{ channel: Channel }>(
      `/channels/${channelId}/voice-settings`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  createDirectChannel(token: string, userId: string) {
    return apiRequest<{ channel: Channel }>(
      `/channels/direct/${userId}`,
      {
        method: 'POST',
      },
      token,
    );
  },

  uploadAttachment(token: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<{ attachment: MessageAttachment }>(
      '/uploads',
      {
        method: 'POST',
        body: formData,
      },
      token,
    );
  },

  adminStats(token: string) {
    return apiRequest<{ stats: AdminStats }>('/admin/stats', {}, token);
  },

  adminSettings(token: string) {
    return apiRequest<{ settings: AdminSettings }>('/admin/settings', {}, token);
  },

  adminAnalyticsOverview(
    token: string,
    input?: { window?: AnalyticsWindow; category?: AnalyticsCategory; name?: string },
  ) {
    const query = new URLSearchParams();
    if (input?.window) {
      query.set('window', input.window);
    }
    if (input?.category) {
      query.set('category', input.category);
    }
    if (input?.name) {
      query.set('name', input.name);
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiRequest<{ overview: AdminAnalyticsOverview }>(`/admin/analytics/overview${suffix}`, {}, token);
  },

  adminAnalyticsTimeseries(
    token: string,
    input?: { window?: AnalyticsWindow; category?: AnalyticsCategory; name?: string },
  ) {
    const query = new URLSearchParams();
    if (input?.window) {
      query.set('window', input.window);
    }
    if (input?.category) {
      query.set('category', input.category);
    }
    if (input?.name) {
      query.set('name', input.name);
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiRequest<{ timeseries: AdminAnalyticsTimeseries }>(
      `/admin/analytics/timeseries${suffix}`,
      {},
      token,
    );
  },

  updateAdminSettings(
    token: string,
    input: Partial<
      Pick<
        AdminSettings,
        | 'allowRegistrations'
        | 'readOnlyMode'
        | 'slowModeSeconds'
        | 'idleTimeoutMinutes'
        | 'voiceNoiseSuppressionDefault'
        | 'voiceEchoCancellationDefault'
        | 'voiceAutoGainControlDefault'
      >
    >,
  ) {
    return apiRequest<{ settings: AdminSettings }>(
      '/admin/settings',
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  adminUsers(token: string) {
    return apiRequest<{ users: AdminUserSummary[] }>('/admin/users', {}, token);
  },

  updateAdminUser(
    token: string,
    userId: string,
    input: Partial<{
      role: UserRole;
      avatarUrl: string | null;
      isSuspended: boolean;
      suspensionHours: number;
    }>,
  ) {
    return apiRequest<{ user: AdminUserSummary }>(
      `/admin/users/${userId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      token,
    );
  },

  deleteAdminUser(token: string, userId: string) {
    return apiRequest<{ deletedUserId: string }>(
      `/admin/users/${userId}`,
      {
        method: 'DELETE',
      },
      token,
    );
  },

  clearAdminUsersExceptSelf(token: string) {
    return apiRequest<{ deletedCount: number }>(
      '/admin/users/clear-others',
      {
        method: 'POST',
      },
      token,
    );
  },

  friends(token: string) {
    return apiRequest<{ friends: FriendSummary[] }>('/friends', {}, token);
  },

  friendRequests(token: string) {
    return apiRequest<{ incoming: FriendRequestSummary[]; outgoing: FriendRequestSummary[] }>(
      '/friends/requests',
      {},
      token,
    );
  },

  sendFriendRequest(token: string, username: string) {
    return apiRequest<{ request: FriendRequestSummary }>(
      '/friends/requests',
      {
        method: 'POST',
        body: JSON.stringify({ username }),
      },
      token,
    );
  },

  acceptFriendRequest(token: string, requestId: string) {
    return apiRequest<{ friendship: FriendSummary }>(
      `/friends/requests/${requestId}/accept`,
      {
        method: 'POST',
      },
      token,
    );
  },

  declineFriendRequest(token: string, requestId: string) {
    return apiRequest<void>(
      `/friends/requests/${requestId}/decline`,
      {
        method: 'POST',
      },
      token,
    );
  },

  cancelFriendRequest(token: string, requestId: string) {
    return apiRequest<void>(
      `/friends/requests/${requestId}/cancel`,
      {
        method: 'POST',
      },
      token,
    );
  },

  removeFriend(token: string, friendshipId: string) {
    return apiRequest<void>(
      `/friends/${friendshipId}`,
      {
        method: 'DELETE',
      },
      token,
    );
  },

  messages(token: string, channelId: string, params?: { before?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.before) {
      query.set('before', params.before);
    }
    if (params?.limit) {
      query.set('limit', String(params.limit));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiRequest<{ messages: Message[] }>(`/channels/${channelId}/messages${suffix}`, {}, token);
  },

  markChannelRead(token: string, channelId: string, upToMessageId?: string) {
    return apiRequest<{
      receipt: {
        channelId: string;
        userId: string;
        upToMessageId: string | null;
        at: string;
      };
    }>(
      `/channels/${channelId}/read`,
      {
        method: 'POST',
        body: JSON.stringify({ ...(upToMessageId ? { upToMessageId } : {}) }),
      },
      token,
    );
  },

  sendMessage(
    token: string,
    channelId: string,
    content: string,
    attachment?: MessageAttachment,
    replyToMessageId?: string,
  ) {
    return apiRequest<{ message: Message }>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content, attachment, replyToMessageId }),
      },
      token,
    );
  },

  updateMessage(
    token: string,
    channelId: string,
    messageId: string,
    content: string,
  ) {
    return apiRequest<{ message: Message }>(
      `/channels/${channelId}/messages/${messageId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      },
      token,
    );
  },

  deleteMessage(token: string, channelId: string, messageId: string) {
    return apiRequest<{ message: Message }>(
      `/channels/${channelId}/messages/${messageId}`,
      {
        method: 'DELETE',
      },
      token,
    );
  },

  toggleMessageReaction(
    token: string,
    channelId: string,
    messageId: string,
    emoji: string,
  ) {
    return apiRequest<{ message: Message; reacted: boolean; emoji: string }>(
      `/channels/${channelId}/messages/${messageId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      },
      token,
    );
  },
};

