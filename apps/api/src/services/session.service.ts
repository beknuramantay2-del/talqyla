// Сервис тренировочных сессий (v2).
//
// Единица продукта — ОДНА речь, а не раунд из трёх обменов. Опрос дебатёров:
// нехватка практики 81%, материала 50%, регулярного фидбека 56%, а нехватка
// оппонентов — 6%. Поэтому AI-оппонент понижен до опционального POI, а деньги
// и внимание ушли в судью и кейс-карту.
//
// Стоимость сессии: 1 вызов судьи (+1 короткий POI, если включён). Кейс-карта
// платная только для ПЕРВОГО ученика на теме, дальше отдаётся из БД.

import {
  prisma,
  type SessionMode,
  type SessionStatus,
  type SkillKey,
  type SpeakerRole,
  type Stance,
} from '@talqyla/db';
import { env, MAX_SESSION_SCORE, SKILL_KEYS } from '@talqyla/config';
import { getAiProvider } from '../agents/provider.js';
import { runSpeechJudge, normaliseScore, totalScore, weakestSkill } from '../agents/speech-judge.js';
import { runCaseCard, runPoi, CASE_PROMPT_VERSION, type CaseCardData } from '../agents/casecard.js';
import { assertSessionBudget, recordUsage, type SpendLogger } from '../lib/spend.js';
import { guardInput } from '../lib/injection.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

export interface ServiceLogger extends SpendLogger {
  info?: (obj: Record<string, unknown>, msg?: string) => void;
}

/** Роль по умолчанию: за резолюцию открывает PM, против — LO. */
function defaultRole(stance: Stance): SpeakerRole {
  return (stance === 'PRO' ? 'PM' : 'LO') as SpeakerRole;
}

async function loadSession(userId: string, sessionId: string) {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId },
    include: { topic: true, scores: true },
  });
  if (!session) throw notFound('Сессия не найдена');
  return session;
}

// ── Кейс-карта ─────────────────────────────────────────────────────────

/**
 * Материал по теме одинаков для всех, поэтому карта кешируется на тему.
 * Второй и все последующие ученики получают её бесплатно и мгновенно.
 */
export async function getOrCreateCaseCard(
  userId: string,
  topicId: string,
  log?: ServiceLogger,
): Promise<CaseCardData & { cached: boolean }> {
  const existing = await prisma.caseCard.findUnique({ where: { topicId } });
  if (existing && existing.promptVersion === CASE_PROMPT_VERSION) {
    return {
      stakeholders: existing.stakeholders as string[],
      clashes: existing.clashes as CaseCardData['clashes'],
      govLines: existing.govLines as string[],
      oppLines: existing.oppLines as string[],
      traps: existing.traps as string[],
      cached: true,
    };
  }

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw notFound('Тема не найдена');

  const card = await runCaseCard(getAiProvider(), { title: topic.title, description: topic.description });

  await recordUsage(
    {
      userId,
      kind: 'LLM_CASE',
      provider: 'openrouter',
      model: card.model,
      tokensIn: card.tokensIn,
      tokensOut: card.tokensOut,
      units: card.tokensIn + card.tokensOut,
      costUsd: card.costUsd,
    },
    log,
  );

  // Мусор от модели не кешируем: иначе тема навсегда останется с пустой картой.
  if (card.parsed) {
    const payload = {
      stakeholders: card.stakeholders,
      clashes: card.clashes,
      govLines: card.govLines,
      oppLines: card.oppLines,
      traps: card.traps,
      promptVersion: CASE_PROMPT_VERSION,
    };
    await prisma.caseCard.upsert({ where: { topicId }, update: payload, create: { topicId, ...payload } });
  }

  return {
    stakeholders: card.stakeholders,
    clashes: card.clashes,
    govLines: card.govLines,
    oppLines: card.oppLines,
    traps: card.traps,
    cached: false,
  };
}

// ── Жизненный цикл сессии ──────────────────────────────────────────────

export async function createSession(
  userId: string,
  input: { topicId: string; stance: Stance; mode?: SessionMode; role?: SpeakerRole },
  log?: ServiceLogger,
) {
  // Бюджет проверяется ДО первого платного вызова, а не после последнего.
  await assertSessionBudget(userId, log);

  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) throw notFound('Тема не найдена');

  // Фокус берём из профиля: слабейший навык прошлой сессии задаёт эту.
  const profile = await prisma.studentProfile.findUnique({ where: { userId } });

  return prisma.practiceSession.create({
    data: {
      userId,
      topicId: input.topicId,
      stance: input.stance,
      mode: input.mode ?? ('SPEECH' as SessionMode),
      role: input.role ?? defaultRole(input.stance),
      focusSkill: (profile?.focusSkill ?? null) as SkillKey | null,
      status: 'PREP' as SessionStatus,
    },
    include: { topic: true, scores: true },
  });
}

export async function listSessions(
  userId: string,
  opts?: { page?: number; limit?: number; mode?: SessionMode; status?: SessionStatus },
) {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 20;
  const where = {
    userId,
    ...(opts?.mode ? { mode: opts.mode } : {}),
    ...(opts?.status ? { status: opts.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.practiceSession.findMany({
      where,
      include: { topic: true, scores: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.practiceSession.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function getSession(userId: string, sessionId: string) {
  return loadSession(userId, sessionId);
}

/**
 * POI по ходу речи. Одна короткая реплика вместо полноценного оппонента:
 * ~120 выходных токенов против трёх ходов по 350 в v1.
 */
export async function requestPoi(userId: string, sessionId: string, speechSoFar: string, log?: ServiceLogger) {
  if (!env.POI_ENABLED) throw badRequest('POI отключён в этой конфигурации');

  const session = await loadSession(userId, sessionId);
  if (session.status === 'COMPLETED' || session.status === 'ABORTED') throw badRequest('Сессия завершена');
  if (session.poiText) throw conflict('POI в этой речи уже был');

  guardInput(speechSoFar, { userId, sessionId, field: 'speech' }, log);

  const poi = await runPoi(getAiProvider(), {
    topicTitle: session.topic.title,
    stance: session.stance,
    // В промпт уходит только хвост речи: POI задаётся по последней мысли,
    // а не по всему тексту, и это заметно дешевле.
    speechSoFar: speechSoFar.slice(-1200),
  });

  await recordUsage(
    {
      userId,
      roundId: sessionId,
      kind: 'LLM_DEBATER',
      provider: 'openrouter',
      model: poi.model,
      tokensIn: poi.tokensIn,
      tokensOut: poi.tokensOut,
      units: poi.tokensIn + poi.tokensOut,
      costUsd: poi.costUsd,
    },
    log,
  );

  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { poiText: poi.question, status: 'SPEAKING' as SessionStatus, costUsd: { increment: poi.costUsd } },
  });

  return { question: poi.question };
}

/**
 * Речь сдана — судья считает ballot. Единственный обязательный платный вызов
 * во всей сессии.
 */
export async function submitSpeech(
  userId: string,
  sessionId: string,
  input: { text: string; durationSec?: number; poiAnswer?: string },
  log?: ServiceLogger,
) {
  const session = await loadSession(userId, sessionId);
  if (session.status === 'COMPLETED') throw badRequest('Сессия уже оценена');
  if (session.status === 'ABORTED') throw badRequest('Сессия прервана');

  guardInput(input.text, { userId, sessionId, field: 'speech' }, log);
  if (input.poiAnswer) guardInput(input.poiAnswer, { userId, sessionId, field: 'poiAnswer' }, log);

  // Атомарная заявка на оценку: двойной клик больше не покупает два ballot.
  const claimed = await prisma.practiceSession.updateMany({
    where: { id: sessionId, userId, status: { in: ['PREP', 'SPEAKING'] as SessionStatus[] } },
    data: {
      status: 'SCORING' as SessionStatus,
      speechText: input.text,
      speechSec: input.durationSec ?? null,
      poiAnswer: input.poiAnswer ?? null,
    },
  });
  if (claimed.count === 0) throw conflict('Эта речь уже оценивается');

  let verdict;
  try {
    verdict = await runSpeechJudge(getAiProvider(), {
      topicTitle: session.topic.title,
      stance: session.stance,
      role: session.role as never,
      focusSkill: session.focusSkill as never,
      speechText: input.text,
      speechSec: input.durationSec ?? null,
      poiText: session.poiText,
      poiAnswer: input.poiAnswer ?? null,
    });
  } catch (err) {
    // Возвращаем сессию назад, иначе ученик навсегда застрянет в SCORING.
    await prisma.practiceSession.updateMany({
      where: { id: sessionId, status: 'SCORING' as SessionStatus },
      data: { status: 'SPEAKING' as SessionStatus },
    });
    throw err;
  }

  await recordUsage(
    {
      userId,
      roundId: sessionId,
      kind: 'LLM_JUDGE',
      provider: 'openrouter',
      model: verdict.model,
      tokensIn: verdict.tokensIn,
      tokensOut: verdict.tokensOut,
      units: verdict.tokensIn + verdict.tokensOut,
      costUsd: verdict.costUsd,
    },
    log,
  );

  if (!verdict.parsed) {
    log?.warn({ event: 'judge_unparsable', sessionId, userId }, 'Судья вернул неразбираемый ответ');
  }

  const scores = verdict.scores.map((s) => ({
    skill: s.skill as SkillKey,
    score: normaliseScore(s.score),
    comment: s.comment ?? null,
  }));
  const total = totalScore(verdict.scores);
  const weakest = (weakestSkill(verdict.scores) ?? verdict.drill.skill) as SkillKey;
  const ratingDelta = await computeRatingDelta(userId, session.focusSkill as SkillKey | null, scores);

  await prisma.$transaction(async (tx) => {
    for (const s of scores) {
      await tx.sessionScore.upsert({
        where: { sessionId_skill: { sessionId, skill: s.skill } },
        update: { score: s.score, comment: s.comment },
        create: { sessionId, skill: s.skill, score: s.score, comment: s.comment },
      });
    }

    await tx.practiceSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED' as SessionStatus,
        completedAt: new Date(),
        totalScore: total,
        summaryText: verdict.summaryText,
        strengths: verdict.strengths,
        weaknesses: verdict.weaknesses,
        drillText: verdict.drill.task,
        drillSkill: verdict.drill.skill as SkillKey,
        ratingDelta,
        costUsd: { increment: verdict.costUsd },
      },
    });

    // Слабейший навык становится фокусом следующей сессии. Это и есть
    // «видимый прогресс», ради которого люди возвращаются.
    await tx.studentProfile.updateMany({
      where: { userId },
      data: {
        focusSkill: weakest,
        sessionsPlayed: { increment: 1 },
        ratingPoints: { increment: ratingDelta },
        lastSessionAt: new Date(),
      },
    });
  });

  return {
    sessionId,
    totalScore: total,
    maxScore: MAX_SESSION_SCORE,
    scores,
    strengths: verdict.strengths,
    weaknesses: verdict.weaknesses,
    drill: verdict.drill,
    summaryText: verdict.summaryText,
    nextFocusSkill: weakest,
    ratingDelta,
  };
}

/**
 * Рейтинг растёт за ПРИРОСТ слабого навыка, а не за объём практики.
 * Иначе лигу выигрывает тот, у кого больше свободного времени, а новичок
 * выгорает на первой неделе.
 */
async function computeRatingDelta(
  userId: string,
  focusSkill: SkillKey | null,
  scores: { skill: SkillKey; score: number }[],
): Promise<number> {
  const BASE = 5;
  if (!focusSkill) return BASE;

  const current = scores.find((s) => s.skill === focusSkill);
  if (!current) return BASE;

  const history = await prisma.sessionScore.aggregate({
    where: { skill: focusSkill, session: { userId, status: 'COMPLETED' as SessionStatus } },
    _avg: { score: true },
  });

  const previous = history._avg.score;
  if (previous == null) return BASE;

  // Потолок 15: одна удачная речь не должна перекрывать неделю работы.
  return Math.max(0, Math.min(15, Math.round(BASE + (current.score - previous) * 3)));
}

export async function abortSession(userId: string, sessionId: string) {
  const session = await loadSession(userId, sessionId);
  if (session.status === 'COMPLETED' || session.status === 'ABORTED') throw badRequest('Сессия уже завершена');
  await prisma.practiceSession.update({ where: { id: sessionId }, data: { status: 'ABORTED' as SessionStatus } });
  return { ok: true };
}

/** Навыки рубрики. Фронт рисует ballot по нему, а не по своей копии списка. */
export const RUBRIC_SKILLS = SKILL_KEYS;
