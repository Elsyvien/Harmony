import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

async function seed() {
  // Create admin user
  const hashedPassword = await bcryptjs.hash('max123456', 10);
  
  await prisma.user.upsert({
    where: { email: 'max@staneker.com' },
    update: {},
    create: {
      username: 'max',
      email: 'max@staneker.com',
      passwordHash: hashedPassword,
      isAdmin: true,
    },
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
