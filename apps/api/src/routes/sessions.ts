// Роуты тренировочных сессий (v2). Тонкие обработчики, логика в сервисе.
import { z } from 'zod';
import { blitzAnswerSchema, paginationSchema, speechSchema } from '@talqyla/config';
import * as sessionService from '../services/session.service.js';
import type { TypedFastifyInstance } from '../types/fastify.js';

const CreateSessionBody = z.object({
  topicId: z.string().min(1),
  stance: z.enum(['PRO', 'CON']),
  mode: z.enum(['SPEECH', 'BLITZ', 'CASE']).optional().default('SPEECH'),
  role: z.enum(['PM', 'LO', 'DPM', 'DLO', 'MG', 'MO', 'GW', 'OW']).optional(),
});

const ListSessionsQuery = z.object({
  page: paginationSchema.shape.page,
  limit: paginationSchema.shape.limit,
  mode: z.enum(['SPEECH', 'BLITZ', 'CASE']).optional(),
  status: z.enum(['PREP', 'SPEAKING', 'SCORING', 'COMPLETED', 'ABORTED']).optional(),
});

const SpeechBody = z.object({
  text: speechSchema,
  durationSec: z.coerce.number().int().min(1).max(900).optional(),
  poiAnswer: z.string().trim().max(1200).optional(),
});

// Блиц — та же механика, но ответ на 30 секунд. Отдельная схема, иначе минимум
// в 120 символов не даст сдать короткий ответ.
const BlitzBody = z.object({
  text: blitzAnswerSchema,
  durationSec: z.coerce.number().int().min(1).max(300).optional(),
});

const PoiBody = z.object({ speechSoFar: z.string().trim().min(40).max(4000) });
const CaseQuery = z.object({ topicId: z.string().min(1) });

interface IdParams {
  id: string;
}

export async function sessionRoutes(app: TypedFastifyInstance): Promise<void> {
  // Кейс-карта по теме. Кешируется на тему, поэтому лимит мягкий.
  app.get(
    '/sessions/case',
    { preHandler: app.requireAuth, schema: { querystring: CaseQuery }, config: { rateLimit: { max: 20, timeWindow: 60000 } } },
    async (req) => {
      const { topicId } = req.query as z.infer<typeof CaseQuery>;
      return sessionService.getOrCreateCaseCard(req.user!.id, topicId, req.log);
    },
  );

  app.post(
    '/sessions',
    { preHandler: app.requireAuth, schema: { body: CreateSessionBody }, config: { rateLimit: { max: 10, timeWindow: 60000 } } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof CreateSessionBody>;
      const session = await sessionService.createSession(req.user!.id, body as never, req.log);
      return reply.code(201).send(session);
    },
  );

  app.get(
    '/sessions',
    { preHandler: app.requireAuth, schema: { querystring: ListSessionsQuery } },
    async (req) => sessionService.listSessions(req.user!.id, req.query as never),
  );

  app.get<{ Params: IdParams }>(
    '/sessions/:id',
    { preHandler: app.requireAuth },
    async (req) => sessionService.getSession(req.user!.id, req.params.id),
  );

  // POI: одна короткая реплика оппонента по ходу речи.
  app.post<{ Params: IdParams }>(
    '/sessions/:id/poi',
    { preHandler: app.requireAuth, schema: { body: PoiBody }, config: { rateLimit: { max: 10, timeWindow: 60000 } } },
    async (req) => {
      const { speechSoFar } = req.body as z.infer<typeof PoiBody>;
      return sessionService.requestPoi(req.user!.id, req.params.id, speechSoFar, req.log);
    },
  );

  // Речь сдана: судья считает ballot. Самый дорогой вызов продукта, поэтому
  // и жёсткий лимит, и атомарная заявка в сервисе против двойного клика.
  app.post<{ Params: IdParams }>(
    '/sessions/:id/speech',
    { preHandler: app.requireAuth, schema: { body: SpeechBody }, config: { rateLimit: { max: 6, timeWindow: 60000 } } },
    async (req) => {
      const body = req.body as z.infer<typeof SpeechBody>;
      return sessionService.submitSpeech(req.user!.id, req.params.id, body, req.log);
    },
  );

  app.post<{ Params: IdParams }>(
    '/sessions/:id/blitz',
    { preHandler: app.requireAuth, schema: { body: BlitzBody }, config: { rateLimit: { max: 12, timeWindow: 60000 } } },
    async (req) => {
      const body = req.body as z.infer<typeof BlitzBody>;
      return sessionService.submitSpeech(req.user!.id, req.params.id, body, req.log);
    },
  );

  app.patch<{ Params: IdParams }>(
    '/sessions/:id/abort',
    { preHandler: app.requireAuth },
    async (req) => sessionService.abortSession(req.user!.id, req.params.id),
  );
}
