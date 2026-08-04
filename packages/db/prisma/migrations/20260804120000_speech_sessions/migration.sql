-- Speech-first session model (product v2).
--
-- Driven by the debater survey: strong opponents matter to 6.3%, while
-- practice (87.5%), analysis/feedback (81.3%) and preparation material (50%)
-- dominate. The opponent stops being the core loop.

-- ── New rubric values ────────────────────────────────────────────────
-- Postgres cannot drop enum values that historical rows reference, so the
-- retired ones (CONTENT, LOGIC, DELIVERY) stay in the type and simply stop
-- being produced by the judge.
ALTER TYPE "SkillKey" ADD VALUE IF NOT EXISTS 'CASE_ANALYSIS';
ALTER TYPE "SkillKey" ADD VALUE IF NOT EXISTS 'SPEED';
ALTER TYPE "SkillKey" ADD VALUE IF NOT EXISTS 'ARGUMENTATION';

-- A mid-speech point of information is a turn kind of its own.
ALTER TYPE "TurnKind" ADD VALUE IF NOT EXISTS 'POI';

-- Case cards are generated once per topic, then served from the DB.
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'LLM_CASE';

-- ── Session modes ────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "RoundMode" AS ENUM ('SPEECH', 'BLITZ', 'CASE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "debate_rounds"
    ADD COLUMN IF NOT EXISTS "mode" "RoundMode" NOT NULL DEFAULT 'SPEECH',
    ADD COLUMN IF NOT EXISTS "speaker_role" TEXT,
    ADD COLUMN IF NOT EXISTS "speech_seconds" INTEGER;

CREATE INDEX IF NOT EXISTS "debate_rounds_user_id_mode_created_at_idx"
    ON "debate_rounds"("user_id", "mode", "created_at");

-- ── Ballot always ends in one drill ──────────────────────────────────
ALTER TABLE "round_feedback"
    ADD COLUMN IF NOT EXISTS "drill_skill" "SkillKey",
    ADD COLUMN IF NOT EXISTS "drill_prompt" TEXT;

-- ── Weekly league ────────────────────────────────────────────────────
ALTER TABLE "student_profiles"
    ADD COLUMN IF NOT EXISTS "rating_points" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "streak_days" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_session_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "student_profiles_rating_points_idx"
    ON "student_profiles"("rating_points");

-- ── Preparation material ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "case_cards" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "stakeholders" JSONB NOT NULL,
    "clashes" JSONB NOT NULL,
    "pro_arguments" JSONB NOT NULL,
    "con_arguments" JSONB NOT NULL,
    "traps" JSONB NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_cards_topic_id_key" ON "case_cards"("topic_id");

DO $$ BEGIN
    ALTER TABLE "case_cards"
        ADD CONSTRAINT "case_cards_topic_id_fkey"
        FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ── Usage ledger hardening ───────────────────────────────────────────
-- The ledger table shipped in an earlier migration without the round link.
ALTER TABLE "usage_events"
    ALTER COLUMN "cost_usd" TYPE DECIMAL(10,6);

CREATE INDEX IF NOT EXISTS "usage_events_round_id_idx" ON "usage_events"("round_id");

DO $$ BEGIN
    ALTER TABLE "usage_events"
        ADD CONSTRAINT "usage_events_round_id_fkey"
        FOREIGN KEY ("round_id") REFERENCES "debate_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- One turn index per round; a retried write must not duplicate a speech.
CREATE UNIQUE INDEX IF NOT EXISTS "debate_turns_round_id_idx_key" ON "debate_turns"("round_id", "idx");
