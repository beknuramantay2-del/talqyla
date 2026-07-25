// Dashboard routes — statistics and recent activity for the student.
import { prisma, type SkillKey } from '@talqyla/db';
import { SKILL_KEYS } from '@talqyla/config';
import { notFound } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

export async function dashboardRoutes(app: TypedFastifyInstance): Promise<void> {
  app.get(
    '/dashboard/stats',
    {
      preHandler: app.requireAuth,
    },
    async (req, reply) => {
      const userId = req.user!.id;

      // Ensure student profile exists
      const profile = await prisma.studentProfile.findUnique({
        where: { userId },
      });
      if (!profile) throw notFound('Профиль ученика не найден');

      // Fetch completed rounds and their scores
      const completedRounds = await prisma.debateRound.findMany({
        where: {
          userId,
          status: 'COMPLETED',
        },
        include: {
          skillScores: true,
          feedback: true,
        },
        orderBy: {
          completedAt: 'desc',
        },
      });

      const totalRounds = completedRounds.length;

      // Calculate overall average score (0 to 10 scale per skill, total score out of 50 in feedback)
      // We can average either the feedback.totalScore / 5 or individual SkillScore averages.
      let averageScore = 0;
      if (totalRounds > 0) {
        const sum = completedRounds.reduce((acc, round) => {
          if (round.feedback) {
            return acc + round.feedback.totalScore;
          }
          // Fallback: sum skill scores if feedback row is missing
          const roundSum = round.skillScores.reduce((s, ss) => s + ss.score, 0);
          return acc + roundSum;
        }, 0);
        // Average total score out of 50. Let's convert to an average out of 10 for a standard rating.
        averageScore = Number((sum / totalRounds / 5).toFixed(1));
      }

      // Calculate skill averages for the radar chart
      const skillSums: Record<SkillKey, number> = {
        STRUCTURE: 0,
        CONTENT: 0,
        REFUTATION: 0,
        LOGIC: 0,
        DELIVERY: 0,
      };
      const skillCounts: Record<SkillKey, number> = {
        STRUCTURE: 0,
        CONTENT: 0,
        REFUTATION: 0,
        LOGIC: 0,
        DELIVERY: 0,
      };

      for (const round of completedRounds) {
        for (const score of round.skillScores) {
          const key = score.skill as SkillKey;
          if (key in skillSums) {
            skillSums[key] += score.score;
            skillCounts[key] += 1;
          }
        }
      }

      const radarData = SKILL_KEYS.map((key) => {
        const count = skillCounts[key];
        const avg = count > 0 ? Number((skillSums[key] / count).toFixed(1)) : 0;
        return {
          skill: key,
          score: avg,
        };
      });

      // Determine recommended focus skill (the one with the lowest score)
      let recommendedFocusSkill: SkillKey | null = profile.focusSkill as SkillKey | null;
      if (!recommendedFocusSkill && totalRounds > 0) {
        let minScore = Infinity;
        let minSkill: SkillKey | null = null;
        for (const key of SKILL_KEYS) {
          const count = skillCounts[key];
          const avg = count > 0 ? skillSums[key] / count : 0;
          if (avg < minScore) {
            minScore = avg;
            minSkill = key;
          }
        }
        recommendedFocusSkill = minSkill;
      }

      // Get 5 most recent rounds (completed or in progress)
      const recentRoundsRaw = await prisma.debateRound.findMany({
        where: { userId },
        include: {
          topic: true,
          feedback: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
      });

      const recentRounds = recentRoundsRaw.map((r) => ({
        id: r.id,
        topicTitle: r.topic.title,
        category: r.topic.category,
        stance: r.stance,
        status: r.status,
        score: r.feedback?.totalScore ?? null,
        createdAt: r.createdAt,
      }));

      return reply.send({
        profile: {
          grade: profile.grade,
          experienceLevel: profile.experienceLevel,
          goal: profile.goal,
          roundsPlayed: profile.roundsPlayed,
        },
        stats: {
          totalRounds,
          averageScore,
          focusSkill: recommendedFocusSkill,
          radarData,
        },
        recentRounds,
      });
    }
  );
}
