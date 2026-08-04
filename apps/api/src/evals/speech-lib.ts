// Обвязка golden-set для судьи v2 (одна речь).
//
// Зачем отдельный файл, а не правка lib.ts: старый набор измеряет судью v1 с
// рубрикой из пяти других навыков и транскриптом из трёх обменов. Это разные
// сущности, и смешивать их в одной схеме значит потерять обе.
//
// Пока набор в статусе draft, он ловит ДРЕЙФ между версиями промпта, но не
// доказывает, что судья прав. Правоту подписывает живой тренер.

import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const SPEECH_SKILLS = [
  'STRUCTURE',
  'CASE_ANALYSIS',
  'REFUTATION',
  'QUICK_THINKING',
  'CONTENT',
] as const;
export type SpeechSkill = (typeof SPEECH_SKILLS)[number];

const scoreField = z.number().min(0).max(10);

export const ExpectedSpeechScores = z.object({
  STRUCTURE: scoreField,
  CASE_ANALYSIS: scoreField,
  REFUTATION: scoreField,
  QUICK_THINKING: scoreField,
  CONTENT: scoreField,
});

export const SpeechCaseSchema = z.object({
  id: z.string().regex(/^sp-\d{2}$/),
  topic: z.string().min(5),
  stance: z.enum(['PRO', 'CON']),
  role: z.enum(['PM', 'LO', 'DPM', 'DLO', 'MG', 'MO', 'GW', 'OW']),
  focusSkill: z.enum(SPEECH_SKILLS).nullable(),
  speechText: z.string().min(120),
  speechSec: z.number().int().min(20).max(480).nullable(),
  // POI — единственный источник честной оценки QUICK_THINKING.
  poiText: z.string().nullable(),
  poiAnswer: z.string().nullable(),
  expected: ExpectedSpeechScores,
  // Ожидаемый дрилл: судья обязан бить в слабое место, а не в случайное.
  expectedDrillSkill: z.enum(SPEECH_SKILLS),
  tolerance: z.number().min(0.5).max(3),
  gradedBy: z.string().min(1),
  notes: z.string().optional(),
});

export type SpeechCase = z.infer<typeof SpeechCaseSchema>;

export const SpeechGoldenSetSchema = z.object({
  version: z.number().int().min(1),
  rubricVersion: z.string().min(1),
  status: z.enum(['draft', 'reviewed']),
  disclaimer: z.string().min(20),
  // Стартовый набор меньше двадцати кейсов v1 сознательно: лучше восемь
  // осмысленных речей, чем двадцать сгенерированных заглушек.
  cases: z.array(SpeechCaseSchema).min(8),
});

export type SpeechGoldenSet = z.infer<typeof SpeechGoldenSetSchema>;

export function loadSpeechGoldenSet(
  url: URL = new URL('./speech-golden-set.json', import.meta.url),
): SpeechGoldenSet {
  return SpeechGoldenSetSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

/** Ответ судьи → { НАВЫК: балл }. Пропущенные навыки остаются undefined. */
export function toSpeechScoreMap(
  scores: { skill: string; score: number }[],
): Partial<Record<SpeechSkill, number>> {
  const map: Partial<Record<SpeechSkill, number>> = {};
  for (const s of scores) {
    if ((SPEECH_SKILLS as readonly string[]).includes(s.skill)) {
      map[s.skill as SpeechSkill] = s.score;
    }
  }
  return map;
}

export interface SpeechComparison {
  id: string;
  perSkill: Record<SpeechSkill, { expected: number; actual: number | null; error: number | null }>;
  mae: number | null;
  missingSkills: SpeechSkill[];
  /** Попал ли судья дриллом в ожидаемое слабое место. */
  drillMatched: boolean | null;
  withinTolerance: boolean;
}

export function compareSpeechCase(
  golden: SpeechCase,
  actual: Partial<Record<SpeechSkill, number>>,
  actualDrillSkill?: string | null,
): SpeechComparison {
  const perSkill = {} as SpeechComparison['perSkill'];
  const missingSkills: SpeechSkill[] = [];
  const errors: number[] = [];

  for (const skill of SPEECH_SKILLS) {
    const expected = golden.expected[skill];
    const act = actual[skill];
    if (act === undefined) {
      missingSkills.push(skill);
      perSkill[skill] = { expected, actual: null, error: null };
      continue;
    }
    const error = Math.abs(expected - act);
    errors.push(error);
    perSkill[skill] = { expected, actual: act, error };
  }

  const mae = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;

  return {
    id: golden.id,
    perSkill,
    mae,
    missingSkills,
    drillMatched: actualDrillSkill == null ? null : actualDrillSkill === golden.expectedDrillSkill,
    withinTolerance: mae !== null && missingSkills.length === 0 && mae <= golden.tolerance,
  };
}

/** Средняя абсолютная ошибка по всем навыкам всех кейсов. */
export function speechMae(comparisons: SpeechComparison[]): number {
  const errors = comparisons.flatMap((c) =>
    SPEECH_SKILLS.map((s) => c.perSkill[s].error).filter((e): e is number => e !== null),
  );
  return errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : Number.NaN;
}

/**
 * Стабильность: одна и та же речь, оценённая N раз, должна попадать примерно
 * в одно место. Судья с разбросом в 4 балла — это генератор случайных чисел
 * с хорошими манерами.
 */
export function speechSpread(runs: Partial<Record<SpeechSkill, number>>[]): number {
  let worst = 0;
  for (const skill of SPEECH_SKILLS) {
    const values = runs.map((r) => r[skill]).filter((v): v is number => typeof v === 'number');
    if (values.length < 2) continue;
    worst = Math.max(worst, Math.max(...values) - Math.min(...values));
  }
  return worst;
}

/**
 * Доля кейсов, где дрилл попал в ожидаемое слабое место. Это отдельная от
  * точности метрика: судья может выставить верные баллы и всё равно отправить
 * ученика тренировать не то.
 */
export function drillAccuracy(comparisons: SpeechComparison[]): number {
  const judged = comparisons.filter((c) => c.drillMatched !== null);
  if (judged.length === 0) return Number.NaN;
  return judged.filter((c) => c.drillMatched).length / judged.length;
}

export function averageExpectedSpeech(c: SpeechCase): number {
  return SPEECH_SKILLS.reduce((sum, s) => sum + c.expected[s], 0) / SPEECH_SKILLS.length;
}
