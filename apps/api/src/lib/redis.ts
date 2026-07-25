// Shared Redis client for rate limiting and refresh-token family bookkeeping.
import Redis from 'ioredis';
import { env } from '@talqyla/config';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: () => (env.NODE_ENV === 'test' ? null : undefined),
  });

// Suppress unhandled error events in test mode (Redis not available)
if (env.NODE_ENV === 'test') {
  redis.on('error', () => {});
}

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
