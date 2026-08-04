// Dashboard v2 — прогресс по сессиям, а не по раундам.
//
// Старая версия грузила ВСЕ завершённые раунды со связями в память и считала
// средние в JS. На активном ученике это десятки объектов на каждый заход в
// дашборд. Теперь агрегация делается в SQL, а в память приходят только
// последние пять сессий для ленты.
import { prisma, type SkillKey } from '@talqyla/db';
import { SKILL_KEYS, SKILL_LABELS_RU, MAX_SESSION_SCORE } from '@talqyla/config';
import { notFound } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

export async function dashboardRoutes(app: TypedFastifyInstance): Promise<void> {
  app.get('/dashboard/stats', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.user!.id;

    const profile = await prisma.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw notFound('Профиль ученика не найден');

    const [agg, bySkill, recent] = await Promise.all([
      prisma.practiceSession.aggregate({
        where: { userId, status: 'COMPLETED' },
        _count: { _all: true },
        _avg: { totalScore: true },
      }),
      prisma.sessionScore.groupBy({
        by: ['skill'],
        where: { session: { userId, status: 'COMPLETED' } },
        _avg: { score: true },
        _count: { _all: true },
      }),
      prisma.practiceSession.findMany({
        where: { userId },
        select: {
          id: true,
          mode: true,
          status: true,
          stance: true,
          role: true,
          totalScore: true,
          drillSkill: true,
          createdAt: true,
          topic: { select: { title: true, category: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const avgFor = (skill: SkillKey) => {
      const row = bySkill.find((r) => r.skill === skill);
      return row?._avg.score != null ? Number(row._avg.score.toFixed(1)) : 0;
    };

    // Радар строится по рубрике v2. Навыки без единой оценки честно показывают
    // ноль и подпись «нет данных», а не выдуманное среднее.
    const radarData = SKILL_KEYS.map((skill) => ({
      skill,
      label: SKILL_LABELS_RU[skill],
      score: avgFor(skill),
      samples: bySkill.find((r) => r.skill === skill)?._count._all ?? 0,
    }));

    const totalSessions = agg._count._all;
    const scored = radarData.filter((r) => r.samples > 0);
    const focusSkill =
      (profile.focusSkill as SkillKey | null) ??
      (scored.length > 0 ? scored.reduce((min, r) => (r.score < min.score ? r : min)).skill : null);

    return reply.send({
      profile: {
        grade: profile.grade,
        experienceLevel: profile.experienceLevel,
        goal: profile.goal,
        sessionsPlayed: profile.sessionsPlayed,
        ratingPoints: profile.ratingPoints,
        streakDays: profile.streakDays,
        lastSessionAt: profile.lastSessionAt,
      },
      stats: {
        totalSessions,
        maxScore: MAX_SESSION_SCORE,
        averageScore: agg._avg.totalScore != null ? Number(agg._avg.totalScore.toFixed(1)) : 0,
        focusSkill,
        focusLabel: focusSkill ? SKILL_LABELS_RU[focusSkill] : null,
        radarData,
      },
      recentSessions: recent.map((s) => ({
        id: s.id,
        mode: s.mode,
        status: s.status,
        stance: s.stance,
        role: s.role,
        topicTitle: s.topic.title,
        category: s.topic.category,
        score: s.totalScore,
        drillSkill: s.drillSkill,
        createdAt: s.createdAt,
      })),
    });
  });

  // Недельная лига. Считает ПРИРОСТ, а не объём: иначе таблицу выигрывает тот,
  // у кого больше свободного времени.
  app.get('/dashboard/league', { preHandler: app.requireAuth }, async (req, reply) => {
    const top = await prisma.studentProfile.findMany({
      where: { ratingPoints: { gt: 0 } },
      select: { userId: true, ratingPoints: true, sessionsPlayed: true, user: { select: { name: true } } },
      orderBy: { ratingPoints: 'desc' },
      take: 20,
    });

    const me = top.findIndex((row) => row.userId === req.user!.id);

    return reply.send({
      items: top.map((row, index) => ({
        rank: index + 1,
        name: row.user.name,
        ratingPoints: row.ratingPoints,
        sessionsPlayed: row.sessionsPlayed,
        isMe: row.userId === req.user!.id,
      })),
      myRank: me >= 0 ? me + 1 : null,
    });
  });
}
