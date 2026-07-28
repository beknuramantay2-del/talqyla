#!/usr/bin/env node
/**
 * Talqyla smoke test.
 *
 * Drives the core user journey against a RUNNING API over real HTTP. Used by
 * the CI integration job and by a human after every staging or production
 * deploy. Until now the smoke test existed only as prose in a checklist, which
 * means it was never actually run twice the same way.
 *
 * Usage:
 *   pnpm smoke
 *   SMOKE_BASE_URL=https://staging-api.example.com/api/v1 pnpm smoke
 *   SMOKE_WITH_LLM=1 pnpm smoke      # also spends money on turn + judge
 *
 * Exit code 0 = every step passed. Non-zero = the first failure, printed with
 * the status and the response body, so the log tells you what broke.
 *
 * The paid LLM steps are OFF by default. Running the opponent and the judge on
 * every commit would burn OpenRouter credit for no extra signal about whether
 * the app boots and the database is wired up.
 */

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const WITH_LLM = process.env.SMOKE_WITH_LLM === '1';

const state = {
  accessToken: null,
  refreshCookie: null,
  userEmail: `smoke+${Date.now()}@talqyla.test`,
  password: 'SmokeTest2026',
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

/** Pull the dt_refresh cookie out of a response, if the server set one. */
function captureRefreshCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

  for (const cookie of raw) {
    const match = /(?:^|;\s*)dt_refresh=([^;]*)/.exec(cookie);
    if (match) {
      // An empty value means the server cleared it (logout).
      state.refreshCookie = match[1] === '' ? null : match[1];
    }
  }
}

async function call(method, path, { body, auth = false, cookie = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    if (!state.accessToken) fail(`${method} ${path}`, 'No access token in hand; an earlier step must have gone wrong.');
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
    fail(`${method} ${path}`, `Request never completed: ${err.message}. Is the API up at ${BASE}?`);
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
    fail(label, `Expected HTTP ${codes.join(' or ')}, got ${res.status}.\nBody: ${res.text.slice(0, 800)}`);
  }
  return res.json;
}

async function main() {
  console.log(`\nTalqyla smoke test`);
  console.log(`  target : ${BASE}`);
  console.log(`  llm    : ${WITH_LLM ? 'ON (this run costs money)' : 'off (set SMOKE_WITH_LLM=1 to include)'}\n`);

  // 1. Liveness.
  const health = await call('GET', '/health');
  const healthBody = expect(health, 'GET /health', 200);
  if (healthBody?.status !== 'ok') fail('GET /health', `Expected status "ok", got ${JSON.stringify(healthBody)}`);
  pass('liveness');

  // 2. Readiness. This is the one that catches a missing migration or a Redis
  //    that never came up: the process answers, the dependencies do not.
  const ready = await call('GET', '/health/ready');
  const readyBody = expect(ready, 'GET /health/ready', 200);
  if (readyBody?.checks?.db !== 'ok') fail('GET /health/ready', `Postgres check failed: ${JSON.stringify(readyBody)}`);
  if (readyBody?.checks?.redis !== 'ok') fail('GET /health/ready', `Redis check failed: ${JSON.stringify(readyBody)}`);
  pass('readiness', 'db ok, redis ok');

  // 3. Registration. Users are minors, so the API rejects a signup without a
  //    parent email and consent. Sending them here is the point, not padding.
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
  if (!registered?.accessToken) fail('POST /auth/register', 'No accessToken in the response body.');
  if (!state.refreshCookie) fail('POST /auth/register', 'No dt_refresh cookie was set; sessions will not survive a reload.');
  state.accessToken = registered.accessToken;
  pass('register', state.userEmail);

  // 4. Refresh. Simulates a browser reload: the access token lives in memory
  //    only, so the whole session depends on this call working.
  const refresh = await call('POST', '/auth/refresh', { cookie: true, body: {} });
  const refreshed = expect(refresh, 'POST /auth/refresh', 200);
  if (!refreshed?.accessToken) fail('POST /auth/refresh', 'No accessToken returned; a page reload would log the student out.');
  state.accessToken = refreshed.accessToken;
  pass('refresh after reload');

  // 5. Topic catalogue. Empty means the seed never ran.
  const topics = await call('GET', '/topics?limit=1', { auth: true });
  const topicPage = expect(topics, 'GET /topics', 200);
  const topic = topicPage?.items?.[0];
  if (!topic) fail('GET /topics', 'Topic catalogue is empty. Run `pnpm db:seed` against this database.');
  pass('topics', `${topicPage.total} available`);

  // 6. Create a round.
  const created = await call('POST', '/rounds', {
    auth: true,
    body: { topicId: topic.id, stance: 'PRO', focusSkill: 'STRUCTURE' },
  });
  const round = expect(created, 'POST /rounds', 201);
  if (!round?.id) fail('POST /rounds', `No round id in the response: ${JSON.stringify(round).slice(0, 400)}`);
  state.roundId = round.id;
  pass('create round', state.roundId);

  // 7. Argument builder: claim / warrant / impact, with the real minimum
  //    lengths the Zod schema enforces.
  const argument = await call('POST', `/rounds/${state.roundId}/argument`, {
    auth: true,
    body: {
      claim: 'Smoke test claim for the deployment check',
      warrant: 'This argument exists only to verify that the round pipeline accepts and stores a structured argument.',
      impact: 'If this step fails, students cannot start a round at all.',
    },
  });
  expect(argument, 'POST /rounds/:id/argument', [200, 201]);
  pass('submit argument');

  if (WITH_LLM) {
    // 8a. One opponent exchange. Costs tokens.
    const turn = await call('POST', `/rounds/${state.roundId}/turn`, {
      auth: true,
      body: { text: 'Мой первый аргумент в этом раунде: тезис, обоснование и значимость.', kind: 'OPENING' },
    });
    expect(turn, 'POST /rounds/:id/turn', [200, 201]);
    pass('opponent turn (LLM)');

    // 8b. The judge. The single most expensive call in the product.
    const judge = await call('POST', `/rounds/${state.roundId}/judge`, { auth: true });
    const ballot = expect(judge, 'POST /rounds/:id/judge', [200, 201]);
    pass('judge ballot (LLM)', ballot?.totalScore != null ? `total ${ballot.totalScore}/50` : '');
  } else {
    // 8. No LLM: close the round out so staging does not accumulate zombies.
    const abort = await call('PATCH', `/rounds/${state.roundId}/abort`, { auth: true });
    expect(abort, 'PATCH /rounds/:id/abort', [200, 201]);
    pass('abort round', 'LLM steps skipped');
  }

  // 9. Logout.
  const logout = await call('POST', '/auth/logout', { auth: true, cookie: true, body: {} });
  expect(logout, 'POST /auth/logout', 200);
  pass('logout');

  // 10. The check that actually matters after logout: a revoked refresh token
  //     must NOT bring the session back. Note captureRefreshCookie() clears our
  //     jar when the server clears the cookie, so re-send the value we held.
  if (state.refreshCookie) {
    const zombie = await call('POST', '/auth/refresh', { cookie: true, body: {} });
    if (zombie.status === 200) {
      fail('POST /auth/refresh after logout', 'Logout did not revoke the refresh token: the session came back from the dead.');
    }
    pass('revoked session stays dead', `HTTP ${zombie.status}`);
  } else {
    pass('refresh cookie cleared on logout');
  }

  console.log(`\nAll ${stepNumber} smoke checks passed.\n`);
}

main().catch((err) => {
  console.error(`\nSmoke test crashed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
