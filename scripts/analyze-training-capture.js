import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyzeCapture } from '../src/headless/capture-analysis.js';

const { values } = parseArgs({
  options: {
    capture: { type: 'string', default: 'captures/recorded-session-20260721-1123/training-game-7777.jsonl' },
    from: { type: 'string' },
    to: { type: 'string' },
    'bucket-ms': { type: 'string', default: '1000' },
    'window-ms': { type: 'string', default: '3000' },
    event: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/analyze-training-capture.js [options]

Options:
  --capture PATH          Payload JSONL capture
  --from ISO              Start timestamp
  --to ISO                End timestamp
  --bucket-ms N           Timeline bucket size
  --window-ms N           Half-width around each event
  --event LABEL=ISO       Repeatable labelled event timestamp
  --out PATH              Write JSON analysis to a file
  -h, --help              Show this help`);
  process.exit(0);
}

const events = values.event.map((value) => {
  const separator = value.indexOf('=');
  if (separator < 1) throw new TypeError(`Invalid --event value: ${value}`);
  const label = value.slice(0, separator);
  const timeMs = Date.parse(value.slice(separator + 1));
  if (!Number.isFinite(timeMs)) throw new TypeError(`Invalid --event timestamp: ${value}`);
  return { label, timeMs };
});

const result = await analyzeCapture(values.capture, {
  from: values.from,
  to: values.to,
  bucketMs: Number(values['bucket-ms']),
  eventWindowMs: Number(values['window-ms']),
  events,
});

const output = `${JSON.stringify(result, null, 2)}\n`;
if (values.out) {
  const outputPath = resolve(values.out);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  console.log(outputPath);
} else {
  console.log(output);
}
