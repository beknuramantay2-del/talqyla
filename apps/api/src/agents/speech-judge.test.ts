// Тесты судьи v2. Промпт и парсинг проверяются без БД и без сети.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@talqyla/config', () => ({
  env: { LLM_MODEL_JUDGE: 'stub-model' },
  SKILL_KEYS: ['STRUCTURE', 'CASE_ANALYSIS', 'REFUTATION', 'QUICK_THINKING', 'CONTENT'],
  SKILL_LABELS_RU: {
    STRUCTURE: 'Структура речи',
    CASE_ANALYSIS: 'Анализ кейса',
    REFUTATION: 'Опровержение',
    QUICK_THINKING: 'Скорость мышления',
    CONTENT: 'Аргументация',
    LOGIC: 'Логика',
    DELIVERY: 'Подача',
  },
  ROLE_DUTIES_RU: { PM: 'задать модель', LO: 'оспорить модель' },
}));

const { buildSpeechJudgePrompt, runSpeechJudge, normaliseScore, totalScore, weakestSkill } = await import(
  './speech-judge.js'
);

const input = {
  topicTitle: 'Ограничить соцсети до 16',
  stance: 'PRO',
  role: 'PM' as const,
  focusSkill: null,
  speechText: 'Речь ученика',
  speechSec: 180,
};

function provider(text: string) {
  return {
    llm: { complete: vi.fn().mockResolvedValue({ text, tokensIn: 2400, tokensOut: 700, costUsd: 0.0059, costSource: 'provider' }) },
    stt: { transcribe: vi.fn() },
    tts: { synthesize: vi.fn() },
  } as never;
}

describe('speech judge', () => {
  it('объясняет задачу роли в промпте', () => {
    const prompt = buildSpeechJudgePrompt(input);
    expect(prompt).toContain('Роль спикера: PM');
    expect(prompt).toContain('задать модель');
  });

  // Подача не попала ни в один ответ опроса, поэтому её нет в рубрике.
  it('не оценивает подачу', () => {
    expect(buildSpeechJudgePrompt(input)).not.toContain('DELIVERY');
  });

  it('меняет формулировку QUICK_THINKING, когда POI не было', () => {
    expect(buildSpeechJudgePrompt(input)).toContain('POI в этой речи не было');
    expect(buildSpeechJudgePrompt({ ...input, poiText: 'Вопрос?', poiAnswer: 'Ответ' })).toContain(
      'оценивай по ответу на POI',
    );
  });

  it('разбирает валидный ballot', async () => {
    const payload = JSON.stringify({
      scores: [{ skill: 'STRUCTURE', score: 7, comment: 'ок' }],
      strengths: ['«вывод чёткий»'],
      weaknesses: [],
      drill: { skill: 'STRUCTURE', task: 'Перескажи за 30 секунд' },
      summaryText: 'Ровно',
    });

    const result = await runSpeechJudge(provider(payload), input);
    expect(result.parsed).toBe(true);
    expect(result.drill.task).toContain('30 секунд');
    expect(result.costUsd).toBeCloseTo(0.0059);
  });

  // Мусор от модели не должен превращаться в тихий ноль в прогрессе ученика.
  it('отдаёт честный fallback на неразбираемый ответ', async () => {
    const result = await runSpeechJudge(provider('не json'), input);
    expect(result.parsed).toBe(false);
    expect(result.scores).toHaveLength(0);
    expect(result.drill.task).toBeTruthy();
  });

  it('клампит оценки и считает сумму', () => {
    expect(normaliseScore(12)).toBe(10);
    expect(normaliseScore(-3)).toBe(0);
    expect(normaliseScore(null)).toBe(0);
    expect(totalScore([{ score: 7 }, { score: 4 }])).toBe(11);
  });

  it('находит слабейший навык', () => {
    expect(
      weakestSkill([
        { skill: 'STRUCTURE', score: 7 },
        { skill: 'REFUTATION', score: 3 },
      ] as never),
    ).toBe('REFUTATION');
    expect(weakestSkill([])).toBeNull();
  });
});
