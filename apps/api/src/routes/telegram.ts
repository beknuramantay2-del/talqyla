import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@talqyla/config';

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
    from?: { first_name?: string };
  };
};

const telegramApi = (method: string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

async function sendStartMessage(chatId: number, firstName?: string) {
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL || process.env.WEB_APP_URL;
  const replyMarkup = webAppUrl
    ? { inline_keyboard: [[{ text: 'Открыть Talqyla', web_app: { url: webAppUrl } }]] }
    : undefined;
  await fetch(telegramApi('sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `Привет${firstName ? `, ${firstName}` : ''}! Talqyla — тренажёр дебатов. Нажми кнопку ниже, чтобы начать.`,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function telegramRoutes(app: FastifyInstance) {
  app.post('/telegram/webhook', async (request, reply) => {
    if (!env.TELEGRAM_BOT_TOKEN) return reply.code(503).send({ ok: false, error: 'Telegram bot is not configured' });
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const received = String(request.headers['x-telegram-bot-api-secret-token'] || '');
      if (!safeEqual(received, env.TELEGRAM_WEBHOOK_SECRET)) return reply.code(401).send({ ok: false });
    }
    const update = request.body as TelegramUpdate;
    const chatId = update.message?.chat?.id;
    if (chatId && (update.message?.text === '/start' || update.message?.text?.startsWith('/start '))) {
      await sendStartMessage(chatId, update.message?.from?.first_name);
    }
    return { ok: true };
  });
}

export async function configureTelegramWebhook() {
  if (!env.TELEGRAM_BOT_TOKEN || env.NODE_ENV !== 'production') return;
  const webhookUrl = `${env.API_BASE_URL.replace(/\/$/, '')}/api/v1/telegram/webhook`;
  const body: Record<string, unknown> = { url: webhookUrl, allowed_updates: ['message'], drop_pending_updates: false };
  if (env.TELEGRAM_WEBHOOK_SECRET) body.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  const response = await fetch(telegramApi('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telegram setWebhook failed: ${response.status} ${await response.text()}`);
}
