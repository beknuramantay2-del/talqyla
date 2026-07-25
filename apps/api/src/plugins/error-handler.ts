// Global error handler + Zod validation response formatter.
// Every route can `throw new ApiError(...)` or `throw badRequest(...)`
// and the client always gets the same shape.
import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';
import { captureError } from '../lib/sentry.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    // 1. Zod schema validation (manual parses inside handlers) → 422 with field details.
    if (err instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Ошибка валидации',
          details: formatZod(err),
        },
      });
    }

    // 2. Fastify schema validation errors (from fastify-type-provider-zod)
    if ('validation' in err && Array.isArray(err.validation)) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Ошибка валидации',
          details: formatZod(err.validation as unknown as ZodError),
        },
      });
    }

    // 3. Our own ApiError.
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }

    // 4. Errors with explicit status codes (rate limit, body parser, etc.)
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: { code: 'REQUEST_ERROR', message: err.message },
      });
    }

    // 5. Unknown — never leak internals.
    captureError(err, { req: { url: req.url, method: req.method } });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' },
    });
  });

  // 404 for unmatched routes (default Fastify message is JSON but not our shape).
  app.setNotFoundHandler((req, reply) => {
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Маршрут не найден: ${req.method} ${req.url}` },
    });
  });
}

function formatZod(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
}
