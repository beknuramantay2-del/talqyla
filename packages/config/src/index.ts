// Shared config: validated environment + common Zod schemas and types.
// The whole monorepo imports `@talqyla/config` to read env in one shape.

import { z } from 'zod';

/**
 * Env booleans. `z.coerce.boolean()` is a trap: it turns the STRING "false"
 * into `true`. This helper parses the way humans expect.
 */
const envBool = (def: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
    .default(def)
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1' || v === 'yes'));

const DEFAULT_DEV_SECRET = 'change-me-access-secret-min-16-chars';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── Database ────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // ── Auth (JWT + rotating refresh-token family) ──────────────────────
  // NOTE: refresh tokens are opaque (not JWTs), so there's no REFRESH_SECRET —
  // only the TTL is needed. Access tokens are HS256-signed with ACCESS_SECRET.
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // ── API (Fastify) ───────────────────────────────────────────────────
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  // ── Web (Next.js) ───────────────────────────────────────────────────
  WEB_PORT: z.coerce.number().default(3000),
  NEXT_PUBLIC_API_URL: z.string().url().optional(),

  // ── Round orchestration ─────────────────────────────────────────────
  // Number of "opponent ↔ student" exchanges in the sparring cycle.
  // 3 ≈ 15 min. Keep small to bound token cost.
  MAX_ROUND_EXCHANGES: z.coerce.number().int().min(1).max(6).default(3),

  // ── Spend guardrails (per user, per UTC day) ────────────────────────
  // Hard ceilings so a single account cannot drain the AI balance.
  // Both are checked before a round is created; whichever trips first wins.
  DAILY_ROUND_LIMIT: z.coerce.number().int().min(1).max(200).default(10),
  DAILY_COST_LIMIT_USD: z.coerce.number().min(0.05).max(100).default(1.0),

  // ── LLM via OpenRouter (single key for all models) ──────────────────
  OPENROUTER_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_REFERER: z.string().default('http://localhost:3000'),
  LLM_APP_TITLE: z.string().default('ДебатоТренер'),
  // Haiku 4.5 matches Sonnet-4-class quality at $1/$5 per MTok — it replaces
  // BOTH the old 3.5-haiku debater and the (3x pricier) 3.5-sonnet judge.
  LLM_MODEL_DEBATER: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_JUDGE: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_SUMMARIZER: z.string().default('anthropic/claude-haiku-4.5'),

  // The summarizer costs an extra LLM call to compress ~600 tokens of history.
  // At MAX_ROUND_EXCHANGES <= 4 that is a NET LOSS. Off unless rounds get long.
  SUMMARIZER_ENABLED: envBool(false),

  // ── Prompt-injection handling ───────────────────────────────────────
  // 'log'   — record the signal, let the round continue (default).
  //           Real isolation comes from delimiters + system-prompt rules.
  // 'block' — reject the input with 400. Regex blocklists false-positive on
  //           normal debate phrasing, so blocking hurts students more than
  //           it helps. Only turn this on if you see live abuse.
  INJECTION_ACTION: z.enum(['log', 'block']).default('log'),

  // ── STT (speech → text). stub needs no key. ─────────────────────────
  STT_PROVIDER: z.enum(['stub', 'groq', 'openai']).default('stub'),
  GROQ_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // ── TTS (text → opponent voice). stub needs no key. ─────────────────
  TTS_PROVIDER: z.enum(['stub', 'openai', 'elevenlabs']).default('stub'),
  TTS_VOICE: z.string().default('onyx'),
  ELEVENLABS_API_KEY: z.string().default(''),
  // TTS is ~50% of per-round COGS and the /voice/tts endpoint is user-driven.
  // Without a ceiling it is a free text-to-speech API for the whole internet.
  TTS_MAX_CHARS: z.coerce.number().int().min(50).max(5000).default(800),

  // ── Data protection (users are minors, grades 7–11) ─────────────────
  PARENTAL_CONSENT_REQUIRED: envBool(true),
  CONSENT_VERSION: z.string().default('2026-07-01'),
  // Voice transcripts of children are the most sensitive data we hold.
  // After this window turn content is redacted; scores survive for progress.
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(180),
  // Run the purge on an in-process daily timer (single-instance deploys).
  // For multi-instance, leave off and run `pnpm retention:purge` from cron.
  RETENTION_JOB_ENABLED: envBool(false),

  // ── Error monitoring (Sentry) ─────────────────────────────────────
  SENTRY_DSN: z.string().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ── Storage for voice uploads (dev = local folder) ──────────────────
  STORAGE_DIR: z.string().default('storage'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;

/** Parse and cache `process.env`. Throws (fails fast) on missing/invalid vars. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.superRefine((val, ctx) => {
    if (val.NODE_ENV !== 'production') return;

    // M3: a wildcard CORS origin with credentials: true reflects any origin,
    // which is a credential-bearing cross-origin attack surface. Block it in prod.
    if (val.CORS_ORIGIN.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN=* запрещён в production с credentials: true. Укажи конкретные домены через запятую.',
      });
    }

    // Shipping the committed dev secret to prod means anyone who has read the
    // repo can mint valid access tokens for any user. Fail the boot.
    if (val.JWT_ACCESS_SECRET === DEFAULT_DEV_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET оставлен дефолтным. Сгенерируй свой: openssl rand -hex 32',
      });
    }

    // Cookies are set with `secure: true`, so an http:// API base means the
    // refresh cookie is silently never stored.
    if (val.API_BASE_URL.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_BASE_URL'],
        message: 'В production API_BASE_URL должен быть https:// — refresh-cookie ставится с secure: true.',
      });
    }
  }).safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();

// ── Reusable Zod primitives ──────────────────────────────────────────

export const idSchema = z.string().cuid();
export const emailSchema = z.string().email().max(255).toLowerCase();
export const passwordSchema = z
  .string()
  .min(8, 'Минимум 8 символов')
  .max(128)
  .regex(/[A-Za-zА-Яа-я]/, 'Нужна хотя бы одна буква')
  .regex(/\d/, 'Нужна хотя бы одна цифра');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Domain primitives for ДебатоТренер ──────────────────────────────

// Russian school grade 7–11.
export const gradeSchema = z.number().int().min(7).max(11);

// Single skill score on the 0–10 Judge rubric.
export const scoreSchema = z.number().int().min(0).max(10);

// Five judging categories — drives the dashboard radar + DB enum.
export const SKILL_KEYS = ['STRUCTURE', 'CONTENT', 'REFUTATION', 'LOGIC', 'DELIVERY'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

// Argument builder fields. Min lengths prevent "got nothing" submissions;
// maxes keep transcripts cheap. Russian messages.
export const claimSchema = z
  .string()
  .trim()
  .min(8, 'Сформулируй утверждение (минимум 8 символов)')
  .max(300, 'Слишком длинно — уложись в 300 символов');

export const warrantSchema = z
  .string()
  .trim()
  .min(20, 'Обоснуй утверждение (минимум 20 символов)')
  .max(600, 'Слишком длинно — уложись в 600 символов');

export const impactSchema = z
  .string()
  .trim()
  .min(15, 'Объясни значимость (минимум 15 символов)')
  .max(400, 'Слишком длинно — уложись в 400 символов');

export const argumentSchema = z.object({
  claim: claimSchema,
  warrant: warrantSchema,
  impact: impactSchema,
});
export type Argument = z.infer<typeof argumentSchema>;

// Parental consent captured at registration. Users are minors (7–11 класс),
// so a self-service checkbox is the legal minimum, not a nice-to-have.
export const parentalConsentSchema = z.object({
  parentEmail: emailSchema,
  consentGiven: z.literal(true, {
    errorMap: () => ({ message: 'Нужно согласие родителя или законного представителя' }),
  }),
});

// Human-readable labels for skills (used by web + API serialisation).
export const SKILL_LABELS_RU: Record<SkillKey, string> = {
  STRUCTURE: 'Структура аргумента',
  CONTENT: 'Содержание и доказательства',
  REFUTATION: 'Опровержение',
  LOGIC: 'Логика',
  DELIVERY: 'Подача',
};

// Standard API error shape — every error response uses this body.
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// Standard paginated list envelope.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
