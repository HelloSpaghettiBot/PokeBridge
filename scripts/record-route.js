import { appendFile, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const source = path.resolve(option('source', 'captures/decrypted-gameplay-session2.jsonl'));
const output = path.resolve(option('output', `captures/route-${Date.now()}.jsonl`));
const pollMs = Number(option('poll-ms', '60'));
let offset = (await stat(source)).size;
let remainder = '';
let sequence = 0;
let stopped = false;
let lastPosition = null;

function decodeMovement(hex) {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length < 8 || bytes.readUInt8(2) !== 6) return null;
  const flags = bytes.readUInt8(7);
  return {
    x: bytes.readUInt16LE(3),
    y: bytes.readUInt16LE(5),
    direction: flags & 0x3f,
    running: Boolean(flags & 0x80),
    secondary: Boolean(flags & 0x40),
  };
}

async function write(event) {
  await appendFile(output, `${JSON.stringify({ sequence: sequence++, ...event })}\n`);
}

async function initialPosition() {
  const text = await readFile(source, 'utf8');
  const lines = text.trimEnd().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const packet = JSON.parse(lines[index]);
      if (packet.type === 'plain_packet' && packet.direction === 'client_to_server' && packet.opcode === 6) {
        return decodeMovement(packet.dataHex);
      }
    } catch {}
  }
  return null;
}

async function capture(packet) {
  if (packet.type !== 'plain_packet') return;
  let classification = packet.direction === 'client_to_server' ? 'client_action' : 'server_response';
  let movement = null;
  if (packet.direction === 'client_to_server' && packet.opcode === 6) {
    classification = 'movement';
    movement = decodeMovement(packet.dataHex);
    if (movement && lastPosition) {
      movement.dx = movement.x - lastPosition.x;
      movement.dy = movement.y - lastPosition.y;
    }
    if (movement) lastPosition = movement;
  } else if (packet.direction === 'client_to_server' && packet.opcode === 7) {
    classification = 'direction_intent';
  } else if (packet.direction === 'server_to_client' && packet.opcode === 48) {
    classification = 'unexpected_encounter';
  } else if (packet.direction === 'server_to_client' && packet.opcode === 49) {
    classification = 'battle_end';
  }
  await write({
    recordedAt: new Date().toISOString(),
    classification,
    movement,
    packet,
  });
}

async function poll() {
  const size = (await stat(source)).size;
  if (size < offset) {
    offset = 0;
    remainder = '';
  }
  if (size === offset) return;
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  const file = await open(source, 'r');
  try { await file.read(buffer, 0, length, offset); }
  finally { await file.close(); }
  offset = size;
  const lines = (remainder + buffer.toString('utf8')).split(/\r?\n/);
  remainder = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try { await capture(JSON.parse(line)); }
    catch (error) { await write({ recordedAt: new Date().toISOString(), classification: 'parse_error', message: error.message }); }
  }
}

lastPosition = await initialPosition();
await write({
  recordedAt: new Date().toISOString(),
  classification: 'route_start',
  source,
  output,
  initialPosition: lastPosition,
});
process.stdout.write(`${output}\n`);

const timer = setInterval(() => void poll().catch(error => write({
  recordedAt: new Date().toISOString(),
  classification: 'poll_error',
  message: error.message,
})), pollMs);

async function stop(signal) {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  await poll();
  await write({ recordedAt: new Date().toISOString(), classification: 'route_end', signal, finalPosition: lastPosition });
}

process.on('SIGINT', () => void stop('SIGINT').finally(() => process.exit(0)));
process.on('SIGTERM', () => void stop('SIGTERM').finally(() => process.exit(0)));
