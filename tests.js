import assert from 'node:assert/strict';
import { quoteExists, verifyMoveJudge } from './backend/src/judge/quoteVerifier.js';
import { fallbackMoveJudge } from './backend/src/judge/fallbackJudge.js';
import { judgeUserMove } from './backend/src/judge/moveJudge.js';
import { applyScore, nextSkill, buildFeedbackCards, finalJudge } from './backend/src/judge/finalJudge.js';

const SKILLS = ['Argumentation', 'Counterargumentation', 'Rebuttal', 'Structure'];

assert.equal(applyScore({ Argumentation: 72, Counterargumentation: 61, Rebuttal: 68, Structure: 77 }, 'Counterargumentation', 8).Counterargumentation, 66);
assert.equal(nextSkill({ Argumentation: 80, Counterargumentation: 58, Rebuttal: 63, Structure: 74 }, 'Counterargumentation'), 'Counterargumentation');
assert.equal(nextSkill({ Argumentation: 80, Counterargumentation: 82, Rebuttal: 61, Structure: 74 }, 'Counterargumentation'), 'Rebuttal');

const user = 'AI helps students find information faster.';
assert.equal(quoteExists('AI helps students find information faster', [user]), true);
assert.equal(quoteExists('teachers can still require oral checks', [user]), false);

const fake = verifyMoveJudge({
  skillScore: 9,
  confidence: 0.9,
  detectedStrength: { label: 'strong', quote: 'this quote was never said', reason: 'invented' },
  detectedWeakness: { label: 'weak', quote: 'also invented', reason: 'invented' },
  rubric: { understanding: { score: 2, quote: 'invented quote', reason: 'no' } },
}, [user]);
assert.equal(fake.detectedStrength.quote, null);
assert.equal(fake.detectedWeakness.quote, null);
assert.ok(fake.rubric.understanding.score <= 1);

const judged = fallbackMoveJudge({
  targetSkill: 'Counterargumentation',
  round: 1,
  topic: 'Should schools ban the use of AI for homework?',
  userPosition: 'Schools should not ban AI for homework; they should teach responsible use.',
  latestAi: 'If students can use AI to complete homework, how can teachers know they truly understood the material?',
  latestUser: user,
});
assert.ok(judged.detectedWeakness.quote === null || quoteExists(judged.detectedWeakness.quote, [user]));
assert.ok(judged.skillScore >= 0 && judged.skillScore <= 10);

const invalidLlm = judgeUserMove({
  targetSkill: 'Counterargumentation',
  round: 1,
  topic: 'Should schools ban the use of AI for homework?',
  userPosition: 'Schools should not ban AI.',
  latestAi: 'How can teachers know they understood the material?',
  latestUser: user,
  llmJson: 'not json',
});
assert.equal(invalidLlm.source, 'fallback');
assert.ok(invalidLlm.opponentAttackStrategy);

const session = {
  targetSkill: 'Counterargumentation',
  messages: [{ speaker: 'user', text: user }],
  judgeResults: [judged],
};
const cards = buildFeedbackCards(session);
assert.ok(cards.every((card) => quoteExists(card.quote, [user])));

const finals = finalJudge(session, { Argumentation: 72, Counterargumentation: 61, Rebuttal: 68, Structure: 77 });
assert.ok(finals.feedbackCards.every((card) => quoteExists(card.quote, [user])));
assert.ok(SKILLS.includes(finals.nextSkill));

console.log('tests passed');
