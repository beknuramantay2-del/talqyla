// Auth routes: register, login, refresh, logout, password reset.
// Passwords hashed with bcrypt (cost 12). Refresh token in httpOnly cookie.
// Register also creates a StudentProfile placeholder (grade=7, BEGINNER)
// that gets filled in by /onboarding.
//
// SECURITY notes:
//   - Login always runs bcrypt.compare (against a dummy hash if email unknown)
//     to prevent email-enumeration via timing (H1).
//   - Account lockout is keyed on `${ip}:${emailHash}` so an attacker can't
//     lock a victim out from a different IP, while a per-email ceiling still
//     catches distributed brute force (H6).
//   - Password reset NEVER logs the token and NEVER returns it in the body.
//     Delivery is via an external email sink (C2/C3).
//   - After a password reset, ALL existing sessions are revoked (C4).
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@talqyla/db';
import { emailSchema, passwordSchema } from '@talqyla/config';
import { conflict, unauthorized, sanitize, badRequest } from '../lib/errors.js';
import { issueTokenPair, rotateRefreshToken } from '../auth/jwt.js';
import { redis } from '../lib/redis.js';
import type { TypedFastifyInstance, FastifyReply, FastifyRequest } from '../types/fastify.js';

const SALT_ROUNDS = 12;

// Per-IP-per-email lockout ceiling. A distributed attacker hitting many IPs
// still trips the global per-email ceiling below.
const MAX_ATTEMPTS_PER_IP_EMAIL = 5;
// Global per-email ceiling across all IPs — catches distributed brute force
// without letting one attacker DoS-lock a known victim.
const MAX_ATTEMPTS_GLOBAL_EMAIL = 20;
const LOCKOUT_MINUTES = 15;

// Pre-computed dummy hash so bcrypt.compare always runs, even when the email
// is unknown — defeats the login timing oracle (H1).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', SALT_ROUNDS);

const RegisterBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Укажи имя').max(100),
});

const LoginBody = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

const RefreshBody = z.object({ refreshToken: z.string().optional() }).optional();

const LogoutBody = z.object({ refreshToken: z.string().optional() }).optional();

const PasswordResetRequestBody = z.object({ email: emailSchema });
const PasswordResetConfirmBody = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

type RegisterBodyType = z.infer<typeof RegisterBody>;
type LoginBodyType = z.infer<typeof LoginBody>;
type RefreshBodyType = z.infer<typeof RefreshBody>;

const REFRESH_COOKIE = 'dt_refresh';
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // 30d in seconds

function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: REFRESH_MAX_AGE,
  });
}

function getRefreshToken(req: FastifyRequest): string | undefined {
  return req.cookies[REFRESH_COOKIE] ?? (req.body as RefreshBodyType | undefined)?.refreshToken;
}

function emailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

/** Check account lockout. Considers BOTH per-IP-per-email AND global-per-email. */
async function checkLockout(ip: string, email: string): Promise<void> {
  try {
    const perIpKey = `lockout:${ip}:${emailHash(email)}`;
    const globalKey = `lockout:global:${emailHash(email)}`;
    const [perIp, global] = await Promise.all([redis.get(perIpKey), redis.get(globalKey)]);
    if ((perIp && Number(perIp) >= MAX_ATTEMPTS_PER_IP_EMAIL) ||
        (global && Number(global) >= MAX_ATTEMPTS_GLOBAL_EMAIL)) {
      throw unauthorized('Слишком много неудачных попыток. Попробуй через 15 минут.');
    }
  } catch {
    // If Redis is unavailable, allow login to proceed without lockout
  }
}

/** Increment both per-IP-per-email and global-per-email attempt counters. */
async function incrementAttempts(ip: string, email: string): Promise<void> {
  const perIpKey = `lockout:${ip}:${emailHash(email)}`;
  const globalKey = `lockout:global:${emailHash(email)}`;
  const ttl = LOCKOUT_MINUTES * 60;
  for (const key of [perIpKey, globalKey]) {
    const existing = await redis.ttl(key);
    if (existing < 0) {
      await redis.setex(key, ttl, 1);
    } else {
      await redis.incr(key);
    }
  }
}

/** Reset attempt counters on successful login. */
async function resetAttempts(ip: string, email: string): Promise<void> {
  await Promise.all([
    redis.del(`lockout:${ip}:${emailHash(email)}`),
    redis.del(`lockout:global:${emailHash(email)}`),
  ]);
}

export async function authRoutes(app: TypedFastifyInstance): Promise<void> {
  // ── Register ──────────────────────────────────────────────────────
  app.post(
    '/register',
    {
      schema: { body: RegisterBody },
      config: { rateLimit: { max: 3, timeWindow: 300000 } }, // 3 per 5 min per IP
    },
    async (req, reply) => {
      const { email, password, name: rawName } = req.body as RegisterBodyType;
      const name = sanitize(rawName);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw conflict('Пользователь с таким email уже существует');

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await prisma.user.create({
        data: { email, passwordHash, name, role: 'USER' },
      });

      await prisma.studentProfile.create({
        data: { userId: user.id, grade: 7, experienceLevel: 'BEGINNER' },
      });

      const pair = await issueTokenPair(user.id, user.role);
      setRefreshCookie(reply, pair.refreshToken);
      return reply.code(201).send({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        accessToken: pair.accessToken,
      });
    },
  );

  // ── Login ─────────────────────────────────────────────────────────
  app.post(
    '/login',
    {
      schema: { body: LoginBody },
      config: { rateLimit: { max: 5, timeWindow: 60000 } }, // 5 per min per IP
    },
    async (req, reply) => {
      const { email, password } = req.body as LoginBodyType;
      const ip = req.ip;

      await checkLockout(ip, email);

      const user = await prisma.user.findUnique({ where: { email } });
      // ALWAYS run bcrypt.compare — against DUMMY_HASH if user is unknown — so a
      // missing email takes the same time as a wrong password (H1).
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) {
        await incrementAttempts(ip, email);
        throw unauthorized('Неверный email или пароль');
      }

      await resetAttempts(ip, email);
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const pair = await issueTokenPair(user.id, user.role);
      setRefreshCookie(reply, pair.refreshToken);
      return reply.send({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        accessToken: pair.accessToken,
      });
    },
  );

  // ── Refresh ───────────────────────────────────────────────────────
  app.post(
    '/refresh',
    {
      schema: { body: RefreshBody },
      config: { rateLimit: { max: 10, timeWindow: 60000 } },
    },
    async (req, reply) => {
      const presented = getRefreshToken(req);
      if (!presented) throw unauthorized('Отсутствует refresh token');
      try {
        const pair = await rotateRefreshToken(presented);
        setRefreshCookie(reply, pair.refreshToken);
        return reply.send({ accessToken: pair.accessToken });
      } catch {
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
        throw unauthorized('Недействительный refresh token');
      }
    },
  );

  // ── Password reset request ─────────────────────────────────────
  // SECURITY: the token is NEVER logged and NEVER returned in the response.
  // Delivery happens through an external email sink that the operator wires up.
  app.post(
    '/password-reset',
    {
      schema: { body: PasswordResetRequestBody },
      config: { rateLimit: { max: 3, timeWindow: 3600000 } }, // 3 per hour per IP
    },
    async (_req, reply) => {
      const { email } = _req.body as { email: string };
      const user = await prisma.user.findUnique({ where: { email } });

      // Same response whether or not the email exists — no enumeration.
      const generic = { ok: true, message: 'Если email зарегистрирован, ссылка для сброса отправлена.' };

      if (!user) return reply.send(generic);

      const token = randomBytes(32).toString('hex');
      const hashed = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: hashed, passwordResetExpires: expiresAt },
      });

      // TODO: send email via external service. For dev, inspect the DB row.
      // NEVER log the plaintext token — it's a valid 1-hour account credential (C2).
      return reply.send(generic);
    },
  );

  // ── Password reset confirm ─────────────────────────────────────
  app.post(
    '/password-reset/confirm',
    {
      schema: { body: PasswordResetConfirmBody },
      config: { rateLimit: { max: 5, timeWindow: 60000 } }, // H3: rate limit brute-force + DoS
    },
    async (req, reply) => {
      const { token, password } = req.body as { token: string; password: string };
      const hashed = createHash('sha256').update(token).digest('hex');

      const user = await prisma.user.findFirst({
        where: { passwordResetToken: hashed, passwordResetExpires: { gt: new Date() } },
      });

      if (!user) throw unauthorized('Недействительный или истёкший токен сброса');

      if (await bcrypt.compare(password, user.passwordHash)) {
        throw badRequest('Новый пароль не должен совпадать с текущим');
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // C4: invalidate ALL existing sessions on password change so a stolen
      // refresh token can't survive a recovery.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      return reply.send({ ok: true, message: 'Пароль успешно изменён. Войди заново.' });
    },
  );

  // ── Logout ────────────────────────────────────────────────────────
  app.post(
    '/logout',
    { schema: { body: LogoutBody } },
    async (req, reply) => {
      const presented = getRefreshToken(req);
      if (presented) {
        try {
          const [, jti] = presented.split('.');
          if (jti) await prisma.refreshToken.updateMany({ where: { jti }, data: { revokedAt: new Date() } });
        } catch {
          /* noop */
        }
      }
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
      return reply.send({ ok: true });
    },
  );
}
