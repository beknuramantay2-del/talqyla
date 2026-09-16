# Evidence-based Judge Engine

Talqyla Judge is an adjudicator, not a coach.

Pipeline:

```
User response
→ Evidence extractor
→ Rubric judge
→ Quote verifier
→ MoveJudgeResult saved on DebateSession.judgeResults
→ Opponent receives detectedWeakness + nextOpponentInstruction
→ After maxRounds: Final Judge uses only verified quotes
→ Feedback cards are dropped if a quote was never said
```

Rules:

- Every praise and criticism needs an exact student quote.
- If a quote is missing or invented, the backend nulls it out.
- Feedback cards cannot be created without a verified quote.
- Invalid Judge JSON falls back to deterministic scoring that still uses real student text.

Counterargumentation rubric, 0-2 each, total 0-10:

1. understanding
2. directResponse
3. explanation
4. ownReasoning
5. connectionToPosition
