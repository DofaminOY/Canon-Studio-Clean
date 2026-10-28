import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPairingManager, isLocalBrowserRequest } from '../src/agent/pairing.js';
import { createServer } from '../src/http/router.js';

const SITE = 'https://canon-studio-clean.vercel.app';

test('PIN has five-minute lifetime, single use, and exact allowed origin', () => {
  const old = process.env.CANON_STUDIO_ALLOWED_ORIGIN;
  process.env.CANON_STUDIO_ALLOWED_ORIGIN = SITE;
  try {
    let time = 1000;
    const manager = createPairingManager({ now: () => time, pinGenerator: () => '12345678' });
    assert.equal(manager.pair(SITE, '12345678').status, 403); // No PIN issued
    assert.equal(manager.issuePin().code, '12345678');
    assert.equal(manager.pair('https://evil.example', '12345678').status, 403);
    const result = manager.pair(SITE, '12345678');
    assert.equal(result.ok, true);
    assert.equal(manager.authorized(SITE, result.token), true);
    assert.equal(manager.authorized('https://evil.example', result.token), false);
    assert.equal(manager.pair(SITE, '12345678').status, 403);
    time += 12 * 60 * 60_000 + 1;
    assert.equal(manager.authorized(SITE, result.token), false);
    assert.equal(manager.issuePin().code, '12345678');
    time += 5 * 60_000 + 1;
    assert.equal(manager.pair(SITE, '12345678').status, 403);
  } finally {
    if (old === undefined) delete process.env.CANON_STUDIO_ALLOWED_ORIGIN;
    else process.env.CANON_STUDIO_ALLOWED_ORIGIN = old;
  }
});

test('rate limit protects pairing code from repeated guesses', () => {
  const old = process.env.CANON_STUDIO_ALLOWED_ORIGIN;
  process.env.CANON_STUDIO_ALLOWED_ORIGIN = SITE;
  try {
    let now = 0;
    const manager = createPairingManager({ now: () => now, pinGenerator: () => '87654321' });
    manager.issuePin();
    for (let i = 0; i < 4; i++) assert.equal(manager.pair(SITE, '11111111').status, 403);
    assert.equal(manager.pair(SITE, '11111111').status, 429);
    assert.equal(manager.pair(SITE, '87654321').status, 429);
    now += 5 * 60_000 + 1;
    manager.issuePin();
    assert.equal(manager.pair(SITE, '87654321').ok, true);
  } finally {
    if (old === undefined) delete process.env.CANON_STUDIO_ALLOWED_ORIGIN;
    else process.env.CANON_STUDIO_ALLOWED_ORIGIN = old;
  }
});

test('cross-site browser request cannot read code even without Origin header', () => {
  assert.equal(isLocalBrowserRequest({ headers: { host: '127.0.0.1:3177', 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(isLocalBrowserRequest({ headers: { host: '127.0.0.1:3177', 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isLocalBrowserRequest({ headers: { host: '127.0.0.1:3177', origin: SITE } }), false);
});

test('HTTP: Vercel must pair before reading config, discovering or printing', async () => {
  const old = process.env.CANON_STUDIO_ALLOWED_ORIGIN;
  process.env.CANON_STUDIO_ALLOWED_ORIGIN = SITE;
  const server = createServer();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const options = { headers: { Origin: SITE } };
    let res = await fetch(base + '/api/health', options);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), SITE);
    res = await fetch(base + '/api/config', options);
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/discovery', options);
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/pairing/code', options);
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/pairing/code', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/pairing/code');
    assert.equal(res.status, 200);
    const { code } = await res.json();
    assert.match(code, /^\d{8}$/);
    res = await fetch(base + '/api/pairing', {
      method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '00000000' }),
    });
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/pairing', {
      method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    assert.equal(res.status, 200);
    const { token } = await res.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    res = await fetch(base + '/api/config', { headers: { Origin: SITE, 'X-Canon-Token': token } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).token, undefined); // Never reveal local master token
    res = await fetch(base + '/api/tasks', { headers: { Origin: SITE, 'X-Canon-Token': token } });
    assert.equal(res.status, 200);
    res = await fetch(base + '/api/print', { method: 'POST', headers: { Origin: SITE }, body: 'x' });
    assert.equal(res.status, 403);
    res = await fetch(base + '/api/config', { headers: { Origin: 'https://evil.example', 'X-Canon-Token': token } });
    assert.equal(res.status, 403);
    const localConfig = await (await fetch(base + '/api/config')).json();
    res = await fetch(base + '/api/pairing/revoke', {
      method: 'POST', headers: { 'X-Canon-Token': localConfig.token },
    });
    assert.equal(res.status, 200);
    res = await fetch(base + '/api/config', { headers: { Origin: SITE, 'X-Canon-Token': token } });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (old === undefined) delete process.env.CANON_STUDIO_ALLOWED_ORIGIN;
    else process.env.CANON_STUDIO_ALLOWED_ORIGIN = old;
  }
});
