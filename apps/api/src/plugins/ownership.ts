// Ownership guard — reusable preHandler that checks if a resource belongs to the user.
// Usage:
//   app.get('/rounds/:id', { preHandler: [app.requireAuth, app.ownedRound] }, handler);
//   The owned round is available as req.ownedRound.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@talqyla/db';
import { notFound } from '../lib/errors.js';
import type { AuthUser } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    ownedRound?: Awaited<ReturnType<typeof prisma.debateRound.findFirst>>;
  }

  interface FastifyInstance {
    ownedRound: (req: FastifyRequest) => Promise<void>;
  }
}

export function registerOwnershipGuards(app: FastifyInstance): void {
  app.decorate('ownedRound', async (req: FastifyRequest) => {
    const { id } = req.params as { id?: string };
    if (!id) throw notFound();

    const user = req.user as AuthUser | undefined;
    if (!user) throw notFound();

    const round = await prisma.debateRound.findFirst({
      where: { id, userId: user.id },
    });

    if (!round) throw notFound('Раунд не найден');
    req.ownedRound = round;
  });
}
