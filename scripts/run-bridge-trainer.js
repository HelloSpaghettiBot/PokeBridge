import { open, stat, appendFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { HumanMovementTiming } from '../src/navigation/human-movement.js';
import { parseWorldState } from '../src/navigation/world-state.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const capturePath = path.resolve(option('capture', 'captures/decrypted-gameplay-session2.jsonl'));
const logPath = path.resolve(option('log', 'captures/bridge-trainer.log'));
const port = Number(option('port', '37666'));
const moveId = Number(option('move-id', '52'));
const stepMs = Number(option('step-ms', '240'));
const sweep = Number(option('sweep', '16'));
const maxBattles = Number(option('max-battles', '0'));

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port');
if (!Number.isInteger(moveId) || moveId < 1 || moveId > 65535) throw new Error('Invalid --move-id');
if (!Number.isInteger(sweep) || sweep < 1) throw new Error('Invalid --sweep');
if (!Number.isInteger(maxBattles) || maxBattles < 0) throw new Error('Invalid --max-battles');

let offset = (await stat(capturePath)).size;
let remainder = '';
let battle = false;
let battleReady = false;
let commandPending = false;
let stopped = false;
let resumeAt = Date.now();
let movementIndex = 0;
let battlesCompleted = 0;
let battleActionCooldownUntil = 0;
let enemy = null;
let lastWorld = null;
let previousMovementDirection = null;
let lastMovementAdvanced = false;
const movementTiming = new HumanMovementTiming({ walkCadenceMs: stepMs });
const directions = [
  ...Array(sweep).fill(2), // left
  ...Array(sweep).fill(3), // right
];

async function log(event, details = {}) {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details });
  await appendFile(logPath, `${record}\n`);
  process.stdout.write(`${record}\n`);
}

function command(line, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error(`Command timeout: ${line}`)), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${line}\n`));
    socket.on('data', chunk => {
      response += chunk;
      const newline = response.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.end();
      const answer = response.slice(0, newline).trim();
      if (answer.startsWith('OK ')) resolve(answer.slice(3));
      else reject(new Error(answer));
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function act() {
  if (stopped || commandPending) return;
  if (battle) {
    if (!battleReady) return;
    if (Date.now() < battleActionCooldownUntil) return;
    commandPending = true;
    battleReady = false;
    try {
      const response = await command('AUTO');
      if (response.startsWith('NO_DAMAGE_PP')) {
        await log('recovery_required', { reason: 'no_damaging_move_pp', response });
        return;
      }
      battleActionCooldownUntil = Date.now() + 500;
      await log('battle_move', { response });
    } catch (error) {
      battleReady = true;
      await log('command_error', { command: 'BATTLE', message: error.message });
    } finally {
      commandPending = false;
    }
    return;
  }
  if (Date.now() < resumeAt) return;
  commandPending = true;
  const direction = directions[movementIndex % directions.length];
  try {
    const response = await command(`MOVE ${direction}`);
    let advanced = false;
    if (response.startsWith('MOVED')) {
      const worldText = response.replace(/^MOVED\s+\d+\s+/, '');
      try {
        const world = parseWorldState(worldText);
        advanced = !lastWorld || world.map !== lastWorld.map || world.x !== lastWorld.x || world.y !== lastWorld.y;
        lastWorld = world;
      } catch {}
    }
    await log('movement', { direction, advanced, response });
    lastMovementAdvanced = advanced;
    if (advanced) movementIndex += 1;
    else resumeAt = Date.now() + 90;
  } catch (error) {
    await log('command_error', { command: 'MOVE', message: error.message });
  } finally {
    commandPending = false;
  }
}

async function packet(record) {
  if (record.type !== 'plain_packet' || record.direction !== 'server_to_client') return;
  if (record.opcode === 48) {
    battle = true;
    battleReady = false;
    enemy = null;
    await log('encounter', { dataHex: record.dataHex });
    setTimeout(async () => {
      try {
        enemy = await command('IDENTIFY');
        await log('enemy_identified', { enemy });
      } catch (error) {
        await log('identify_error', { message: error.message });
      }
    }, 350);
  } else if (record.opcode === 50) {
    battle = true;
    battleReady = true;
    await log('turn_ready', { dataHex: record.dataHex });
    void act();
  } else if (record.opcode === 49) {
    battle = false;
    battleReady = false;
    enemy = null;
    resumeAt = Date.now() + 2500;
    battlesCompleted += 1;
    await log('battle_end', { dataHex: record.dataHex, battlesCompleted });
    if (maxBattles > 0 && battlesCompleted >= maxBattles) {
      await shutdown('max_battles');
    }
  }
}

async function readCapture() {
  const currentSize = (await stat(capturePath)).size;
  if (currentSize < offset) {
    offset = 0;
    remainder = '';
  }
  if (currentSize === offset) return;
  const length = currentSize - offset;
  const buffer = Buffer.alloc(length);
  const file = await open(capturePath, 'r');
  try {
    await file.read(buffer, 0, length, offset);
  } finally {
    await file.close();
  }
  offset = currentSize;
  const lines = (remainder + buffer.toString('utf8')).split(/\r?\n/);
  remainder = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      await packet(JSON.parse(line));
    } catch (error) {
      await log('capture_parse_error', { message: error.message });
    }
  }
}

const initialState = await command('STATE');
try { lastWorld = parseWorldState(await command('WORLD')); } catch {}
battle = initialState === 'BATTLE';
battleReady = battle;
await log('started', { capturePath, port, moveId, stepMs, sweep, maxBattles, initialState });
if (battle) void act();

const captureTimer = setInterval(() => void readCapture().catch(error => log('capture_error', { message: error.message })), 75);
let actionTimer;
function scheduleAction() {
  if (stopped) return;
  const direction = directions[movementIndex % directions.length];
  const delayMs = movementTiming.nextDelay({
    directionChanged: !battle && previousMovementDirection !== null && direction !== previousMovementDirection,
    advanced: lastMovementAdvanced,
    inBattle: battle,
  });
  previousMovementDirection = battle ? previousMovementDirection : direction;
  lastMovementAdvanced = false;
  actionTimer = setTimeout(async () => {
    await act();
    scheduleAction();
  }, delayMs);
}
scheduleAction();

async function shutdown(signal) {
  if (stopped) return;
  stopped = true;
  clearInterval(captureTimer);
  clearTimeout(actionTimer);
  await log('stopped', { signal });
}

process.on('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));
