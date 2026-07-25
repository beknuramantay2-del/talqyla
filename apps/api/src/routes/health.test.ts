// Tests for health and auth routes
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

describe('GET /api/v1/health', () => {
  it('returns 200 with ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /api/v1/auth/register', () => {
  it('returns 422 on invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'password123', name: 'Test' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 on weak password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'test@example.com', password: 'short', name: 'Test' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 on empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'test@example.com', password: 'password123', name: '' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns 422 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-email' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /api/v1/topics (requires auth)', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/topics' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/v1/dashboard/stats (requires auth)', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard/stats' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/rounds (requires auth)', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rounds',
      payload: { topicId: '123', stance: 'PRO' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/rounds (requires auth)', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/rounds' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /api/v1/rounds/:id/abort (requires auth)', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/rounds/some-id/abort',
    });
    expect(res.statusCode).toBe(401);
  });
});
