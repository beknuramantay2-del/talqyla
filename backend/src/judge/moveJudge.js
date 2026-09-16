import { fallbackMoveJudge } from './fallbackJudge.js';
import { verifyMoveJudge } from './quoteVerifier.js';

function parseJudgeJson(raw) {
  try {
    const cleaned = String(raw || '').replace(/^```json\s*|```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function toLegacySignal(result) {
  return {
    skillScore: result.skillScore,
    detectedStrength: result.detectedStrength.label,
    detectedWeakness: result.detectedWeakness.label,
    opponentAttackStrategy: result.opponentAttackStrategy,
    confidence: result.confidence,
  };
}

export function judgeUserMove(input) {
  const userTexts = [input.latestUser];
  const parsed = parseJudgeJson(input.llmJson);
  if (!parsed) return verifyMoveJudge(fallbackMoveJudge(input), userTexts);

  const candidate = {
    round: input.round,
    targetSkill: input.targetSkill,
    skillScore: Number(parsed.skillScore || 0),
    detectedStrength: parsed.detectedStrength || { label: 'relevant_to_topic', quote: null, reason: '' },
    detectedWeakness: parsed.detectedWeakness || { label: 'indirect_response', quote: null, reason: '' },
    rubric: parsed.rubric || fallbackMoveJudge(input).rubric,
    opponentAttackStrategy: parsed.opponentAttackStrategy || 'challenge_missing_link',
    nextOpponentInstruction: parsed.nextOpponentInstruction || 'Answer the missing link in the student claim.',
    confidence: Number(parsed.confidence || 0.5),
    source: 'llm',
  };

  const verified = verifyMoveJudge(candidate, userTexts);
  if (!verified.detectedStrength.quote && !verified.detectedWeakness.quote) {
    return { ...fallbackMoveJudge(input), source: 'fallback' };
  }
  return verified;
}
