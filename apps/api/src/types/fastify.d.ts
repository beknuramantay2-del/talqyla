import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@talqyla/db';

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
}

export type TypedFastifyInstance = FastifyInstance;

export type { FastifyRequest, FastifyReply };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser | null;
  }

  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    optionalAuth: (req: FastifyRequest) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (req: FastifyRequest) => Promise<void>;
  }
}
