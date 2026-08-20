import { parseArgs } from 'node:util';
import { summarizeCaptures } from '../src/capture-summary.js';

const { values } = parseArgs({
  options: {
    captures: { type: 'string', default: 'captures' },
    ports: { type: 'string', default: '2106,7777,7780' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage:
  node scripts/summarize-captures.js [options]

Options:
  --captures DIR    Capture directory (default: captures)
  --ports LIST      Comma-separated game ports (default: 2106,7777,7780)
  -h, --help        Show this help`);
  process.exit(0);
}

const gamePorts = String(values.ports)
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value));

const summary = await summarizeCaptures({
  capturesDir: values.captures,
  gamePorts,
});

console.log(JSON.stringify(summary, null, 2));
