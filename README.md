# Talqyla

Talqyla is an AI debate trainer for a Telegram Mini App. It follows: **SKILL → CASE → 1v1 SPARRING → JUDGE → FEEDBACK → NEXT SKILL**.

## MVP
- Home: Debate Skill, progress bar, Start Debate, Your Progress, Recent Training.
- Active Debate: Round 1–4, AI Opponent, topic, microphone affordance, required text input.
- Result: Debate Skill before/after, strongest skill, needs-work skill, 2–3 evidence-based feedback cards, Next Debate.

## Judge Engine
The judge is an adjudicator, not a coach. Every praise and criticism must use an exact student quote. Invented quotes are nulled by `quoteVerifier`. Feedback cards without a verified quote are dropped. Invalid Judge JSON falls back to deterministic scoring that still uses real student text.

See `docs/judge-engine.md`.

## Architecture
- `frontend/`: React + TypeScript Telegram Mini App mobile shell.
- `backend/`: Node.js TypeScript REST API and debate engine.
- `shared/`: DebateSession, MoveJudgeResult, FinalJudgeResult.
- `backend/src/judge/`: evidence extractor, rubric, quote verifier, move judge, final judge.

## Run locally
```bash
npm test
node --import tsx backend/src/app.ts
```
API: `http://localhost:8787`.

## Env
See `.env.example`. Never commit real keys. Provider routing is documented in `docs/providers.md`.

Defaults:
- Groq text: `llama-3.1-8b-instant`
- Google Judge: `gemini-3.8-flash`
- Google STT: `gemini-3.5-transcribe`
- Deepgram: `nova-3`
- Groq STT: `whisper-large-v3-turbo`

## Scoring
Initial skills: Argumentation 72, Counterargumentation 61, Rebuttal 68, Structure 77. Overall score is the rounded average. The target skill changes from the verified Judge score.

## Next Skill
If the trained skill is still below 70, repeat it. Otherwise choose the lowest skill.
