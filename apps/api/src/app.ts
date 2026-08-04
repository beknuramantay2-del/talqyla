import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from '@talqyla/config';
import { redis } from './lib/redis.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerAuthPlugins } from './plugins/auth.js';
import { registerOwnershipGuards } from './plugins/ownership.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { topicsRoutes } from './routes/topics.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { voiceRoutes } from './routes/voice.js';
import { roundRoutes } from './routes/rounds.js';
import { sessionRoutes } from './routes/sessions.js';
import { meRoutes } from './routes/me.js';

type TypedFastify = FastifyInstance;

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization','req.headers.cookie','*.password','*.passwordHash','*.email','*.name','*.token','*.resetToken','*.refreshToken','*.parentEmail'],
    },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (req, reply) => { const requestId = (req.headers['x-request-id'] as string) ?? randomUUID(); req.id = requestId; reply.header('X-Request-Id', requestId); });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'", ...env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean), env.API_BASE_URL], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'none'"], objectSrc: ["'none'"] } },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, xFrameOptions: { action: 'deny' }, xContentTypeOptions: true, hidePoweredBy: true,
  });
  await app.register(cors, { origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true });
  await app.register(cookie, { secret: env.JWT_ACCESS_SECRET });
  await app.register(rateLimit, { global: false, max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS, ...(env.NODE_ENV !== 'test' ? { redis: redis as never } : {}), keyGenerator: (req) => { const auth = req.headers.authorization; const subject = auth && auth.startsWith('Bearer ') ? `s:${createHash('sha256').update(auth.slice(7).trim()).digest('hex').slice(0, 24)}` : `ip:${req.ip}`; return `${subject}:${req.routeOptions.url ?? req.url}`; }, hook: 'onRequest', addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true }, addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true } });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(swagger, { openapi: { info: { title: 'Talqyla API', version: '0.2.0' }, servers: [{ url: env.API_BASE_URL }] } });
  if (env.NODE_ENV !== 'production') await app.register(swaggerUi, { routePrefix: '/docs' });
  await registerAuthPlugins(app); registerOwnershipGuards(app); registerErrorHandler(app);
  await app.register(async (api: TypedFastify) => {
    await api.register(healthRoutes);
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(meRoutes);
    await api.register(onboardingRoutes);
    await api.register(topicsRoutes);
    await api.register(dashboardRoutes);
    await api.register(voiceRoutes);
    // v2: тренировочные сессии.
    await api.register(sessionRoutes);
    // Legacy v1: раунды из трёх обменов. Живут, пока не перенесена история.
    await api.register(roundRoutes);
  }, { prefix: '/api/v1' });
  return app;
}
