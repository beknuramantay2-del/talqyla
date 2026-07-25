// Topics routes — fetch the topic catalogue.
import { z } from 'zod';
import { prisma, type TopicCategory, type TopicDifficulty } from '@talqyla/db';
import { paginationSchema } from '@talqyla/config';
import { notFound } from '../lib/errors.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const TopicParams = z.object({
  idOrSlug: z.string().min(1),
});

const ListTopicsQuery = z.object({
  page: paginationSchema.shape.page,
  limit: paginationSchema.shape.limit,
  category: z.enum(['SCHOOL', 'SOCIETY', 'TECHNOLOGY', 'ETHICS', 'ENVIRONMENT', 'SPORTS', 'CULTURE']).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
});

type TopicParamsType = z.infer<typeof TopicParams>;
type ListTopicsQueryType = z.infer<typeof ListTopicsQuery>;

export async function topicsRoutes(app: TypedFastifyInstance): Promise<void> {
  // ── Get all topics ────────────────────────────────────────────────
  app.get(
    '/topics',
    {
      preHandler: app.requireAuth,
      schema: { querystring: ListTopicsQuery },
    },
    async (req, reply) => {
      const { page, limit, category, difficulty } = req.query as ListTopicsQueryType;
      const skip = (page - 1) * limit;
      const where: { category?: TopicCategory; difficulty?: TopicDifficulty } = {};
      if (category) where.category = category as TopicCategory;
      if (difficulty) where.difficulty = difficulty as TopicDifficulty;

      const [items, total] = await Promise.all([
        prisma.topic.findMany({ where, skip, take: limit, orderBy: { slug: 'asc' } }),
        prisma.topic.count({ where }),
      ]);
      return reply.send({ items, total, page, limit });
    }
  );

  // ── Get single topic ───────────────────────────────────────────────
  app.get(
    '/topics/:idOrSlug',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TopicParams,
      },
    },
    async (req, reply) => {
      const { idOrSlug } = req.params as TopicParamsType;

      const topic = await prisma.topic.findFirst({
        where: {
          OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        },
      });

      if (!topic) throw notFound('Тема не найдена');
      return reply.send(topic);
    }
  );
}
