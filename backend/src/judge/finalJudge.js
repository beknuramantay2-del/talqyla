import { onlyVerifiedCards, quoteExists } from './quoteVerifier.js';

const SKILLS = ['Argumentation', 'Counterargumentation', 'Rebuttal', 'Structure'];

export function overall(scores) {
  return Math.round(SKILLS.reduce((sum, skill) => sum + scores[skill], 0) / SKILLS.length);
}

export function applyScore(scores, skill, judgeScore) {
  const next = { ...scores };
  const delta = Math.max(1, Math.round((judgeScore - 5) / 2) + 3);
  next[skill] = Math.max(0, Math.min(100, next[skill] + delta));
  return next;
}

export function nextSkill(scores, target) {
  if (scores[target] < 70) return target;
  return [...SKILLS].sort((a, b) => scores[a] - scores[b])[0];
}

export function buildFeedbackCards(session) {
  const userTexts = session.messages.filter((m) => m.speaker === 'user').map((m) => m.text);
  const last = session.judgeResults[session.judgeResults.length - 1];
  if (!last) return [];
  const cards = [];
  if (last.detectedStrength.quote) {
    cards.push({
      title: 'What worked',
      quote: last.detectedStrength.quote,
      explanation: last.detectedStrength.reason,
    });
  }
  if (last.detectedWeakness.quote) {
    cards.push({
      title: 'What broke',
      quote: last.detectedWeakness.quote,
      explanation: last.detectedWeakness.reason,
    });
  }
  const bestDirect = [...session.judgeResults].reverse().find((r) => r.rubric?.directResponse?.quote && r.rubric.directResponse.score >= 1);
  if (bestDirect?.rubric.directResponse.quote) {
    cards.push({
      title: 'Next move',
      quote: bestDirect.rubric.directResponse.quote,
      explanation: 'Answer the opponent exact objection first, then add your own benefit.',
    });
  }
  return onlyVerifiedCards(cards, userTexts);
}

export function finalJudge(session, previousScores) {
  const last = session.judgeResults[session.judgeResults.length - 1] || { skillScore: 5, targetSkill: session.targetSkill };
  const scores = applyScore(previousScores, session.targetSkill, last.skillScore);
  const strongest = [...SKILLS].sort((a, b) => scores[b] - scores[a])[0];
  const needsWork = [...SKILLS].sort((a, b) => scores[a] - scores[b])[0];
  const chosen = nextSkill(scores, session.targetSkill);
  const before = overall(previousScores);
  const after = overall(scores);
  const cards = buildFeedbackCards(session);
  const userTexts = session.messages.filter((m) => m.speaker === 'user').map((m) => m.text);
  const safeCards = cards.filter((card) => quoteExists(card.quote, userTexts));
  return {
    overallBefore: before,
    overallAfter: after,
    delta: after - before,
    targetSkill: session.targetSkill,
    strongest,
    needsWork,
    feedbackCards: safeCards,
    nextSkill: chosen,
    nextTraining: `Practice ${chosen.toLowerCase()} in the next 1v1 debate.`,
    coachLine: `Тебе стоит потренировать ${chosen}: отвечай сначала на точный аргумент оппонента, потом добавляй свою пользу.`,
    scores,
  };
}
