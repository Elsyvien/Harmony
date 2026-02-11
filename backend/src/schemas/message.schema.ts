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
