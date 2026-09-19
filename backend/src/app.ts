import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { finalJudge, nextSkill, overall, judgeUserMove, toLegacySignal } from './judge/index.js';

let progress: Record<string, number> = { Argumentation: 72, Counterargumentation: 61, Rebuttal: 68, Structure: 77 };
const sessions = new Map<string, any>();
const telegramSessions = new Map<number, string>();
const topics = [
  ['Should schools ban the use of AI for homework?', 'Schools should not ban AI; they should teach responsible use.', 'Schools should ban AI because it weakens real learning.', 'If students can use AI to complete homework, how can teachers know they truly understood the material?'],
  ['Should teenagers have limits on social media?', 'Teenagers should manage social media with guidance, not strict limits.', 'Teenagers need firm limits because platforms are designed to capture attention.', 'If apps are built to keep teenagers scrolling, why should we assume self-control is enough?'],
];

function lastAi(session: any): string {
  return [...session.messages].reverse().find((m: any) => m.speaker === 'ai')?.text || '';
}

function start() {
  const target = nextSkill(progress, 'Counterargumentation');
  const c = topics[Date.now() % topics.length]!;
  const now = new Date().toISOString();
  const s: any = {
    sessionId: randomUUID(), userId: 'telegram-user', topic: c[0], userPosition: c[1], aiPosition: c[2],
    targetSkill: target, round: 1, maxRounds: 4,
    messages: [{ id: randomUUID(), speaker: 'ai', text: c[3], timestamp: now, round: 1 }],
    startedAt: now, status: 'active', judgeResults: [],
  };
  sessions.set(s.sessionId, s);
  return s;
}

function opponentFromJudge(result: any, latestUser: string): string {
  if (result.detectedWeakness?.label === 'does_not_answer_core_objection') return `Ты дал отдельную выгоду, но не снял возражение. Почему фраза «${latestUser.slice(0, 80)}» отвечает именно на мой вопрос?`;
  if (result.opponentAttackStrategy === 'ask_for_reasoning') return 'Ты сделал заявление, но не доказал его. Почему это действительно поддерживает твою позицию?';
  return result.nextOpponentInstruction || 'Ответь на моё точное возражение, прежде чем добавлять новый аргумент.';
}

function respond(id: string, text: string) {
  const s = sessions.get(id);
  if (!s) throw Error('Session not found');
  if (s.status !== 'active') throw Error('Session is not active');
  const clean = String(text || '').trim();
  if (!clean) throw Error('Empty user response');
  s.messages.push({ id: randomUUID(), speaker: 'user', text: clean, timestamp: new Date().toISOString(), round: s.round });
  const judged = judgeUserMove({ targetSkill: s.targetSkill, round: s.round, topic: s.topic, userPosition: s.userPosition, latestAi: lastAi(s), latestUser: clean });
  s.judgeResults.push(judged);
  s.lastJudgeSignal = toLegacySignal(judged);
  if (s.round >= s.maxRounds) {
    s.status = 'finished';
    s.finishedAt = new Date().toISOString();
    s.feedback = finalJudge(s, progress);
    progress = { ...s.feedback.scores };
    s.scores = s.feedback.scores;
    s.nextSkill = s.feedback.nextSkill;
    return s;
  }
  s.round += 1;
  const ai = opponentFromJudge(judged, clean);
  s.messages.push({ id: randomUUID(), speaker: 'ai', text: ai, timestamp: new Date().toISOString(), round: s.round });
  return s;
}

const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const telegramApi = (method: string) => 'https://api.telegram.org/bot' + botToken + '/' + method;

function secureEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

async function sendTelegram(chatId: number, text: string) {
  if (!botToken) return;
  const response = await fetch(telegramApi('sendMessage'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) console.error('Telegram sendMessage failed', response.status, await response.text());
}

async function handleTelegram(update: any) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || '').trim();
  if (!chatId || !text) return;
  if (text === '/start' || text === '/debate') {
    const session = start(); telegramSessions.set(chatId, session.sessionId);
    await sendTelegram(chatId, `Talqyla запущена!\n\nТема: ${session.topic}\nТвоя позиция: ${session.userPosition}\nНавык: ${session.targetSkill}\n\nВопрос оппонента:\n${lastAi(session)}\n\nОтветь одним сообщением.`);
    return;
  }
  const sessionId = telegramSessions.get(chatId);
  if (!sessionId) { await sendTelegram(chatId, 'Напиши /start, чтобы начать тренировку.'); return; }
  const session = respond(sessionId, text);
  if (session.status === 'finished') {
    const f = session.feedback;
    await sendTelegram(chatId, `Сессия завершена.\n\nИтог: ${f.overallAfter ?? overall(session.scores || progress)}/100\nСледующий навык: ${session.nextSkill}\n\nСильные стороны:\n${(f.strengths || []).join('\n') || '—'}\n\nЧто улучшить:\n${(f.weaknesses || []).join('\n') || '—'}\n\nНапиши /start для новой тренировки.`);
    telegramSessions.delete(chatId);
  } else {
    await sendTelegram(chatId, `Раунд ${session.round}/${session.maxRounds}\n\n${lastAi(session)}`);
  }
}

async function configureWebhook() {
  if (!botToken) { console.warn('TELEGRAM_BOT_TOKEN is not set; HTTP API works, Telegram bot disabled'); return; }
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const baseUrl = process.env.PUBLIC_URL || process.env.API_BASE_URL || (domain ? 'https://' + domain : '');
  if (!baseUrl) { console.warn('No public domain found; Telegram webhook was not configured'); return; }
  const payload: Record<string, unknown> = { url: baseUrl.replace(/\/$/, '') + '/telegram/webhook', allowed_updates: ['message'] };
  if (webhookSecret) payload.secret_token = webhookSecret;
  const response = await fetch(telegramApi('setWebhook'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Telegram setWebhook failed: ${response.status} ${await response.text()}`);
  console.log('Telegram webhook configured');
}

export const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-telegram-bot-api-secret-token');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      if (req.url === '/telegram/webhook' && req.method === 'POST') {
        if (webhookSecret && !secureEqual(String(req.headers['x-telegram-bot-api-secret-token'] || ''), webhookSecret)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false })); }
        await handleTelegram(JSON.parse(body || '{}')); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true }));
      }
      let out: any;
      if (req.url === '/health') out = { ok: true, app: 'Talqyla', mode: 'standalone' };
      else if (req.url === '/api/progress') out = { overall: overall(progress), skills: progress };
      else if (req.url === '/api/debate/start') out = start();
      else if (req.url?.includes('/respond')) out = respond(req.url.split('/')[3]!, JSON.parse(body || '{}').text || '');
      else { res.statusCode = 404; throw Error('Not found'); }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
    } catch (e: any) { console.error({ event: 'error', message: e.message }); if (res.statusCode < 400) res.statusCode = e.message === 'Session not found' ? 404 : 400; res.end(JSON.stringify({ error: e.message })); }
  });
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '0.0.0.0', () => { console.log(`Talqyla standalone API listening on ${port}`); void configureWebhook().catch((e) => console.error(e)); });
