// Тесты жизненного цикла сессии v2.
//
// Что здесь важно проверить, кроме happy path:
//   1. бюджет спрашивают ДО создания сессии, а не после вызова судьи;
//   2. двойная сдача речи не покупает два ballot;
//   3. кешированная кейс-карта не тратит модель;
//   4. рейтинг растёт за ПРИРОСТ слабого навыка, а не за факт тренировки.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@talqyla/db';
import * as sessionService from './session.service.js';
import { runSpeechJudge } from '../agents/speech-judge.js';
import { runCaseCard, runPoi } from '../agents/casecard.js';

vi.mock('@talqyla/db', () => ({
  prisma: {
    topic: { findUnique: vi.fn() },
    caseCard: { findUnique: vi.fn(), upsert: vi.fn() },
    studentProfile: { findUnique: vi.fn(), updateMany: vi.fn() },
    practiceSession: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    sessionScore: { upsert: vi.fn(), aggregate: vi.fn() },
    usageEvent: { create: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    debateRound: { count: vi.fn() },
    $transaction: vi.fn((cb: (tx: Record<string, unknown>) => unknown) =>
      cb({
        sessionScore: { upsert: vi.fn() },
        practiceSession: { update: vi.fn() },
        studentProfile: { updateMany: vi.fn() },
      }),
    ),
  },
}));

vi.mock('@talqyla/config', () => ({
  env: {
    NODE_ENV: 'test',
    POI_ENABLED: true,
    INJECTION_ACTION: 'log',
    DAILY_SESSION_LIMIT: 20,
    DAILY_ROUND_LIMIT: 10,
    DAILY_COST_LIMIT_USD: 0.25,
    DAILY_STT_SECONDS_LIMIT: 900,
    DAILY_TTS_CHARS_LIMIT: 4000,
  },
  SKILL_KEYS: ['STRUCTURE', 'CASE_ANALYSIS', 'REFUTATION', 'QUICK_THINKING', 'CONTENT'],
  MAX_SESSION_SCORE: 50,
}));

vi.mock('../agents/provider.js', () => ({ getAiProvider: () => ({}) }));
vi.mock('../agents/speech-judge.js', async () => {
  const actual = await vi.importActual<typeof import('./judge-helpers-for-test.js')>('../agents/speech-judge.js').catch(() => null);
  return {
    runSpeechJudge: vi.fn(),
    normaliseScore: (raw: number | null | undefined) => Math.max(0, Math.min(10, Math.round(raw ?? 0))),
    totalScore: (scores: { score: number }[]) => scores.reduce((sum, s) => sum + Math.round(s.score), 0),
    weakestSkill: (scores: { skill: string; score: number }[]) =>
      scores.length ? scores.reduce((min, s) => (s.score < min.score ? s : min)).skill : null,
    ...(actual ? {} : {}),
  };
});
vi.mock('../agents/casecard.js', () => ({
  runCaseCard: vi.fn(),
  runPoi: vi.fn(),
  CASE_PROMPT_VERSION: '2026-08',
}));

/** Ничего сегодня не потрачено. */
function allowSpend() {
  vi.mocked(prisma.usageEvent.aggregate).mockResolvedValue({ _sum: { costUsd: 0 } } as never);
  vi.mocked(prisma.usageEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.practiceSession.count).mockResolvedValue(0);
  vi.mocked(prisma.debateRound.count).mockResolvedValue(0);
}

const VERDICT = {
  scores: [
    { skill: 'STRUCTURE', score: 7, comment: '' },
    { skill: 'CASE_ANALYSIS', score: 5, comment: '' },
    { skill: 'REFUTATION', score: 4, comment: '' },
    { skill: 'QUICK_THINKING', score: 6, comment: '' },
    { skill: 'CONTENT', score: 6, comment: '' },
  ],
  strengths: ['«запрет решает причину» — вывод назван прямо'],
  weaknesses: ['«это просто неудобно» — не разобран главный clash'],
  drill: { skill: 'REFUTATION', task: 'За 60 секунд разбей сильнейший аргумент оппонента.' },
  summaryText: 'Структура держится, опровержение проседает.',
  tokensIn: 2400,
  tokensOut: 700,
  costUsd: 0.0069,
  model: 'stub-model',
  parsed: true,
};

const SPEECH = 'а'.repeat(400);

function mockSession(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.practiceSession.findFirst).mockResolvedValue({
    id: 's1',
    userId: 'u1',
    topicId: 't1',
    mode: 'SPEECH',
    status: 'PREP',
    role: 'PM',
    stance: 'PRO',
    focusSkill: 'REFUTATION',
    poiText: null,
    topic: { id: 't1', title: 'Запрет соцсетей до 16', description: '...' },
    scores: [],
    ...overrides,
  } as never);
}

describe('session.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowSpend();
  });

  describe('createSession', () => {
    it('создаёт сессию в статусе PREP и берёт фокус из профиля', async () => {
      vi.mocked(prisma.topic.findUnique).mockResolvedValue({ id: 't1', title: 'T' } as never);
      vi.mocked(prisma.studentProfile.findUnique).mockResolvedValue({ focusSkill: 'STRUCTURE' } as never);
      vi.mocked(prisma.practiceSession.create).mockResolvedValue({ id: 's1', status: 'PREP' } as never);

      await sessionService.createSession('u1', { topicId: 't1', stance: 'PRO' } as never);

      expect(prisma.practiceSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PREP', role: 'PM', focusSkill: 'STRUCTURE' }),
        }),
      );
    });

    it('за Opposition роль по умолчанию LO', async () => {
      vi.mocked(prisma.topic.findUnique).mockResolvedValue({ id: 't1' } as never);
      vi.mocked(prisma.studentProfile.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.practiceSession.create).mockResolvedValue({ id: 's1' } as never);

      await sessionService.createSession('u1', { topicId: 't1', stance: 'CON' } as never);

      expect(prisma.practiceSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'LO' }) }),
      );
    });

    // Регрессия v1: лимит проверялся ПОСЛЕ траты, поэтому последний вызов
    // всегда уходил за потолок.
    it('не создаёт сессию, если суточный бюджет исчерпан', async () => {
      vi.mocked(prisma.usageEvent.aggregate).mockResolvedValue({ _sum: { costUsd: 0.25 } } as never);

      await expect(sessionService.createSession('u1', { topicId: 't1', stance: 'PRO' } as never)).rejects.toThrow();
      expect(prisma.practiceSession.create).not.toHaveBeenCalled();
    });

    it('не создаёт сессию сверх суточного лимита штук', async () => {
      vi.mocked(prisma.practiceSession.count).mockResolvedValue(20);
      vi.mocked(prisma.topic.findUnique).mockResolvedValue({ id: 't1' } as never);

      await expect(sessionService.createSession('u1', { topicId: 't1', stance: 'PRO' } as never)).rejects.toThrow(
        /Дневной лимит тренировок/,
      );
      expect(prisma.practiceSession.create).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateCaseCard', () => {
    it('отдаёт кеш темы, не вызывая модель', async () => {
      vi.mocked(prisma.caseCard.findUnique).mockResolvedValue({
        topicId: 't1',
        promptVersion: '2026-08',
        stakeholders: ['Подростки'],
        clashes: [{ title: 'c', gov: 'g', opp: 'o' }],
        govLines: ['g1'],
        oppLines: ['o1'],
        traps: ['t1'],
      } as never);

      const card = await sessionService.getOrCreateCaseCard('u1', 't1');

      expect(card.cached).toBe(true);
      expect(runCaseCard).not.toHaveBeenCalled();
    });

    it('перегенерирует карту, если версия промпта устарела', async () => {
      vi.mocked(prisma.caseCard.findUnique).mockResolvedValue({ promptVersion: '2026-01' } as never);
      vi.mocked(prisma.topic.findUnique).mockResolvedValue({ id: 't1', title: 'T', description: 'D' } as never);
      vi.mocked(runCaseCard).mockResolvedValue({
        stakeholders: ['a', 'b'],
        clashes: [],
        govLines: [],
        oppLines: [],
        traps: [],
        tokensIn: 300,
        tokensOut: 400,
        costUsd: 0.002,
        model: 'stub-model',
        parsed: true,
      } as never);

      const card = await sessionService.getOrCreateCaseCard('u1', 't1');

      expect(card.cached).toBe(false);
      expect(prisma.caseCard.upsert).toHaveBeenCalled();
    });

    // Мусор от модели не должен навсегда осесть в кеше темы.
    it('не кеширует неразобранный ответ модели', async () => {
      vi.mocked(prisma.caseCard.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.topic.findUnique).mockResolvedValue({ id: 't1', title: 'T', description: 'D' } as never);
      vi.mocked(runCaseCard).mockResolvedValue({
        stakeholders: [],
        clashes: [],
        govLines: [],
        oppLines: [],
        traps: [],
        tokensIn: 300,
        tokensOut: 10,
        costUsd: 0.001,
        model: 'stub-model',
        parsed: false,
      } as never);

      await sessionService.getOrCreateCaseCard('u1', 't1');

      expect(prisma.caseCard.upsert).not.toHaveBeenCalled();
    });
  });

  describe('submitSpeech', () => {
    it('оценивает речь и возвращает ровно один дрилл', async () => {
      mockSession();
      vi.mocked(prisma.practiceSession.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.sessionScore.aggregate).mockResolvedValue({ _avg: { score: null } } as never);
      vi.mocked(runSpeechJudge).mockResolvedValue(VERDICT as never);

      const ballot = await sessionService.submitSpeech('u1', 's1', { text: SPEECH, durationSec: 200 });

      expect(ballot.totalScore).toBe(28);
      expect(ballot.drill.skill).toBe('REFUTATION');
      expect(ballot.nextFocusSkill).toBe('REFUTATION');
      expect(prisma.usageEvent.create).toHaveBeenCalled();
    });

    // Регрессия: двойной клик по «Сдать судье» покупал две оценки.
    it('не покупает второй ballot при параллельной сдаче', async () => {
      mockSession({ status: 'SPEAKING' });
      vi.mocked(prisma.practiceSession.updateMany).mockResolvedValue({ count: 0 } as never);

      await expect(sessionService.submitSpeech('u1', 's1', { text: SPEECH })).rejects.toThrow(
        'Эта речь уже оценивается',
      );
      expect(runSpeechJudge).not.toHaveBeenCalled();
    });

    it('возвращает сессию в SPEAKING, если судья упал', async () => {
      mockSession({ status: 'SPEAKING' });
      vi.mocked(prisma.practiceSession.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(runSpeechJudge).mockRejectedValue(new Error('upstream down'));

      await expect(sessionService.submitSpeech('u1', 's1', { text: SPEECH })).rejects.toThrow('upstream down');

      const lastCall = vi.mocked(prisma.practiceSession.updateMany).mock.calls.at(-1)?.[0] as {
        data: { status: string };
      };
      expect(lastCall.data.status).toBe('SPEAKING');
    });

    it('отказывает по уже завершённой сессии', async () => {
      mockSession({ status: 'COMPLETED' });
      await expect(sessionService.submitSpeech('u1', 's1', { text: SPEECH })).rejects.toThrow('уже оценена');
    });

    // Рейтинг за прирост: та же оценка при том же среднем даёт базовые очки.
    it('даёт базовые очки, когда фокусный навык не вырос', async () => {
      mockSession();
      vi.mocked(prisma.practiceSession.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.sessionScore.aggregate).mockResolvedValue({ _avg: { score: 4 } } as never);
      vi.mocked(runSpeechJudge).mockResolvedValue(VERDICT as never);

      const ballot = await sessionService.submitSpeech('u1', 's1', { text: SPEECH });
      expect(ballot.ratingDelta).toBe(5);
    });

    it('даёт больше очков за прирост слабого навыка', async () => {
      mockSession();
      vi.mocked(prisma.practiceSession.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.sessionScore.aggregate).mockResolvedValue({ _avg: { score: 2 } } as never);
      vi.mocked(runSpeechJudge).mockResolvedValue(VERDICT as never);

      const ballot = await sessionService.submitSpeech('u1', 's1', { text: SPEECH });
      expect(ballot.ratingDelta).toBe(11);
    });

    it('не уходит в минус при провале и не пробивает потолок', async () => {
      mockSession();
      vi.mocked(prisma.practiceSession.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.sessionScore.aggregate).mockResolvedValue({ _avg: { score: 9.5 } } as never);
      vi.mocked(runSpeechJudge).mockResolvedValue(VERDICT as never);

      const ballot = await sessionService.submitSpeech('u1', 's1', { text: SPEECH });
      expect(ballot.ratingDelta).toBe(0);
    });
  });

  describe('requestPoi', () => {
    it('не даёт взять второй POI в одной речи', async () => {
      mockSession({ status: 'SPEAKING', poiText: 'Уже был вопрос' });

      await expect(sessionService.requestPoi('u1', 's1', 'а'.repeat(200))).rejects.toThrow('уже был');
      expect(runPoi).not.toHaveBeenCalled();
    });

    it('записывает трату на POI', async () => {
      mockSession({ status: 'SPEAKING' });
      vi.mocked(runPoi).mockResolvedValue({
        question: 'Откуда данные?',
        tokensIn: 400,
        tokensOut: 40,
        costUsd: 0.0006,
        model: 'stub-model',
      } as never);

      const result = await sessionService.requestPoi('u1', 's1', 'а'.repeat(200));

      expect(result.question).toBe('Откуда данные?');
      expect(prisma.usageEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: 'LLM_DEBATER' }) }),
      );
    });
  });
});
