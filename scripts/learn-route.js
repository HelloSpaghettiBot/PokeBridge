import { readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { WorldGraph } from '../src/navigation/world-graph.js';
import { parseWorldState } from '../src/navigation/world-state.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const summaryPath = path.resolve(option('summary', ''));
const graphPath = path.resolve(option('graph', 'captures/world-graph.json'));
const segmentIndexes = String(option('segments', '')).split(',').filter(Boolean).map(Number);
const port = Number(option('port', '37666'));
const cadenceMs = Number(option('cadence-ms', '420'));
if (!summaryPath || !segmentIndexes.length) throw new Error('Use --summary <file> --segments 1,2,3');

function command(line, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let response = '';
    const timer = setTimeout(() => socket.destroy(new Error(`Timeout: ${line}`)), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${line}\n`));
    socket.on('data', chunk => {
      response += chunk;
      const newline = response.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      const result = response.slice(0, newline).trim();
      if (!result.startsWith('OK ')) reject(new Error(result));
      else resolve(result.slice(3));
    });
    socket.once('error', reject);
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
let serialized = {};
try { serialized = JSON.parse(await readFile(graphPath, 'utf8')); } catch {}
const graph = new WorldGraph(serialized);
let current = parseWorldState(await command('WORLD'));
graph.observe(current);
process.stdout.write(`start ${JSON.stringify(current)}\n`);

function directionTo(from, to, fallback) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return 3;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 1;
  if (dx === 0 && dy === 1) return 0;
  return fallback;
}

for (const segmentIndex of segmentIndexes) {
  const segment = summary.segments.find(item => item.index === segmentIndex);
  if (!segment) throw new Error(`Missing segment ${segmentIndex}`);
  for (let waypointIndex = 0; waypointIndex < segment.coordinates.length; waypointIndex += 1) {
    const target = segment.coordinates[waypointIndex];
    const direction = directionTo(current, target, segment.directions[waypointIndex]);
    const warpWaypoint = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 2;
    if ((await command('STATE')) === 'BATTLE') {
      await writeFile(graphPath, `${JSON.stringify(graph.toJSON(), null, 2)}\n`);
      throw new Error(`Encounter interrupted route at segment ${segmentIndex}, waypoint ${waypointIndex}`);
    }
    if (current.x === target.x && current.y === target.y) continue;
    let reached = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const before = current;
      await command(`MOVE ${direction}`);
      await delay(cadenceMs);
      current = parseWorldState(await command('WORLD'));
      const observation = graph.observeStep(before, direction, current);
      process.stdout.write(`${observation.type} ${JSON.stringify(current)}\n`);
      await writeFile(graphPath, `${JSON.stringify(graph.toJSON(), null, 2)}\n`);
      if (current.map !== before.map || (current.x === target.x && current.y === target.y)) {
        reached = true;
        break;
      }
      if (!warpWaypoint && (current.x !== before.x || current.y !== before.y)) {
        throw new Error(`Route diverged at segment ${segmentIndex}, waypoint ${waypointIndex}`);
      }
    }
    if (!reached) throw new Error(`Blocked waypoint at segment ${segmentIndex}, waypoint ${waypointIndex}`);
  }
  const beforeTransition = current;
  await delay(700);
  current = parseWorldState(await command('WORLD'));
  if (current.map !== beforeTransition.map) graph.observeStep(beforeTransition, segment.directions.at(-1), current);
  await writeFile(graphPath, `${JSON.stringify(graph.toJSON(), null, 2)}\n`);
}
process.stdout.write(`complete ${JSON.stringify(current)} graph=${graphPath}\n`);
