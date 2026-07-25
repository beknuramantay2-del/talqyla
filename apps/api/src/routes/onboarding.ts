// Onboarding quiz route.
// Saves the 4-question quiz answers, derives an experience level, and updates
// the student profile. The derived level then calibrates Debater complexity.
import { z } from 'zod';
import { prisma, type ExperienceLevel } from '@talqyla/db';
import { gradeSchema } from '@talqyla/config';
import { badRequest, notFound } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const OnboardingBody = z.object({
  grade: gradeSchema,
  // never | few | regular
  priorExperience: z.enum(['never', 'few', 'regular']),
  goal: z.enum(['confidence', 'arguments', 'rebuttals', 'logic']),
  // argument | opinion — the mini logic-test answer
  logicAnswer: z.enum(['argument', 'opinion']),
});

type OnboardingBodyType = z.infer<typeof OnboardingBody>;

/**
 * Map quiz answers → experience level. The Debater prompt uses this to
 * calibrate opponent complexity (simpler vocabulary, gentler pushback).
 *
 * - Grade alone never pushes above BEGINNER unless paired with experience.
 * - A correct logic-test answer bumps INTERMEDIATE → ADVANCED.
 */
function deriveLevel(input: OnboardingBodyType): ExperienceLevel {
  const { priorExperience, logicAnswer } = input;
  const correctLogic = logicAnswer === 'argument';

  if (priorExperience === 'regular' && correctLogic) return 'ADVANCED';
  if (priorExperience === 'regular') return 'INTERMEDIATE';
  if (priorExperience === 'few' && correctLogic) return 'INTERMEDIATE';
  return 'BEGINNER';
}

export async function onboardingRoutes(app: TypedFastifyInstance): Promise<void> {
  app.post(
    '/onboarding',
    {
      preHandler: app.requireAuth,
      schema: { body: OnboardingBody },
    },
    async (req, reply) => {
      const body = req.body as OnboardingBodyType;
      const userId = req.user!.id;
      const derivedLevel = deriveLevel(body);

      const profile = await prisma.studentProfile.findUnique({ where: { userId } });
      if (!profile) throw notFound('Профиль ученика не найден');

      // Upsert the quiz row (one per user — @unique userId).
      await prisma.onboardingQuiz.upsert({
        where: { userId },
        update: {
          grade: body.grade,
          priorExperience: body.priorExperience,
          goal: body.goal,
          logicAnswer: body.logicAnswer,
          derivedLevel,
        },
        create: {
          userId,
          grade: body.grade,
          priorExperience: body.priorExperience,
          goal: body.goal,
          logicAnswer: body.logicAnswer,
          derivedLevel,
        },
      });

      // Reflect the level + grade into the profile.
      await prisma.studentProfile.update({
        where: { userId },
        data: {
          grade: body.grade as number,
          experienceLevel: derivedLevel as ExperienceLevel,
          goal: body.goal as string,
        },
      });

      return reply.send({
        level: derivedLevel,
        grade: body.grade,
        message:
          derivedLevel === 'BEGINNER'
            ? 'Стартовый уровень: 🟢 Новичок. Начинаем с адаптированных оппонентов.'
            : derivedLevel === 'INTERMEDIATE'
              ? 'Стартовый уровень: 🟡 Средний. Оппонент будет посерьёзнее.'
              : 'Стартовый уровень: 🔴 Продвинутый. Оппонент не будет тебя щадить.',
      });
    },
  );

  // Read the derived level back (used by the dashboard header).
  app.get(
    '/onboarding',
    {
      preHandler: app.requireAuth,
    },
    async (req) => {
      const userId = req.user!.id;
      const quiz = await prisma.onboardingQuiz.findUnique({ where: { userId } });
      if (!quiz) throw badRequest('Сначала пройди входной тест');
      return quiz;
    },
  );
}
