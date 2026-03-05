import { z } from 'zod';

export const serverIdParamsSchema = z.object({
  serverId: z.string().uuid(),
});

export const inviteCodeParamsSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export const inviteIdParamsSchema = z.object({
  serverId: z.string().uuid(),
  inviteId: z.string().uuid(),
});

export const createServerBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional(),
  iconUrl: z.string().trim().url().max(500).optional(),
});

export const createServerInviteBodySchema = z.object({
  maxUses: z.coerce.number().int().min(1).max(1000).optional(),
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
});

export const listAuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const moderateUserBodySchema = z.object({
  targetUserId: z.string().uuid(),
  type: z.enum(['WARN', 'TIMEOUT', 'KICK', 'BAN', 'UNBAN']),
  reason: z.string().trim().max(500).optional(),
  durationHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
});
