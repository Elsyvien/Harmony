import { z } from 'zod';

export const channelIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listMessagesQuerySchema = z.object({
  before: z
    .string()
    .datetime()
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createMessageBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

export const createChannelBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Channel name may only contain letters, numbers, - and _'),
});

export const directChannelParamsSchema = z.object({
  userId: z.string().uuid(),
});
