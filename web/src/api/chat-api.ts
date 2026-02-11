import { apiRequest } from './client';
import type { Channel, Message, User } from '../types/api';

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

  sendMessage(token: string, channelId: string, content: string) {
    return apiRequest<{ message: Message }>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      },
      token,
    );
  },
};
