// Живая оценка судьи v2 по golden-set речей.
//
//   pnpm eval:speech:live
//
// Три вопроса, без ответов на которые нельзя обещать школе объективное
// судейство:
//   1. ТОЧНОСТЬ  — насколько баллы судьи далеки от эталонных?
//   2. СТАБИЛЬНОСТЬ — одна и та же речь три раза: насколько плывут оценки?
//   3. ДРИЛЛ — попадает ли рекомендация в реальное слабое место?
//
// Третий пункт новый: в v1 судью мерили только по баллам, хотя ученик
// действует по дриллу, а не по цифрам.
//
// Тратит настоящие деньги: один вызов на кейс плюс повторы. Гоняется ночью,
// не на каждый пуш.

import { getAiProvider } from '../agents/provider.js';
import { runSpeechJudge, RUBRIC_VERSION } from '../agents/speech-judge.js';
import {
  loadSpeechGoldenSet,
  compareSpeechCase,
  speechMae,
  speechSpread,
  drillAccuracy,
  toSpeechScoreMap,
  SPEECH_SKILLS,
  type SpeechCase,
  type SpeechSkill,
} from './speech-lib.js';

const MAE_THRESHOLD = Number(process.env.EVAL_MAE_THRESHOLD ?? 1.5);
const SPREAD_THRESHOLD = Number(process.env.EVAL_SPREAD_THRESHOLD ?? 2.0);
const DRILL_THRESHOLD = Number(process.env.EVAL_DRILL_THRESHOLD ?? 0.6);
const CONSISTENCY_RUNS = Number(process.env.EVAL_CONSISTENCY_RUNS ?? 3);
const CONSISTENCY_CASES = Number(process.env.EVAL_CONSISTENCY_CASES ?? 3);

let spentUsd = 0;

async function scoreCase(
  c: SpeechCase,
): Promise<{ scores: Partial<Record<SpeechSkill, number>>; drillSkill: string | null }> {
  const result = await runSpeechJudge(getAiProvider(), {
    topicTitle: c.topic,
    stance: c.stance,
    role: c.role,
    focusSkill: c.focusSkill,
    speechText: c.speechText,
    speechSec: c.speechSec,
    poiText: c.poiText,
    poiAnswer: c.poiAnswer,
  });

  spentUsd += result.costUsd;
  if (!result.parsed) console.warn(`  ! ${c.id}: судья вернул неразбираемый ответ`);

  return { scores: toSpeechScoreMap(result.scores), drillSkill: result.drill?.skill ?? null };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY не задан — прогон без него бессмысленен: stub вернёт константу.');
    process.exit(1);
  }

  const set = loadSpeechGoldenSet();

  if (set.rubricVersion !== RUBRIC_VERSION) {
    console.warn(
      `ВНИМАНИЕ: рубрика в коде (${RUBRIC_VERSION}) не совпадает с набором (${set.rubricVersion}). Эталоны устарели.`,
    );
  }
  if (set.status === 'draft') {
    console.warn('ВНИМАНИЕ: набор в статусе draft — это проверка дрейфа, а не правоты судьи.\n');
  }

  console.log(`Прогон судьи речей по ${set.cases.length} кейсам...\n`);

  // ── 1. Точность и дрилл ──────────────────────────────────────────
  const comparisons = [];
  for (const c of set.cases) {
    const { scores, drillSkill } = await scoreCase(c);
    const comparison = compareSpeechCase(c, scores, drillSkill);
    comparisons.push(comparison);

    const mark = comparison.withinTolerance ? 'ok  ' : 'FAIL';
    const drill = comparison.drillMatched ? 'дрилл ok' : `дрилл мимо (${drillSkill ?? '-'})`;
    const detail = SPEECH_SKILLS.map((s) => {
      const cell = comparison.perSkill[s];
      return `${s.slice(0, 4)} ${cell.expected}/${cell.actual ?? '-'}`;
    }).join('  ');
    console.log(`  ${mark} ${pad(c.id, 6)} MAE ${comparison.mae?.toFixed(2) ?? '-'}  ${detail}  ${drill}`);
  }

  const mae = speechMae(comparisons);
  const drillHit = drillAccuracy(comparisons);
  const failedCases = comparisons.filter((c) => !c.withinTolerance);

  // ── 2. Стабильность ──────────────────────────────────────────────
  console.log(`\nСтабильность: ${CONSISTENCY_CASES} кейса × ${CONSISTENCY_RUNS} прогона...\n`);
  let worstSpread = 0;
  for (const c of set.cases.slice(0, CONSISTENCY_CASES)) {
    const runs: Partial<Record<SpeechSkill, number>>[] = [];
    for (let i = 0; i < CONSISTENCY_RUNS; i++) {
      runs.push((await scoreCase(c)).scores);
    }
    const spread = speechSpread(runs);
    worstSpread = Math.max(worstSpread, spread);
    console.log(
      `  ${spread <= SPREAD_THRESHOLD ? 'ok  ' : 'FAIL'} ${pad(c.id, 6)} максимальный разброс ${spread.toFixed(1)} балла`,
    );
  }

  // ── Вердикт ──────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  console.log(`  Средняя ошибка (MAE):   ${mae.toFixed(2)}  (порог ${MAE_THRESHOLD})`);
  console.log(`  Худший разброс:         ${worstSpread.toFixed(1)}  (порог ${SPREAD_THRESHOLD})`);
  console.log(`  Дрилл в цель:           ${(drillHit * 100).toFixed(0)}%  (порог ${DRILL_THRESHOLD * 100}%)`);
  console.log(`  Кейсов вне допуска:     ${failedCases.length} из ${comparisons.length}`);
  console.log(`  Потрачено:              $${spentUsd.toFixed(4)}`);
  console.log('────────────────────────────────────────');

  const accuracyFailed = !Number.isFinite(mae) || mae > MAE_THRESHOLD;
  const stabilityFailed = worstSpread > SPREAD_THRESHOLD;
  const drillFailed = !Number.isFinite(drillHit) || drillHit < DRILL_THRESHOLD;

  if (accuracyFailed) console.error('\nПРОВАЛ: судья слишком далеко от эталонов.');
  if (stabilityFailed) console.error('\nПРОВАЛ: судья нестабилен между прогонами.');
  if (drillFailed) console.error('\nПРОВАЛ: дрилл слишком часто указывает не на слабое место.');

  if (accuracyFailed || stabilityFailed || drillFailed) process.exit(1);

  console.log('\nСудья в допуске.');
}

main().catch((err) => {
  console.error('Eval упал:', err);
  process.exit(1);
});
