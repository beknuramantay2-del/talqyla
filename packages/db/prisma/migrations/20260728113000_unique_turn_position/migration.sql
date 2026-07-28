-- Prevent two concurrent requests from inserting the same turn position.
-- The service still needs an idempotency key for perfect cost control, but this
-- constraint makes duplicate transcript positions fail closed instead of
-- silently corrupting the round history.
CREATE UNIQUE INDEX "debate_turns_round_id_idx_key" ON "debate_turns"("round_id", "idx");
