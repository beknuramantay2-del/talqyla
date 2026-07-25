import * as Sentry from '@sentry/node';
import { env } from '@talqyla/config';

export function initSentry(): void {
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    enabled: env.NODE_ENV === 'production',
    integrations: [Sentry.requestDataIntegration()],
  });
}

export function captureError(error: unknown, hint?: { req?: Record<string, unknown> }): void {
  if (!env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (hint?.req) {
      scope.setExtra('request_url', hint.req.url);
      scope.setExtra('request_method', hint.req.method);
    }
    Sentry.captureException(error);
  });
}

export async function closeSentry(): Promise<void> {
  if (!env.SENTRY_DSN) return;
  await Sentry.close(2000);
}
