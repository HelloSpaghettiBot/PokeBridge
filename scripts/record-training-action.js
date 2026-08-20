import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [event, ...detailParts] = process.argv.slice(2);
if (!event) {
  console.error('Usage: node scripts/record-training-action.js EVENT [DETAIL ...]');
  process.exit(1);
}

const outputPath = resolve('captures/training-actions.jsonl');
const record = {
  timestamp: new Date().toISOString(),
  event,
  detail: detailParts.join(' ') || undefined,
};

await mkdir(dirname(outputPath), { recursive: true });
await appendFile(outputPath, `${JSON.stringify(record)}\n`);
console.log(JSON.stringify(record));
