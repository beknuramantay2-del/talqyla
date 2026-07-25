// Prisma client singleton for the ДебатоТренер monorepo.
// Importing from here guarantees one client per Node process in dev
// (avoids exhausting connections during Next.js HMR / Fastify reloads).

import { PrismaClient } from '@talqyla/prisma-client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? // keep PII out of logs: only warnings/errors, never query args.
          [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }]
        : [{ level: 'error', emit: 'stdout' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@talqyla/prisma-client';
