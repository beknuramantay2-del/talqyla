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

  // ── Auth ────────────────────────────────────────────────────────────
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

  // ── Session v2 ──────────────────────────────────────────────────────
  // Продукт больше не гоняет три обмена с оппонентом. Единица тренировки —
  // одна речь. Эти рамки задают и UX, и потолок расходов.
  SPEECH_PREP_SECONDS: z.coerce.number().int().min(30).max(600).default(180),
  SPEECH_MAX_SECONDS: z.coerce.number().int().min(60).max(480).default(240),
  SPEECH_MAX_CHARS: z.coerce.number().int().min(500).max(8000).default(4000),
  BLITZ_MAX_CHARS: z.coerce.number().int().min(100).max(2000).default(700),
  // POI — единственное, что осталось от AI-оппонента. Выключается одним флагом.
  POI_ENABLED: envBool(true),

  // Legacy: сколько обменов было в раунде v1. Оставлено ради старых раундов.
  MAX_ROUND_EXCHANGES: z.coerce.number().int().min(1).max(6).default(3),

  // ── Spend guardrails (per user, per UTC day) ────────────────────────
  DAILY_ROUND_LIMIT: z.coerce.number().int().min(1).max(200).default(10),
  DAILY_SESSION_LIMIT: z.coerce.number().int().min(1).max(200).default(20),
  // 0.25, а не 1.0: при цене сессии ~$0.007 старый порог не срабатывал никогда
  // и был чистым украшением.
  DAILY_COST_LIMIT_USD: z.coerce.number().min(0.05).max(100).default(0.25),
  // Аудио тарифицируется отдельно: раньше STT и TTS не попадали в кап вообще.
  DAILY_STT_SECONDS_LIMIT: z.coerce.number().int().min(60).max(36_000).default(900),
  DAILY_TTS_CHARS_LIMIT: z.coerce.number().int().min(200).max(200_000).default(4000),

  // ── LLM via OpenRouter ──────────────────────────────────────────────
  OPENROUTER_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  LLM_REFERER: z.string().default('http://localhost:3000'),
  LLM_APP_TITLE: z.string().default('Talqyla'),
  LLM_MODEL_JUDGE: z.string().default('anthropic/claude-haiku-4.5'),
  // Кейс-карта генерируется один раз на тему и кешируется, поэтому здесь можно
  // позволить модель поумнее без влияния на себестоимость сессии.
  LLM_MODEL_CASE: z.string().default('anthropic/claude-haiku-4.5'),
  // POI — одна короткая реплика. Дешёвая модель, короткий ответ.
  LLM_MODEL_DEBATER: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_SUMMARIZER: z.string().default('anthropic/claude-haiku-4.5'),
  SUMMARIZER_ENABLED: envBool(false),

  // ── Prompt-injection handling ───────────────────────────────────────
  INJECTION_ACTION: z.enum(['log', 'block']).default('log'),

  // ── STT ─────────────────────────────────────────────────────────────
  STT_PROVIDER: z.enum(['stub', 'groq', 'openai']).default('stub'),
  // turbo дешевле large-v3 в 2.8 раза при том же WER на русском.
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // ── TTS ─────────────────────────────────────────────────────────────
  TTS_PROVIDER: z.enum(['stub', 'openai', 'elevenlabs']).default('stub'),
  TTS_VOICE: z.string().default('onyx'),
  ELEVENLABS_API_KEY: z.string().default(''),
  // Озвучка — самая дорогая часть продукта и при этом не то, за чем приходят.
  TTS_MAX_CHARS: z.coerce.number().int().min(50).max(5000).default(420),

  // ── Data protection (users are minors) ──────────────────────────────
  PARENTAL_CONSENT_REQUIRED: envBool(true),
  CONSENT_VERSION: z.string().default('2026-07-01'),
  TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(180),
  RETENTION_JOB_ENABLED: envBool(false),

  // ── Error monitoring ────────────────────────────────────────────────
  SENTRY_DSN: z.string().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

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

    // Голос без ключа тихо возвращает заглушку. В проде это выглядит как
    // «продукт работает», хотя распознавания нет вообще.
    if (val.STT_PROVIDER === 'groq' && !val.GROQ_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GROQ_API_KEY'],
        message: 'STT_PROVIDER=groq требует GROQ_API_KEY.',
      });
    }
    if ((val.STT_PROVIDER === 'openai' || val.TTS_PROVIDER === 'openai') && !val.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'Выбран провайдер openai, но OPENAI_API_KEY не задан.',
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

// ── Domain primitives ───────────────────────────────────────────────

export const gradeSchema = z.number().int().min(7).max(11);
export const scoreSchema = z.number().int().min(0).max(10);

/**
 * Рубрика v2. Порядок = порядок в ballot.
 *
 * Опрос 16 дебатёров: структура речи 56%, скорость мышления 50%, анализ
 * кейса 50%, контраргументация 31%, аргументация 25%. Подачу не назвал никто,
 * поэтому DELIVERY выведена из оценки.
 */
export const SKILL_KEYS = [
  'STRUCTURE',
  'CASE_ANALYSIS',
  'REFUTATION',
  'QUICK_THINKING',
  'CONTENT',
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** Значения, которые остались в БД от v1 и больше не выставляются судьёй. */
export const LEGACY_SKILL_KEYS = ['LOGIC', 'DELIVERY'] as const;
export type LegacySkillKey = (typeof LEGACY_SKILL_KEYS)[number];

export const ALL_SKILL_KEYS = [...SKILL_KEYS, ...LEGACY_SKILL_KEYS] as const;
export type AnySkillKey = (typeof ALL_SKILL_KEYS)[number];

export const SKILL_LABELS_RU: Record<AnySkillKey, string> = {
  STRUCTURE: 'Структура речи',
  CASE_ANALYSIS: 'Анализ кейса',
  REFUTATION: 'Опровержение',
  QUICK_THINKING: 'Скорость мышления',
  CONTENT: 'Аргументация',
  LOGIC: 'Логика',
  DELIVERY: 'Подача',
};

/** Максимум ballot: 5 навыков по 10. */
export const MAX_SESSION_SCORE = SKILL_KEYS.length * 10;

export const SESSION_MODES = ['SPEECH', 'BLITZ', 'CASE'] as const;
export type SessionModeKey = (typeof SESSION_MODES)[number];

export const SPEAKER_ROLES = ['PM', 'LO', 'DPM', 'DLO', 'MG', 'MO', 'GW', 'OW'] as const;
export type SpeakerRoleKey = (typeof SPEAKER_ROLES)[number];

/** Что судья считает выполнением роли. Используется в промпте судьи. */
export const ROLE_DUTIES_RU: Record<SpeakerRoleKey, string> = {
  PM: 'определить резолюцию, задать модель и выставить первую линию Government',
  LO: 'оспорить модель, назвать главный clash и выставить линию Opposition',
  DPM: 'восстановить линию Government и ответить на атаки LO',
  DLO: 'усилить Opposition и добить слабое место Government',
  MG: 'дать extension: новый аргумент, а не пересказ открывающей команды',
  MO: 'дать extension для Opposition и переломить сравнение',
  GW: 'подвести итог, взвесить clash в пользу Government, без нового материала',
  OW: 'подвести итог, взвесить clash в пользу Opposition, без нового материала',
};

// Речь ученика. Нижняя граница отсекает «сказал два слова и жду ballot».
export const speechSchema = z
  .string()
  .trim()
  .min(120, 'Речь слишком короткая: судить нечего')
  .max(env.SPEECH_MAX_CHARS, `Слишком длинно, уложись в ${env.SPEECH_MAX_CHARS} символов`);

export const blitzAnswerSchema = z
  .string()
  .trim()
  .min(20, 'Ответ слишком короткий')
  .max(env.BLITZ_MAX_CHARS, `Уложись в ${env.BLITZ_MAX_CHARS} символов`);

// Legacy Claim/Warrant/Impact — остаётся для старых раундов.
export const claimSchema = z.string().trim().min(8, 'Сформулируй утверждение (минимум 8 символов)').max(300);
export const warrantSchema = z.string().trim().min(20, 'Обоснуй утверждение (минимум 20 символов)').max(600);
export const impactSchema = z.string().trim().min(15, 'Объясни значимость (минимум 15 символов)').max(400);
export const argumentSchema = z.object({ claim: claimSchema, warrant: warrantSchema, impact: impactSchema });
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
