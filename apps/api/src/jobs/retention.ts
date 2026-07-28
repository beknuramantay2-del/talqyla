// Data-retention purge.
//
// The most sensitive thing this product holds is the transcribed speech of a
// child. Keeping it forever is both a legal liability and pointless: after a
// few months the coaching value is in the SCORES, not the raw words.
//
// So we redact turn content past TRANSCRIPT_RETENTION_DAYS while keeping
// SkillScore rows intact — progress charts survive, the child's words do not.
//
// Run it either way:
//   • single instance  → RETENTION_JOB_ENABLED=true (daily in-process timer)
//   • multi instance   → `pnpm retention:purge` from cron/k8s CronJob

import { prisma } from '@talqyla/db';
import { env } from '@talqyla/config';

const REDACTED = '[удалено по политике хранения данных]';

export interface PurgeResult {
  cutoff: Date;
  turnsRedacted: number;
  roundsRedacted: number;
  feedbackRedacted: number;
  refreshTokensDeleted: number;
}

export async function purgeExpiredData(now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - env.TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const turns = await prisma.debateTurn.updateMany({
    where: { createdAt: { lt: cutoff }, purgedAt: null },
    data: {
      contentText: REDACTED,
      question: null,
      audioUrl: null,
      citationRefs: [],
      purgedAt: now,
    },
  });

  const rounds = await prisma.debateRound.updateMany({
    where: { createdAt: { lt: cutoff }, purgedAt: null },
    data: {
      argument: { claim: REDACTED, warrant: REDACTED, impact: REDACTED },
      transcript: [],
      purgedAt: now,
    },
  });

  // Free-text judge prose quotes the student verbatim, so it expires too.
  // Numeric scores in SkillScore / RoundFeedback.totalScore are kept.
  const feedback = await prisma.roundFeedback.updateMany({
    where: { createdAt: { lt: cutoff }, summaryText: { not: REDACTED } },
    data: {
      strengths: [],
      weaknesses: [],
      advice: [],
      summaryText: REDACTED,
    },
  });

  // Housekeeping: expired/revoked refresh tokens are dead weight.
  const tokens = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  return {
    cutoff,
    turnsRedacted: turns.count,
    roundsRedacted: rounds.count,
    feedbackRedacted: feedback.count,
    refreshTokensDeleted: tokens.count,
  };
}
