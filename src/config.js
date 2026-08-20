import { extname, join, dirname, basename } from 'node:path';

export function normalizeBridgeConfig(config) {
  const routes = Array.isArray(config.routes) ? config.routes : [config];
  if (routes.length === 0) throw new TypeError('config must define at least one route');

  const seen = new Set();
  return routes.map((route, index) => {
    const normalized = {
      listenHost: route.listenHost ?? config.listenHost ?? '127.0.0.1',
      listenPort: numberValue(route.listenPort ?? config.listenPort, 'listenPort'),
      upstreamHost: route.upstreamHost,
      upstreamPort: numberValue(route.upstreamPort, 'upstreamPort'),
      capturePath: route.capturePath ?? capturePathForRoute(config.capturePath, route, index),
      captureMaxBytes: numberValue(route.captureMaxBytes ?? config.captureMaxBytes ?? 0, 'captureMaxBytes'),
      capturePayload: route.capturePayload ?? config.capturePayload ?? true,
      rewriteRules: route.rewriteRules ?? config.rewriteRules ?? [],
      connectTimeoutMs: numberValue(route.connectTimeoutMs ?? config.connectTimeoutMs ?? 10000, 'connectTimeoutMs'),
      idleTimeoutMs: numberValue(route.idleTimeoutMs ?? config.idleTimeoutMs ?? 0, 'idleTimeoutMs'),
      maxConnections: numberValue(route.maxConnections ?? config.maxConnections ?? 100, 'maxConnections'),
    };

    if (!normalized.upstreamHost) throw new TypeError(`routes[${index}].upstreamHost is required`);
    const listenKey = `${normalized.listenHost}:${normalized.listenPort}`;
    if (seen.has(listenKey)) throw new TypeError(`duplicate listen route: ${listenKey}`);
    seen.add(listenKey);
    return normalized;
  });
}

export function numberValue(value, name, defaultValue) {
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new TypeError(`${name} is required`);
  }
  const number = Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer`);
  return number;
}

function capturePathForRoute(capturePath, route, index) {
  if (!capturePath) return undefined;
  const extension = extname(capturePath);
  const stem = basename(capturePath, extension);
  return join(dirname(capturePath), `${stem}-${route.listenPort ?? index}${extension}`);
}
