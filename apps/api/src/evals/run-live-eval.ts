// Live judge evaluation — hits the real model against the golden set.
//
//   pnpm eval:judge:live
//
// Two questions, both of which the product needs answered before anyone can
// claim "objective scoring":
//   1. ACCURACY  — how far are the judge's marks from the reference marks?
//   2. STABILITY — score the same round three times; how much do marks move?
//
// Costs real money (one judge call per case, plus repeats). Runs nightly in CI,
// never on every push.

import { getAiProvider } from '../agents/provider.js';
import { runJudge, RUBRIC_VERSION } from '../agents/judge.js';
import {
  loadGoldenSet,
  compareCase,
  overallMae,
  maxSpread,
  toScoreMap,
  SKILLS,
  type GoldenCase,
  type Skill,
} from './lib.js';

const MAE_THRESHOLD = Number(process.env.EVAL_MAE_THRESHOLD ?? 1.5);
const SPREAD_THRESHOLD = Number(process.env.EVAL_SPREAD_THRESHOLD ?? 2.0);
const CONSISTENCY_RUNS = Number(process.env.EVAL_CONSISTENCY_RUNS ?? 3);
const CONSISTENCY_CASES = Number(process.env.EVAL_CONSISTENCY_CASES ?? 3);

let spentUsd = 0;

async function scoreCase(c: GoldenCase): Promise<Partial<Record<Skill, number>>> {
  const result = await runJudge(getAiProvider(), {
    topicTitle: c.topic,
    stance: c.stance,
    focusSkill: c.focusSkill,
    argument: c.argument,
    transcript: c.transcript.map((t) => ({ role: t.role, kind: t.kind, text: t.text })),
  });
  spentUsd += result.costUsd;
  if (!result.parsed) {
    console.warn(`  ! ${c.id}: судья вернул неразбираемый ответ`);
  }
  return toScoreMap(result.scores);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY не задан — live-eval без него бессмысленен (stub вернёт константу).');
    process.exit(1);
  }

  const goldenSet = loadGoldenSet();

  if (goldenSet.rubricVersion !== RUBRIC_VERSION) {
    console.warn(
      `ВНИМАНИЕ: рубрика в коде (${RUBRIC_VERSION}) не совпадает с набором (${goldenSet.rubricVersion}). Эталоны устарели.`,
    );
  }
  if (goldenSet.status === 'draft') {
    console.warn('ВНИМАНИЕ: набор в статусе draft — это проверка стабильности, а не правоты судьи.\n');
  }

  console.log(`Прогон судьи по ${goldenSet.cases.length} кейсам...\n`);

  // ── 1. Accuracy ──────────────────────────────────────────────────
  const comparisons = [];
  for (const c of goldenSet.cases) {
    const actual = await scoreCase(c);
    const comparison = compareCase(c, actual);
    comparisons.push(comparison);

    const mark = comparison.withinTolerance ? 'ok  ' : 'FAIL';
    const detail = SKILLS.map((s) => {
      const cell = comparison.perSkill[s];
      return `${s.slice(0, 4)} ${cell.expected}/${cell.actual ?? '-'}`;
    }).join('  ');
    console.log(`  ${mark} ${pad(c.id, 6)} MAE ${comparison.mae?.toFixed(2) ?? '-'}   ${detail}`);
  }

  const mae = overallMae(comparisons);
  const failedCases = comparisons.filter((c) => !c.withinTolerance);

  // ── 2. Stability ─────────────────────────────────────────────────
  console.log(`\nСтабильность: ${CONSISTENCY_CASES} кейса × ${CONSISTENCY_RUNS} прогона...\n`);
  let worstSpread = 0;
  for (const c of goldenSet.cases.slice(0, CONSISTENCY_CASES)) {
    const runs: Partial<Record<Skill, number>>[] = [];
    for (let i = 0; i < CONSISTENCY_RUNS; i++) {
      runs.push(await scoreCase(c));
    }
    const spread = maxSpread(runs);
    worstSpread = Math.max(worstSpread, spread);
    const mark = spread <= SPREAD_THRESHOLD ? 'ok  ' : 'FAIL';
    console.log(`  ${mark} ${pad(c.id, 6)} максимальный разброс ${spread.toFixed(1)} балла`);
  }

  // ── Verdict ──────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  console.log(`  Средняя ошибка (MAE):   ${mae.toFixed(2)}  (порог ${MAE_THRESHOLD})`);
  console.log(`  Худший разброс:         ${worstSpread.toFixed(1)}  (порог ${SPREAD_THRESHOLD})`);
  console.log(`  Кейсов вне допуска:     ${failedCases.length} из ${comparisons.length}`);
  console.log(`  Потрачено:              $${spentUsd.toFixed(4)}`);
  console.log('────────────────────────────────────────');

  const accuracyFailed = !Number.isFinite(mae) || mae > MAE_THRESHOLD;
  const stabilityFailed = worstSpread > SPREAD_THRESHOLD;

  if (accuracyFailed) console.error('\nПРОВАЛ: судья слишком далеко от эталонов.');
  if (stabilityFailed) console.error('\nПРОВАЛ: судья нестабилен между прогонами.');

  if (accuracyFailed || stabilityFailed) process.exit(1);

  console.log('\nСудья в допуске.');
}

main().catch((err) => {
  console.error('Eval упал:', err);
  process.exit(1);
});
