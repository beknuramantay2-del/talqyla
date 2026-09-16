export function extractStudentClaims(userText) {
  const text = String(userText || '').trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((quote) => quote.trim())
    .filter((quote) => quote.length >= 12)
    .map((quote) => ({
      quote,
      claimType: /because|потому что|так как|therefore/i.test(quote) ? 'reason' : 'claim',
    }));
}
