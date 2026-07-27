// Round service — orchestration only. Prompts live in ../agents/*.
import {
  prisma,
  type RoundStatus,
  type SkillKey,
  type TurnKind,
  type TtsProvider,
  type Stance,
  type ExperienceLevel,
} from '@talqyla/db';
import { env } from '@talqyla/config';
import { getAiProvider } from '../agents/provider.js';
import { runDebater } from '../agents/debater.js';
import { runJudge, normaliseScore, totalScore, type JudgeScoreItem } from '../agents/judge.js';
import { compressHistory } from '../agents/summarizer.js';
import { notFound, conflict, badRequest, rateLimited } from '../lib/errors.js';

export type { JudgeScoreItem };

/** Minimal logger shape — routes pass Fastify's `req.log`. */
export interface ServiceLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  info?: (obj: Record<string, unknown>, msg?: string) => void;
}

// ─── Prompt-injection detection ─────────────────────────────────────
//
// This is a SIGNAL, not a gate. A regex blocklist cannot stop a determined
// attacker (transliteration, paraphrase, spacing all defeat it) but it CAN
// very easily reject a legitimate 9th-grader. "Теперь ты утверждаешь обратное"
// is a normal debate sentence, and the old list threw a 400 on it.
//
// Real isolation comes from two things that are already in place:
//   1. student content is wrapped in <STUDENT_SPEECH> / <STUDENT_ARGUMENT>;
//   2. the system prompt instructs the model to treat those as data only.
//
// So by default we log the hit (INJECTION_ACTION=log) and let the round run.
// Flip to 'block' only if telemetry shows real abuse.
const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  // English
  { name: 'en.ignore_previous', re: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i },
  { name: 'en.forget_instructions', re: /forget\s+(all\s+)?(your\s+)?(instructions|prompts|rules)/i },
  { name: 'en.system_prompt', re: /(reveal|print|show|repeat)\s+(your\s+)?(system\s+prompt|instructions)/i },
  { name: 'en.act_as_system', re: /act\s+as\s+(the\s+)?(system|admin|developer)/i },
  { name: 'en.new_instructions', re: /new\s+(instructions|rules)\s*:/i },
  { name: 'en.override', re: /override\s+(your\s+)?(instructions|prompt|rules)/i },
  { name: 'en.disregard', re: /disregard\s+(all\s+)?(previous|prior)\s+(instructions|rules)/i },
  // Russian — tightened so ordinary debate phrasing does not trip them.
  { name: 'ru.ignore_previous', re: /игнорир(уй|уйте|овать)\s+(все\s+)?(предыдущие|прошлые|прежние)?\s*(указания|инструкции|правила)/i },
  { name: 'ru.forget_instructions', re: /забуд(ь|ьте)\s+(все\s+)?(свои\s+)?(инструкции|указания|правила)/i },
  { name: 'ru.reveal_prompt', re: /(покажи|выведи|повтори|назови)\s+(свой\s+)?системн(ый|ые)\s+(промпт|инструкции)/i },
  { name: 'ru.role_swap', re: /(ты|вы)\s+теперь\s+(не\s+)?(оппонент|судья|система|администратор|ассистент|бот|модель)/i },
  { name: 'ru.new_rules', re: /новые\s+(инструкции|правила|указания)\s*:/i },
  { name: 'ru.cancel_rules', re: /отмени\s+(свои\s+)?(инструкции|правила)/i },
  { name: 'ru.dont_follow', re: /не\s+следуй\s+(своим\s+)?(инструкциям|правилам)/i },
  { name: 'ru.exit_role', re: /выйди\s+из\s+роли/i },
  { name: 'ru.act_as_system', re: /действуй\s+как\s+(система|администратор|разработчик)/i },
];

function detectPromptInjection(input: string): string | null {
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(input)) return p.name;
  }
  return null;
}

/**
 * Record a suspected injection. Never logs the raw text — it belongs to a
 * minor and would end up in log storage forever.
 */
function guardInput(
  input: string,
  ctx: { userId: string; roundId: string; field: string },
  log?: ServiceLogger,
): void {
  const pattern = detectPromptInjection(input);
  if (!pattern) return;

  log?.warn(
    {
      event: 'prompt_injection_suspected',
      pattern,
      action: env.INJECTION_ACTION,
      userId: ctx.userId,
      roundId: ctx.roundId,
      field: ctx.field,
      length: input.length,
    },
    'Подозрение на prompt injection',
  );

  if (env.INJECTION_ACTION === 'block') {
    throw badRequest('Обнаружена попытка манипуляции. Пожалуйста, продолжай дискуссию в рамках учебных дебатов.');
  }
}

const MAX_EXCHANGES = env.MAX_ROUND_EXCHANGES;

function getTtsProvider(): TtsProvider | null {
  if (env.TTS_PROVIDER === 'openai') return 'OPENAI' as TtsProvider;
  if (env.TTS_PROVIDER === 'elevenlabs') return 'ELEVENLABS' as TtsProvider;
  return null;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Hard per-user daily ceilings.
 *
 * Rate limiting alone is not a spend control: it caps requests per minute, not
 * dollars per day. `costEstimateUsd` was already being written to every round
 * and read by nobody — now it actually stops the burn.
 */
async function assertDailyBudget(userId: string, log?: ServiceLogger): Promise<void> {
  const since = startOfUtcDay();

  const [roundsToday, spend] = await Promise.all([
    prisma.debateRound.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.debateRound.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { costEstimateUsd: true },
    }),
  ]);

  if (roundsToday >= env.DAILY_ROUND_LIMIT) {
    log?.warn({ event: 'daily_round_cap_hit', userId, roundsToday }, 'Дневной лимит раундов исчерпан');
    throw rateLimited(
      `Дневной лимит раундов исчерпан (${env.DAILY_ROUND_LIMIT} в сутки). Возвращайся завтра — дебаты никуда не денутся.`,
    );
  }

  const spentUsd = Number(spend?._sum?.costEstimateUsd ?? 0);
  if (spentUsd >= env.DAILY_COST_LIMIT_USD) {
    log?.warn({ event: 'daily_cost_cap_hit', userId, spentUsd }, 'Дневной бюджет AI исчерпан');
    throw rateLimited('Дневной лимит занятий исчерпан. Возвращайся завтра.');
  }
}

/**
 * Which skill this round should hammer.
 * Round-level choice wins; otherwise fall back to the weakest skill the judge
 * found last time (StudentProfile.focusSkill).
 */
async function resolveFocusSkill(userId: string, roundFocus: SkillKey | null): Promise<{
  focusSkill: SkillKey | null;
  level: ExperienceLevel;
}> {
  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  return {
    focusSkill: roundFocus ?? profile?.focusSkill ?? null,
    level: profile?.experienceLevel ?? 'BEGINNER',
  };
}

// ── Public API ─────────────────────────────────────────────────────

export async function createRound(
  userId: string,
  topicId: string,
  stance: Stance,
  focusSkill?: SkillKey | null,
  log?: ServiceLogger,
) {
  await assertDailyBudget(userId, log);

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw notFound('Тема не найдена');

  return prisma.debateRound.create({
    data: {
      userId,
      topicId,
      stance,
      status: 'SETUP',
      focusSkill: focusSkill ?? null,
      transcript: [],
    },
    include: { topic: true },
  });
}

export async function listRounds(
  userId: string,
  opts?: { page?: number; limit?: number; status?: string; sort?: string; order?: string },
) {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { userId };
  if (opts?.status) where.status = opts.status;

  const orderField = opts?.sort ?? 'createdAt';
  const orderDir = opts?.order ?? 'desc';

  const orderBy = { [orderField]: orderDir } as const;

  const [items, total] = await Promise.all([
    prisma.debateRound.findMany({
      where: where as never,
      include: {
        topic: true,
        feedback: { select: { totalScore: true } },
        _count: { select: { turns: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.debateRound.count({ where: where as never }),
  ]);

  return { items, total, page, limit };
}

export async function getRound(userId: string, roundId: string) {
  const round = await prisma.debateRound.findFirst({
    where: { id: roundId, userId },
    include: {
      topic: true,
      turns: { orderBy: { idx: 'asc' } },
      skillScores: true,
      feedback: true,
    },
  });
  if (!round) throw notFound('Раунд не найден');
  return round;
}

export async function submitArgument(
  userId: string,
  roundId: string,
  argument: { claim: string; warrant: string; impact: string },
  log?: ServiceLogger,
) {
  const round = await prisma.debateRound.findFirst({ where: { id: roundId, userId } });
  if (!round) throw notFound('Раунд не найден');
  if (round.status !== 'SETUP') throw conflict('Аргумент уже отправлен');

  guardInput(argument.claim, { userId, roundId, field: 'claim' }, log);
  guardInput(argument.warrant, { userId, roundId, field: 'warrant' }, log);
  guardInput(argument.impact, { userId, roundId, field: 'impact' }, log);

  const updatedRound = await prisma.debateRound.update({
    where: { id: roundId },
    data: { argument, status: 'ARGUMENT_BUILT' },
    include: { topic: true },
  });

  // If stance is CON, opponent speaks first.
  if (updatedRound.stance === 'CON') {
    const { focusSkill, level } = await resolveFocusSkill(userId, updatedRound.focusSkill ?? null);

    const opponentTurn = await runDebater(getAiProvider(), {
      topicTitle: updatedRound.topic?.title ?? '',
      stance: updatedRound.stance,
      level,
      focusSkill,
      exchangeNum: 0,
      maxExchanges: MAX_EXCHANGES,
      argument: updatedRound.argument as { claim?: string; warrant?: string; impact?: string } | null,
      history: [],
    });

    await prisma.$transaction(async (tx) => {
      await tx.debateTurn.create({
        data: {
          roundId,
          idx: 0,
          role: 'OPPONENT',
          kind: opponentTurn.kind as TurnKind,
          contentText: opponentTurn.text,
          question: opponentTurn.question,
          citationRefs: opponentTurn.citationRefs,
          tokensIn: opponentTurn.tokensIn,
          tokensOut: opponentTurn.tokensOut,
          costUsd: opponentTurn.costUsd,
          ttsProvider: getTtsProvider(),
        },
      });

      await tx.debateRound.update({
        where: { id: roundId },
        data: {
          status: 'IN_PROGRESS',
          exchangesDone: 0,
          costEstimateUsd: opponentTurn.costUsd,
        },
      });
    });

    return prisma.debateRound.findUnique({
      where: { id: roundId },
      include: { topic: true, turns: { orderBy: { idx: 'asc' } } },
    });
  }

  return updatedRound;
}

export async function submitTurn(
  userId: string,
  roundId: string,
  studentText: string,
  turnKind: string,
  log?: ServiceLogger,
) {
  const round = await prisma.debateRound.findFirst({
    where: { id: roundId, userId },
    include: { topic: true },
  });
  if (!round) throw notFound('Раунд не найден');

  if (round.status === 'SETUP') throw badRequest('Сначала построй аргумент');
  if (round.status === 'COMPLETED' || round.status === 'ABORTED') {
    throw badRequest('Раунд уже завершён');
  }
  if (round.status === 'AWAITING_JUDGE' || round.status === 'JUDGING') {
    throw badRequest('Раунд ожидает оценки судьи');
  }
  if (round.exchangesDone >= MAX_EXCHANGES) {
    throw badRequest('Достигнуто максимальное количество обменов');
  }

  guardInput(studentText, { userId, roundId, field: 'turn' }, log);

  const existingTurns = await prisma.debateTurn.findMany({
    where: { roundId },
    orderBy: { idx: 'asc' },
  });

  const studentIdx = existingTurns.length;

  await prisma.debateTurn.create({
    data: {
      roundId,
      idx: studentIdx,
      role: 'STUDENT',
      kind: turnKind as TurnKind,
      contentText: studentText,
    },
  });

  const allTurns = [
    ...existingTurns,
    { role: 'STUDENT' as const, kind: turnKind as TurnKind, contentText: studentText, idx: studentIdx },
  ];

  const history = allTurns.map((t) => ({ role: t.role.toLowerCase(), text: t.contentText }));

  const exchangeNum = round.exchangesDone;
  const { focusSkill, level } = await resolveFocusSkill(userId, round.focusSkill ?? null);

  // No-op unless SUMMARIZER_ENABLED — see agents/summarizer.ts for why.
  const compact = await compressHistory(getAiProvider(), history);

  const opponentTurn = await runDebater(getAiProvider(), {
    topicTitle: round.topic?.title ?? '',
    stance: round.stance,
    level,
    focusSkill,
    exchangeNum,
    maxExchanges: MAX_EXCHANGES,
    argument: round.argument as { claim?: string; warrant?: string; impact?: string } | null,
    history: compact.history,
  });

  const opponentIdx = studentIdx + 1;
  const newExchangesDone = exchangeNum + 1;
  const isLastExchange = newExchangesDone >= MAX_EXCHANGES;
  const newStatus: RoundStatus = isLastExchange ? 'AWAITING_JUDGE' : 'IN_PROGRESS';
  const turnCost = opponentTurn.costUsd + compact.costUsd;

  await prisma.debateTurn.create({
    data: {
      roundId,
      idx: opponentIdx,
      role: 'OPPONENT',
      kind: opponentTurn.kind as TurnKind,
      contentText: opponentTurn.text,
      question: opponentTurn.question,
      citationRefs: opponentTurn.citationRefs,
      tokensIn: opponentTurn.tokensIn,
      tokensOut: opponentTurn.tokensOut,
      costUsd: turnCost,
      ttsProvider: getTtsProvider(),
    },
  });

  const previousCost = Number(round.costEstimateUsd ?? 0);

  await prisma.debateRound.update({
    where: { id: roundId },
    data: {
      status: newStatus,
      exchangesDone: newExchangesDone,
      costEstimateUsd: previousCost + turnCost,
    },
  });

  return {
    studentTurn: { idx: studentIdx, role: 'STUDENT', kind: turnKind, text: studentText },
    opponentTurn: {
      idx: opponentIdx,
      role: 'OPPONENT',
      kind: opponentTurn.kind,
      text: opponentTurn.text,
      question: opponentTurn.question,
      citationRefs: opponentTurn.citationRefs,
    },
    status: newStatus,
    exchangesDone: newExchangesDone,
  };
}

export async function judgeRound(userId: string, roundId: string, log?: ServiceLogger) {
  const round = await prisma.debateRound.findFirst({
    where: { id: roundId, userId },
    include: { turns: { orderBy: { idx: 'asc' } }, topic: true },
  });

  if (!round) throw notFound('Раунд не найден');
  if (round.status !== 'AWAITING_JUDGE') {
    throw badRequest('Раунд не готов к оценке. Заверши все обмены.');
  }

  // Claim the round atomically before spending money. Two parallel POSTs to
  // /judge used to buy two full judge calls for one round.
  const claimed = await prisma.debateRound.updateMany({
    where: { id: roundId, userId, status: 'AWAITING_JUDGE' },
    data: { status: 'JUDGING' },
  });
  if (claimed.count === 0) throw conflict('Оценка этого раунда уже выполняется');

  let feedback;
  try {
    feedback = await runJudge(getAiProvider(), {
      topicTitle: round.topic?.title ?? '',
      stance: round.stance,
      focusSkill: round.focusSkill ?? null,
      argument: round.argument as { claim?: string; warrant?: string; impact?: string } | null,
      transcript: round.turns.map((t) => ({ role: t.role, kind: t.kind, text: t.contentText })),
    });
  } catch (err) {
    // Release the claim so the student can retry instead of being stuck.
    await prisma.debateRound.updateMany({
      where: { id: roundId, status: 'JUDGING' },
      data: { status: 'AWAITING_JUDGE' },
    });
    throw err;
  }

  if (!feedback.parsed) {
    log?.warn({ event: 'judge_unparsable', roundId, userId }, 'Судья вернул неразбираемый ответ');
  }

  const total = totalScore(feedback.scores);

  await prisma.$transaction(async (tx) => {
    for (const s of feedback.scores) {
      await tx.skillScore.create({
        data: {
          roundId,
          skill: s.skill as SkillKey,
          score: normaliseScore(s.score),
          comment: s.comment ?? null,
        },
      });
    }

    await tx.roundFeedback.create({
      data: {
        roundId,
        totalScore: total,
        strengths: feedback.strengths,
        weaknesses: feedback.weaknesses,
        advice: feedback.advice,
        summaryText: feedback.summaryText,
      },
    });

    const currentCost = Number(round.costEstimateUsd ?? 0);
    await tx.debateRound.update({
      where: { id: roundId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        costEstimateUsd: currentCost + feedback.costUsd,
      },
    });
  });

  // Point the next round at the weakest skill — this is what feeds
  // FOCUS_BRIEF in the debater prompt.
  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (profile && feedback.scores.length > 0) {
    const weakest = feedback.scores.reduce((min, s) =>
      normaliseScore(s.score) < normaliseScore(min.score) ? s : min,
    );

    await prisma.studentProfile.update({
      where: { userId },
      data: {
        roundsPlayed: { increment: 1 },
        focusSkill: (weakest?.skill ?? null) as SkillKey | null,
      },
    });
  }

  return {
    totalScore: total,
    scores: feedback.scores,
    strengths: feedback.strengths,
    weaknesses: feedback.weaknesses,
    advice: feedback.advice,
    summaryText: feedback.summaryText,
  };
}

export async function abortRound(userId: string, roundId: string) {
  const round = await prisma.debateRound.findFirst({ where: { id: roundId, userId } });
  if (!round) throw notFound('Раунд не найден');
  if (round.status === 'COMPLETED' || round.status === 'ABORTED') {
    throw badRequest('Раунд уже завершён');
  }

  await prisma.debateRound.update({
    where: { id: roundId },
    data: { status: 'ABORTED' },
  });

  return { ok: true };
}
