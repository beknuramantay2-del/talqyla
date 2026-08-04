-- v2: одна речь вместо раунда из трёх обменов.
--
-- Порядок важен. Postgres не даёт использовать новое значение enum в той же
-- транзакции, где оно добавлено, поэтому значения SkillKey добавляются здесь,
-- а пишутся в таблицы уже следующими запросами приложения.

-- ── Рубрика v2 ──────────────────────────────────────────────────────────
-- DELIVERY НЕ удаляется: на нём висит история v1, а DROP VALUE в Postgres нет.
ALTER TYPE "SkillKey" ADD VALUE IF NOT EXISTS 'CASE_ANALYSIS';
ALTER TYPE "SkillKey" ADD VALUE IF NOT EXISTS 'QUICK_THINKING';

-- ── Новые перечисления ──────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "SessionMode" AS ENUM ('SPEECH', 'BLITZ', 'CASE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "SessionStatus" AS ENUM ('PREP', 'SPEAKING', 'SCORING', 'COMPLETED', 'ABORTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "SpeakerRole" AS ENUM ('PM', 'LO', 'DPM', 'DLO', 'MG', 'MO', 'GW', 'OW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UsageKind создан в 20260801150000_usage_events. Добавляем режим кейс-карт.
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'LLM_CASE';

-- ── Рейтинг и серия ─────────────────────────────────────────────────────
ALTER TABLE "student_profiles"
    ADD COLUMN IF NOT EXISTS "sessions_played" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "rating_points" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "streak_days" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_session_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "student_profiles_rating_points_idx"
    ON "student_profiles"("rating_points");

-- ── Кейс-карты ──────────────────────────────────────────────────────────
-- Одна карта на тему, а не на ученика: материал одинаковый, платить за него
-- каждый раз заново незачем.
CREATE TABLE IF NOT EXISTS "case_cards" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "stakeholders" JSONB NOT NULL,
    "clashes" JSONB NOT NULL,
    "gov_lines" JSONB NOT NULL,
    "opp_lines" JSONB NOT NULL,
    "traps" JSONB NOT NULL,
    "prompt_version" TEXT NOT NULL DEFAULT '2026-08',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_cards_topic_id_key" ON "case_cards"("topic_id");

ALTER TABLE "case_cards" DROP CONSTRAINT IF EXISTS "case_cards_topic_id_fkey";
ALTER TABLE "case_cards"
    ADD CONSTRAINT "case_cards_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Сессии ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "practice_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL DEFAULT 'SPEECH',
    "status" "SessionStatus" NOT NULL DEFAULT 'PREP',
    "role" "SpeakerRole" NOT NULL DEFAULT 'PM',
    "stance" "Stance" NOT NULL,
    "focus_skill" "SkillKey",
    "speech_text" TEXT,
    "speech_sec" INTEGER,
    "poi_text" TEXT,
    "poi_answer" TEXT,
    "total_score" INTEGER,
    "summary_text" TEXT,
    "strengths" JSONB NOT NULL DEFAULT '[]',
    "weaknesses" JSONB NOT NULL DEFAULT '[]',
    "drill_text" TEXT,
    "drill_skill" "SkillKey",
    "rating_delta" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "purged_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "practice_sessions_user_id_status_idx" ON "practice_sessions"("user_id", "status");
-- Суточный кап и лента прогресса читаются этим индексом.
CREATE INDEX IF NOT EXISTS "practice_sessions_user_id_created_at_idx" ON "practice_sessions"("user_id", "created_at");
-- Ретеншн сканирует по возрасту.
CREATE INDEX IF NOT EXISTS "practice_sessions_created_at_idx" ON "practice_sessions"("created_at");

ALTER TABLE "practice_sessions" DROP CONSTRAINT IF EXISTS "practice_sessions_user_id_fkey";
ALTER TABLE "practice_sessions"
    ADD CONSTRAINT "practice_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "practice_sessions" DROP CONSTRAINT IF EXISTS "practice_sessions_topic_id_fkey";
ALTER TABLE "practice_sessions"
    ADD CONSTRAINT "practice_sessions_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Оценки по навыкам ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session_scores" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "skill" "SkillKey" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "session_scores_session_id_skill_key" ON "session_scores"("session_id", "skill");
CREATE INDEX IF NOT EXISTS "session_scores_skill_idx" ON "session_scores"("skill");

ALTER TABLE "session_scores" DROP CONSTRAINT IF EXISTS "session_scores_session_id_fkey";
ALTER TABLE "session_scores"
    ADD CONSTRAINT "session_scores_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
