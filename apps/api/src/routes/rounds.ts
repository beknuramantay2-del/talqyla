// Round routes — thin handlers, business logic lives in services/round.service.ts
import { z } from 'zod';
import { argumentSchema, paginationSchema } from '@talqyla/config';
import * as roundService from '../services/round.service.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const CreateRoundBody = z.object({
  topicId: z.string().min(1),
  stance: z.enum(['PRO', 'CON']),
  focusSkill: z.enum(['STRUCTURE', 'CONTENT', 'REFUTATION', 'LOGIC', 'DELIVERY']).optional(),
});

const SubmitTurnBody = z.object({
  text: z.string().min(1).max(2000),
  kind: z.enum(['OPENING', 'REBUTTAL', 'QUESTION', 'RESPONSE', 'CLOSING']).optional().default('RESPONSE'),
});

const ListRoundsQuery = z.object({
  page: paginationSchema.shape.page,
  limit: paginationSchema.shape.limit,
  status: z
    .enum(['SETUP', 'ARGUMENT_BUILT', 'IN_PROGRESS', 'AWAITING_JUDGE', 'JUDGING', 'COMPLETED', 'ABORTED'])
    .optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'exchangesDone']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

type CreateRoundBodyType = z.infer<typeof CreateRoundBody>;
type SubmitTurnBodyType = z.infer<typeof SubmitTurnBody>;
type ListRoundsQueryType = z.infer<typeof ListRoundsQuery>;

interface IdParams {
  id: string;
}

export async function roundRoutes(app: TypedFastifyInstance): Promise<void> {
  // ── Create ──────────────────────────────────────────────────────
  app.post(
    '/rounds',
    {
      preHandler: app.requireAuth,
      schema: { body: CreateRoundBody },
      config: { rateLimit: { max: 5, timeWindow: 60000 } }, // 5 rounds/min
    },
    async (req, reply) => {
      const { topicId, stance, focusSkill } = req.body as CreateRoundBodyType;
      const round = await roundService.createRound(req.user!.id, topicId, stance, focusSkill, req.log);
      return reply.code(201).send(round);
    },
  );

  // ── List ──────────────────────────────────────────────────────
  app.get(
    '/rounds',
    { preHandler: app.requireAuth, schema: { querystring: ListRoundsQuery } },
    async (req) => {
      const query = req.query as ListRoundsQueryType;
      return roundService.listRounds(req.user!.id, query);
    },
  );

  // ── Get single ──────────────────────────────────────────────────
  app.get<{ Params: IdParams }>(
    '/rounds/:id',
    { preHandler: [app.requireAuth, app.ownedRound] },
    async (req) => req.ownedRound,
  );

  // ── Submit argument ─────────────────────────────────────────────
  app.post<{ Params: IdParams }>(
    '/rounds/:id/argument',
    {
      preHandler: [app.requireAuth, app.ownedRound],
      schema: { body: argumentSchema },
      config: { rateLimit: { max: 10, timeWindow: 60000 } },
    },
    async (req, reply) => {
      const body = req.body as z.infer<typeof argumentSchema>;
      const result = await roundService.submitArgument(req.user!.id, req.params.id, body, req.log);
      return reply.code(result!.status === 'SETUP' ? 200 : 201).send(result);
    },
  );

  // ── Submit turn ─────────────────────────────────────────────────
  app.post<{ Params: IdParams }>(
    '/rounds/:id/turn',
    {
      preHandler: [app.requireAuth, app.ownedRound],
      schema: { body: SubmitTurnBody },
      config: { rateLimit: { max: 10, timeWindow: 60000 } }, // 10 turns/min
    },
    async (req) => {
      const { text, kind } = req.body as SubmitTurnBodyType;
      return roundService.submitTurn(req.user!.id, req.params.id, text, kind, req.log);
    },
  );

  // ── Judge ───────────────────────────────────────────────────────
  // The single most expensive call in the product. Rate-limited AND claimed
  // atomically in the service so a double-click cannot buy two evaluations.
  app.post<{ Params: IdParams }>(
    '/rounds/:id/judge',
    {
      preHandler: [app.requireAuth, app.ownedRound],
      config: { rateLimit: { max: 5, timeWindow: 60000 } },
    },
    async (req) => roundService.judgeRound(req.user!.id, req.params.id, req.log),
  );

  // ── Abort ───────────────────────────────────────────────────────
  app.patch<{ Params: IdParams }>(
    '/rounds/:id/abort',
    { preHandler: [app.requireAuth, app.ownedRound] },
    async (req) => roundService.abortRound(req.user!.id, req.params.id),
  );
}
