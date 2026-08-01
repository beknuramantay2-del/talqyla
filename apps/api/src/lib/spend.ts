// Учёт трат на AI: одна точка входа для «сколько уже потрачено» и «можно ли тратить».
//
// Что здесь чинится. Суточный бюджет считался по DebateRound.costEstimateUsd, то
// есть учитывал ТОЛЬКО LLM. Вызовы /voice/stt и /voice/tts не попадали в кап
// вообще: у них был лишь rate limit 20 запросов в минуту. При TTS_PROVIDER=openai
// это ~$14 в час с одного аккаунта, просто дёрганьем эндпоинта.
//
// Правила модуля:
//   1. Каждый платный вызов пишется в usage_events. Без исключений.
//   2. Лимит проверяется ДО вызова по проектной стоимости, а не после по факту.
//   3. Падение учёта не должно ронять раунд ученика, но обязано быть в логах.

import { prisma } from '@talqyla/db';
import { env } from '@talqyla/config';
import { rateLimited } from './errors.js';
import { EST_ROUND_USD } from './pricing.js';

export type SpendKind = 'LLM_DEBATER' | 'LLM_JUDGE' | 'LLM_SUMMARIZER' | 'STT' | 'TTS';

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
  /** Суммарные деньги за UTC-сутки: LLM + STT + TTS. */
  usd: number;
  /** Символы, отправленные в озвучку. Отдельный кап: TTS дороже всего остального. */
  ttsChars: number;
  /** Секунды аудио, отправленные в распознавание. */
  sttSeconds: number;
  /** Созданные раунды. */
  rounds: number;
}

export async function getDailySpend(userId: string): Promise<DailySpend> {
  const since = startOfUtcDay();

  const [total, tts, stt, rounds] = await Promise.all([
    prisma.usageEvent.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { costUsd: true },
    }),
    prisma.usageEvent.aggregate({
      where: { userId, kind: 'TTS', createdAt: { gte: since } },
      _sum: { units: true },
    }),
    prisma.usageEvent.aggregate({
      where: { userId, kind: 'STT', createdAt: { gte: since } },
      _sum: { units: true },
    }),
    prisma.debateRound.count({ where: { userId, createdAt: { gte: since } } }),
  ]);

  return {
    usd: Number(total._sum.costUsd ?? 0),
    ttsChars: Number(tts._sum.units ?? 0),
    sttSeconds: Number(stt._sum.units ?? 0),
    rounds,
  };
}

/**
 * Записать факт траты. Никогда не бросает наружу: если строчка учёта не легла,
 * ученик не должен потерять уже оплаченный ход. Но в логи это попадёт.
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

/**
 * Общий страж бюджета: сегодняшние траты + проектная стоимость вызова не должны
 * пробить дневной потолок.
 */
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

/** Перед созданием раунда: и штук в сутки, и денег в сутки. */
export async function assertRoundBudget(userId: string, log?: SpendLogger): Promise<void> {
  const spend = await assertBudget(
    userId,
    EST_ROUND_USD,
    {
      event: 'daily_cost_cap_hit',
      message: 'Дневной лимит занятий исчерпан. Возвращайся завтра.',
    },
    log,
  );

  if (spend.rounds >= env.DAILY_ROUND_LIMIT) {
    log?.warn({ event: 'daily_round_cap_hit', userId, rounds: spend.rounds }, 'Дневной лимит раундов исчерпан');
    throw rateLimited(
      `Дневной лимит раундов исчерпан (${env.DAILY_ROUND_LIMIT} в сутки). Возвращайся завтра, дебаты никуда не денутся.`,
    );
  }
}

/**
 * Перед распознаванием речи. Длительность точно известна только провайдеру,
 * поэтому здесь считаем по верхней оценке из размера файла.
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
 * Перед озвучкой. Символы известны заранее, поэтому проверка точная, а не оценочная.
 * Это единственное место, где мы можем не дать одному аккаунту превратить
 * /voice/tts в бесплатный TTS-API за наш счёт.
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
    {
      event: 'daily_cost_cap_hit_tts',
      message: 'Дневной лимит озвучки исчерпан. Реплики оппонента останутся текстом.',
    },
    log,
  );

  if (spend.ttsChars + chars > env.DAILY_TTS_CHARS_LIMIT) {
    log?.warn({ event: 'daily_tts_cap_hit', userId, chars: spend.ttsChars }, 'Дневной лимит TTS исчерпан');
    throw rateLimited('Дневной лимит озвучки исчерпан. Реплики оппонента останутся текстом.');
  }
}
