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
import { meRoutes } from './routes/me.js';

type TypedFastify = FastifyInstance;

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Keep child PII (email, name) and all credentials out of logs (M6).
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.passwordHash',
        '*.email',
        '*.name',
        '*.token',
        '*.resetToken',
        '*.refreshToken',
        '*.parentEmail',
      ],
    },
  }).withTypeProvider<ZodTypeProvider>();

  // Zod as the schema validator/compiler.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ── Request ID ──────────────────────────────────────────────────
  app.addHook('onRequest', async (req, reply) => {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.id = requestId;
    reply.header('X-Request-Id', requestId);
  });

  // ── Security & infra plugins ────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    hidePoweredBy: true,
  });
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });
  await app.register(cookie, { secret: env.JWT_ACCESS_SECRET });
  await app.register(rateLimit, {
    global: false, // We define per-route limits instead
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    ...(env.NODE_ENV !== 'test' ? { redis: redis as never } : {}),
    // Bucket per SESSION, not per IP. A whole school behind one NAT used to
    // share a single bucket, while one student on mobile could reset theirs by
    // switching networks. The rate-limit hook runs before auth, so we key on a
    // hash of the bearer token rather than a resolved user id.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      const subject =
        auth && auth.startsWith('Bearer ')
          ? `s:${createHash('sha256').update(auth.slice(7).trim()).digest('hex').slice(0, 24)}`
          : `ip:${req.ip}`;
      return `${subject}:${req.routeOptions.url ?? req.url}`;
    },
    hook: 'onRequest',
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // ── OpenAPI docs ────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: { title: 'ДебатоТренер API', version: '0.1.0' },
      servers: [{ url: env.API_BASE_URL }],
    },
  });
  // H7: Swagger UI must not be exposed in production — it maps the attack surface.
  if (env.NODE_ENV !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // ── App-scoped decorations ──────────────────────────────────────
  await registerAuthPlugins(app);
  registerOwnershipGuards(app);
  registerErrorHandler(app);

  // ── Routes (all under /api/v1) ──────────────────────────────────
  await app.register(
    async (api: TypedFastify) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(meRoutes);
      await api.register(onboardingRoutes);
      await api.register(topicsRoutes);
      await api.register(dashboardRoutes);
      await api.register(voiceRoutes);
      await api.register(roundRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
