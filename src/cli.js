import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBridge } from './bridge.js';
import { normalizeBridgeConfig } from './config.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    'listen-host': { type: 'string' },
    'listen-port': { type: 'string' },
    'upstream-host': { type: 'string' },
    'upstream-port': { type: 'string' },
    capture: { type: 'string' },
    'capture-max-bytes': { type: 'string' },
    'capture-payload': { type: 'boolean' },
    'connect-timeout-ms': { type: 'string' },
    'idle-timeout-ms': { type: 'string' },
    'max-connections': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage:
  node src/cli.js --listen-port PORT --upstream-host HOST --upstream-port PORT [options]
  node src/cli.js --config bridge.config.json [overrides]

Options:
  --config PATH        Load JSON config
  --listen-host HOST   Local bind address (default: 127.0.0.1)
  --capture PATH       Append timestamped TCP chunks as JSONL
  --capture-max-bytes  Rotate JSONL capture files after this many bytes
  --capture-payload    Include full payload hex in captures
  --connect-timeout-ms Upstream connect timeout (default: 10000)
  --idle-timeout-ms    Close idle established connections after this many ms
  --max-connections    Active connection cap (default: 100)
  -h, --help           Show this help`);
  process.exit(0);
}

async function loadConfig(path) {
  if (!path) return {};
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

try {
  const fileConfig = await loadConfig(values.config);
  const config = {
    ...fileConfig,
    listenHost: values['listen-host'] ?? fileConfig.listenHost ?? '127.0.0.1',
    listenPort: values['listen-port'] ?? fileConfig.listenPort,
    upstreamHost: values['upstream-host'] ?? fileConfig.upstreamHost,
    upstreamPort: values['upstream-port'] ?? fileConfig.upstreamPort,
    capturePath: values.capture ?? fileConfig.capturePath,
    captureMaxBytes: values['capture-max-bytes'] ?? fileConfig.captureMaxBytes,
    capturePayload: values['capture-payload'] ?? fileConfig.capturePayload,
    connectTimeoutMs: values['connect-timeout-ms'] ?? fileConfig.connectTimeoutMs,
    idleTimeoutMs: values['idle-timeout-ms'] ?? fileConfig.idleTimeoutMs,
    maxConnections: values['max-connections'] ?? fileConfig.maxConnections,
  };

  const routes = normalizeBridgeConfig(config);
  const bridges = [];
  for (const route of routes) {
    bridges.push(await createBridge({
      ...route,
      capturePath: route.capturePath && resolve(route.capturePath),
    }));
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('shutting down');
    await Promise.allSettled(bridges.map((bridge) => bridge.close()));
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
