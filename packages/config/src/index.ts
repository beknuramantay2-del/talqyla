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

  // ── Session orchestration ───────────────────────────────────────────
  //
  // The product is speech-first, not chat-first. A session is ONE speech,
  // optionally interrupted by ONE point of information, then judged.
  // 93.8% of surveyed debaters practise a few times a MONTH, so a 15-minute
  // three-exchange round was too heavy to ever become a habit.
  //
  // Kept for the legacy exchange loop and the blitz drill ceiling.
  MAX_ROUND_EXCHANGES: z.coerce.number().int().min(1).max(6).default(3),
  /** Speech length ceiling in seconds. 4 minutes matches BPF junior timing. */
  SPEECH_MAX_SECONDS: z.coerce.number().int().min(60).max(600).default(240),
  /** Transcribed speech ceiling. ~4 min of Russian speech is ~3500 chars. */
  SPEECH_MAX_CHARS: z.coerce.number().int().min(500).max(8000).default(4000),
  /** One mid-speech point of information. Costs one small LLM call. */
  POI_ENABLED: envBool(true),
  /** Blitz drills per day. Cheap by design: this is the habit driver. */
  DAILY_BLITZ_LIMIT: z.coerce.number().int().min(1).max(200).default(30),

  // ── Spend guardrails (per user, per UTC day) ────────────────────────
  // Checked BEFORE the paid call, against projected cost. STT and TTS are
  // metered too: they used to bypass every budget.
  DAILY_ROUND_LIMIT: z.coerce.number().int().min(1).max(200).default(10),
  DAILY_COST_LIMIT_USD: z.coerce.number().min(0.05).max(100).default(0.25),
  DAILY_TTS_CHARS_LIMIT: z.coerce.number().int().min(0).max(200_000).default(4000),
  DAILY_STT_SECONDS_LIMIT: z.coerce.number().int().min(0).max(50_000).default(900),

  // ── LLM via OpenRouter (single key for all models) ──────────────────
  OPENROUTER_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_REFERER: z.string().default('http://localhost:3000'),
  LLM_APP_TITLE: z.string().default('Talqyla'),
  LLM_MODEL_DEBATER: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_JUDGE: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_SUMMARIZER: z.string().default('anthropic/claude-haiku-4.5'),
  /** Case cards are generated once per topic and cached in the DB forever. */
  LLM_MODEL_CASE: z.string().default('anthropic/claude-haiku-4.5'),

  // Kept for compatibility. The summarizer no longer calls an LLM at all:
  // compressing ~600 tokens cost more than the tokens it saved.
  SUMMARIZER_ENABLED: envBool(false),
  /** How many recent turns reach the prompt. Replaces the summarizer. */
  HISTORY_WINDOW_TURNS: z.coerce.number().int().min(2).max(20).default(4),
  /** Per-turn truncation inside that window. */
  HISTORY_TURN_MAX_CHARS: z.coerce.number().int().min(200).max(4000).default(700),

  // ── Prompt-injection handling ───────────────────────────────────────
  INJECTION_ACTION: z.enum(['log', 'block']).default('log'),

  // ── STT (speech → text). stub needs no key. ─────────────────────────
  STT_PROVIDER: z.enum(['stub', 'groq', 'openai']).default('stub'),
  // turbo is 2.8x cheaper than large-v3 with near-identical Russian WER.
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // ── TTS (text → opponent voice). stub needs no key. ─────────────────
  // TTS is the single most expensive item per session and nobody in the
  // survey asked for a talking opponent. Off unless explicitly enabled.
  TTS_PROVIDER: z.enum(['stub', 'openai', 'elevenlabs']).default('stub'),
  TTS_VOICE: z.string().default('onyx'),
  ELEVENLABS_API_KEY: z.string().default(''),
  TTS_MAX_CHARS: z.coerce.number().int().min(50).max(5000).default(420),

  // ── Data protection (users are minors, grades 7–11) ─────────────────
  PARENTAL_CONSENT_REQUIRED: envBool(true),
  CONSENT_VERSION: z.string().default('2026-07-01'),
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(180),
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

    if (val.CORS_ORIGIN.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN=* запрещён в production с credentials: true. Укажи конкретные домены через запятую.',
      });
    }

    if (val.JWT_ACCESS_SECRET === DEFAULT_DEV_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET оставлен дефолтным. Сгенерируй свой: openssl rand -hex 32',
      });
    }

    if (val.API_BASE_URL.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_BASE_URL'],
        message: 'В production API_BASE_URL должен быть https:// — refresh-cookie ставится с secure: true.',
      });
    }

    // A paid TTS provider with no character ceiling is an open wallet.
    if (val.TTS_PROVIDER !== 'stub' && val.DAILY_TTS_CHARS_LIMIT === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DAILY_TTS_CHARS_LIMIT'],
        message: 'Платный TTS без суточного лимита символов запрещён в production.',
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

// ── Domain primitives ────────────────────────────────────────────────

export const gradeSchema = z.number().int().min(7).max(11);
export const scoreSchema = z.number().int().min(0).max(10);

/**
 * Judging rubric, rewritten from the debater survey.
 *
 * Requested fixes: structure of speech 56.3%, speed of thinking 50%,
 * case analysis 50%, counter-argument 31.3%, argumentation 25%.
 * DELIVERY was requested by nobody yet occupied 20% of the ballot, so it is
 * demoted to a secondary observation instead of a scored category.
 */
export const SKILL_KEYS = ['STRUCTURE', 'CASE_ANALYSIS', 'REFUTATION', 'SPEED', 'ARGUMENTATION'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** Retired categories. Kept so historical rounds still render. */
export const LEGACY_SKILL_KEYS = ['CONTENT', 'LOGIC', 'DELIVERY'] as const;

export const SKILL_LABELS_RU: Record<string, string> = {
  STRUCTURE: 'Структура речи',
  CASE_ANALYSIS: 'Анализ кейса',
  REFUTATION: 'Опровержение',
  SPEED: 'Скорость мышления',
  ARGUMENTATION: 'Аргументация',
  // legacy
  CONTENT: 'Содержание',
  LOGIC: 'Логика',
  DELIVERY: 'Подача',
};

/** Session modes. One engine, three entry points. */
export const ROUND_MODES = ['SPEECH', 'BLITZ', 'CASE'] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

// Argument builder fields (still used to frame a speech before recording).
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

export const parentalConsentSchema = z.object({
  parentEmail: emailSchema,
  consentGiven: z.literal(true, {
    errorMap: () => ({ message: 'Нужно согласие родителя или законного представителя' }),
  }),
});

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
