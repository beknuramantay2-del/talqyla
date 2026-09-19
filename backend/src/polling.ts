import './app.js';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const hasPublicDomain = Boolean(process.env.PUBLIC_URL || process.env.API_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN);
const port = Number(process.env.PORT || 8787);
const localApi = `http://127.0.0.1:${port}`;
const chatSessions = new Map<number, string>();
let offset = 0;

const tg = (method: string) => 'https://api.telegram.org/bot' + token + '/' + method;

async function telegram(method: string, payload?: Record<string, unknown>) {
  const response = await fetch(tg(method), payload ? {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(35_000),
  } : { signal: AbortSignal.timeout(35_000) });
  const data = await response.json() as any;
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${response.status} ${JSON.stringify(data)}`);
  return data.result;
}

async function send(chatId: number, text: string) { await telegram('sendMessage', { chat_id: chatId, text }); }

async function startDebate(chatId: number) {
  const response = await fetch(`${localApi}/api/debate/start`, { method: 'POST' });
  const session = await response.json() as any;
  if (!response.ok) throw new Error(session.error || 'Cannot start debate');
  chatSessions.set(chatId, session.sessionId);
  const question = session.messages?.[session.messages.length - 1]?.text || '';
  await send(chatId, `Talqyla запущена!\n\nТема: ${session.topic}\nТвоя позиция: ${session.userPosition}\nНавык: ${session.targetSkill}\n\nВопрос оппонента:\n${question}\n\nОтветь одним сообщением.`);
}

async function handleMessage(message: any) {
  const chatId = message?.chat?.id;
  const text = String(message?.text || '').trim();
  if (!chatId || !text) return;
  if (text === '/start' || text === '/debate') return startDebate(chatId);
  const sessionId = chatSessions.get(chatId);
  if (!sessionId) return send(chatId, 'Напиши /start, чтобы начать тренировку.');
  const response = await fetch(`${localApi}/api/debate/${sessionId}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const session = await response.json() as any;
  if (!response.ok) { chatSessions.delete(chatId); return send(chatId, 'Сессия сброшена. Напиши /start ещё раз.'); }
  if (session.status === 'finished') {
    chatSessions.delete(chatId);
    const feedback = session.feedback || {};
    return send(chatId, `Сессия завершена.\n\nИтог: ${feedback.overallAfter ?? '—'}/100\nСледующий навык: ${session.nextSkill || '—'}\n\nСильные стороны:\n${(feedback.strengths || []).join('\n') || '—'}\n\nЧто улучшить:\n${(feedback.weaknesses || []).join('\n') || '—'}\n\nНапиши /start для новой тренировки.`);
  }
  const reply = session.messages?.[session.messages.length - 1]?.text || 'Продолжай аргумент.';
  await send(chatId, `Раунд ${session.round}/${session.maxRounds}\n\n${reply}`);
}

async function pollForever() {
  if (!token) { console.warn('TELEGRAM_BOT_TOKEN is not set; polling disabled'); return; }
  if (hasPublicDomain) { console.log('Public domain found; Telegram webhook mode is active'); return; }
  await new Promise(resolve => setTimeout(resolve, 1000));
  await telegram('deleteWebhook', { drop_pending_updates: false });
  console.log('Telegram long polling started');
  while (true) {
    try {
      const updates = await telegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates as any[]) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        try { await handleMessage(update.message); } catch (error) { console.error('Telegram update failed', error); }
      }
    } catch (error) {
      console.error('Telegram polling error', error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

void pollForever();
