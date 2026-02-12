import type { FastifyPluginAsync } from 'fastify';
import { UserService } from '../services/user.service.js';
import { createAuthGuard } from './guards.js';

interface UserRoutesOptions {
    userService: UserService;
}

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (fastify, options) => {
    const authPreHandler = createAuthGuard();

    fastify.post('/users/me/avatar', { preHandler: [authPreHandler] }, async (request, reply) => {
        const data = await request.file();
        if (!data) {
            reply.code(400).send({ code: 'BAD_REQUEST', message: 'No file uploaded' });
            return;
        }

        const user = await options.userService.updateAvatar(request.user.userId, data);
        fastify.wsGateway.updateUserProfile(user.id, {
            username: user.username,
            avatarUrl: user.avatarUrl,
        });
        return { user };
    });
};
