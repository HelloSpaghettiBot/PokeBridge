import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { dashboardPage } from './dashboard-page.js';

export function createDashboardServer(options) {
  const runtime = options.runtime;
  const basePath = normalizeBase(options.basePath ?? '/pokemmo');
  const token = String(options.token ?? '');
  const host = options.host ?? '127.0.0.1';
  if (!token && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('POKEMMO_DASHBOARD_TOKEN is required for a non-loopback dashboard');
  const page = dashboardPage(basePath);
  const viewPassword = String(options.viewPassword ?? '');
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      if (!url.pathname.startsWith(basePath)) return send(response, 404, 'Not found');
      const route = url.pathname.slice(basePath.length) || '/';
      if (request.method === 'GET' && route === '/access') {
        return send(response, 200, accessPage(basePath), 'text/html; charset=utf-8');
      }
      if (request.method === 'POST' && route === '/access') {
        const body = await readForm(request);
        if (!viewPassword || !sameSecret(body.password, viewPassword)) {
          return send(response, 401, 'Dashboard password is incorrect.');
        }
        response.setHeader('Set-Cookie', dashboardCookie(token, basePath));
        response.writeHead(303, { location: `${basePath}/` });
        return response.end();
      }
      if (token && url.searchParams.get('token') === token) {
        response.setHeader('Set-Cookie', dashboardCookie(token, basePath));
        response.writeHead(302, { location: basePath }); return response.end();
      }
      if (token && !authorized(request, token)) return send(response, 401, 'Dashboard token required');
      if (request.method === 'GET' && route === '/') return send(response, 200, page, 'text/html; charset=utf-8');
      if (request.method === 'GET' && route === '/api/state') return json(response, 200, runtime.state.snapshot());
      if (request.method === 'POST' && route === '/api/login') {
        const body = await readJson(request); requireText(body.username, 'username'); requireText(body.password, 'password');
        await runtime.submitCredentials(body.username, body.password); return json(response, 200, runtime.state.snapshot().login);
      }
      if (request.method === 'POST' && route === '/api/mfa') {
        const body = await readJson(request); requireText(body.code, 'code'); await runtime.submitMfa(body.code); return json(response, 200, runtime.state.snapshot().login);
      }
      if (request.method === 'POST' && route === '/api/activity') {
        const body = await readJson(request); await runtime.setActivity({ ...runtime.state.value.activity, ...body }); return json(response, 200, runtime.state.snapshot().activity);
      }
      return send(response, 404, 'Not found');
    } catch (error) { return json(response, 400, { error: error.message }); }
  });
}

function authorized(request, token) {
  if (request.headers.authorization === `Bearer ${token}`) return true;
  return String(request.headers.cookie ?? '').split(';').some(value => decodeURIComponent(value.trim()) === `pokemmo_token=${token}`);
}
function sameSecret(provided, expected) {
  const left = Buffer.from(String(provided ?? ''), 'utf8');
  const right = Buffer.from(String(expected), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
function dashboardCookie(token, basePath) {
  return `pokemmo_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${basePath}; Secure; Max-Age=31536000`;
}
function normalizeBase(value) { const base = `/${String(value).replace(/^\/+|\/+$/g, '')}`; return base === '/' ? '' : base; }
function requireText(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); }
function send(response, status, body, type = 'text/plain; charset=utf-8') { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(body); }
function json(response, status, value) { send(response, status, JSON.stringify(value), 'application/json; charset=utf-8'); }
async function readJson(request, limit = 64 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw new Error('Request body too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function readForm(request, limit = 4096) {
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw new Error('Request body too large'); chunks.push(chunk); }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

function accessPage(basePath) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PokeMMO dashboard access</title><style>body{margin:0;background:#100817;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(88vw,360px);background:#23112f;padding:24px;border-radius:18px}h1{margin-top:0}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border-radius:10px;border:1px solid #6d4a7e;font-size:18px}button{background:#8a42c2;color:#fff;font-weight:700}</style></head><body><form class="card" method="post" action="${basePath}/access"><h1>Dashboard access</h1><p>Enter the dashboard password.</p><input name="password" type="password" autocomplete="current-password" required><button type="submit">Open dashboard</button></form></body></html>`;
}
