import { apiRequest } from './client';
import type {
  AdminSettings,
  AdminStats,
  AdminUserSummary,
  Channel,
  FriendRequestSummary,
  FriendSummary,
  Message,
  MessageAttachment,
  User,
  UserRole,
} from '../types/api';

export interface AuthResponse {
  token: string;
  user: User;
}

export const chatApi = {
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

  channels(token: string) {
    return apiRequest<{ channels: Channel[] }>('/channels', {}, token);
  },

  createChannel(token: string, name: string, type: 'TEXT' | 'VOICE' = 'TEXT') {
    return apiRequest<{ channel: Channel }>(
      '/channels',
      {
        method: 'POST',
        body: JSON.stringify({ name, type }),
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

  updateVoiceChannelSettings(token: string, channelId: string, input: { voiceBitrateKbps: number }) {
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

  updateAdminSettings(
    token: string,
    input: Partial<Pick<AdminSettings, 'allowRegistrations' | 'readOnlyMode' | 'slowModeSeconds'>>,
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
    input: Partial<{ role: UserRole }>,
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

  sendMessage(
    token: string,
    channelId: string,
    content: string,
    attachment?: MessageAttachment,
  ) {
    return apiRequest<{ message: Message }>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content, attachment }),
      },
      token,
    );
  },
};
