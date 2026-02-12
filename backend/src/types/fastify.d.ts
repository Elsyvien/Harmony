import '@fastify/jwt';
import 'fastify';

interface JwtUserPayload {
  userId: string;
  username: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  isAdmin: boolean;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUserPayload;
    user: JwtUserPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    wsGateway: {
      broadcastMessage: (channelId: string, message: unknown) => void;
      broadcastMessageUpdated: (channelId: string, message: unknown) => void;
      broadcastMessageDeleted: (channelId: string, message: unknown) => void;
      broadcastMessageReaction: (
        channelId: string,
        message: unknown,
        meta: { userId: string; emoji: string; reacted: boolean },
      ) => void;
      notifyUsers: (userIds: string[], type: string, payload: unknown) => void;
      broadcastSystem: (type: string, payload: unknown) => void;
    };
  }
}
