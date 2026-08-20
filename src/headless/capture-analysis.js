import { createHash } from 'node:crypto';
import { readJsonLines } from '../capture-summary.js';

export async function analyzeCapture(path, options = {}) {
  const records = (await readJsonLines(path))
    .filter((record) => record.type === 'tcp_data' && record.timestamp)
    .map(normalizeRecord)
    .filter(Boolean)
    .sort((left, right) => left.timeMs - right.timeMs);

  const startMs = parseTime(options.from) ?? records.at(0)?.timeMs ?? 0;
  const endMs = parseTime(options.to) ?? records.at(-1)?.timeMs ?? startMs;
  const selected = records.filter((record) => record.timeMs >= startMs && record.timeMs <= endMs);
  const bucketMs = options.bucketMs ?? 1000;
  const eventWindowMs = options.eventWindowMs ?? 3000;

  return {
    path,
    range: {
      from: new Date(startMs).toISOString(),
      to: new Date(endMs).toISOString(),
    },
    totals: summarizeRecords(selected),
    lengthHistograms: buildLengthHistograms(selected),
    repeatedClientPayloads: findRepeatedClientPayloads(selected),
    timeline: buildTimeline(selected, { startMs, bucketMs }),
    events: (options.events ?? []).map((event) => ({
      label: event.label,
      timestamp: new Date(event.timeMs).toISOString(),
      records: extractWindow(selected, event.timeMs, eventWindowMs),
    })),
  };
}

export function extractWindow(records, centerMs, windowMs = 3000) {
  return records
    .filter((record) => Math.abs(record.timeMs - centerMs) <= windowMs)
    .map((record) => ({
      timestamp: record.timestamp,
      offsetMs: record.timeMs - centerMs,
      direction: record.direction,
      length: record.length,
      fingerprint: record.fingerprint,
      dataPrefixHex: record.dataHex?.slice(0, 32),
    }));
}

function normalizeRecord(record) {
  const timeMs = Date.parse(record.timestamp);
  if (!Number.isFinite(timeMs)) return null;
  const dataHex = typeof record.dataHex === 'string' ? record.dataHex.toLowerCase() : undefined;
  return {
    timestamp: new Date(timeMs).toISOString(),
    timeMs,
    direction: record.direction,
    length: Number(record.length) || (dataHex ? dataHex.length / 2 : 0),
    dataHex,
    fingerprint: dataHex
      ? createHash('sha256').update(dataHex, 'hex').digest('hex').slice(0, 16)
      : undefined,
  };
}

function summarizeRecords(records) {
  const summary = {
    records: records.length,
    bytes: 0,
    clientToUpstream: { records: 0, bytes: 0 },
    upstreamToClient: { records: 0, bytes: 0 },
  };
  for (const record of records) {
    summary.bytes += record.length;
    const target = record.direction === 'client_to_upstream'
      ? summary.clientToUpstream
      : summary.upstreamToClient;
    target.records += 1;
    target.bytes += record.length;
  }
  return summary;
}

function buildLengthHistograms(records) {
  const histograms = { client_to_upstream: {}, upstream_to_client: {} };
  for (const record of records) {
    const histogram = histograms[record.direction];
    if (!histogram) continue;
    histogram[record.length] = (histogram[record.length] ?? 0) + 1;
  }
  return histograms;
}

function findRepeatedClientPayloads(records) {
  const payloads = new Map();
  for (const record of records) {
    if (record.direction !== 'client_to_upstream' || !record.dataHex) continue;
    const entry = payloads.get(record.dataHex) ?? {
      length: record.length,
      fingerprint: record.fingerprint,
      count: 0,
      firstTimestamp: record.timestamp,
      lastTimestamp: record.timestamp,
      dataHex: record.dataHex,
    };
    entry.count += 1;
    entry.lastTimestamp = record.timestamp;
    payloads.set(record.dataHex, entry);
  }
  return [...payloads.values()]
    .filter((entry) => entry.count > 1)
    .sort((left, right) => right.count - left.count || left.length - right.length)
    .slice(0, 100);
}

function buildTimeline(records, { startMs, bucketMs }) {
  const buckets = new Map();
  for (const record of records) {
    const bucketStartMs = startMs + Math.floor((record.timeMs - startMs) / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStartMs) ?? {
      timestamp: new Date(bucketStartMs).toISOString(),
      clientToUpstreamRecords: 0,
      clientToUpstreamBytes: 0,
      upstreamToClientRecords: 0,
      upstreamToClientBytes: 0,
    };
    if (record.direction === 'client_to_upstream') {
      bucket.clientToUpstreamRecords += 1;
      bucket.clientToUpstreamBytes += record.length;
    } else {
      bucket.upstreamToClientRecords += 1;
      bucket.upstreamToClientBytes += record.length;
    }
    buckets.set(bucketStartMs, bucket);
  }
  return [...buckets.values()];
}

function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`Invalid timestamp: ${value}`);
  return time;
}
