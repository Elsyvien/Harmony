import { z } from 'zod';

const envBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return value;
}, z.boolean());


const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('15m'),
    CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),
    MESSAGE_MAX_LENGTH: z.coerce.number().int().min(1).max(4000).default(2000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(120),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RTC_STUN_URL: z.string().min(1).default('stun:stun.l.google.com:19302'),
    CLOUDFLARE_TURN_KEY_ID: z.string().default(''),
    CLOUDFLARE_TURN_API_TOKEN: z.string().default(''),
    CLOUDFLARE_TURN_FILTER_PORT_53: envBoolean.default(true),
    TURN_URLS: z.string().default(''),
    TURN_USERNAME: z.string().default(''),
    TURN_CREDENTIAL: z.string().default(''),
    TURN_SHARED_SECRET: z.string().default(''),
    TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    RTC_FORCE_RELAY: envBoolean.default(false),
    RTC_ENABLE_PUBLIC_FALLBACK_TURN: envBoolean.default(true),
    SFU_ENABLED: envBoolean.default(false),
    SFU_AUDIO_ONLY: envBoolean.default(true),
    SFU_ANNOUNCED_IP: z.string().default(''),
    SFU_LISTEN_IP: z.string().default('0.0.0.0'),
    SFU_MIN_PORT: z.coerce.number().int().min(1024).max(65535).default(40000),
    SFU_MAX_PORT: z.coerce.number().int().min(1024).max(65535).default(49999),
    SFU_WEBRTC_TCP: envBoolean.default(true),
    SFU_WEBRTC_UDP: envBoolean.default(true),
    SFU_PREFER_TCP: envBoolean.default(false),
  })
  .refine((value) => value.SFU_MIN_PORT <= value.SFU_MAX_PORT, {
    message: 'SFU_MIN_PORT must be less than or equal to SFU_MAX_PORT',
    path: ['SFU_MIN_PORT'],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
