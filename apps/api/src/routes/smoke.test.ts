import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('HTTP infrastructure smoke test', () => {
  describe('Security headers', () => {
    it('sets X-Frame-Options: DENY', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets Strict-Transport-Security with max-age 1 year', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    });

    it('sets X-Request-Id header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.headers['x-request-id']).toBeTruthy();
    });

    it('does not expose X-Powered-By', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('Error standardisation', () => {
    it('returns standard error shape on 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/nonexistent' });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('returns VALIDATION_ERROR on bad payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'bad' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns UNAUTHORIZED on protected route without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/topics' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('CORS', () => {
    it('returns CORS headers on OPTIONS preflight', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });
      expect(res.headers['access-control-allow-origin']).toBeDefined();
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Rate limiting headers', () => {
    it('returns rate-limit headers on auth routes', { timeout: 15000 }, async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'test@test.com', password: 'password123' },
      });
      expect(res.headers['x-ratelimit-limit']).toBe('5');
    });
  });
});
