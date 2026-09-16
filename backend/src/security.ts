import crypto from 'node:crypto';
import { telegramConfig } from './config.js';

export function validateTelegramInitData(initData: string): boolean {
  if (!telegramConfig.botToken) return true; // local development fallback
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(telegramConfig.botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash));
}
