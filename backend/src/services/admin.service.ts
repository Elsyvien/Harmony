import os from 'node:os';
import { prisma } from '../repositories/prisma.js';

function toMB(value: number) {
  return Number((value / 1024 / 1024).toFixed(2));
}

export class AdminService {
  async getServerStats() {
    const [users, channels, messages, messagesLastHour] = await Promise.all([
      prisma.user.count(),
      prisma.channel.count(),
      prisma.message.count(),
      prisma.message.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const nodeMemory = process.memoryUsage();

    return {
      serverTime: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      node: {
        version: process.version,
        pid: process.pid,
        memoryMB: {
          rss: toMB(nodeMemory.rss),
          heapUsed: toMB(nodeMemory.heapUsed),
          heapTotal: toMB(nodeMemory.heapTotal),
          external: toMB(nodeMemory.external),
        },
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        cpuCores: os.cpus().length,
        loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
        memoryMB: {
          total: toMB(totalMemory),
          used: toMB(usedMemory),
          free: toMB(freeMemory),
          usagePercent: Number(((usedMemory / totalMemory) * 100).toFixed(2)),
        },
      },
      database: {
        users,
        channels,
        messages,
        messagesLastHour,
      },
    };
  }
}
