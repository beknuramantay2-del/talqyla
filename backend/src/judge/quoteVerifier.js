export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteExists(quote, userTexts) {
  if (!quote) return false;
  const needle = normalizeText(quote);
  if (needle.length < 8) return false;
  return (userTexts || []).some((text) => normalizeText(text).includes(needle));
}

export function latestUserQuote(userTexts) {
  const latest = String(userTexts?.[userTexts.length - 1] || '').trim();
  if (!latest) return null;
  const sentences = latest
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  return sentences.sort((a, b) => b.length - a.length)[0] || (latest.length >= 8 ? latest : null);
}

export function verifiedQuote(quote, userTexts) {
  return quoteExists(quote, userTexts) ? String(quote).trim() : latestUserQuote(userTexts);
}

export function nullUnverified(evidence, userTexts) {
  const quote = evidence?.quote ?? null;
  if (quoteExists(quote, userTexts)) return { ...evidence, quote: String(quote).trim() };
  return {
    ...evidence,
    quote: null,
    reason: 'No verified student quote supports this point.',
  };
}

export function verifyMoveJudge(result, userTexts) {
  const strength = nullUnverified(result.detectedStrength, userTexts);
  const weakness = nullUnverified(result.detectedWeakness, userTexts);
  const rubric = Object.fromEntries(
    Object.entries(result.rubric || {}).map(([key, value]) => {
      const next = nullUnverified(value, userTexts);
      const score = next.quote ? value.score : Math.min(value.score, 1);
      return [key, { ...next, score }];
    }),
  );
  const skillScore = Math.max(
    0,
    Math.min(
      10,
      Object.values(rubric).reduce((sum, item) => sum + Number(item.score || 0), 0),
    ),
  );
  const confidence = strength.quote && weakness.quote ? result.confidence : Math.min(result.confidence || 0.5, 0.45);
  return { ...result, detectedStrength: strength, detectedWeakness: weakness, rubric, skillScore, confidence };
}

export function onlyVerifiedCards(cards, userTexts) {
  return (cards || []).filter((card) => quoteExists(card.quote, userTexts)).slice(0, 3);
}
