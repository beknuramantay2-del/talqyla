-- Учёт трат на AI. До этой таблицы бюджет считался только по LLM внутри раунда,
-- а STT и TTS не попадали в суточный кап вообще.

CREATE TYPE "UsageKind" AS ENUM ('LLM_DEBATER', 'LLM_JUDGE', 'LLM_SUMMARIZER', 'STT', 'TTS');

CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "round_id" TEXT,
    "kind" "UsageKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- Суточный бюджет читается этим индексом на каждом платном вызове.
CREATE INDEX "usage_events_user_id_created_at_idx" ON "usage_events"("user_id", "created_at");
CREATE INDEX "usage_events_kind_created_at_idx" ON "usage_events"("kind", "created_at");

ALTER TABLE "usage_events"
    ADD CONSTRAINT "usage_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
