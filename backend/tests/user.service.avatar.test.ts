import { Readable } from 'node:stream';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MultipartFile } from '@fastify/multipart';
import { UserService } from '../src/services/user.service.js';

const { prismaUserMock } = vi.hoisted(() => ({
  prismaUserMock: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../src/repositories/prisma.js', () => ({
  prisma: {
    user: prismaUserMock,
  },
}));

function createAvatarFile(content: Buffer, mimetype = 'image/png') {
  const stream = Readable.from(content) as Readable & { truncated?: boolean };
  stream.truncated = false;
  return {
    fieldname: 'file',
    filename: 'avatar.png',
    encoding: '7bit',
    mimetype,
    fields: {},
    file: stream,
    toBuffer: async () => content,
  } as unknown as MultipartFile;
}

describe('UserService.updateAvatar', () => {
  const service = new UserService();
  let originalCwd = '';
  let workspaceDir = '';

  beforeEach(async () => {
    originalCwd = process.cwd();
    workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'harmony-avatar-test-'));
    process.chdir(workspaceDir);
    prismaUserMock.findUnique.mockReset();
    prismaUserMock.update.mockReset();
  });

  it('rejects unsupported avatar mime types', async () => {
    const file = createAvatarFile(Buffer.from('demo'), 'text/plain');

    await expect(service.updateAvatar('user-1', file)).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE',
    });
    expect(prismaUserMock.findUnique).not.toHaveBeenCalled();
  });

  it('rejects uploads for unknown users', async () => {
    prismaUserMock.findUnique.mockResolvedValue(null);

    const file = createAvatarFile(Buffer.from('demo'));
    await expect(service.updateAvatar('missing-user', file)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    expect(prismaUserMock.update).not.toHaveBeenCalled();
  });

  it('stores uploaded avatar, persists URL, and removes previous local avatar', async () => {
    const previousAvatarRelative = path.join('uploads', 'avatars', 'old-avatar.png');
    const previousAvatarAbsolute = path.join(workspaceDir, previousAvatarRelative);
    await mkdir(path.dirname(previousAvatarAbsolute), { recursive: true });
    await writeFile(previousAvatarAbsolute, 'old-avatar');

    prismaUserMock.findUnique.mockResolvedValue({
      id: 'user-1',
      avatarUrl: '/uploads/avatars/old-avatar.png',
    });
    prismaUserMock.update.mockImplementation(async (input: { data: { avatarUrl: string } }) => ({
      id: 'user-1',
      username: 'max',
      email: 'max@example.com',
      role: 'OWNER',
      isAdmin: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      avatarUrl: input.data.avatarUrl,
    }));

    const payload = Buffer.from('new-avatar-binary');
    const file = createAvatarFile(payload);
    const updated = await service.updateAvatar('user-1', file);

    expect(updated.avatarUrl).toMatch(/^\/uploads\/avatars\/user-1-.+\.png$/);
    const nextAvatarUrl = updated.avatarUrl as string;
    const nextAvatarPath = path.join(workspaceDir, nextAvatarUrl.replace(/^\//, ''));
    const uploadedBytes = await readFile(nextAvatarPath);
    expect(uploadedBytes.equals(payload)).toBe(true);
    await expect(access(previousAvatarAbsolute)).rejects.toThrow();
  });

  it('cleans up uploaded file when database update fails', async () => {
    prismaUserMock.findUnique.mockResolvedValue({
      id: 'user-1',
      avatarUrl: null,
    });
    prismaUserMock.update.mockRejectedValue(new Error('database unavailable'));

    const file = createAvatarFile(Buffer.from('will-be-removed'));
    await expect(service.updateAvatar('user-1', file)).rejects.toThrow('database unavailable');

    const avatarDir = path.join(workspaceDir, 'uploads', 'avatars');
    const files = await readdir(avatarDir);
    expect(files).toHaveLength(0);
  });

  it('rejects avatars larger than 5MB and does not persist them', async () => {
    prismaUserMock.findUnique.mockResolvedValue({
      id: 'user-1',
      avatarUrl: null,
    });

    const file = createAvatarFile(Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    await expect(service.updateAvatar('user-1', file)).rejects.toMatchObject({
      code: 'AVATAR_TOO_LARGE',
    });
    expect(prismaUserMock.update).not.toHaveBeenCalled();

    const avatarDir = path.join(workspaceDir, 'uploads', 'avatars');
    const files = await readdir(avatarDir);
    expect(files).toHaveLength(0);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(workspaceDir, { recursive: true, force: true });
  });
});
