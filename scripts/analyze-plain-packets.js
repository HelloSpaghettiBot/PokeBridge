import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseJavapOpcodeMap,
  parsePlainPacketJsonl,
  summarizePlainPackets,
} from '../src/headless/plain-packet-analysis.js';

const args = new Map(process.argv.slice(2).map((value, index, values) => [
  value.replace(/^--/, ''),
  values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : true,
]));
const capturePath = resolve(String(args.get('capture') ?? 'captures/decrypted-gameplay-live.jsonl'));
const mapPath = resolve(String(args.get('map') ?? 'analysis/Mw1.javap.txt'));
const outputPath = args.get('out') ? resolve(String(args.get('out'))) : null;
const records = parsePlainPacketJsonl(await readFile(capturePath, 'utf8'));
const opcodeMap = parseJavapOpcodeMap(await readFile(mapPath, 'utf8'));
const summary = summarizePlainPackets(records, { opcodeMap });
const json = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, json);
process.stdout.write(json);
