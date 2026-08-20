import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createSocksBridge } from '../src/socks-bridge.js';

const { values } = parseArgs({
  options: {
    'listen-host': { type: 'string', default: '127.0.0.1' },
    'listen-port': { type: 'string', default: '1080' },
    capture: { type: 'string', default: 'captures/socks-session.jsonl' },
    'capture-max-bytes': { type: 'string', default: '10485760' },
    'capture-payload': { type: 'boolean', default: false },
    'connect-timeout-ms': { type: 'string', default: '10000' },
    'idle-timeout-ms': { type: 'string', default: '300000' },
    'max-connections': { type: 'string', default: '100' },
    'allowed-ports': { type: 'string', default: '80,443,2106,7777,7780' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage:
  node scripts/socks-cli.js [options]

Options:
  --listen-host HOST      Local bind host (default: 127.0.0.1)
  --listen-port PORT      SOCKS5 port (default: 1080)
  --capture PATH          JSONL capture path
  --capture-payload       Include full payload hex in captures
  --allowed-ports LIST    Comma-separated upstream ports (default: 80,443,2106,7777,7780)
  -h, --help              Show this help`);
  process.exit(0);
}

function integer(name) {
  const number = Number(values[name]);
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer`);
  return number;
}

try {
  const allowedPorts = String(values['allowed-ports'])
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number);

  const bridge = await createSocksBridge({
    listenHost: values['listen-host'],
    listenPort: integer('listen-port'),
    capturePath: values.capture && resolve(values.capture),
    captureMaxBytes: integer('capture-max-bytes'),
    capturePayload: values['capture-payload'],
    connectTimeoutMs: integer('connect-timeout-ms'),
    idleTimeoutMs: integer('idle-timeout-ms'),
    maxConnections: integer('max-connections'),
    allowedPorts,
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('shutting down socks bridge');
    await bridge.close();
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
