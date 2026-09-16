import { extractStudentClaims } from './evidenceExtractor.js';
import { latestUserQuote, quoteExists } from './quoteVerifier.js';
import { emptyCriterion } from './rubrics.js';

function containsAny(haystack, needles) {
  const text = haystack.toLowerCase();
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

function score(okFull, okPartial, quote, fullReason, partialReason, noneReason) {
  if (okFull && quote) return { score: 2, quote, reason: fullReason };
  if (okPartial && quote) return { score: 1, quote, reason: partialReason };
  return emptyCriterion(noneReason);
}

export function fallbackMoveJudge({ targetSkill, round, topic, userPosition, latestAi, latestUser }) {
  const quote = latestUserQuote([latestUser]);
  const claims = extractStudentClaims(latestUser);
  const user = String(latestUser || '');
  const ai = String(latestAi || '');
  const hasBecause = /because|потому что|так как|если|if /i.test(user);
  const mentionsAiPoint = containsAny(user, ai.split(/\s+/).filter((w) => w.length > 6).slice(0, 6));
  const answersQuestion = /\?/.test(ai) ? /how|why|как|почему|because|потому/i.test(user) : mentionsAiPoint;
  const ownReason = claims.length > 0 && hasBecause;
  const connects = containsAny(user, userPosition.split(/\s+/).filter((w) => w.length > 5).slice(0, 5));

  const rubric = {
    understanding: score(mentionsAiPoint && answersQuestion, mentionsAiPoint, quote, 'The student reused part of the opponent point before answering.', 'The answer stays on the same topic, but does not show the opponent core objection.', 'The student did not address the opponent argument.'),
    directResponse: score(answersQuestion && hasBecause, answersQuestion, quote, 'The student answered the opponent objection with a reason.', 'The student stayed near the objection but did not answer it directly.', 'The student added a separate claim instead of answering the opponent.'),
    explanation: score(hasBecause && answersQuestion, hasBecause, quote, 'The student explained why the opponent concern does not decide the issue.', 'The student gave a reason, but not why the opponent argument fails.', 'The student did not explain a weakness in the opponent argument.'),
    ownReasoning: score(ownReason, Boolean(quote), quote, 'The student gave an independent reason for their side.', 'The student made a claim, but the reason is thin.', 'The student did not give their own reason.'),
    connectionToPosition: score(connects && Boolean(quote), Boolean(quote), quote, 'The answer supports the student stated position.', 'The answer is related, but the link to the position is implicit.', 'The answer is not connected to the student position.'),
  };

  const skillScore = Object.values(rubric).reduce((sum, item) => sum + item.score, 0);
  const weaknessLabel = rubric.directResponse.score < 2 ? 'does_not_answer_core_objection' : rubric.explanation.score < 2 ? 'missing_weakness_explanation' : 'underdeveloped_argument';
  const strengthLabel = rubric.ownReasoning.score >= 2 ? 'independent_reason' : 'relevant_to_topic';

  return {
    round,
    targetSkill,
    skillScore,
    detectedStrength: {
      label: strengthLabel,
      quote,
      reason: rubric.ownReasoning.reason,
    },
    detectedWeakness: {
      label: weaknessLabel,
      quote,
      reason: rubric.directResponse.score < 2 ? rubric.directResponse.reason : rubric.explanation.reason,
    },
    rubric,
    opponentAttackStrategy: weaknessLabel === 'does_not_answer_core_objection' ? 'challenge_missing_link' : 'ask_for_reasoning',
    nextOpponentInstruction:
      weaknessLabel === 'does_not_answer_core_objection'
        ? `Press why the student answer actually defeats this objection: ${ai}`
        : `Ask the student to prove the missing link in: ${quote || topic}`,
    confidence: quoteExists(quote, [user]) ? 0.62 : 0.4,
    source: 'fallback',
  };
}
