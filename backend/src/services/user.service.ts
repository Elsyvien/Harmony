import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../utils/app-error.js';
import { prisma } from '../repositories/prisma.js';

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const AVATAR_LOCAL_PREFIX = '/uploads/avatars/';

const AVATAR_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

function resolveLocalAvatarPath(avatarUrl: string | null) {
  if (!avatarUrl || !avatarUrl.startsWith(AVATAR_LOCAL_PREFIX)) {
    return null;
  }
  const fileName = path.basename(avatarUrl);
  return path.join(process.cwd(), 'uploads', 'avatars', fileName);
}

async function deleteFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export class UserService {
  async updateAvatar(userId: string, file: MultipartFile) {
    const fileExtension = AVATAR_EXTENSION_BY_MIME[file.mimetype];
    if (!fileExtension) {
      throw new AppError(
        'INVALID_FILE_TYPE',
        400,
        'Only PNG, JPG, WEBP, GIF or AVIF images are allowed',
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarUrl: true },
    });
    if (!existingUser) {
      throw new AppError('USER_NOT_FOUND', 404, 'User not found');
    }

    const fileName = `${userId}-${randomUUID()}${fileExtension}`;
    const avatarUrl = `${AVATAR_LOCAL_PREFIX}${fileName}`;
    const fullUploadPath = path.join(process.cwd(), 'uploads', 'avatars');
    const fullAvatarPath = path.join(fullUploadPath, fileName);
    await mkdir(fullUploadPath, { recursive: true });

    let totalBytes = 0;
    const sizeGuard = new Transform({
      transform(chunk, encoding, callback) {
        void encoding;
        const chunkSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
        totalBytes += chunkSize;
        if (totalBytes > MAX_AVATAR_SIZE_BYTES) {
          callback(new AppError('AVATAR_TOO_LARGE', 400, 'Avatar must be 5 MB or smaller'));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(file.file, sizeGuard, createWriteStream(fullAvatarPath));
      if (file.file.truncated) {
        throw new AppError('AVATAR_TOO_LARGE', 400, 'Avatar must be 5 MB or smaller');
      }
    } catch (error) {
      await deleteFileIfExists(fullAvatarPath);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('AVATAR_UPLOAD_FAILED', 500, 'Could not upload avatar');
    }

    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
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
    } catch (error) {
      await deleteFileIfExists(fullAvatarPath);
      throw error;
    }

    const previousAvatarPath = resolveLocalAvatarPath(existingUser.avatarUrl);
    if (previousAvatarPath && previousAvatarPath !== fullAvatarPath) {
      try {
        await deleteFileIfExists(previousAvatarPath);
      } catch {
        // Cleanup should not fail the avatar update.
      }
    }

    return updatedUser;
  }
}
