# Talqyla security release gate

This is the project-specific security gate for a product used by school students and processing voice transcripts.

## Assets and trust boundaries

- Browser: access token is memory-only; refresh session is an httpOnly cookie.
- API: Fastify routes, JWT verification, ownership guards, rate limits, spend caps, AI orchestration.
- Data stores: PostgreSQL contains accounts, consent, rounds, transcripts, scores and refresh-token hashes; Redis contains rate-limit and login-lockout state.
- Processors: OpenRouter receives debate text, Groq receives student audio for STT, OpenAI receives opponent text for TTS.
- Deployment: Docker Compose, GitHub Actions, environment-provided secrets.

## Priority abuse cases

| Risk | Control | Verification |
|---|---|---|
| Account takeover | bcrypt, timing-safe login, lockout, rotating refresh family, logout/reset revocation | auth tests, refresh rotation test |
| IDOR/BOLA | ownership predicate on every round query | ownership tests |
| AI cost exhaustion | per-user daily caps, route limits, TTS cap, judge claim state | spend and idempotency tests |
| Prompt injection | untrusted delimiters, output schemas, log-only detector | agent and regression tests |
| Minor data leakage | consent version, retention purge, export/delete, redacted logs | retention and data-rights tests |
| Browser token theft | no localStorage access token, httpOnly refresh cookie | frontend review and manual browser test |
| Supply-chain compromise | frozen lockfile, dependency audit, Gitleaks, build/test gate | CI workflow |

## Framework mapping

- NIST CSF 2.0: GV.OC, ID.RA, PR.AA, PR.DS, PR.PS, DE.CM, RS.AN, RC.RP.
- NIST AI RMF: GOVERN, MAP, MEASURE, MANAGE, especially privacy, security, prompt injection and model-output reliability.
- MITRE ATLAS: prompt injection, context poisoning, unsafe model output and excessive agency are the relevant AI threat families.
- MITRE D3FEND: input validation, credential hardening, network isolation, logging and data minimization.

## Merge gate

A change is not production-ready when any of these are false:

- `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- `pnpm audit --audit-level=high` passes without being ignored.
- Gitleaks runs on repository history and the working tree.
- Production rejects the default JWT secret and HTTP API base URL.
- User-owned resources filter by authenticated user ID.
- Paid AI endpoints have rate, size, timeout, output and spend controls.
- Access tokens are not persisted in browser storage.
- Transcript retention, consent, export and deletion are documented and tested.
- Judge output is schema validated and the golden set is reviewed before accuracy claims.

## Residual risk

GitHub Advanced Security is not enabled on the current repository plan, so this gate does not claim CodeQL or GitHub secret-scanning coverage. Before production, enable a supported scanner or run equivalent CodeQL/dependency/container scans outside GitHub and attach the results to the release.
