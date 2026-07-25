// JWT helpers: short-lived access tokens + rotating refresh tokens (DB-backed).
// Access token  → signed JWT, stateless, 15m, carries userId + role.
// Refresh token → opaque random string; only its hash is stored in refresh_tokens.
//   On use we rotate (issue new, revoke old). If a revoked token is reused, the
//   whole family is revoked → detects theft (RFC 6749 §10.4 pattern).
//
// SECURITY: the family id is created ONCE per credential (login/register) and
// PRESERVED across every rotation in the chain. This is what makes reuse
// detection work: a stolen token rotated by the attacker stays in the same
// family as the victim's token, so reuse revokes BOTH.

import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { env } from '@talqyla/config';
import { prisma } from '@talqyla/db';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@talqyla/db';

const ISSUER = 'talqyla-api';

export interface AccessTokenPayload {
  sub: string; // userId
  role: UserRole;
  type: 'access';
  iss: typeof ISSUER;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const ACCESS_TTL_SECONDS = ttlToSeconds(env.JWT_ACCESS_TTL);
const REFRESH_TTL_SECONDS = ttlToSeconds(env.JWT_REFRESH_TTL);

export function signAccessToken(userId: string, role: UserRole): string {
  return jwt.sign(
    { sub: userId, role, type: 'access', iss: ISSUER } satisfies AccessTokenPayload,
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: ACCESS_TTL_SECONDS,
      algorithm: 'HS256',
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
  });
  if (typeof payload === 'string' || payload.type !== 'access') {
    throw new Error('invalid access token');
  }
  return payload as AccessTokenPayload;
}

/**
 * Issue a fresh token pair and persist the refresh-token row.
 *
 * @param family If provided (rotation), the replacement inherits this family.
 *               If omitted (login/register), a NEW family is created.
 */
export async function issueTokenPair(
  userId: string,
  role: UserRole,
  family?: string,
): Promise<TokenPair> {
  const accessToken = signAccessToken(userId, role);
  const jti = nanoid(32);
  const fam = family ?? nanoid(32);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  const plaintext = `${fam}.${jti}`;
  await prisma.refreshToken.create({
    data: {
      userId,
      jti,
      family: fam,
      hashed: hashToken(plaintext),
      expiresAt: refreshExpiresAt,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { refreshJti: jti } });

  return { accessToken, refreshToken: plaintext, refreshExpiresAt };
}

/**
 * Rotate a refresh token. Returns a new pair, or throws on reuse/expiry.
 *
 * Reuse detection: if the presented token's row is already revoked, the entire
 * family is revoked (theft assumption — an attacker is using a stale token
 * while the legitimate user already rotated past it).
 *
 * SECURITY: the replacement inherits `row.family`, so the whole chain lives in
 * ONE family. A stolen token rotated by the attacker therefore stays in the
 * same family as the victim's tokens, and any later reuse kills everything.
 */
export async function rotateRefreshToken(presented: string): Promise<TokenPair> {
  const [family, jti] = presented.split('.');
  if (!family || !jti) throw new Error('malformed refresh token');

  const row = await prisma.refreshToken.findUnique({ where: { jti } });
  if (!row || row.family !== family) throw new Error('unknown refresh token');
  if (!safeEqualHash(row.hashed, presented)) throw new Error('refresh token mismatch');

  // Reuse → revoke whole family.
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new Error('refresh token reuse detected — family revoked');
  }
  if (row.expiresAt.getTime() < Date.now()) throw new Error('refresh token expired');

  const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });

  // Create the replacement IN THE SAME FAMILY, then revoke the old one.
  const replacement = await issueTokenPair(user.id, user.role, row.family);
  await prisma.refreshToken.update({
    where: { jti: row.jti },
    data: { revokedAt: new Date(), replacedBy: replacement.refreshToken.split('.')[1] },
  });
  return replacement;
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.user.update({ where: { id: userId }, data: { refreshJti: null } });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of the stored hash vs the presented token's hash. */
function safeEqualHash(storedHex: string, presented: string): boolean {
  const presentedHash = hashToken(presented);
  const a = Buffer.from(storedHex, 'utf8');
  const b = Buffer.from(presentedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) throw new Error(`bad TTL: ${ttl}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      throw new Error(`bad TTL unit: ${m[2]}`);
  }
}
