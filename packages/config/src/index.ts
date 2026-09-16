import { z } from 'zod';
import { createHash } from 'node:crypto';

const envBool = z
  .string()
  .optional()
  .transform((value) => value === 'true');

const DEFAULT_DEV_SECRET = 'change-me-access-secret-min-16-chars';

function applyRuntimeDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
  const publicDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const publicUrl = publicDomain ? 'https://' + publicDomain : undefined;

  if (onRailway && !env.NODE_ENV) {
    env.NODE_ENV = 'production';
  }

  env.API_PORT = env.PORT || env.API_PORT || '4000';
  env.DATABASE_URL =
    env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_PRIVATE_URL || env.DATABASE_PUBLIC_URL;
  env.REDIS_URL =
    env.REDIS_URL || env.REDIS_PRIVATE_URL || env.REDIS_PUBLIC_URL || 'redis://localhost:6379';

  env.API_BASE_URL = env.API_BASE_URL || publicUrl || 'http://localhost:4000';

  if (!env.CORS_ORIGIN || env.CORS_ORIGIN === '*') {
    env.CORS_ORIGIN = publicUrl || env.API_BASE_URL || 'http://localhost:3000';
  }

  if (!env.NEXT_PUBLIC_API_URL) {
    env.NEXT_PUBLIC_API_URL = env.API_BASE_URL.replace(/\/$/, '') + '/api/v1';
  }

  if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 16) {
    const seed =
      env.RAILWAY_PROJECT_ID && env.RAILWAY_SERVICE_ID
        ? env.RAILWAY_PROJECT_ID + ':' + env.RAILWAY_SERVICE_ID + ':talqyla-jwt'
        : DEFAULT_DEV_SECRET;
    env.JWT_ACCESS_SECRET =
      seed === DEFAULT_DEV_SECRET ? seed : createHash('sha256').update(seed).digest('hex');
  }

  if (env.STT_PROVIDER === 'deepgram') {
    env.STT_PROVIDER = env.GROQ_API_KEY ? 'groq' : 'stub';
  }
  if (!env.STT_PROVIDER || env.STT_PROVIDER === 'stub') {
    if (env.GROQ_API_KEY) env.STT_PROVIDER = 'groq';
  }

  env.GROQ_STT_MODEL = env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
  env.GROQ_MODEL = env.GROQ_MODEL || 'llama-3.1-8b-instant';
  env.OPENROUTER_MODEL = env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';
  env.OPENROUTER_BACKUP_MODEL = env.OPENROUTER_BACKUP_MODEL || 'google/gemma-2-9b-it:free';
  env.GOOGLE_MODEL = env.GOOGLE_MODEL || 'gemini-3.8-flash';
  env.GOOGLE_STT_MODEL = env.GOOGLE_STT_MODEL || 'gemini-3.5-transcribe';
  env.DEEPGRAM_MODEL = env.DEEPGRAM_MODEL || 'nova-3';
  env.TTS_PROVIDER = env.TTS_PROVIDER || 'stub';

  return env;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(16),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000/api/v1'),
  SENTRY_DSN: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BACKUP_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENCODE_ZEN_API_KEY: z.string().optional(),
  OPENCODE_ZEN_BASE_URL: z.string().url().optional(),
  OPENCODE_ZEN_MODEL: z.string().optional(),
  LLM_MODEL_JUDGE: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_CASE: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_DEBATER: z.string().default('anthropic/claude-haiku-4.5'),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.1-8b-instruct:free'),
  OPENROUTER_BACKUP_MODEL: z.string().default('google/gemma-2-9b-it:free'),
  GROQ_MODEL: z.string().default('llama-3.1-8b-instant'),
  GOOGLE_MODEL: z.string().default('gemini-3.8-flash'),
  GOOGLE_STT_MODEL: z.string().default('gemini-3.5-transcribe'),
  STT_PROVIDER: z.enum(['stub', 'groq', 'openai']).default('stub'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default('nova-3'),
  TTS_PROVIDER: z.enum(['stub', 'elevenlabs']).default('stub'),
  ELEVENLABS_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  FEATURE_TELEGRAM_PAYMENTS: envBool.default('false'),
  FEATURE_REFERRALS: envBool.default('false'),
  FEATURE_STREAKS: envBool.default('true'),
});

type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const resolved = applyRuntimeDefaults(source);
  const parsed = EnvSchema.superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'production') return;
    if (data.CORS_ORIGIN === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN=* is not allowed in production',
      });
    }
    if (data.JWT_ACCESS_SECRET === DEFAULT_DEV_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET must be changed before production',
      });
    }
    if (data.API_BASE_URL.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_BASE_URL'],
        message: 'API_BASE_URL must use https in production',
      });
    }
  }).safeParse(resolved);
  if (!parsed.success) {
    throw new Error('Invalid environment: ' + parsed.error.message);
  }
  cached = parsed.data;
  return parsed.data;
}

export const env = loadEnv();

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_COOKIE_NAME = 'talqyla_refresh';
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_MAX_REQUESTS = 120;
export const RATE_LIMIT_AUTH_MAX_REQUESTS = 20;

export const SPEND_SOFT_CAP_USD = 0.5;
export const SPEND_HARD_CAP_USD = 2;

export const SESSION_CREDIT_COSTS = {
  case_prep: 1,
  skill_drill: 1,
  debate: 2,
} as const;

export const CREDIT_PACKS = [
  { id: 'credits_50', credits: 50, stars: 50, usd: 1 },
  { id: 'credits_150', credits: 150, stars: 140, usd: 2.8 },
  { id: 'credits_400', credits: 400, stars: 350, usd: 7 },
] as const;
