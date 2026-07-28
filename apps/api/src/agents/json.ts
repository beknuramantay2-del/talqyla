// Shared defensive JSON parsing for agent responses.
//
// Models in JSON mode still occasionally wrap output in code fences or add a
// sentence of prose. We strip both rather than throwing away a usable answer.

export function safeJsonParse(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try the first { ... last } — the model sometimes adds prose around it.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* give up */
      }
    }
    return {};
  }
}
