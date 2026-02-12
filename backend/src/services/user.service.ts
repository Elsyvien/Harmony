import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../utils/app-error.js';
import { prisma } from '../repositories/prisma.js';

export class UserService {
    async updateAvatar(userId: string, file: MultipartFile) {
        if (!file.mimetype.startsWith('image/')) {
            throw new AppError('INVALID_FILE_TYPE', 400, 'Only image files are allowed');
        }

        const fileExtension = path.extname(file.filename) || '.png';
        const fileName = `${userId}-${randomUUID()}${fileExtension}`;
        const fullUploadPath = path.join(process.cwd(), 'uploads', 'avatars');
        await mkdir(fullUploadPath, { recursive: true });

        await pipeline(file.file, createWriteStream(path.join(fullUploadPath, fileName)));

        const avatarUrl = `/uploads/avatars/${fileName}`;

        return prisma.user.update({
            where: { id: userId },
            data: { avatarUrl },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isAdmin: true,
                createdAt: true,
                avatarUrl: true,
            },
        });
    }
}
