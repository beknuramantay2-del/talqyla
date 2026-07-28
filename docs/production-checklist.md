# Talqyla production release checklist

Use this checklist for every production release. Do not mark the release complete from a green build alone.

## 0. Release decision

- [ ] Confirm the release commit and rollback commit.
- [ ] Confirm an owner for the release and an owner for rollback.
- [ ] Announce the maintenance window and expected user impact.
- [ ] Confirm database backup, restore point, and available disk space.
- [ ] Confirm staging smoke test passed with the same Docker images and environment shape.
- [ ] Confirm no open Critical/High security findings without an explicit written exception.
- [ ] Confirm judge golden set status. If it is still `draft`, do not claim objective scoring in public copy.

## 1. Production secrets and environment

Generate values outside Git and inject them through the deployment secret manager or protected environment file. Never commit the real file.

Required:

- [ ] `POSTGRES_USER`
- [ ] `POSTGRES_PASSWORD`, generated randomly and stored only in the deployment secret store
- [ ] `POSTGRES_DB`
- [ ] `REDIS_PASSWORD`, generated randomly and stored only in the deployment secret store
- [ ] `JWT_ACCESS_SECRET`, at least 32 random bytes, unique to production
- [ ] `API_BASE_URL`, an HTTPS URL
- [ ] `CORS_ORIGIN`, the exact frontend origin, never `*`
- [ ] `NEXT_PUBLIC_API_URL`, the public API base URL used by the browser
- [ ] `OPENROUTER_API_KEY`, only if live LLM is enabled
- [ ] `GROQ_API_KEY`, only if `STT_PROVIDER=groq`
- [ ] `OPENAI_API_KEY`, only if `STT_PROVIDER=openai` or `TTS_PROVIDER=openai`
- [ ] `SENTRY_DSN`, recommended for production error monitoring

Set deliberately:

- [ ] `NODE_ENV=production`
- [ ] `STT_PROVIDER=groq` or `openai`, never accidentally `stub` for a paid pilot
- [ ] `TTS_PROVIDER=openai` or `stub`, depending on the launch promise
- [ ] `PARENTAL_CONSENT_REQUIRED=true`
- [ ] `CONSENT_VERSION` matches the approved legal text
- [ ] `TRANSCRIPT_RETENTION_DAYS` matches the approved privacy policy
- [ ] `RETENTION_JOB_ENABLED=true` for exactly one API instance, or leave it false and configure a single cron job
- [ ] `DAILY_ROUND_LIMIT` and `DAILY_COST_LIMIT_USD` protect the provider budget
- [ ] `TTS_MAX_CHARS` is set to the intended cost ceiling
- [ ] `CORS_ORIGIN` contains no trailing or accidental wildcard origin

Secret validation:

```bash
# Run locally against a redacted env template, never print production values.
openssl rand -hex 32

docker compose -f docker-compose.prod.yml config >/tmp/talqyla-compose-check.txt
# Review the rendered structure, then delete it if it contains interpolated secrets.
rm -f /tmp/talqyla-compose-check.txt
```

## 2. Pre-deploy checks

- [ ] Merge only the reviewed release commit into `main`.
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm db:generate`
- [ ] `pnpm build`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm audit --prod --audit-level=high`
- [ ] Gitleaks history scan passes.
- [ ] CodeQL completes without a release-blocking finding.
- [ ] Confirm the migration exists in `packages/db/prisma/migrations/` and is included in the release commit.
- [ ] Confirm API and web images use the intended commit, not `latest` from an older build.

## 3. Backup and migration

1. Put the release into a short maintenance or deploy mode if the platform supports it.
2. Create and verify a PostgreSQL backup before changing schema:

```bash
export BACKUP_FILE="/secure/backups/talqyla-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$BACKUP_FILE" "$DATABASE_URL"
pg_restore --list "$BACKUP_FILE" >/dev/null
```

3. Check the database connection from the API environment.
4. Apply migrations with deploy mode only:

```bash
pnpm db:deploy
```

5. Do not use `prisma migrate dev` in production.
6. Verify Prisma reports the expected migration and no failed migration remains.
7. Start the API and web containers, then wait for health checks.

For this release, verify the migration that adds `JUDGING`, parental-consent fields, retention markers and supporting indexes. Existing users must have a documented backfill/consent policy before enabling live minor accounts.

## 4. Smoke test after deploy

Run with synthetic data first. Never use a real child account for the first deploy test.

- [ ] `GET /api/v1/health` returns healthy.
- [ ] Register a synthetic student with parent email and consent.
- [ ] Refresh the browser and confirm the session returns through the httpOnly cookie.
- [ ] Log out, then confirm refresh cannot restore the session.
- [ ] Log in again.
- [ ] Load topics.
- [ ] Create a PRO round.
- [ ] Submit Claim, Warrant and Impact.
- [ ] Submit three turns and confirm each opponent response is persisted once.
- [ ] Confirm the sixth turn is rejected and the round enters `AWAITING_JUDGE`.
- [ ] Call judge once, confirm `JUDGING` then `COMPLETED`.
- [ ] Double-submit judge and confirm it cannot buy a second evaluation.
- [ ] Open the ballot and confirm total score is shown as `/50`, not `/10`.
- [ ] Confirm weakest skill becomes the next focus.
- [ ] Test STT with a synthetic audio clip, if voice is enabled.
- [ ] Test TTS length limit and rate limit, if TTS is enabled.
- [ ] Verify no access token, refresh token, child speech, parent email or provider key appears in logs.
- [ ] Verify export and deletion endpoints with the synthetic account.

## 5. Rollback plan

### Application-only rollback

Use when the schema is backward-compatible and the problem is in API/web behavior.

1. Stop rollout and record the failing release commit and error window.
2. Switch API and web images to the previous known-good commit.
3. Restart only the affected services.
4. Run health checks and the minimal auth/round smoke test.
5. Keep the database migration in place if the previous application can safely read the new nullable columns/status values.
6. Investigate before attempting a second deploy.

### Database rollback

Do not casually downgrade Prisma migrations. A migration rollback can destroy data or break a newer application.

1. Stop application writes.
2. Confirm the last good backup and restore point.
3. Decide with the release owner whether forward-fix is safer than restore.
4. If restore is approved, restore into a new database first and validate counts, users, rounds, scores and refresh-token rows.
5. Switch the API `DATABASE_URL` only after validation.
6. Restart services and run the full synthetic smoke test.
7. Communicate data-loss window, if any, honestly.

### Emergency provider rollback

- [ ] Set live providers to `stub` only to stop spend or protect user flow, and show a clear maintenance state to users.
- [ ] Rotate a compromised provider key immediately and revoke the old key.
- [ ] Lower `DAILY_COST_LIMIT_USD` and `TTS_MAX_CHARS` during an incident.
- [ ] Preserve redacted logs and timestamps for investigation.

## 6. Post-release monitoring

For the first 30 minutes watch:

- API health and error rate.
- 401/403/429/5xx rates.
- round completion rate and judge failure rate.
- provider latency, timeouts and spend.
- database connections, locks, disk and Redis memory.
- retention job result and Sentry events.

After the window:

- [ ] Record the release commit, migration, smoke-test result and any exceptions.
- [ ] Update the incident/release log.
- [ ] Remove temporary elevated access and temporary secrets.
- [ ] Schedule review of remaining High/Medium findings.
