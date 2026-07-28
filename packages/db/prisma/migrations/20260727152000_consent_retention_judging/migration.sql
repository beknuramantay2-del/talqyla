-- Audit follow-up migration.
--
-- 1. RoundStatus.JUDGING — lets the judge endpoint claim a round atomically so
--    two parallel requests cannot buy two evaluations.
-- 2. Parental-consent columns on users — students are minors.
-- 3. purged_at markers + age indexes for the data-retention sweep.
-- 4. Indexes backing the per-user daily spend guard.

-- ── 1. New round status ─────────────────────────────────────────────
ALTER TYPE "RoundStatus" ADD VALUE IF NOT EXISTS 'JUDGING' AFTER 'AWAITING_JUDGE';

-- ── 2. Parental consent ─────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "parent_email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "parental_consent_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "parental_consent_version" TEXT;

-- ── 3. Retention markers ────────────────────────────────────────────
ALTER TABLE "debate_rounds" ADD COLUMN IF NOT EXISTS "purged_at" TIMESTAMP(3);
ALTER TABLE "debate_turns" ADD COLUMN IF NOT EXISTS "purged_at" TIMESTAMP(3);

-- ── 4. Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "debate_rounds_user_id_created_at_idx" ON "debate_rounds"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "debate_rounds_created_at_idx" ON "debate_rounds"("created_at");
CREATE INDEX IF NOT EXISTS "debate_turns_created_at_idx" ON "debate_turns"("created_at");
CREATE INDEX IF NOT EXISTS "round_feedback_created_at_idx" ON "round_feedback"("created_at");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
