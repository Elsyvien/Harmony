import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../utils/app-error.js';
import { prisma } from '../repositories/prisma.js';

export class UserService {
    async updateAvatar(userId: string, file: MultipartFile) {
        if (!file.mimetype.startsWith('image/')) {
            throw new AppError('INVALID_FILE_TYPE', 'Only image files are allowed', 400);
        }

        const fileExtension = path.extname(file.filename);
        const fileName = `${userId}-${randomUUID()}${fileExtension}`;
        const uploadPath = path.join(process.cwd(), 'uploads', 'avatars');
        const filePath = path.join(uploadPath, fileName);

        // Ensure directory exists (app.ts creates 'uploads', but maybe not 'uploads/avatars')
        // For simplicity, let's put it in 'uploads' root or ensure 'avatars' exists.
        // app.ts does: await mkdir(uploadsDir, { recursive: true });
        // Let's just put it in uploads/ for now to match app.ts static serving from root of uploads
        // actually app.ts serves uploadsDir at /uploads/

        const finalFileName = `avatars/${fileName}`; // Subdir structure
        const fullUploadPath = path.join(process.cwd(), 'uploads', 'avatars');

        // We need to ensure the avatars subdirectory exists
        const fs = await import('node:fs/promises');
        await fs.mkdir(fullUploadPath, { recursive: true });

        await pipeline(file.file, fs.createWriteStream(path.join(fullUploadPath, fileName)));

        const avatarUrl = `/uploads/avatars/${fileName}`;

        const user = await prisma.user.update({
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

        return user;
    }
}
