import fs from 'node:fs';

const lines = fs.readFileSync('captures/decrypted-gameplay-session2.jsonl', 'utf8').split(/\r?\n/);
for (const item of lines.map(line => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(item => item?.type === 'plain_packet' && item.protocolClass === 'f.hU' && item.direction === 'client_to_server').slice(0, 4)) {
  console.log('outbound', item.opcode, item.length, item.dataHex);
}
const record = lines.map(line => {
  try { return JSON.parse(line); } catch { return null; }
}).find(item => item?.type === 'plain_packet'
  && item.protocolClass === 'f.hU'
  && item.direction === 'client_to_server'
  && item.opcode === 1);

if (!record) throw new Error('Captured game login packet not found');
const payload = Buffer.from(record.dataHex, 'hex').subarray(3);
console.log('payload', payload.length);
console.log('prefix', payload.subarray(0, 64).toString('hex'));
let offset = 41;
console.log('mod bitmask', payload[offset++]);
const modCount = payload[offset++];
console.log('mod count', modCount);
for (let index = 0; index < modCount; index += 1) {
  let name = '';
  while (offset + 1 < payload.length) {
    const codePoint = payload.readUInt16LE(offset);
    offset += 2;
    if (codePoint === 0) break;
    name += String.fromCharCode(codePoint);
  }
  console.log('mod', index, name, payload[offset++], payload[offset++]);
}
const count = payload[offset++];
console.log('environment count', count);
for (let index = 0; index < count; index += 1) {
  const key = payload[offset++];
  let value = '';
  while (offset + 1 < payload.length) {
    const codePoint = payload.readUInt16LE(offset);
    offset += 2;
    if (codePoint === 0) break;
    value += String.fromCharCode(codePoint);
  }
  console.log(index, key, value);
}
console.log('tail offset', offset, 'tail length', payload.length - offset);
console.log('tail', payload.subarray(offset).toString('hex'));
