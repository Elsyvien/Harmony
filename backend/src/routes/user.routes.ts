import type { FastifyPluginAsync } from 'fastify';
import { UserService } from '../services/user.service.js';

interface UserRoutesOptions {
    userService: UserService;
}

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (fastify, options) => {
    fastify.post('/users/me/avatar', async (request, reply) => {
        // Authenticate
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
            return;
        }

        const data = await request.file();
        if (!data) {
            reply.code(400).send({ code: 'BAD_REQUEST', message: 'No file uploaded' });
            return;
        }

        const user = await options.userService.updateAvatar(request.user.userId, data);
        return { user };
    });
};
