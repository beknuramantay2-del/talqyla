// Account & data-rights routes.
//
// We process voice recordings and transcripts of minors. That makes data
// export and deletion table stakes, not a roadmap item — it is the first thing
// a school's legal contact will ask for.
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@talqyla/db';
import { env } from '@talqyla/config';
import { notFound, unauthorized } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const DeleteAccountBody = z.object({
  // Deleting a child's whole learning history is irreversible — re-authenticate.
  password: z.string().min(1, 'Подтверди пароль'),
  confirm: z.literal('УДАЛИТЬ', {
    errorMap: () => ({ message: 'Для подтверждения отправь confirm: "УДАЛИТЬ"' }),
  }),
});

export async function meRoutes(app: TypedFastifyInstance): Promise<void> {
  // ── Who am I + what do we store about me ────────────────────────
  app.get('/me', { preHandler: app.requireAuth }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        parentEmail: true,
        parentalConsentAt: true,
        parentalConsentVersion: true,
        studentProfile: true,
      },
    });
    if (!user) throw notFound('Пользователь не найден');

    return {
      ...user,
      dataPolicy: {
        transcriptRetentionDays: env.TRANSCRIPT_RETENTION_DAYS,
        consentVersion: env.CONSENT_VERSION,
        processors: ['OpenRouter (текст)', 'Groq (распознавание речи)', 'OpenAI (синтез речи)'],
      },
    };
  });

  // ── Export everything we hold ───────────────────────────────────
  app.get(
    '/me/export',
    { preHandler: app.requireAuth, config: { rateLimit: { max: 3, timeWindow: 3600000 } } },
    async (req, reply) => {
      const userId = req.user!.id;

      const [user, quiz, rounds] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true,
            lastLoginAt: true,
            parentEmail: true,
            parentalConsentAt: true,
            parentalConsentVersion: true,
            studentProfile: true,
          },
        }),
        prisma.onboardingQuiz.findUnique({ where: { userId } }),
        prisma.debateRound.findMany({
          where: { userId },
          include: {
            topic: { select: { slug: true, title: true } },
            turns: { orderBy: { idx: 'asc' } },
            skillScores: true,
            feedback: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      if (!user) throw notFound('Пользователь не найден');

      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="talqyla-export-${userId}.json"`);
      return reply.send({
        exportedAt: new Date().toISOString(),
        retentionDays: env.TRANSCRIPT_RETENTION_DAYS,
        user,
        onboarding: quiz,
        rounds,
      });
    },
  );

  // ── Erase everything ────────────────────────────────────────────
  // Prisma cascades handle the profile, quiz, rounds, turns, scores,
  // feedback and refresh tokens.
  app.delete(
    '/me',
    {
      preHandler: app.requireAuth,
      schema: { body: DeleteAccountBody },
      config: { rateLimit: { max: 3, timeWindow: 3600000 } },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const { password } = req.body as z.infer<typeof DeleteAccountBody>;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('Пользователь не найден');

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw unauthorized('Неверный пароль');

      await prisma.user.delete({ where: { id: userId } });

      req.log.warn({ event: 'account_deleted', userId }, 'Аккаунт и все данные удалены по запросу');

      reply.clearCookie('dt_refresh', { path: '/api/v1/auth' });
      return reply.send({ ok: true, message: 'Аккаунт и все связанные данные удалены безвозвратно.' });
    },
  );
}
