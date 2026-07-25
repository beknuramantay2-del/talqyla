// Round service unit tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@talqyla/db';
import * as roundService from '../services/round.service.js';

// Stub Prisma calls.
vi.mock('@talqyla/db', () => ({
  prisma: {
    topic: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    debateRound: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    debateTurn: { create: vi.fn(), findMany: vi.fn() },
    skillScore: { create: vi.fn() },
    roundFeedback: { create: vi.fn() },
    studentProfile: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((cb: (tx: Record<string, unknown>) => unknown) =>
      cb({
        debateTurn: { create: vi.fn() },
        debateRound: { update: vi.fn() },
        skillScore: { create: vi.fn() },
        roundFeedback: { create: vi.fn() },
      }),
    ),
  },
  RoundStatus: {},
  SkillKey: {},
  TurnKind: {},
  Stance: {},
}));

// Stub env.
vi.mock('@talqyla/config', () => ({
  env: {
    MAX_ROUND_EXCHANGES: 3,
    LLM_MODEL_DEBATER: 'stub-model',
    LLM_MODEL_JUDGE: 'stub-model',
    TTS_PROVIDER: 'stub',
  },
}));

describe('round.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRound', () => {
    it('creates a round with SETUP status', async () => {
      const mockTopic = { id: 'topic-1', title: 'Test Topic' };
      vi.mocked(prisma.topic.findUnique).mockResolvedValue(mockTopic as never);
      vi.mocked(prisma.debateRound.create).mockResolvedValue({
        id: 'round-1',
        userId: 'user-1',
        topicId: 'topic-1',
        stance: 'PRO',
        status: 'SETUP',
        topic: mockTopic,
      } as never);

      const result = await roundService.createRound('user-1', 'topic-1', 'PRO');

      expect(prisma.topic.findUnique).toHaveBeenCalledWith({ where: { id: 'topic-1' } });
      expect(prisma.debateRound.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            topicId: 'topic-1',
            stance: 'PRO',
            status: 'SETUP',
          }),
        }),
      );
      expect(result.status).toBe('SETUP');
    });

    it('throws NOT_FOUND for unknown topic', async () => {
      vi.mocked(prisma.topic.findUnique).mockResolvedValue(null);

      await expect(roundService.createRound('user-1', 'bad-topic', 'PRO')).rejects.toThrow('Тема не найдена');
    });
  });

  describe('listRounds', () => {
    it('returns paginated rounds', async () => {
      const mockRounds = [
        { id: 'r1', topic: { title: 'T1' }, feedback: null, _count: { turns: 2 } },
        { id: 'r2', topic: { title: 'T2' }, feedback: null, _count: { turns: 1 } },
      ];
      vi.mocked(prisma.debateRound.findMany).mockResolvedValue(mockRounds as never);
      vi.mocked(prisma.debateRound.count).mockResolvedValue(2);

      const result = await roundService.listRounds('user-1', { page: 1, limit: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('filters by status when provided', async () => {
      vi.mocked(prisma.debateRound.findMany).mockResolvedValue([]);
      vi.mocked(prisma.debateRound.count).mockResolvedValue(0);

      await roundService.listRounds('user-1', { status: 'COMPLETED' });

      expect(prisma.debateRound.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });
  });

  describe('submitArgument', () => {
    it('throws if round not found', async () => {
      vi.mocked(prisma.debateRound.findFirst).mockResolvedValue(null);

      await expect(
        roundService.submitArgument('user-1', 'bad-round', { claim: 'C', warrant: 'W', impact: 'I' }),
      ).rejects.toThrow('Раунд не найден');
    });

    it('throws if round is not in SETUP status', async () => {
      vi.mocked(prisma.debateRound.findFirst).mockResolvedValue({
        id: 'r1',
        userId: 'user-1',
        status: 'IN_PROGRESS',
      } as never);

      await expect(
        roundService.submitArgument('user-1', 'r1', { claim: 'C', warrant: 'W', impact: 'I' }),
      ).rejects.toThrow('Аргумент уже отправлен');
    });
  });

  describe('abortRound', () => {
    it('aborts a round that is in progress', async () => {
      vi.mocked(prisma.debateRound.findFirst).mockResolvedValue({
        id: 'r1',
        userId: 'user-1',
        status: 'IN_PROGRESS',
      } as never);
      vi.mocked(prisma.debateRound.update).mockResolvedValue({} as never);

      const result = await roundService.abortRound('user-1', 'r1');
      expect(result).toEqual({ ok: true });
      expect(prisma.debateRound.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ABORTED' } }),
      );
    });

    it('throws if round is already completed', async () => {
      vi.mocked(prisma.debateRound.findFirst).mockResolvedValue({
        id: 'r1',
        userId: 'user-1',
        status: 'COMPLETED',
      } as never);

      await expect(roundService.abortRound('user-1', 'r1')).rejects.toThrow('Раунд уже завершён');
    });
  });
});
