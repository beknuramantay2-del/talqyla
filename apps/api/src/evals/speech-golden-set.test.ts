// Офлайн-проверки eval-харнесса судьи v2.
//
// Гоняются на каждом билде и ничего не стоят. Они НЕ доказывают, что судья
// точен: для этого нужна живая модель и `pnpm eval:speech:live`. Что они
// доказывают: набор корректен, он различает слабые и сильные речи, и
// арифметика сравнения не врёт.

import { describe, it, expect } from 'vitest';
import {
  loadSpeechGoldenSet,
  compareSpeechCase,
  speechMae,
  speechSpread,
  drillAccuracy,
  toSpeechScoreMap,
  averageExpectedSpeech,
  SPEECH_SKILLS,
  type SpeechCase,
} from './speech-lib.js';

const set = loadSpeechGoldenSet();

describe('speech golden set', () => {
  it('парсится и держит минимум 8 кейсов', () => {
    expect(set.cases.length).toBeGreaterThanOrEqual(8);
  });

  it('имеет уникальные id', () => {
    const ids = set.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('покрывает обе стороны', () => {
    const stances = new Set(set.cases.map((c) => c.stance));
    expect(stances).toContain('PRO');
    expect(stances).toContain('CON');
  });

  // Роль определяет, что судья считает выполненной задачей. Набор из одних
  // только PM ничего не скажет о том, понимает ли судья whip.
  it('покрывает разные роли, включая закрывающие', () => {
    const roles = new Set(set.cases.map((c) => c.role));
    expect(roles.size).toBeGreaterThanOrEqual(4);
    const closing = ['MG', 'MO', 'GW', 'OW'];
    expect(set.cases.some((c) => closing.includes(c.role))).toBe(true);
  });

  // Набор, где все речи средние, не отловит судью, который всем ставит 6.
  it('охватывает шкалу от слабой речи до турнирной', () => {
    const averages = set.cases.map(averageExpectedSpeech);
    expect(Math.min(...averages)).toBeLessThanOrEqual(4.5);
    expect(Math.max(...averages)).toBeGreaterThanOrEqual(7.5);
  });

  it('делает каждый навык слабым местом хотя бы раз', () => {
    for (const skill of SPEECH_SKILLS) {
      const hasWeak = set.cases.some((c) => c.expected[skill] <= 3);
      expect(hasWeak, `нет ни одного кейса со слабым навыком ${skill}`).toBe(true);
    }
  });

  // QUICK_THINKING честно измеряется только по ответу на POI. Без пары
  // «ответил / поплыл» этот навык непроверяем.
  it('содержит и удачный, и провальный ответ на POI', () => {
    const withPoi = set.cases.filter((c) => c.poiText && c.poiAnswer);
    expect(withPoi.length).toBeGreaterThanOrEqual(2);
    expect(withPoi.some((c) => c.expected.QUICK_THINKING >= 8)).toBe(true);
    expect(withPoi.some((c) => c.expected.QUICK_THINKING <= 3)).toBe(true);
  });

  // Дрилл обязан бить в слабое место, иначе ученик тренирует не то.
  it('ожидает дрилл по одному из самых слабых навыков', () => {
    for (const c of set.cases) {
      const min = Math.min(...SPEECH_SKILLS.map((s) => c.expected[s]));
      expect(c.expected[c.expectedDrillSkill], `${c.id}: дрилл не по слабому навыку`).toBe(min);
    }
  });

  it('честно говорит, что тренер его ещё не подписал', () => {
    if (set.status === 'draft') {
      expect(set.disclaimer).toMatch(/тренер/i);
      expect(set.cases.filter((c) => c.gradedBy.startsWith('TODO')).length).toBeGreaterThan(0);
    } else {
      expect(
        set.cases.filter((c) => c.gradedBy.startsWith('TODO')),
        'status=reviewed, но остались неподписанные кейсы',
      ).toHaveLength(0);
    }
  });
});

describe('speech eval maths', () => {
  const sample = set.cases[0] as SpeechCase;
  const perfect = Object.fromEntries(SPEECH_SKILLS.map((s) => [s, sample.expected[s]]));

  it('показывает нулевую ошибку при точном совпадении', () => {
    const result = compareSpeechCase(sample, perfect);
    expect(result.mae).toBe(0);
    expect(result.withinTolerance).toBe(true);
  });

  it('заваливает допуск, когда судья стабильно мимо', () => {
    const inflated = Object.fromEntries(
      SPEECH_SKILLS.map((s) => [s, Math.min(10, sample.expected[s] + 4)]),
    );
    const result = compareSpeechCase(sample, inflated);
    expect(result.mae).toBeGreaterThan(sample.tolerance);
    expect(result.withinTolerance).toBe(false);
  });

  it('отмечает пропущенные навыки, а не ставит им тихий ноль', () => {
    const result = compareSpeechCase(sample, { STRUCTURE: sample.expected.STRUCTURE });
    expect(result.missingSkills).toHaveLength(4);
    expect(result.withinTolerance).toBe(false);
  });

  it('усредняет ошибку по кейсам', () => {
    const off = Object.fromEntries(SPEECH_SKILLS.map((s) => [s, sample.expected[s] + 2]));
    expect(speechMae([compareSpeechCase(sample, perfect), compareSpeechCase(sample, off)])).toBeCloseTo(1, 5);
  });

  it('меряет разброс между прогонами', () => {
    expect(speechSpread([{ STRUCTURE: 5 }, { STRUCTURE: 8 }, { STRUCTURE: 6 }])).toBe(3);
    expect(speechSpread([{ STRUCTURE: 7 }, { STRUCTURE: 7 }])).toBe(0);
  });

  // Точность баллов и точность дрилла — разные вещи: можно выставить верные
  // оценки и всё равно отправить ученика тренировать не то.
  it('считает попадание дрилла отдельно от баллов', () => {
    const hit = compareSpeechCase(sample, perfect, sample.expectedDrillSkill);
    const miss = compareSpeechCase(
      sample,
      perfect,
      SPEECH_SKILLS.find((s) => s !== sample.expectedDrillSkill),
    );
    expect(hit.drillMatched).toBe(true);
    expect(miss.drillMatched).toBe(false);
    expect(drillAccuracy([hit, miss])).toBe(0.5);
  });

  it('не считает дрилл, если судья его не вернул', () => {
    const result = compareSpeechCase(sample, perfect);
    expect(result.drillMatched).toBeNull();
    expect(Number.isNaN(drillAccuracy([result]))).toBe(true);
  });

  it('игнорирует навыки вне рубрики v2', () => {
    const map = toSpeechScoreMap([
      { skill: 'STRUCTURE', score: 7 },
      // DELIVERY осталась в БД от v1 и судьёй больше не выставляется.
      { skill: 'DELIVERY', score: 9 },
      { skill: 'CHARISMA', score: 3 },
    ]);
    expect(map.STRUCTURE).toBe(7);
    expect(Object.keys(map)).toHaveLength(1);
  });
});
