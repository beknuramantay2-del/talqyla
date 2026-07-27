// Entry point — builds the app and listens.
import { buildApp } from './app.js';
import { env } from '@talqyla/config';
import { prisma } from '@talqyla/db';
import { redis } from './lib/redis.js';
import { initSentry, closeSentry } from './lib/sentry.js';
import { purgeExpiredData } from './jobs/retention.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function start() {
  initSentry();

  const app = await buildApp();

  // ── Data-retention purge (single-instance deployments) ────────────
  // For multi-instance, leave RETENTION_JOB_ENABLED off and run
  // `pnpm retention:purge` from cron so the job does not run N times.
  let retentionTimer: NodeJS.Timeout | null = null;
  if (env.RETENTION_JOB_ENABLED) {
    const runPurge = async () => {
      try {
        const result = await purgeExpiredData();
        app.log.info({ event: 'retention_purge', ...result }, 'Очистка по политике хранения выполнена');
      } catch (err) {
        app.log.error(err, 'Очистка по политике хранения упала');
      }
    };
    void runPurge();
    retentionTimer = setInterval(runPurge, ONE_DAY_MS);
    retentionTimer.unref();
  }

  // ── Graceful Shutdown ─────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.warn(`Received ${signal}. Starting graceful shutdown...`);

    const timeout = setTimeout(() => {
      app.log.error('Graceful shutdown timed out. Forcing process exit.');
      process.exit(1);
    }, 10000);

    try {
      if (retentionTimer) clearInterval(retentionTimer);
      await app.close();
      await prisma.$disconnect();
      await redis.quit();
      await closeSentry();

      clearTimeout(timeout);
      app.log.warn('Graceful shutdown completed successfully.');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error occurred during graceful shutdown.');
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
    app.log.info(`ДебатоТренер API listening on http://0.0.0.0:${env.API_PORT}`);
    if (env.NODE_ENV !== 'production') {
      app.log.info(`Swagger UI at ${env.API_BASE_URL}/docs`);
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
