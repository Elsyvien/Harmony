import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

async function seed() {
  // Create admin user
  const hashedPassword = await bcryptjs.hash('max123456', 10);

  await prisma.user.upsert({
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

  // Create default channel
  await prisma.channel.upsert({
    where: { name: 'global' },
    update: {},
    create: { name: 'global' },
  });
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
