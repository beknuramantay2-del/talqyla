// Тесты суточных капов.
//
// Главная регрессия, которую они ловят: до v2 STT и TTS не попадали в бюджет
// вообще. При TTS_PROVIDER=openai это ~$14 в час с одного аккаунта.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@talqyla/db';
import { assertSttBudget, assertTtsBudget, assertSessionBudget, getDailySpend, recordUsage } from './spend.js';

vi.mock('@talqyla/db', () => ({
  prisma: {
    usageEvent: { create: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    practiceSession: { count: vi.fn() },
    debateRound: { count: vi.fn() },
  },
}));

vi.mock('@talqyla/config', () => ({
  env: {
    DAILY_SESSION_LIMIT: 20,
    DAILY_ROUND_LIMIT: 10,
    DAILY_COST_LIMIT_USD: 0.25,
    DAILY_STT_SECONDS_LIMIT: 900,
    DAILY_TTS_CHARS_LIMIT: 4000,
  },
}));

function spentToday(opts: { usd?: number; sttSeconds?: number; ttsChars?: number; sessions?: number }) {
  vi.mocked(prisma.usageEvent.aggregate).mockResolvedValue({ _sum: { costUsd: opts.usd ?? 0 } } as never);
  vi.mocked(prisma.usageEvent.groupBy).mockResolvedValue([
    { kind: 'STT', _sum: { units: opts.sttSeconds ?? 0 } },
    { kind: 'TTS', _sum: { units: opts.ttsChars ?? 0 } },
  ] as never);
  vi.mocked(prisma.practiceSession.count).mockResolvedValue(opts.sessions ?? 0);
  vi.mocked(prisma.debateRound.count).mockResolvedValue(0);
}

describe('spend guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('складывает деньги и единицы за сутки', async () => {
    spentToday({ usd: 0.03, sttSeconds: 120, ttsChars: 800, sessions: 2 });
    const spend = await getDailySpend('u1');
    expect(spend).toMatchObject({ usd: 0.03, sttSeconds: 120, ttsChars: 800, sessions: 2 });
  });

  it('пропускает сессию в пределах лимита', async () => {
    spentToday({ usd: 0.05 });
    await expect(assertSessionBudget('u1')).resolves.toBeUndefined();
  });

  // Проверка ДО вызова: 0.246 + проектные 0.008 уже пробивают 0.25.
  it('блокирует вызов, который пробьёт потолок, а не только уже пробивший', async () => {
    spentToday({ usd: 0.246 });
    await expect(assertSessionBudget('u1')).rejects.toThrow();
  });

  it('блокирует STT по секундам, даже если деньги ещё есть', async () => {
    spentToday({ usd: 0.01, sttSeconds: 890 });
    await expect(assertSttBudget('u1', 0.0002, 60)).rejects.toThrow(/наговорено достаточно/);
  });

  it('блокирует TTS по символам', async () => {
    spentToday({ usd: 0.01, ttsChars: 3900 });
    await expect(assertTtsBudget('u1', 0.006, 420)).rejects.toThrow(/лимит озвучки/);
  });

  it('пропускает TTS в пределах лимита', async () => {
    spentToday({ usd: 0.01, ttsChars: 1000 });
    await expect(assertTtsBudget('u1', 0.006, 420)).resolves.toBeUndefined();
  });

  // Учёт не должен ронять уже оплаченный ответ судьи.
  it('не бросает наружу, если запись траты упала', async () => {
    vi.mocked(prisma.usageEvent.create).mockRejectedValue(new Error('db down'));
    const log = { warn: vi.fn(), error: vi.fn() };

    await expect(
      recordUsage({ userId: 'u1', kind: 'LLM_JUDGE', provider: 'openrouter', model: 'm', costUsd: 0.007 }, log),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'usage_record_failed' }),
      expect.any(String),
    );
  });
});
