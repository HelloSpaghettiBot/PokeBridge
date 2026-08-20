import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { WorldGraph } from '../src/navigation/world-graph.js';

const [graphArg, fromMap, fromX, fromY, toMap, toX, toY, direction = '0'] = process.argv.slice(2);
if (!toY) throw new Error('graph fromMap fromX fromY toMap toX toY [direction]');
const graphPath = path.resolve(graphArg);
let serialized = {};
try { serialized = JSON.parse(await readFile(graphPath, 'utf8')); } catch {}
const graph = new WorldGraph(serialized);
const observation = graph.observeStep(
  { map: fromMap, name: '', x: Number(fromX), y: Number(fromY), direction: Number(direction) },
  Number(direction),
  { map: toMap, name: '', x: Number(toX), y: Number(toY), direction: Number(direction) },
);
await writeFile(graphPath, `${JSON.stringify(graph.toJSON(), null, 2)}\n`);
process.stdout.write(`${JSON.stringify(observation)}\n`);
