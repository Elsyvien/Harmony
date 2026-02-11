import { z } from 'zod';

export const friendRequestBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
});

export const friendshipIdParamsSchema = z.object({
  id: z.string().uuid(),
});
