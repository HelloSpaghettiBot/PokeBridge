export const KNOWN_IDLE_PACKETS = Object.freeze([
  { opcode: 0, length: 3, label: 'secondary heartbeat' },
  { opcode: 32, length: 36, label: 'client telemetry', className: 'f.RX' },
  { opcode: 194, length: 12, label: 'game keepalive', className: 'f.li1' },
]);

export function parsePlainPacketJsonl(text) {
  return String(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
      }
    })
    .filter((record) => record.type === 'plain_packet');
}

export function parseJavapOpcodeMap(text) {
  const lines = String(text).split(/\r?\n/);
  const mapping = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const classMatch = lines[index].match(/\/\/ class (f\/\S+)/);
    if (!classMatch) continue;
    for (let lookahead = index + 1; lookahead < Math.min(index + 5, lines.length); lookahead += 1) {
      const instruction = lines[lookahead].match(/:\s+(iconst_m1|iconst_[0-5]|bipush|sipush)(?:\s+(-?\d+))?/);
      if (!instruction) continue;
      const opcode = instruction[1] === 'iconst_m1'
        ? -1
        : instruction[1].startsWith('iconst_')
          ? Number(instruction[1].slice('iconst_'.length))
          : Number(instruction[2]);
      mapping.set(opcode, classMatch[1].replace('/', '.'));
      break;
    }
  }
  return mapping;
}

export function summarizePlainPackets(records, options = {}) {
  const opcodeMap = options.opcodeMap ?? new Map();
  const groups = new Map();
  for (const record of records) {
    const key = `${record.direction}|${record.opcode}|${record.length}`;
    const group = groups.get(key) ?? {
      direction: record.direction,
      opcode: record.opcode,
      length: record.length,
      count: 0,
      firstTimestamp: record.timestamp,
      lastTimestamp: record.timestamp,
      samples: [],
    };
    group.count += 1;
    group.lastTimestamp = record.timestamp;
    if (group.samples.length < 3 && !group.samples.includes(record.dataHex)) group.samples.push(record.dataHex);
    groups.set(key, group);
  }

  const packetGroups = [...groups.values()]
    .map((group) => {
      const idle = KNOWN_IDLE_PACKETS.find((known) => known.opcode === group.opcode && known.length === group.length);
      return {
        ...group,
        className: opcodeMap.get(group.opcode) ?? idle?.className ?? null,
        idleLabel: idle?.label ?? null,
      };
    })
    .sort((left, right) => left.opcode - right.opcode || left.length - right.length);

  return {
    totalPackets: records.length,
    packetGroups,
    actionCandidates: packetGroups.filter((group) => group.direction === 'client_to_server' && !group.idleLabel),
  };
}
