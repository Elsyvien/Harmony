import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

async function seed() {
  // Create admin user
  const hashedPassword = await bcryptjs.hash('max123456', 10);

  const owner = await prisma.user.upsert({
    where: { email: 'max@staneker.com' },
    update: {
      role: 'OWNER',
      isAdmin: true,
      isSuspended: false,
      suspendedUntil: null,
    },
    create: {
      username: 'max',
      email: 'max@staneker.com',
      passwordHash: hashedPassword,
      role: 'OWNER',
      isAdmin: true,
    },
  });

  // Guarantee owner privileges for username "Max" (case-insensitive).
  await prisma.user.updateMany({
    where: { username: 'max' },
    data: {
      role: 'OWNER',
      isAdmin: true,
      isSuspended: false,
      suspendedUntil: null,
    },
  });

  await prisma.user.updateMany({
    where: { username: 'Max' },
    data: {
      role: 'OWNER',
      isAdmin: true,
      isSuspended: false,
      suspendedUntil: null,
    },
  });

  // Ensure global app settings row exists.
  await prisma.appSettings.upsert({
    where: { id: 'global' },
    update: {},
    create: { id: 'global' },
  });

  const defaultServer = await prisma.server.upsert({
    where: { slug: 'harmony-default' },
    update: {
      ownerId: owner.id,
      visibility: 'INVITE_ONLY',
    },
    create: {
      name: 'Harmony',
      slug: 'harmony-default',
      ownerId: owner.id,
      visibility: 'INVITE_ONLY',
    },
  });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      role: true,
    },
  });
  if (users.length > 0) {
    await prisma.serverMember.createMany({
      data: users.map((user) => ({
        serverId: defaultServer.id,
        userId: user.id,
        role: user.role === 'OWNER' || user.role === 'ADMIN' ? user.role : 'MEMBER',
      })),
      skipDuplicates: true,
    });
  }

  // Backfill legacy public/voice channels into the default server.
  await prisma.channel.updateMany({
    where: {
      serverId: null,
      type: {
        in: ['PUBLIC', 'VOICE'],
      },
    },
    data: {
      serverId: defaultServer.id,
    },
  });

  const existingGlobal = await prisma.channel.findFirst({
    where: {
      serverId: defaultServer.id,
      name: 'global',
      type: 'PUBLIC',
    },
    select: { id: true },
  });
  if (!existingGlobal) {
    await prisma.channel.create({
      data: {
        serverId: defaultServer.id,
        name: 'global',
        type: 'PUBLIC',
      },
    });
  }
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed', error);
    await prisma.$disconnect();
    process.exit(1);
  });
