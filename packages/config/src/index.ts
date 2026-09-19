import { createHash } from 'node:crypto';
import { z } from 'zod';

const envBool = (def: boolean) => z.union([z.boolean(), z.enum(['true','false','1','0','yes','no'])]).default(def).transform((v) => typeof v === 'boolean' ? v : ['true','1','yes'].includes(v));
const DEFAULT_DEV_SECRET = 'change-me-access-secret-min-16-chars';

function runtimeDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...source };
  const railway = Boolean(out.RAILWAY_ENVIRONMENT || out.RAILWAY_PROJECT_ID);
  const domain = out.RAILWAY_PUBLIC_DOMAIN?.trim();
  const publicUrl = domain ? 'https://' + domain : undefined;
  if (railway && !out.NODE_ENV) out.NODE_ENV = 'production';
  out.API_PORT = out.PORT || out.API_PORT || '4000';
  out.DATABASE_URL = out.DATABASE_URL || out.POSTGRES_URL || out.DATABASE_PRIVATE_URL || out.DATABASE_PUBLIC_URL;
  out.REDIS_URL = out.REDIS_URL || out.REDIS_PRIVATE_URL || out.REDIS_PUBLIC_URL || 'redis://localhost:6379';
  out.API_BASE_URL = out.API_BASE_URL || publicUrl || 'http://localhost:4000';
  out.CORS_ORIGIN = !out.CORS_ORIGIN || out.CORS_ORIGIN === '*' ? (publicUrl || out.API_BASE_URL) : out.CORS_ORIGIN;
  out.NEXT_PUBLIC_API_URL = out.NEXT_PUBLIC_API_URL || out.API_BASE_URL.replace(/\/$/, '') + '/api/v1';
  if (!out.JWT_ACCESS_SECRET || out.JWT_ACCESS_SECRET.length < 16) {
    const seed = railway ? [out.RAILWAY_PROJECT_ID, out.RAILWAY_SERVICE_ID, 'talqyla'].join(':') : DEFAULT_DEV_SECRET;
    out.JWT_ACCESS_SECRET = seed === DEFAULT_DEV_SECRET ? seed : createHash('sha256').update(seed).digest('hex');
  }
  if ((!out.STT_PROVIDER || out.STT_PROVIDER === 'stub') && out.GROQ_API_KEY) out.STT_PROVIDER = 'groq';
  return out;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  DATABASE_URL: z.string().url(), REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(16), JWT_ACCESS_TTL: z.string().default('15m'), JWT_REFRESH_TTL: z.string().default('30d'),
  API_PORT: z.coerce.number().default(4000), API_BASE_URL: z.string().url(), CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().default(100), RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  WEB_PORT: z.coerce.number().default(3000), NEXT_PUBLIC_API_URL: z.string().url().optional(),
  SPEECH_PREP_SECONDS: z.coerce.number().int().min(30).max(600).default(180), SPEECH_MAX_SECONDS: z.coerce.number().int().min(60).max(480).default(240),
  SPEECH_MAX_CHARS: z.coerce.number().int().min(500).max(8000).default(4000), BLITZ_MAX_CHARS: z.coerce.number().int().min(100).max(2000).default(700), POI_ENABLED: envBool(true),
  MAX_ROUND_EXCHANGES: z.coerce.number().int().min(1).max(6).default(3), HISTORY_WINDOW_TURNS: z.coerce.number().int().min(1).max(20).default(6), HISTORY_TURN_MAX_CHARS: z.coerce.number().int().min(100).max(5000).default(1200),
  DAILY_ROUND_LIMIT: z.coerce.number().int().default(10), DAILY_SESSION_LIMIT: z.coerce.number().int().default(20), DAILY_COST_LIMIT_USD: z.coerce.number().default(0.25),
  DAILY_STT_SECONDS_LIMIT: z.coerce.number().int().default(900), DAILY_TTS_CHARS_LIMIT: z.coerce.number().int().default(4000),
  OPENROUTER_API_KEY: z.string().default(''), OPENROUTER_BACKUP_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'), LLM_REFERER: z.string().default('http://localhost:3000'), LLM_APP_TITLE: z.string().default('Talqyla'),
  LLM_MODEL_JUDGE: z.string().default('anthropic/claude-haiku-4.5'), LLM_MODEL_CASE: z.string().default('anthropic/claude-haiku-4.5'),
  LLM_MODEL_DEBATER: z.string().default('anthropic/claude-haiku-4.5'), LLM_MODEL_SUMMARIZER: z.string().default('anthropic/claude-haiku-4.5'), SUMMARIZER_ENABLED: envBool(false),
  INJECTION_ACTION: z.enum(['log','block']).default('log'),
  STT_PROVIDER: z.enum(['stub','groq','openai']).default('stub'), GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'), GROQ_API_KEY: z.string().default(''), OPENAI_API_KEY: z.string().default(''),
  TTS_PROVIDER: z.enum(['stub','openai','elevenlabs']).default('stub'), TTS_VOICE: z.string().default('onyx'), ELEVENLABS_API_KEY: z.string().default(''), TTS_MAX_CHARS: z.coerce.number().int().default(420),
  PARENTAL_CONSENT_REQUIRED: envBool(true), CONSENT_VERSION: z.string().default('2026-07-01'), TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().default(180), RETENTION_JOB_ENABLED: envBool(false),
  SENTRY_DSN: z.string().default(''), SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1), STORAGE_DIR: z.string().default('storage'),
  TELEGRAM_BOT_TOKEN: z.string().default(''), TELEGRAM_BOT_USERNAME: z.string().default(''), TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  GOOGLE_API_KEY: z.string().default(''), DEEPGRAM_API_KEY: z.string().default(''), OPENCODE_ZEN_API_KEY: z.string().default(''),
});
export type AppEnv = z.infer<typeof EnvSchema>;
let cached: AppEnv | null = null;
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    if (v.CORS_ORIGIN === '*') ctx.addIssue({ code: z.ZodIssueCode.custom, path:['CORS_ORIGIN'], message:'CORS_ORIGIN=* запрещён в production' });
    if (v.JWT_ACCESS_SECRET === DEFAULT_DEV_SECRET) ctx.addIssue({ code:z.ZodIssueCode.custom, path:['JWT_ACCESS_SECRET'], message:'JWT secret must not use development default' });
    if (v.API_BASE_URL.startsWith('http://')) ctx.addIssue({ code:z.ZodIssueCode.custom, path:['API_BASE_URL'], message:'API_BASE_URL must use https in production' });
    if (v.STT_PROVIDER === 'groq' && !v.GROQ_API_KEY) ctx.addIssue({ code:z.ZodIssueCode.custom, path:['GROQ_API_KEY'], message:'STT_PROVIDER=groq requires GROQ_API_KEY' });
  }).safeParse(runtimeDefaults(source));
  if (!parsed.success) throw new Error('Invalid environment configuration: ' + parsed.error.message);
  cached = parsed.data; return cached;
}
export const env = loadEnv();

export const idSchema = z.string().cuid();
export const emailSchema = z.string().email().max(255).toLowerCase();
export const passwordSchema = z.string().min(8).max(128).regex(/[A-Za-zА-Яа-я]/).regex(/\d/);
export const paginationSchema = z.object({ page:z.coerce.number().int().min(1).default(1), limit:z.coerce.number().int().min(1).max(100).default(20) });
export const gradeSchema = z.number().int().min(7).max(11);
export const scoreSchema = z.number().int().min(0).max(10);
export const SKILL_KEYS = ['STRUCTURE','CASE_ANALYSIS','REFUTATION','QUICK_THINKING','CONTENT'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export const LEGACY_SKILL_KEYS = ['LOGIC','DELIVERY'] as const;
export type LegacySkillKey = (typeof LEGACY_SKILL_KEYS)[number];
export const ALL_SKILL_KEYS = [...SKILL_KEYS,...LEGACY_SKILL_KEYS] as const;
export type AnySkillKey = (typeof ALL_SKILL_KEYS)[number];
export const SKILL_LABELS_RU: Record<AnySkillKey,string> = { STRUCTURE:'Структура речи', CASE_ANALYSIS:'Анализ кейса', REFUTATION:'Опровержение', QUICK_THINKING:'Скорость мышления', CONTENT:'Аргументация', LOGIC:'Логика', DELIVERY:'Подача' };
export const MAX_SESSION_SCORE = SKILL_KEYS.length * 10;
export const SESSION_MODES = ['SPEECH','BLITZ','CASE'] as const;
export type SessionModeKey = (typeof SESSION_MODES)[number];
export const SPEAKER_ROLES = ['PM','LO','DPM','DLO','MG','MO','GW','OW'] as const;
export type SpeakerRoleKey = (typeof SPEAKER_ROLES)[number];
export const ROLE_DUTIES_RU: Record<SpeakerRoleKey,string> = { PM:'определить резолюцию, задать модель и выставить первую линию Government', LO:'оспорить модель, назвать главный clash и выставить линию Opposition', DPM:'восстановить линию Government и ответить на атаки LO', DLO:'усилить Opposition и добить слабое место Government', MG:'дать extension: новый аргумент', MO:'дать extension для Opposition', GW:'взвесить clash в пользу Government без нового материала', OW:'взвесить clash в пользу Opposition без нового материала' };
export const speechSchema = z.string().trim().min(120).max(env.SPEECH_MAX_CHARS);
export const blitzAnswerSchema = z.string().trim().min(20).max(env.BLITZ_MAX_CHARS);
export const claimSchema = z.string().trim().min(8).max(300); export const warrantSchema = z.string().trim().min(20).max(600); export const impactSchema = z.string().trim().min(15).max(400);
export const argumentSchema = z.object({ claim:claimSchema, warrant:warrantSchema, impact:impactSchema });
export type Argument = z.infer<typeof argumentSchema>;
export const parentalConsentSchema = z.object({ parentEmail:emailSchema, consentGiven:z.literal(true) });
export interface ApiErrorBody { error:{ code:string; message:string; details?:unknown } }
export interface Paginated<T> { items:T[]; total:number; page:number; limit:number }
