import { z } from 'zod';

export const channelIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const channelMessageParamsSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const listMessagesQuerySchema = z.object({
  before: z
    .string()
    .datetime()
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const messageAttachmentSchema = z.object({
  url: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(120),
  size: z.number().int().min(1).max(8 * 1024 * 1024),
});

export const createMessageBodySchema = z
  .object({
    content: z.string().max(2000).default(''),
    replyToMessageId: z.string().uuid().optional(),
    attachment: messageAttachmentSchema.optional(),
  })
  .refine((payload) => payload.content.trim().length > 0 || Boolean(payload.attachment), {
    message: 'Message content cannot be empty',
    path: ['content'],
  });

export const updateMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const toggleReactionBodySchema = z.object({
  emoji: z.string().trim().min(1).max(32),
});

export const createChannelBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Channel name may only contain letters, numbers, - and _'),
  type: z.enum(['TEXT', 'VOICE']).default('TEXT'),
});

export const updateVoiceSettingsBodySchema = z.object({
  voiceBitrateKbps: z.coerce.number().int().min(16).max(1536),
});

export const directChannelParamsSchema = z.object({
  userId: z.string().uuid(),
});
