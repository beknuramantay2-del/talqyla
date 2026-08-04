// Учёт трат на AI: одна точка входа для «сколько уже потрачено» и «можно ли тратить».
//
// Что здесь чинится. Суточный бюджет считался по DebateRound.costEstimateUsd,
// то есть учитывал ТОЛЬКО LLM. Вызовы /voice/stt и /voice/tts не попадали в кап
// вообще: у них был лишь rate limit. При TTS_PROVIDER=openai это ~$14 в час с
// одного аккаунта, просто дёрганьем эндпоинта.
//
// Правила модуля:
//   1. Каждый платный вызов пишется в usage_events. Без исключений.
//   2. Лимит проверяется ДО вызова по проектной стоимости, а не после по факту.
//   3. Падение учёта не должно ронять сессию ученика, но обязано быть в логах.

import { prisma } from '@talqyla/db';
import { env } from '@talqyla/config';
import { rateLimited } from './errors.js';
import { EST_ROUND_USD, EST_SESSION_USD } from './pricing.js';

export type SpendKind = 'LLM_DEBATER' | 'LLM_JUDGE' | 'LLM_SUMMARIZER' | 'LLM_CASE' | 'STT' | 'TTS';

/** Минимальный логгер — роуты передают req.log. */
export interface SpendLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error?: (obj: Record<string, unknown>, msg?: string) => void;
}

export function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export interface DailySpend {
  usd: number;
  ttsChars: number;
  sttSeconds: number;
  sessions: number;
  rounds: number;
}

export async function getDailySpend(userId: string): Promise<DailySpend> {
  const since = startOfUtcDay();

  const [total, byKind, sessions, rounds] = await Promise.all([
    prisma.usageEvent.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { costUsd: true } }),
    // Один groupBy вместо двух отдельных агрегатов: аудио-капы читаются
    // на каждом платном вызове, лишние round-trip тут дороже кода.
    prisma.usageEvent.groupBy({
      by: ['kind'],
      where: { userId, createdAt: { gte: since }, kind: { in: ['STT', 'TTS'] } },
      _sum: { units: true },
    }),
    prisma.practiceSession.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.debateRound.count({ where: { userId, createdAt: { gte: since } } }),
  ]);

  const unitsFor = (kind: 'STT' | 'TTS') =>
    Number(byKind.find((row) => row.kind === kind)?._sum.units ?? 0);

  return {
    usd: Number(total._sum.costUsd ?? 0),
    ttsChars: unitsFor('TTS'),
    sttSeconds: unitsFor('STT'),
    sessions,
    rounds,
  };
}

/**
 * Записать факт траты. Никогда не бросает наружу: если строчка учёта не легла,
 * ученик не должен потерять уже оплаченный ответ судьи. Но в логи это попадёт.
 */
export async function recordUsage(
  input: {
    userId: string;
    roundId?: string | null;
    kind: SpendKind;
    provider: string;
    model: string;
    tokensIn?: number;
    tokensOut?: number;
    /** Токены для LLM, секунды для STT, символы для TTS. */
    units?: number;
    costUsd: number;
  },
  log?: SpendLogger,
): Promise<void> {
  try {
    await prisma.usageEvent.create({
      data: {
        userId: input.userId,
        roundId: input.roundId ?? null,
        kind: input.kind as never,
        provider: input.provider,
        model: input.model,
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        units: input.units ?? 0,
        costUsd: input.costUsd,
      },
    });
  } catch (err) {
    (log?.error ?? log?.warn)?.(
      { event: 'usage_record_failed', kind: input.kind, userId: input.userId, err: String(err) },
      'Не удалось записать трату AI',
    );
  }
}

/** Общий страж: сегодняшние траты + проектная стоимость вызова против потолка. */
export async function assertBudget(
  userId: string,
  projectedUsd: number,
  ctx: { event: string; message: string },
  log?: SpendLogger,
): Promise<DailySpend> {
  const spend = await getDailySpend(userId);

  if (spend.usd + projectedUsd > env.DAILY_COST_LIMIT_USD) {
    log?.warn(
      { event: ctx.event, userId, spentUsd: spend.usd, projectedUsd, limit: env.DAILY_COST_LIMIT_USD },
      'Дневной бюджет AI исчерпан',
    );
    throw rateLimited(ctx.message);
  }

  return spend;
}

/** Перед созданием сессии: и штук в сутки, и денег в сутки. */
export async function assertSessionBudget(userId: string, log?: SpendLogger): Promise<void> {
  const spend = await assertBudget(
    userId,
    EST_SESSION_USD,
    { event: 'daily_cost_cap_hit', message: 'Дневной лимит тренировок исчерпан. Возвращайся завтра.' },
    log,
  );

  if (spend.sessions >= env.DAILY_SESSION_LIMIT) {
    log?.warn({ event: 'daily_session_cap_hit', userId, sessions: spend.sessions }, 'Дневной лимит сессий исчерпан');
    throw rateLimited(`Дневной лимит тренировок исчерпан (${env.DAILY_SESSION_LIMIT} в сутки). Возвращайся завтра.`);
  }
}

/** Legacy: раунды v1. */
export async function assertRoundBudget(userId: string, log?: SpendLogger): Promise<void> {
  const spend = await assertBudget(
    userId,
    EST_ROUND_USD,
    { event: 'daily_cost_cap_hit', message: 'Дневной лимит занятий исчерпан. Возвращайся завтра.' },
    log,
  );

  if (spend.rounds >= env.DAILY_ROUND_LIMIT) {
    log?.warn({ event: 'daily_round_cap_hit', userId, rounds: spend.rounds }, 'Дневной лимит раундов исчерпан');
    throw rateLimited(`Дневной лимит раундов исчерпан (${env.DAILY_ROUND_LIMIT} в сутки). Возвращайся завтра.`);
  }
}

/**
 * Перед распознаванием речи. Точную длительность знает только провайдер,
 * поэтому здесь верхняя оценка из размера файла.
 */
export async function assertSttBudget(
  userId: string,
  projectedUsd: number,
  projectedSeconds: number,
  log?: SpendLogger,
): Promise<void> {
  const spend = await assertBudget(
    userId,
    projectedUsd,
    {
      event: 'daily_cost_cap_hit_stt',
      message: 'Дневной лимит распознавания речи исчерпан. Ответь текстом или возвращайся завтра.',
    },
    log,
  );

  if (spend.sttSeconds + projectedSeconds > env.DAILY_STT_SECONDS_LIMIT) {
    log?.warn({ event: 'daily_stt_cap_hit', userId, seconds: spend.sttSeconds }, 'Дневной лимит STT исчерпан');
    throw rateLimited('Сегодня наговорено достаточно. Ответь текстом или возвращайся завтра.');
  }
}

/**
 * Перед озвучкой. Символы известны заранее, поэтому проверка точная.
 * Это единственное место, где мы не даём превратить /voice/tts в бесплатный
 * TTS-API за наш счёт.
 */
export async function assertTtsBudget(
  userId: string,
  projectedUsd: number,
  chars: number,
  log?: SpendLogger,
): Promise<void> {
  const spend = await assertBudget(
    userId,
    projectedUsd,
    { event: 'daily_cost_cap_hit_tts', message: 'Дневной лимит озвучки исчерпан. Реплики останутся текстом.' },
    log,
  );

  if (spend.ttsChars + chars > env.DAILY_TTS_CHARS_LIMIT) {
    log?.warn({ event: 'daily_tts_cap_hit', userId, chars: spend.ttsChars }, 'Дневной лимит TTS исчерпан');
    throw rateLimited('Дневной лимит озвучки исчерпан. Реплики останутся текстом.');
  }
}
