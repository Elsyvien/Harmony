export interface ApiError {
  code: string;
  message: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
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
  user: {
    id: string;
    username: string;
  };
}
