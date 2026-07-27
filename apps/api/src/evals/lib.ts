// Golden-set plumbing shared by the offline test and the live eval runner.
//
// Why this exists: the product sells "objective scoring across 5 skills".
// Until the judge is measured against a fixed set of rounds, that claim is
// unfalsifiable — and any prompt tweak can silently move every student's marks.

import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const SKILLS = ['STRUCTURE', 'CONTENT', 'REFUTATION', 'LOGIC', 'DELIVERY'] as const;
export type Skill = (typeof SKILLS)[number];

const scoreField = z.number().min(0).max(10);

export const ExpectedScoresSchema = z.object({
  STRUCTURE: scoreField,
  CONTENT: scoreField,
  REFUTATION: scoreField,
  LOGIC: scoreField,
  DELIVERY: scoreField,
});

export const GoldenCaseSchema = z.object({
  id: z.string().regex(/^gs-\d{2}$/),
  topic: z.string().min(5),
  stance: z.enum(['PRO', 'CON']),
  grade: z.number().int().min(7).max(11),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  focusSkill: z.enum(SKILLS).nullable(),
  argument: z.object({
    claim: z.string().min(5),
    warrant: z.string().min(10),
    impact: z.string().min(5),
  }),
  transcript: z
    .array(
      z.object({
        role: z.enum(['STUDENT', 'OPPONENT']),
        kind: z.enum(['OPENING', 'REBUTTAL', 'QUESTION', 'RESPONSE', 'CLOSING']),
        text: z.string().min(20),
      }),
    )
    .min(2),
  expected: ExpectedScoresSchema,
  tolerance: z.number().min(0.5).max(3),
  gradedBy: z.string().min(1),
  notes: z.string().optional(),
});

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

export const GoldenSetSchema = z.object({
  version: z.number().int().min(1),
  rubricVersion: z.string().min(1),
  // 'draft' = scores are development baselines, good enough to detect DRIFT
  // but not evidence that the judge is CORRECT. Only a human coach flips this.
  status: z.enum(['draft', 'reviewed']),
  disclaimer: z.string().min(20),
  cases: z.array(GoldenCaseSchema).min(20),
});

export type GoldenSet = z.infer<typeof GoldenSetSchema>;

export function loadGoldenSet(url: URL = new URL('./golden-set.json', import.meta.url)): GoldenSet {
  return GoldenSetSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

/** Judge output → { SKILL: score }. Missing skills stay undefined on purpose. */
export function toScoreMap(scores: { skill: string; score: number }[]): Partial<Record<Skill, number>> {
  const map: Partial<Record<Skill, number>> = {};
  for (const s of scores) {
    if ((SKILLS as readonly string[]).includes(s.skill)) {
      map[s.skill as Skill] = s.score;
    }
  }
  return map;
}

export interface CaseComparison {
  id: string;
  perSkill: Record<Skill, { expected: number; actual: number | null; error: number | null }>;
  mae: number | null;
  missingSkills: Skill[];
  withinTolerance: boolean;
}

export function compareCase(
  golden: GoldenCase,
  actual: Partial<Record<Skill, number>>,
): CaseComparison {
  const perSkill = {} as CaseComparison['perSkill'];
  const missingSkills: Skill[] = [];
  const errors: number[] = [];

  for (const skill of SKILLS) {
    const exp = golden.expected[skill];
    const act = actual[skill];
    if (act === undefined) {
      missingSkills.push(skill);
      perSkill[skill] = { expected: exp, actual: null, error: null };
      continue;
    }
    const error = Math.abs(exp - act);
    errors.push(error);
    perSkill[skill] = { expected: exp, actual: act, error };
  }

  const mae = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;

  return {
    id: golden.id,
    perSkill,
    mae,
    missingSkills,
    withinTolerance: mae !== null && missingSkills.length === 0 && mae <= golden.tolerance,
  };
}

/** Mean absolute error across every scored skill of every case. */
export function overallMae(comparisons: CaseComparison[]): number {
  const errors = comparisons.flatMap((c) =>
    SKILLS.map((s) => c.perSkill[s].error).filter((e): e is number => e !== null),
  );
  return errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : Number.NaN;
}

/**
 * Consistency: the same round scored N times should land in the same place.
 * Returns the largest max-min gap across skills. A judge that swings 4 points
 * between runs is a random number generator with good manners.
 */
export function maxSpread(runs: Partial<Record<Skill, number>>[]): number {
  let worst = 0;
  for (const skill of SKILLS) {
    const values = runs.map((r) => r[skill]).filter((v): v is number => typeof v === 'number');
    if (values.length < 2) continue;
    worst = Math.max(worst, Math.max(...values) - Math.min(...values));
  }
  return worst;
}

export function averageExpected(c: GoldenCase): number {
  return SKILLS.reduce((sum, s) => sum + c.expected[s], 0) / SKILLS.length;
}
