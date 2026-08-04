#!/usr/bin/env node
/**
 * Talqyla smoke test.
 *
 * Гоняет основной путь пользователя против ЗАПУЩЕННОГО API по реальному HTTP.
 * Используется в CI и человеком после каждого деплоя.
 *
 * v2: основной путь — тренировочная сессия (роль → кейс-карта → речь → ballot).
 * Раунды v1 остались в проверке отдельным шагом, пока не перенесена история.
 *
 * Usage:
 *   pnpm smoke
 *   SMOKE_BASE_URL=https://staging-api.example.com/api/v1 pnpm smoke
 *   SMOKE_WITH_LLM=1 pnpm smoke      # включает платные шаги: кейс-карта и судья
 *
 * Exit code 0 = все шаги прошли. Ненулевой = первая поломка с телом ответа.
 *
 * Платные шаги ВЫКЛЮЧЕНЫ по умолчанию: гонять судью на каждый коммит значит
 * жечь баланс OpenRouter без дополнительного сигнала о том, что приложение
 * поднялось и база подключена.
 */

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const WITH_LLM = process.env.SMOKE_WITH_LLM === '1';

const state = {
  accessToken: null,
  refreshCookie: null,
  userEmail: `smoke+${Date.now()}@talqyla.test`,
  password: 'SmokeTest2026',
  sessionId: null,
  roundId: null,
};

let stepNumber = 0;

function pass(label, extra = '') {
  stepNumber += 1;
  console.log(`  ok  ${String(stepNumber).padStart(2, '0')}  ${label}${extra ? ` -> ${extra}` : ''}`);
}

function fail(label, detail) {
  console.error(`\nFAILED: ${label}\n${detail}\n`);
  process.exit(1);
}

/** Достаём cookie dt_refresh, если сервер её выставил. */
function captureRefreshCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

  for (const cookie of raw) {
    const match = /(?:^|;\s*)dt_refresh=([^;]*)/.exec(cookie);
    if (match) {
      // Пустое значение = сервер очистил cookie (logout).
      state.refreshCookie = match[1] === '' ? null : match[1];
    }
  }
}

async function call(method, path, { body, auth = false, cookie = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    if (!state.accessToken) fail(`${method} ${path}`, 'Нет access-токена: сломался более ранний шаг.');
    headers.authorization = `Bearer ${state.accessToken}`;
  }
  if (cookie && state.refreshCookie) headers.cookie = `dt_refresh=${state.refreshCookie}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    fail(`${method} ${path}`, `Запрос не дошёл: ${err.message}. API поднят на ${BASE}?`);
  }

  captureRefreshCookie(res);

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function expect(res, label, allowed) {
  const codes = Array.isArray(allowed) ? allowed : [allowed];
  if (!codes.includes(res.status)) {
    fail(label, `Ожидали HTTP ${codes.join(' или ')}, получили ${res.status}.\nТело: ${res.text.slice(0, 800)}`);
  }
  return res.json;
}

// Речь должна пройти минимальную длину из speechSchema (120 символов),
// иначе шаг упрётся в валидацию, а не в реальную логику.
const SPEECH_TEXT =
  'Уважаемые судьи, наша позиция состоит в том, что ограничение решает причину проблемы, а не её симптом. ' +
  'Во-первых, платформы намеренно проектируют вовлечение, и школа не может это компенсировать. ' +
  'Во-вторых, добровольные меры уже пробовали, и они не сработали. ' +
  'Поэтому регулирование эффективнее просветительских кампаний.';

async function main() {
  console.log(`\nTalqyla smoke test`);
  console.log(`  target : ${BASE}`);
  console.log(`  llm    : ${WITH_LLM ? 'ON (этот прогон тратит деньги)' : 'off (SMOKE_WITH_LLM=1 чтобы включить)'}\n`);

  // 1. Liveness.
  const health = await call('GET', '/health');
  const healthBody = expect(health, 'GET /health', 200);
  if (healthBody?.status !== 'ok') fail('GET /health', `Ожидали status "ok", получили ${JSON.stringify(healthBody)}`);
  pass('liveness');

  // 2. Readiness. Ловит непринятую миграцию или не поднявшийся Redis:
  //    процесс отвечает, а зависимости нет.
  const ready = await call('GET', '/health/ready');
  const readyBody = expect(ready, 'GET /health/ready', 200);
  if (readyBody?.checks?.db !== 'ok') fail('GET /health/ready', `Postgres не отвечает: ${JSON.stringify(readyBody)}`);
  if (readyBody?.checks?.redis !== 'ok') fail('GET /health/ready', `Redis не отвечает: ${JSON.stringify(readyBody)}`);
  pass('readiness', 'db ok, redis ok');

  // 3. Регистрация. Пользователи несовершеннолетние, поэтому API обязан
  //    отклонять signup без родительского email и согласия.
  const register = await call('POST', '/auth/register', {
    body: {
      email: state.userEmail,
      password: state.password,
      name: 'Smoke Test',
      parentEmail: `parent+${Date.now()}@talqyla.test`,
      parentalConsent: true,
    },
  });
  const registered = expect(register, 'POST /auth/register', 201);
  if (!registered?.accessToken) fail('POST /auth/register', 'В ответе нет accessToken.');
  if (!state.refreshCookie) fail('POST /auth/register', 'Не выставлена cookie dt_refresh: сессия не переживёт перезагрузку.');
  state.accessToken = registered.accessToken;
  pass('register', state.userEmail);

  // 4. Refresh. Эмуляция перезагрузки страницы: access-токен живёт только в
  //    памяти, поэтому вся сессия держится на этом вызове.
  const refresh = await call('POST', '/auth/refresh', { cookie: true, body: {} });
  const refreshed = expect(refresh, 'POST /auth/refresh', 200);
  if (!refreshed?.accessToken) fail('POST /auth/refresh', 'Токен не вернулся: перезагрузка выкинет ученика из аккаунта.');
  state.accessToken = refreshed.accessToken;
  pass('refresh after reload');

  // 5. Каталог тем. Пустой = seed не прогонялся.
  const topics = await call('GET', '/topics?limit=1', { auth: true });
  const topicPage = expect(topics, 'GET /topics', 200);
  const topic = topicPage?.items?.[0];
  if (!topic) fail('GET /topics', 'Каталог тем пуст. Прогони `pnpm db:seed` на этой базе.');
  pass('topics', `${topicPage.total} доступно`);

  // ── v2: основной путь продукта ──────────────────────────────────────

  // 6. Создание сессии. Роль подставляется по стороне: PRO -> PM.
  const createdSession = await call('POST', '/sessions', {
    auth: true,
    body: { topicId: topic.id, stance: 'PRO', mode: 'SPEECH' },
  });
  const session = expect(createdSession, 'POST /sessions', 201);
  if (!session?.id) fail('POST /sessions', `В ответе нет id сессии: ${JSON.stringify(session).slice(0, 400)}`);
  if (session.status !== 'PREP') fail('POST /sessions', `Ожидали статус PREP, получили ${session.status}.`);
  if (session.role !== 'PM') fail('POST /sessions', `Для стороны PRO роль должна быть PM, получили ${session.role}.`);
  state.sessionId = session.id;
  pass('create session', `${state.sessionId} (${session.role})`);

  // 7. Чтение сессии: страница /sessions/[id] держится на этом вызове.
  const fetched = await call('GET', `/sessions/${state.sessionId}`, { auth: true });
  const fetchedSession = expect(fetched, 'GET /sessions/:id', 200);
  if (fetchedSession?.id !== state.sessionId) fail('GET /sessions/:id', 'Вернулась не та сессия.');
  pass('read session');

  // 8. Список сессий с пагинацией: дашборд и история читают этот конверт.
  const list = await call('GET', '/sessions?limit=5', { auth: true });
  const listBody = expect(list, 'GET /sessions', 200);
  if (!Array.isArray(listBody?.items)) fail('GET /sessions', 'Нет массива items в ответе.');
  pass('list sessions', `${listBody.total} всего`);

  // 9. Дашборд. У нового пользователя он обязан отдавать пустое состояние,
  //    а не падать: это первый экран после регистрации.
  const dashboard = await call('GET', '/dashboard/stats', { auth: true });
  const stats = expect(dashboard, 'GET /dashboard/stats', 200);
  if (!Array.isArray(stats?.stats?.radarData)) fail('GET /dashboard/stats', 'Нет radarData в ответе.');
  if (stats.stats.radarData.length !== 5) {
    fail('GET /dashboard/stats', `Рубрика v2 состоит из 5 навыков, пришло ${stats.stats.radarData.length}.`);
  }
  pass('dashboard empty state', `${stats.stats.totalSessions} сессий`);

  // 10. Лига. Тоже должна работать на пустых данных.
  const league = await call('GET', '/dashboard/league', { auth: true });
  const leagueBody = expect(league, 'GET /dashboard/league', 200);
  if (!Array.isArray(leagueBody?.items)) fail('GET /dashboard/league', 'Нет массива items.');
  pass('league');

  // 11. Валидация речи. Слишком короткая речь обязана отбиваться 422:
  //     иначе судья будет платно оценивать два слова.
  const tooShort = await call('POST', `/sessions/${state.sessionId}/speech`, {
    auth: true,
    body: { text: 'Коротко.' },
  });
  if (tooShort.status !== 422) {
    fail('POST /sessions/:id/speech (короткая речь)', `Ожидали 422, получили ${tooShort.status}. Судья будет платить за мусор.`);
  }
  pass('speech validation rejects a stub', 'HTTP 422');

  if (WITH_LLM) {
    // 12a. Кейс-карта. Первый вызов на тему платный, дальше берётся из кеша.
    const firstCard = await call('GET', `/sessions/case?topicId=${topic.id}`, { auth: true });
    const card = expect(firstCard, 'GET /sessions/case', 200);
    if (!Array.isArray(card?.stakeholders)) fail('GET /sessions/case', 'В карте нет stakeholders.');
    pass('case card (LLM)', card.cached ? 'из кеша' : 'сгенерирована');

    // 12b. Второй запрос обязан прийти из кеша, иначе мы платим за каждого
    //      ученика на одной и той же теме.
    const secondCard = await call('GET', `/sessions/case?topicId=${topic.id}`, { auth: true });
    const cached = expect(secondCard, 'GET /sessions/case (повтор)', 200);
    if (cached?.cached !== true) {
      fail('GET /sessions/case (повтор)', 'Карта не закешировалась: каждый ученик будет стоить отдельный вызов модели.');
    }
    pass('case card cached', 'повторный вызов бесплатный');

    // 12c. Речь и ballot. Единственный обязательный платный вызов сессии.
    const speech = await call('POST', `/sessions/${state.sessionId}/speech`, {
      auth: true,
      body: { text: SPEECH_TEXT, durationSec: 190 },
    });
    const ballot = expect(speech, 'POST /sessions/:id/speech', [200, 201]);
    if (typeof ballot?.totalScore !== 'number') fail('POST /sessions/:id/speech', 'В ballot нет totalScore.');
    if (!ballot?.drill?.task) fail('POST /sessions/:id/speech', 'Судья не вернул дрилл: ученику нечего делать дальше.');
    pass('speech ballot (LLM)', `${ballot.totalScore}/${ballot.maxScore}, дрилл: ${ballot.drill.skill}`);

    // 12d. Повторная сдача не должна покупать второй ballot.
    const doubleSubmit = await call('POST', `/sessions/${state.sessionId}/speech`, {
      auth: true,
      body: { text: SPEECH_TEXT },
    });
    if (doubleSubmit.status < 400) {
      fail('POST /sessions/:id/speech (повтор)', 'Повторная сдача прошла: двойной клик покупает две оценки.');
    }
    pass('double submit blocked', `HTTP ${doubleSubmit.status}`);
  } else {
    // 12. Без LLM закрываем сессию, чтобы staging не копил зомби.
    const abort = await call('PATCH', `/sessions/${state.sessionId}/abort`, { auth: true });
    expect(abort, 'PATCH /sessions/:id/abort', [200, 201]);
    pass('abort session', 'платные шаги пропущены');
  }

  // ── Legacy v1: пока раунды живы, они тоже должны отвечать ───────────
  const legacyRound = await call('POST', '/rounds', {
    auth: true,
    body: { topicId: topic.id, stance: 'PRO', focusSkill: 'STRUCTURE' },
  });
  const round = expect(legacyRound, 'POST /rounds (legacy)', 201);
  state.roundId = round?.id;
  if (state.roundId) {
    const abortRound = await call('PATCH', `/rounds/${state.roundId}/abort`, { auth: true });
    expect(abortRound, 'PATCH /rounds/:id/abort', [200, 201]);
  }
  pass('legacy round endpoint alive');

  // Logout.
  const logout = await call('POST', '/auth/logout', { auth: true, cookie: true, body: {} });
  expect(logout, 'POST /auth/logout', 200);
  pass('logout');

  // Главная проверка после logout: отозванный refresh не должен воскрешать
  // сессию. captureRefreshCookie чистит наш jar, поэтому шлём сохранённое.
  if (state.refreshCookie) {
    const zombie = await call('POST', '/auth/refresh', { cookie: true, body: {} });
    if (zombie.status === 200) {
      fail('POST /auth/refresh после logout', 'Logout не отозвал refresh-токен: сессия вернулась с того света.');
    }
    pass('revoked session stays dead', `HTTP ${zombie.status}`);
  } else {
    pass('refresh cookie cleared on logout');
  }

  console.log(`\nВсе ${stepNumber} проверок пройдены.\n`);
}

main().catch((err) => {
  console.error(`\nSmoke test упал: ${err?.stack ?? err}\n`);
  process.exit(1);
});
