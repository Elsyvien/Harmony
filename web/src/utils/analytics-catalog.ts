export type AnalyticsCategory = 'reliability' | 'usage' | 'moderation' | 'operations';
export type TelemetryLevel = 'info' | 'warn' | 'error';
export type AnalyticsContextValue = string | number | boolean | null;

type AnalyticsEventDefinition = {
  category: AnalyticsCategory;
  defaultLevel?: TelemetryLevel;
  allowedContextKeys: readonly string[];
};

export const ANALYTICS_EVENT_DEFINITIONS = {
  'api.request.succeeded': {
    category: 'reliability',
    allowedContextKeys: ['method', 'path', 'statusCode'],
  },
  'api.request.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['method', 'path', 'statusCode', 'code'],
  },
  'auth.login.succeeded': {
    category: 'usage',
    allowedContextKeys: ['method'],
  },
  'auth.login.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['method', 'code'],
  },
  'auth.register.succeeded': {
    category: 'usage',
    allowedContextKeys: ['method'],
  },
  'auth.register.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['method', 'code'],
  },
  'avatar.upload.blocked': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: [],
  },
  'avatar.upload.invalid': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['mimeType'],
  },
  'avatar.upload.rejected': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['sizeBytes'],
  },
  'avatar.upload.succeeded': {
    category: 'usage',
    allowedContextKeys: ['sizeBytes', 'mimeType'],
  },
  'avatar.upload.failed': {
    category: 'reliability',
    defaultLevel: 'error',
    allowedContextKeys: ['sizeBytes', 'mimeType', 'code'],
  },
  'message.send.attempted': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'hasAttachment', 'hasReply'],
  },
  'message.send.acked': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'transport', 'hasAttachment', 'hasReply', 'statusCode'],
  },
  'message.send.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['channelId', 'transport', 'hasAttachment', 'hasReply', 'code', 'statusCode'],
  },
  'message.retry.attempted': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'hasAttachment', 'hasReply'],
  },
  'message.retry.succeeded': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'hasAttachment', 'hasReply'],
  },
  'message.retry.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['channelId', 'hasAttachment', 'hasReply', 'code'],
  },
  'friends.request.sent': {
    category: 'usage',
    allowedContextKeys: ['fromView'],
  },
  'friends.request.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['fromView', 'code'],
  },
  'channel.opened.succeeded': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'channelType', 'isDirect'],
  },
  'settings.updated.succeeded': {
    category: 'usage',
    allowedContextKeys: ['field'],
  },
  'voice.join.attempted': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'muted', 'deafened'],
  },
  'voice.join.succeeded': {
    category: 'usage',
    allowedContextKeys: ['channelId', 'muted', 'deafened'],
  },
  'voice.join.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['channelId', 'muted', 'deafened', 'code'],
  },
  'voice.leave.succeeded': {
    category: 'usage',
    allowedContextKeys: ['channelId'],
  },
  'voice.signal.offer.failed': {
    category: 'reliability',
    defaultLevel: 'error',
    allowedContextKeys: ['channelId', 'targetUserId', 'code'],
  },
  'voice.signal.answer.failed': {
    category: 'reliability',
    defaultLevel: 'error',
    allowedContextKeys: ['channelId', 'targetUserId', 'code'],
  },
  'voice.signal.rate_limited': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['channelId'],
  },
  'stream.constraints.failed': {
    category: 'reliability',
    defaultLevel: 'error',
    allowedContextKeys: ['presetLabel', 'source', 'code'],
  },
  'video.share.failed': {
    category: 'reliability',
    defaultLevel: 'error',
    allowedContextKeys: ['source', 'qualityPreset', 'code'],
  },
  'ws.connect.attempted': {
    category: 'operations',
    allowedContextKeys: ['url'],
  },
  'ws.connect.succeeded': {
    category: 'operations',
    allowedContextKeys: ['url'],
  },
  'ws.connect.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['url', 'reason'],
  },
  'ws.disconnected.warn': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['code', 'reason'],
  },
  'ws.reconnect.attempted': {
    category: 'operations',
    allowedContextKeys: ['attempt'],
  },
  'ws.reconnect.succeeded': {
    category: 'operations',
    allowedContextKeys: ['attempt'],
  },
  'ws.reconnect.failed': {
    category: 'reliability',
    defaultLevel: 'warn',
    allowedContextKeys: ['attempt', 'reason'],
  },
  'moderation.user.suspended': {
    category: 'moderation',
    allowedContextKeys: ['targetUserId', 'suspensionHours'],
  },
  'moderation.user.unsuspended': {
    category: 'moderation',
    allowedContextKeys: ['targetUserId'],
  },
  'moderation.user.deleted': {
    category: 'moderation',
    allowedContextKeys: ['targetUserId'],
  },
  'moderation.users.cleared': {
    category: 'moderation',
    allowedContextKeys: ['deletedCount'],
  },
  'moderation.role.updated': {
    category: 'moderation',
    allowedContextKeys: ['targetUserId', 'role'],
  },
  'client.error.reported': {
    category: 'reliability',
    defaultLevel: 'error',
    allowedContextKeys: ['feature', 'code'],
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENT_DEFINITIONS;

function sanitizeContextValue(value: unknown): AnalyticsContextValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.slice(0, 240);
  }
  return undefined;
}

export function getAnalyticsEventDefinition(name: string): AnalyticsEventDefinition | null {
  return ANALYTICS_EVENT_DEFINITIONS[name as AnalyticsEventName] ?? null;
}

export function sanitizeAnalyticsContext(
  name: string,
  context: Record<string, unknown> | undefined,
) {
  const definition = getAnalyticsEventDefinition(name);
  if (!definition || !context) {
    return undefined;
  }

  const next: Record<string, AnalyticsContextValue> = {};
  for (const key of definition.allowedContextKeys) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      continue;
    }
    const sanitized = sanitizeContextValue(context[key]);
    if (sanitized === undefined) {
      continue;
    }
    next[key] = sanitized;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}
