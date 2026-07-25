-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "SkillKey" AS ENUM ('STRUCTURE', 'CONTENT', 'REFUTATION', 'LOGIC', 'DELIVERY');

-- CreateEnum
CREATE TYPE "TopicCategory" AS ENUM ('SCHOOL', 'SOCIETY', 'TECHNOLOGY', 'ETHICS', 'ENVIRONMENT', 'SPORTS', 'CULTURE');

-- CreateEnum
CREATE TYPE "TopicDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "Stance" AS ENUM ('PRO', 'CON');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('SETUP', 'ARGUMENT_BUILT', 'IN_PROGRESS', 'AWAITING_JUDGE', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "TurnRole" AS ENUM ('STUDENT', 'OPPONENT');

-- CreateEnum
CREATE TYPE "TurnKind" AS ENUM ('OPENING', 'REBUTTAL', 'QUESTION', 'RESPONSE', 'CLOSING');

-- CreateEnum
CREATE TYPE "SttProvider" AS ENUM ('STUB', 'GROQ', 'OPENAI');

-- CreateEnum
CREATE TYPE "TtsProvider" AS ENUM ('STUB', 'OPENAI', 'ELEVENLABS');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "refresh_jti" TEXT,
    "last_login_at" TIMESTAMP(3),
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "experience_level" "ExperienceLevel" NOT NULL DEFAULT 'BEGINNER',
    "focus_skill" "SkillKey",
    "goal" TEXT,
    "rounds_played" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TopicCategory" NOT NULL,
    "difficulty" "TopicDifficulty" NOT NULL DEFAULT 'EASY',
    "pro_hint" TEXT,
    "con_hint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debate_rounds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "stance" "Stance" NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'SETUP',
    "argument" JSONB,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "exchanges_done" INTEGER NOT NULL DEFAULT 0,
    "cost_estimate_usd" DECIMAL(8,4),
    "focus_skill" "SkillKey",
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debate_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debate_turns" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "role" "TurnRole" NOT NULL,
    "kind" "TurnKind" NOT NULL,
    "content_text" TEXT NOT NULL,
    "question" TEXT,
    "audio_url" TEXT,
    "citation_refs" JSONB DEFAULT '[]',
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(8,6) NOT NULL DEFAULT 0,
    "stt_provider" "SttProvider",
    "tts_provider" "TtsProvider",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debate_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_scores" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "skill" "SkillKey" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_feedback" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "advice" JSONB NOT NULL,
    "summary_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_quizzes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "prior_experience" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "logic_answer" TEXT NOT NULL,
    "derived_level" "ExperienceLevel" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "hashed" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE INDEX "debate_rounds_user_id_status_idx" ON "debate_rounds"("user_id", "status");

-- CreateIndex
CREATE INDEX "debate_rounds_user_id_completed_at_idx" ON "debate_rounds"("user_id", "completed_at");

-- CreateIndex
CREATE INDEX "debate_turns_round_id_idx_idx" ON "debate_turns"("round_id", "idx");

-- CreateIndex
CREATE INDEX "skill_scores_skill_idx" ON "skill_scores"("skill");

-- CreateIndex
CREATE UNIQUE INDEX "skill_scores_round_id_skill_key" ON "skill_scores"("round_id", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "round_feedback_round_id_key" ON "round_feedback"("round_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_quizzes_user_id_key" ON "onboarding_quizzes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens"("family");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_rounds" ADD CONSTRAINT "debate_rounds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_rounds" ADD CONSTRAINT "debate_rounds_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_turns" ADD CONSTRAINT "debate_turns_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "debate_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_scores" ADD CONSTRAINT "skill_scores_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "debate_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_feedback" ADD CONSTRAINT "round_feedback_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "debate_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_quizzes" ADD CONSTRAINT "onboarding_quizzes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

