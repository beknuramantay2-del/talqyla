# Talqyla integration and regression audit

## P0 blockers

1. **Topics contract mismatch:** the API returns `{ items, total, page, limit }`, while the web client typed and returned the whole response as `Topic[]`. Fixed in `apps/web/src/lib/api.ts` by unwrapping `items`.
2. **Voice refresh mismatch:** direct multipart STT requests did not refresh an expired access token. Fixed by retrying once after refresh.
3. **Cross-origin CSP:** API calls from a separately hosted web origin can be blocked by `connect-src 'self'`. Production must set `connect-src` to the exact web/API origins.
4. **Usage ledger drift:** the committed `usage_events` migration and spend helpers are not wired through the Prisma schema and request paths. Do not call production ready until Prisma generation and spend integration pass.

## High regression risks

- The visual BPF arena is not a full BPF backend: the service still runs three student/opponent exchanges, not eight timed speeches.
- APF is not a selectable backend format. The UI must not promise APF execution.
- `/onboarding` exists in the API but has no web route, so new profiles remain at the default level.
- Password reset creates a token but sends no email, so the feature is non-functional.
- Polling every 3 seconds is acceptable for the MVP but is not realtime and adds load per open arena.
- `ownedRound` performs a DB lookup, then the service performs another lookup for most mutations. This is correct but wasteful.

## Architecture notes

The strongest boundary is routes -> services -> agents. The main violations are duplicated API types, a large round orchestration service, and provider/config logic spread across env, pricing, and provider modules. Keep the arena presentational and move format state to a domain model before implementing BPF/APF.

## Security

JWT algorithm pinning, httpOnly strict refresh cookies, ownership guards, Zod validation, Helmet, CORS, bcrypt, and route rate limits are present. Remaining launch risks are CSP origin configuration, password-reset delivery, spend ledger wiring, and the absence of a verified parent-consent legal text.

## Performance

Dashboard loads all completed rounds instead of aggregating in SQL and then performs a second recent-round query. Topic and round list pagination exists in the API but the first web client did not expose filters. The main arena cost is polling plus repeated full round payloads.

## Launch gate

Run `pnpm typecheck && pnpm test && pnpm build`, then `pnpm smoke`. If any command fails, do not deploy the current main branch.
