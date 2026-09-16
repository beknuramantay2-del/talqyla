import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fallbackMoveJudge, judgeUserMove, toLegacySignal, finalJudge, nextSkill, overall } from './judge/index.js';

const skills = ['Argumentation', 'Counterargumentation', 'Rebuttal', 'Structure'];
let progress = { Argumentation: 72, Counterargumentation: 61, Rebuttal: 68, Structure: 77 };
const sessions = new Map();
const topics = [
  ['Should schools ban the use of AI for homework?', 'Schools should not ban AI; they should teach responsible use.', 'Schools should ban AI because it weakens real learning.', 'If students can use AI to complete homework, how can teachers know they truly understood the material?'],
  ['Should teenagers have limits on social media?', 'Teenagers should manage social media with guidance, not strict limits.', 'Teenagers need firm limits because platforms are designed to capture attention.', 'If apps are built to keep teenagers scrolling, why should we assume self-control is enough?'],
];

function lastAi(session) {
  return [...session.messages].reverse().find((m) => m.speaker === 'ai')?.text || '';
}

function start() {
  const target = nextSkill(progress, 'Counterargumentation');
  const c = topics[Date.now() % 2];
  const now = new Date().toISOString();
  const s = {
    sessionId: randomUUID(),
    userId: 'telegram-dev-user',
    topic: c[0],
    userPosition: c[1],
    aiPosition: c[2],
    targetSkill: target,
    round: 1,
    maxRounds: 4,
    messages: [{ id: randomUUID(), speaker: 'ai', text: c[3], timestamp: now, round: 1 }],
    startedAt: now,
    status: 'active',
    judgeResults: [],
  };
  sessions.set(s.sessionId, s);
  console.log({ event: 'session_start', sessionId: s.sessionId, targetSkill: target, topic: s.topic });
  return s;
}

function opponentFromJudge(result, latestUser) {
  if (result.detectedWeakness.label === 'does_not_answer_core_objection') {
    return `You answered with a separate benefit, but that does not defeat my objection. Why does "${latestUser.slice(0, 80)}" prove the thing I actually asked?`;
  }
  if (result.opponentAttackStrategy === 'ask_for_reasoning') {
    return 'You made a claim, but you have not proven it. Why should I accept that this actually supports your position?';
  }
  return result.nextOpponentInstruction || 'Answer my exact objection before adding another benefit.';
}

function respond(id, text) {
  const s = sessions.get(id);
  if (!s) throw Error('Session not found');
  if (s.status !== 'active') throw Error('Session is not active');
  const clean = String(text || '').trim();
  if (!clean) throw Error('Empty user response');
  s.messages.push({ id: randomUUID(), speaker: 'user', text: clean, timestamp: new Date().toISOString(), round: s.round });
  console.log({ event: 'user_response', sessionId: id, round: s.round });
  const judged = judgeUserMove({
    targetSkill: s.targetSkill,
    round: s.round,
    topic: s.topic,
    userPosition: s.userPosition,
    latestAi: lastAi(s),
    latestUser: clean,
  });
  s.judgeResults.push(judged);
  s.lastJudgeSignal = toLegacySignal(judged);
  console.log({ event: 'judge_result', sessionId: id, skillScore: judged.skillScore, weakness: judged.detectedWeakness.label, quote: judged.detectedWeakness.quote });
  if (s.round >= s.maxRounds) {
    s.status = 'finished';
    s.finishedAt = new Date().toISOString();
    s.feedback = finalJudge(s, progress);
    progress = { ...s.feedback.scores };
    s.scores = s.feedback.scores;
    s.nextSkill = s.feedback.nextSkill;
    console.log({ event: 'final_score', sessionId: id, overallAfter: s.feedback.overallAfter, nextSkill: s.nextSkill });
    return s;
  }
  s.round += 1;
  const ai = opponentFromJudge(judged, clean);
  s.messages.push({ id: randomUUID(), speaker: 'ai', text: ai, timestamp: new Date().toISOString(), round: s.round });
  console.log({ event: 'ai_response', sessionId: id, round: s.round, strategy: judged.opponentAttackStrategy });
  return s;
}

export const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      let out;
      if (req.url === '/health') out = { ok: true, app: 'Talqyla' };
      else if (req.url === '/api/progress') out = { overall: overall(progress), skills: progress, deltaSinceLast: 6, recent: { score: 72, topic: 'Should social media be restricted for teenagers?', type: '1v1 AI Debate', when: '2 days ago' } };
      else if (req.url === '/api/debate/start') out = start();
      else if (req.url?.includes('/respond')) out = respond(req.url.split('/')[3], JSON.parse(body || '{}').text || '');
      else throw Error('Not found');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    } catch (e) {
      console.error({ event: 'error', message: e.message });
      res.statusCode = e.message === 'Session not found' ? 404 : 400;
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

if (process.argv[1]?.endsWith('app.ts') || process.argv[1]?.endsWith('app.js')) {
  server.listen(Number(process.env.PORT || 8787), () => console.log('Talqyla API listening'));
}
