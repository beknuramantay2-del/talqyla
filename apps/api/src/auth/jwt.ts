import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { env } from '@talqyla/config';
import { prisma } from '@talqyla/db';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@talqyla/db';
const ISSUER = 'talqyla-api';
export interface AccessTokenPayload { sub: string; role: UserRole; type: 'access'; iss: typeof ISSUER; }
export interface TokenPair { accessToken: string; refreshToken: string; refreshExpiresAt: Date; }
const ACCESS_TTL_SECONDS = ttlToSeconds(env.JWT_ACCESS_TTL); const REFRESH_TTL_SECONDS = ttlToSeconds(env.JWT_REFRESH_TTL);
export function signAccessToken(userId: string, role: UserRole): string { return jwt.sign({ sub: userId, role, type: 'access', iss: ISSUER } satisfies AccessTokenPayload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SECONDS, algorithm: 'HS256' }); }
export function verifyAccessToken(token: string): AccessTokenPayload { const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER }); if (typeof payload === 'string' || payload.type !== 'access') throw new Error('invalid access token'); return payload as AccessTokenPayload; }
export async function issueTokenPair(userId: string, role: UserRole, family?: string): Promise<TokenPair> { return issueTokenPairWithClient(prisma, userId, role, family); }
async function issueTokenPairWithClient(client: any, userId: string, role: UserRole, family?: string): Promise<TokenPair> {
  const accessToken = signAccessToken(userId, role); const jti = nanoid(32); const fam = family ?? nanoid(32); const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000); const plaintext = `${fam}.${jti}`;
  await client.refreshToken.create({ data: { userId, jti, family: fam, hashed: hashToken(plaintext), expiresAt: refreshExpiresAt } }); await client.user.update({ where: { id: userId }, data: { refreshJti: jti } }); return { accessToken, refreshToken: plaintext, refreshExpiresAt };
}
export async function rotateRefreshToken(presented: string): Promise<TokenPair> {
  const [family, jti] = presented.split('.'); if (!family || !jti) throw new Error('malformed refresh token');
  const row = await prisma.refreshToken.findUnique({ where: { jti } }); if (!row || row.family !== family) throw new Error('unknown refresh token'); if (!safeEqualHash(row.hashed, presented)) throw new Error('refresh token mismatch');
  if (row.revokedAt) { await prisma.refreshToken.updateMany({ where: { family, revokedAt: null }, data: { revokedAt: new Date() } }); throw new Error('refresh token reuse detected — family revoked'); }
  if (row.expiresAt.getTime() < Date.now()) throw new Error('refresh token expired');
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({ where: { jti: row.jti, family: row.family, revokedAt: null }, data: { revokedAt: new Date() } }); if (claimed.count !== 1) throw new Error('refresh token already used');
    const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } }); const replacement = await issueTokenPairWithClient(tx, user.id, user.role, row.family); await tx.refreshToken.update({ where: { jti: row.jti }, data: { replacedBy: replacement.refreshToken.split('.')[1] } }); return replacement;
  });
}
export async function revokeAllForUser(userId: string): Promise<void> { await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }); await prisma.user.update({ where: { id: userId }, data: { refreshJti: null } }); }
function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function safeEqualHash(storedHex: string, presented: string): boolean { const a = Buffer.from(storedHex, 'utf8'); const b = Buffer.from(hashToken(presented), 'utf8'); return a.length === b.length && timingSafeEqual(a, b); }
function ttlToSeconds(ttl: string): number { const m = /^(\d+)([smhd])$/.exec(ttl.trim()); if (!m) throw new Error(`bad TTL: ${ttl}`); const n = Number(m[1]); return m[2] === 's' ? n : m[2] === 'm' ? n * 60 : m[2] === 'h' ? n * 3600 : n * 86400; }
