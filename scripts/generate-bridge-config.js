import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { writeBridgeConfigFromCapture } from '../src/endpoint-config.js';

const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o', default: 'bridge.config.json' },
    'listen-host': { type: 'string' },
    'listen-port': { type: 'string' },
    capture: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage:
  node scripts/generate-bridge-config.js --input captures/client-connections.jsonl --output bridge.config.json

Options:
  -i, --input        Watcher JSONL capture path
  -o, --output       Bridge config path (default: bridge.config.json)
  --listen-host      Local bridge bind host (default: 127.0.0.1)
  --listen-port      Local bridge bind port (default: captured remote port; only use for a single endpoint)
  --capture          Bridge byte-capture path
  -h, --help         Show this help`);
  process.exit(0);
}

function integerOption(name) {
  const value = values[name];
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer`);
  return number;
}

try {
  if (!values.input) throw new TypeError('--input is required');
  const config = await writeBridgeConfigFromCapture(resolve(values.input), resolve(values.output), {
    listenHost: values['listen-host'],
    listenPort: integerOption('listen-port'),
    capturePath: values.capture,
  });
  const summary = Array.isArray(config.routes)
    ? config.routes.map((route) => `${route.listenHost}:${route.listenPort}->${route.upstreamHost}:${route.upstreamPort}`).join(', ')
    : `${config.listenHost}:${config.listenPort}->${config.upstreamHost}:${config.upstreamPort}`;
  console.log(`wrote ${resolve(values.output)} -> ${summary}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
