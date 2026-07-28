# Security audit: 2026-07-28

## Fixed in this branch

- Refresh rotation now claims the presented token with a conditional update inside a database transaction. Two parallel refresh requests cannot both receive a replacement token.
- `TTS_PROVIDER=elevenlabs` no longer silently returns the stub MP3. The API returns an explicit upstream error until the provider is implemented.
- A database unique index prevents concurrent requests from creating two turns at the same `(roundId, idx)` position.

## Remaining release blockers

- `round.service.ts` still needs a distributed/idempotency lock around the whole LLM turn. The unique index prevents transcript corruption, but a losing concurrent request can still spend an upstream call before its insert fails.
- `abort` and `judge` need a state-machine lock that covers the external call. Do not treat the current endpoint as safe for retries from an unreliable network.
- Password reset creates a token but there is no mail provider or delivery job. It must not be advertised as functional until a delivery channel exists and is tested.
- Parent consent is recorded, but the legal text and an auditable confirmation flow are still product/legal work.
- `OPENROUTER_API_KEY` and provider keys must live in the deployment secret store, never `.env` committed to Git.
- Next 14 high advisories, backups, restore drills, reviewed judge golden set, and production HTTPS remain launch gates.

## Verification required after merge

1. Run build, typecheck, lint, unit tests, and the integration smoke job.
2. Run two simultaneous refresh calls using one cookie and confirm one succeeds while the other is rejected.
3. Run two simultaneous turn calls and verify the database has no duplicate `(round_id, idx)` rows.
4. Run `pnpm smoke:llm` once against staging, then inspect provider cost and error telemetry.
