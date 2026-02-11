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
      notifyUsers: (userIds: string[], type: string, payload: unknown) => void;
    };
  }
}
