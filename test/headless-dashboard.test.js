import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDashboardServer } from '../src/headless/dashboard-server.js';
import { HeadlessState } from '../src/headless/headless-state.js';

test('dashboard serves state under /pokemmo and has no external telemetry ingest', async () => {
  const state = new HeadlessState();
  const runtime = { state, submitCredentials: async () => {}, submitMfa: async () => {}, setActivity: value => state.patch({ activity: value }) };
  const server = createDashboardServer({ runtime, host: '127.0.0.1', basePath: '/pokemmo', token: 'test-token' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/pokemmo/api/state`)).status, 401);
    const response = await fetch(`${origin}/pokemmo/api/state`, { headers: { authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).login.state, 'signed_out');
    const telemetry = await fetch(`${origin}/pokemmo/api/telemetry`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ player: { money: 960 } }) });
    assert.equal(telemetry.status, 404);
    assert.equal(state.value.player.money, null);
  } finally { server.close(); }
});

test('non-loopback dashboard requires an access token', () => {
  assert.throws(() => createDashboardServer({ runtime: {}, host: '0.0.0.0', token: '' }), /TOKEN/);
});

test('persistent view password grants a reusable dashboard cookie', async t => {
  const state = new HeadlessState();
  const runtime = { state };
  const server = createDashboardServer({
    runtime,
    host: '127.0.0.1',
    basePath: '/pokemmo',
    token: 'test-token',
    viewPassword: 'Loldeedle',
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const access = await fetch(`${origin}/pokemmo/access`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=Loldeedle',
  });
  assert.equal(access.status, 303);
  const cookie = access.headers.get('set-cookie').split(';')[0];
  const stateResponse = await fetch(`${origin}/pokemmo/api/state`, { headers: { cookie } });
  assert.equal(stateResponse.status, 200);
  const reused = await fetch(`${origin}/pokemmo/access`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=Loldeedle',
  });
  assert.equal(reused.status, 303);
});
