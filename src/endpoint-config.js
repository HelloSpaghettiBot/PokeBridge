import { readFile, writeFile } from 'node:fs/promises';

export function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function selectBridgeEndpoint(records, options = {}) {
  return selectBridgeEndpoints(records, { ...options, limit: 1 })[0] ?? null;
}

export function selectBridgeEndpoints(records, options = {}) {
  const candidates = records
    .filter((record) => record.RemoteAddress && Number.isInteger(Number(record.RemotePort)))
    .filter((record) => options.includeLocal || !isLocalAddress(record.RemoteAddress));

  const established = candidates.filter((record) => isEstablishedState(record.State));
  const pool = established.length > 0 ? established : candidates;
  if (pool.length === 0) return [];

  const byEndpoint = new Map();
  for (const record of pool.slice().sort((left, right) => Date.parse(left.timestamp ?? 0) - Date.parse(right.timestamp ?? 0))) {
    byEndpoint.set(`${record.RemoteAddress}:${Number(record.RemotePort)}`, record);
  }

  const endpoints = [...byEndpoint.values()]
    .slice()
    .sort((left, right) => {
      const portDelta = Number(left.RemotePort) - Number(right.RemotePort);
      if (portDelta !== 0) return portDelta;
      return String(left.RemoteAddress).localeCompare(String(right.RemoteAddress));
    });

  return options.limit ? endpoints.slice(0, options.limit) : endpoints;
}

export async function buildBridgeConfigFromCapture(inputPath, options = {}) {
  const records = parseJsonLines(await readFile(inputPath, 'utf8'));
  const endpoints = selectConfigEndpoints(selectBridgeEndpoints(records, options), options);
  if (endpoints.length === 0) {
    throw new Error(`no usable remote endpoint found in ${inputPath}`);
  }
  const routes = endpoints.map((endpoint) => ({
    listenHost: options.listenHost ?? '127.0.0.1',
    listenPort: options.listenPort ?? Number(endpoint.RemotePort),
    upstreamHost: endpoint.RemoteAddress,
    upstreamPort: Number(endpoint.RemotePort),
    capturePath: capturePathForEndpoint(options.capturePath ?? 'captures/bridge-session.jsonl', endpoint),
    captureMaxBytes: options.captureMaxBytes ?? 10485760,
    capturePayload: options.capturePayload ?? false,
    connectTimeoutMs: options.connectTimeoutMs ?? 10000,
    idleTimeoutMs: options.idleTimeoutMs ?? 300000,
    maxConnections: options.maxConnections ?? 100,
  }));

  addLoginRouteRewrites(routes, endpoints, options);

  if (routes.length > 1) return { routes };

  const [route] = routes;
  return route;
}

function addLoginRouteRewrites(routes, endpoints, options) {
  if (options.rewriteLoginIps === false) return;
  const rewriteTargets = unique(endpoints
    .map((endpoint) => String(endpoint.RemoteAddress))
    .filter((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address))
    .filter((address) => address !== '127.0.0.1'));
  const rewriteRules = rewriteTargets.map((address) => ({
    direction: 'upstream_to_client',
    fromHex: ipv4ToHex(address),
    toHex: '7f000001',
    description: `${address} -> 127.0.0.1`,
  }));

  for (const route of routes) {
    if (Number(route.listenPort) === 2106 && rewriteRules.length > 0) {
      route.rewriteRules = rewriteRules;
    }
  }
}

function selectConfigEndpoints(endpoints, options) {
  if (options.uniqueByPort === false) return endpoints;
  const byPort = new Map();
  for (const endpoint of endpoints) {
    const port = Number(endpoint.RemotePort);
    const current = byPort.get(port);
    if (!current || Date.parse(endpoint.timestamp ?? 0) >= Date.parse(current.timestamp ?? 0)) {
      byPort.set(port, endpoint);
    }
  }
  return [...byPort.values()].sort((left, right) => Number(left.RemotePort) - Number(right.RemotePort));
}

function isEstablishedState(state) {
  const normalized = String(state).toLowerCase();
  return normalized === 'established' || normalized === '5';
}

export async function writeBridgeConfigFromCapture(inputPath, outputPath, options = {}) {
  const config = await buildBridgeConfigFromCapture(inputPath, options);
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function isLocalAddress(address) {
  return [
    '0.0.0.0',
    '::',
    '127.0.0.1',
    '::1',
  ].includes(String(address).toLowerCase());
}

function capturePathForEndpoint(capturePath, endpoint) {
  if (!capturePath) return undefined;
  const index = capturePath.lastIndexOf('.');
  const suffix = `${endpoint.RemoteAddress}-${endpoint.RemotePort}`.replace(/[^A-Za-z0-9_-]/g, '_');
  if (index <= 0) return `${capturePath}-${suffix}`;
  return `${capturePath.slice(0, index)}-${suffix}${capturePath.slice(index)}`;
}

function ipv4ToHex(address) {
  return address
    .split('.')
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('');
}

function unique(values) {
  return [...new Set(values)];
}
