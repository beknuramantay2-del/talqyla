// Offline guards for the judge eval harness.
//
// These run on every CI build and cost nothing. They do NOT prove the judge is
// accurate — that needs a live model and lives in `pnpm eval:judge:live`.
// What they DO prove: the golden set is well-formed, actually discriminates
// between good and bad rounds, and the scoring maths is correct.
import { describe, it, expect } from 'vitest';
import {
  loadGoldenSet,
  compareCase,
  overallMae,
  maxSpread,
  toScoreMap,
  averageExpected,
  SKILLS,
  type GoldenCase,
} from './lib.js';
import { JudgeResponseSchema, normaliseScore, totalScore } from '../agents/judge.js';

const goldenSet = loadGoldenSet();

describe('golden set', () => {
  it('parses and holds at least 20 cases', () => {
    expect(goldenSet.cases.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique ids', () => {
    const ids = goldenSet.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers both stances', () => {
    const stances = new Set(goldenSet.cases.map((c) => c.stance));
    expect(stances).toContain('PRO');
    expect(stances).toContain('CON');
  });

  it('covers all three experience levels', () => {
    const levels = new Set(goldenSet.cases.map((c) => c.level));
    expect(levels.size).toBe(3);
  });

  // A set where every round is mediocre cannot detect a judge that scores
  // everything 6/10. We need genuinely weak and genuinely strong rounds.
  it('spans the scale from weak to strong rounds', () => {
    const averages = goldenSet.cases.map(averageExpected);
    expect(Math.min(...averages)).toBeLessThanOrEqual(4.5);
    expect(Math.max(...averages)).toBeGreaterThanOrEqual(7.5);
  });

  it('exercises every skill as a weak spot at least once', () => {
    for (const skill of SKILLS) {
      const hasWeak = goldenSet.cases.some((c) => c.expected[skill] <= 3);
      expect(hasWeak, `нет ни одного кейса со слабым навыком ${skill}`).toBe(true);
    }
  });

  it('is honest about not being coach-reviewed yet', () => {
    if (goldenSet.status === 'draft') {
      expect(goldenSet.disclaimer).toMatch(/тренер/i);
      // Every case still waiting on a human signature.
      const unsigned = goldenSet.cases.filter((c) => c.gradedBy.startsWith('TODO'));
      expect(unsigned.length).toBeGreaterThan(0);
    } else {
      const unsigned = goldenSet.cases.filter((c) => c.gradedBy.startsWith('TODO'));
      expect(unsigned, 'status=reviewed, но остались неподписанные кейсы').toHaveLength(0);
    }
  });
});

describe('eval maths', () => {
  const sample = goldenSet.cases[0] as GoldenCase;

  it('reports zero error on a perfect match', () => {
    const actual = Object.fromEntries(SKILLS.map((s) => [s, sample.expected[s]]));
    const result = compareCase(sample, actual);
    expect(result.mae).toBe(0);
    expect(result.withinTolerance).toBe(true);
  });

  it('fails tolerance when the judge is consistently off', () => {
    const actual = Object.fromEntries(SKILLS.map((s) => [s, Math.min(10, sample.expected[s] + 4)]));
    const result = compareCase(sample, actual);
    expect(result.mae).toBeGreaterThan(sample.tolerance);
    expect(result.withinTolerance).toBe(false);
  });

  it('flags missing skills instead of silently scoring them zero', () => {
    const result = compareCase(sample, { STRUCTURE: sample.expected.STRUCTURE });
    expect(result.missingSkills.length).toBe(4);
    expect(result.withinTolerance).toBe(false);
  });

  it('averages error across cases', () => {
    const perfect = compareCase(sample, Object.fromEntries(SKILLS.map((s) => [s, sample.expected[s]])));
    const off = compareCase(sample, Object.fromEntries(SKILLS.map((s) => [s, sample.expected[s] + 2])));
    expect(overallMae([perfect, off])).toBeCloseTo(1, 5);
  });

  it('measures run-to-run spread', () => {
    expect(maxSpread([{ LOGIC: 5 }, { LOGIC: 8 }, { LOGIC: 6 }])).toBe(3);
    expect(maxSpread([{ LOGIC: 7 }, { LOGIC: 7 }])).toBe(0);
  });
});

describe('judge output handling', () => {
  it('clamps and rounds out-of-range model scores', () => {
    expect(normaliseScore(12)).toBe(10);
    expect(normaliseScore(-3)).toBe(0);
    expect(normaliseScore(6.6)).toBe(7);
    expect(normaliseScore(null)).toBe(0);
  });

  it('sums a full rubric to a 0–50 total', () => {
    const scores = SKILLS.map((skill) => ({ skill, score: 8 }));
    expect(totalScore(scores)).toBe(40);
  });

  it('rejects a response with an unknown skill key', () => {
    const parsed = JudgeResponseSchema.safeParse({
      scores: [{ skill: 'CHARISMA', score: 9 }],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a well-formed response and defaults the prose fields', () => {
    const parsed = JudgeResponseSchema.safeParse({
      scores: SKILLS.map((skill) => ({ skill, score: 7 })),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.strengths).toEqual([]);
      expect(parsed.data.summaryText).toBe('');
    }
  });

  it('maps judge scores onto the skill map used by the eval', () => {
    const map = toScoreMap([
      { skill: 'LOGIC', score: 7 },
      { skill: 'NONSENSE', score: 3 },
    ]);
    expect(map.LOGIC).toBe(7);
    expect(Object.keys(map)).toHaveLength(1);
  });
});
