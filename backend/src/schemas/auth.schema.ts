import { z } from 'zod';

export const registerBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
});

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
});
