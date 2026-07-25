// Health check. Two endpoints:
//   GET /api/v1/health      — liveness (always 200 if process is up)
//   GET /api/v1/health/ready — readiness (checks DB + Redis)
import type { FastifyInstance } from 'fastify';
import { prisma } from '@talqyla/db';
import { redis } from '../lib/redis.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    let ok = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch {
      checks.db = 'fail';
      ok = false;
    }
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
      ok = false;
    }
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', checks });
  });
}
