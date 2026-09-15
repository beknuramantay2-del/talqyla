# Talqyla

Talqyla is an AI debate trainer for a Telegram Mini App. It follows: **SKILL → CASE → 1v1 SPARRING → JUDGE → FEEDBACK → NEXT SKILL**.

## MVP
- Home: Debate Skill 74, progress bar, +6 since last training, Start Debate, Your Progress, Recent Training.
- Active Debate: Round 1–4, timer placeholder, progress, AI Opponent, topic, microphone affordance, required text input.
- Result: Debate Skill before/after, strongest skill, needs-work skill, 2–3 feedback cards, Next Debate.

## Architecture
- `frontend/`: React + TypeScript Telegram Mini App mobile shell.
- `backend/`: Node.js TypeScript REST API and debate engine.
- `shared/`: DebateSession and shared domain types.

Backend is split into debate session, topic generation, opponent, judge/scoring, skill progression, and prompt boundaries.

## Prompts
`OPPONENT_SYSTEM_PROMPT`, `JUDGE_SYSTEM_PROMPT`, `COACH_SYSTEM_PROMPT`, and `TOPIC_GENERATOR_PROMPT` are separated in `backend/src/prompts.ts`.

## Run locally
```bash
npm test
node --import tsx backend/src/app.ts
```
API: `http://localhost:8787`.

## Env
See `.env.example`. Mock mode works without API keys. `OPENAI_API_KEY` and `TELEGRAM_BOT_TOKEN` are optional for local MVP.

## Scoring
Initial skills: Argumentation 72, Counterargumentation 61, Rebuttal 68, Structure 77. Overall score is the rounded average. Judge score changes the target skill with a stable explainable formula.

## Next Skill
If the trained skill is still below 70, repeat it. Otherwise choose the lowest skill.
