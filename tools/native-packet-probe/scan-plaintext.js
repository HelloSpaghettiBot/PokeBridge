const patterns = [
  { name: 'right_32_5_frame', value: '08 00 06 20 00 05 00 03' },
  { name: 'right_32_5_body', value: '06 20 00 05 00 03' },
  { name: 'left_31_5_frame', value: '08 00 06 1f 00 05 00 02' },
  { name: 'left_31_5_body', value: '06 1f 00 05 00 02' },
  { name: 'intent_right', value: '04 00 07 03' },
  { name: 'intent_left', value: '04 00 07 02' },
];

const ranges = Process.enumerateRanges({ protection: 'rw-', coalesce: true });
for (const pattern of patterns) {
  let count = 0;
  for (const range of ranges) {
    try {
      for (const match of Memory.scanSync(range.base, range.size, pattern.value)) {
        const module = Process.findModuleByAddress(match.address);
        send({
          kind: 'plain_match',
          pattern: pattern.name,
          address: match.address.toString(),
          allocationBase: range.base.toString(),
          allocationSize: range.size,
          module: module ? module.name : null,
        });
        count += 1;
        if (count >= 50) break;
      }
    } catch (_) {}
    if (count >= 50) break;
  }
  send({ kind: 'plain_match_count', pattern: pattern.name, count });
}
