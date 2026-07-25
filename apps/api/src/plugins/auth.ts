// Auth guard plugins.
//   `requireAuth`      — any authenticated user.
//   `requireRole(...)` — authenticated AND one of the given roles.
//   `optionalAuth`     — populate user if token present, otherwise null.
//
// Tokens come from the Authorization header (`Bearer <access>`).
// Refresh tokens live only in httpOnly cookies set by /auth/* routes.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@talqyla/db';
import type { UserRole } from '@talqyla/db';
import { verifyAccessToken } from '../auth/jwt.js';
import { ApiError } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser | null;
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

async function resolveUser(req: FastifyRequest): Promise<AuthUser | null> {
  const token = extractBearer(req);
  if (!token) return null;
  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, email: true },
    });
    return user ?? null;
  } catch {
    return null;
  }
}

export async function registerAuthPlugins(app: FastifyInstance): Promise<void> {
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    const user = await resolveUser(req);
    if (!user) throw ApiError.unauthorized();
    req.user = user;
  });

  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    req.user = await resolveUser(req);
  });

  app.decorate('requireRole', (...roles: UserRole[]) => {
    return async (req: FastifyRequest) => {
      const user = await resolveUser(req);
      if (!user) throw ApiError.unauthorized();
      if (!roles.includes(user.role)) throw ApiError.forbidden('Недостаточно прав');
      req.user = user;
    };
  });
}
