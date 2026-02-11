export interface ApiError {
  code: string;
  message: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: string;
  optimistic?: boolean;
  failed?: boolean;
  user: {
    id: string;
    username: string;
  };
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
}
