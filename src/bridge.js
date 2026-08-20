import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { CaptureWriter } from './capture-writer.js';

export async function createBridge(options) {
  const {
    listenHost = '127.0.0.1',
    listenPort,
    upstreamHost,
    upstreamPort,
    capturePath,
    captureMaxBytes = 0,
    capturePayload = true,
    rewriteRules = [],
    rewriteHoldTimeoutMs = 25,
    connectTimeoutMs = 10000,
    idleTimeoutMs = 0,
    maxConnections = 100,
    logger = console,
  } = options;

  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    throw new TypeError('listenPort must be an integer from 0 through 65535');
  }
  if (!upstreamHost) throw new TypeError('upstreamHost is required');
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new TypeError('upstreamPort must be an integer from 1 through 65535');
  }
  if (!Number.isInteger(captureMaxBytes) || captureMaxBytes < 0) {
    throw new TypeError('captureMaxBytes must be a non-negative integer');
  }
  if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 1) {
    throw new TypeError('connectTimeoutMs must be a positive integer');
  }
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new TypeError('idleTimeoutMs must be a non-negative integer');
  }
  if (!Number.isInteger(maxConnections) || maxConnections < 1) {
    throw new TypeError('maxConnections must be a positive integer');
  }
  if (!Number.isInteger(rewriteHoldTimeoutMs) || rewriteHoldTimeoutMs < 0) {
    throw new TypeError('rewriteHoldTimeoutMs must be a non-negative integer');
  }

  const capture = capturePath ? await CaptureWriter.open(capturePath, { maxBytes: captureMaxBytes }) : null;
  const rewriteRuleSets = buildRewriteRuleSets(rewriteRules);
  const sockets = new Set();
  const stats = {
    connectionsOpened: 0,
    connectionsRejected: 0,
    activeConnections: 0,
    bytesClientToUpstream: 0,
    bytesUpstreamToClient: 0,
  };

  const record = (event) => {
    if (!capture) return;
    capture.write({ timestamp: new Date().toISOString(), ...event }).catch((error) => {
      logger.error(`capture write failed: ${error.message}`);
    });
  };

  const server = net.createServer((client) => {
    if (stats.activeConnections >= maxConnections) {
      stats.connectionsRejected += 1;
      record({
        type: 'connection_reject',
        reason: 'max_connections',
        client: `${client.remoteAddress}:${client.remotePort}`,
      });
      client.destroy();
      return;
    }

    const connectionId = randomUUID();
    const upstream = net.createConnection({ host: upstreamHost, port: upstreamPort });
    let connectTimer;
    stats.connectionsOpened += 1;
    stats.activeConnections += 1;
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);

    record({
      type: 'connection_open',
      connectionId,
      client: `${client.remoteAddress}:${client.remotePort}`,
      upstream: `${upstreamHost}:${upstreamPort}`,
    });

    const forward = (source, destination, direction) => {
      const rewriter = createStreamRewriter(rewriteRuleSets.get(direction));
      let carryFlushTimer;

      const clearCarryFlush = () => {
        if (!carryFlushTimer) return;
        clearTimeout(carryFlushTimer);
        carryFlushTimer = undefined;
      };

      const recordForwarded = (buffer, matches) => {
        if (direction === 'client_to_upstream') stats.bytesClientToUpstream += buffer.length;
        if (direction === 'upstream_to_client') stats.bytesUpstreamToClient += buffer.length;
        record({
          type: 'tcp_data',
          connectionId,
          direction,
          length: buffer.length,
          rewritten: matches > 0,
          rewriteMatches: matches,
          ...(capturePayload ? { dataHex: buffer.toString('hex') } : {}),
        });

        return destination.write(buffer);
      };

      const flushCarry = () => {
        const { buffer, matches } = rewriter.flush();
        if (buffer.length > 0) {
          recordForwarded(buffer, matches);
        }
      };

      const scheduleCarryFlush = () => {
        clearCarryFlush();
        if (!rewriter.hasCarry()) return;
        if (rewriteHoldTimeoutMs === 0) {
          flushCarry();
          return;
        }
        carryFlushTimer = setTimeout(() => {
          carryFlushTimer = undefined;
          flushCarry();
        }, rewriteHoldTimeoutMs);
      };

      const writeForward = (chunk) => {
        clearCarryFlush();
        const { buffer, matches } = rewriter.write(chunk);
        const shouldContinue = buffer.length === 0 ? true : recordForwarded(buffer, matches);
        scheduleCarryFlush();
        return shouldContinue;
      };

      source.on('data', (chunk) => {
        if (!writeForward(chunk)) source.pause();
      });
      destination.on('drain', () => source.resume());
      source.on('close', clearCarryFlush);
      destination.on('close', clearCarryFlush);
      source.on('end', () => {
        clearCarryFlush();
        flushCarry();
        destination.end();
      });
    };

    forward(client, upstream, 'client_to_upstream');
    forward(upstream, client, 'upstream_to_client');

    let closed = false;
    const closeBoth = (origin, error) => {
      if (closed) return;
      closed = true;
      clearTimeout(connectTimer);
      stats.activeConnections -= 1;
      record({
        type: 'connection_close',
        connectionId,
        origin,
        error: error?.message,
      });
      if (!client.destroyed) client.destroy(error);
      if (!upstream.destroyed) upstream.destroy(error);
    };

    connectTimer = setTimeout(() => {
      closeBoth('upstream_connect_timeout', new Error(`upstream connect timed out after ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);
    upstream.once('connect', () => {
      clearTimeout(connectTimer);
      if (idleTimeoutMs > 0) {
        client.setTimeout(idleTimeoutMs, () => closeBoth('client_idle_timeout'));
        upstream.setTimeout(idleTimeoutMs, () => closeBoth('upstream_idle_timeout'));
      }
    });

    client.on('error', (error) => closeBoth('client', error));
    upstream.on('error', (error) => closeBoth('upstream', error));
    client.on('close', () => {
      sockets.delete(client);
      closeBoth('client');
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      closeBoth('upstream');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, resolve);
  });

  const address = server.address();
  logger.log(`bridge listening on ${address.address}:${address.port} -> ${upstreamHost}:${upstreamPort}`);

  return {
    address,
    getStats() {
      return { ...stats };
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await capture?.close();
    },
  };
}

function buildRewriteRuleSets(rewriteRules) {
  const rewriteRuleSets = new Map();
  for (const rule of rewriteRules) {
    const direction = rule.direction ?? 'upstream_to_client';
    const from = Buffer.from(rule.fromHex, 'hex');
    const to = Buffer.from(rule.toHex, 'hex');
    if (from.length === 0) throw new TypeError('rewrite fromHex must not be empty');
    if (from.length !== to.length) throw new TypeError('rewrite fromHex and toHex must have equal byte lengths');
    const rules = rewriteRuleSets.get(direction) ?? [];
    rules.push({ from, to });
    rewriteRuleSets.set(direction, rules);
  }
  return rewriteRuleSets;
}

function createStreamRewriter(rules) {
  if (!rules || rules.length === 0) {
    return {
      write(buffer) {
        return { buffer, matches: 0 };
      },
      flush() {
        return { buffer: Buffer.alloc(0), matches: 0 };
      },
      hasCarry() {
        return false;
      },
    };
  }

  let carry = Buffer.alloc(0);

  return {
    write(buffer) {
      const combined = carry.length > 0 ? Buffer.concat([carry, buffer]) : buffer;
      const rewritten = rewriteBuffer(rules, combined);
      const carryLength = findPotentialMatchPrefixLength(rewritten.buffer, rules);
      const emitLength = rewritten.buffer.length - carryLength;
      const pending = rewritten.buffer.subarray(0, emitLength);
      carry = Buffer.from(rewritten.buffer.subarray(emitLength));
      return { buffer: pending, matches: rewritten.matches };
    },
    flush() {
      const pending = carry;
      carry = Buffer.alloc(0);
      if (pending.length === 0) return { buffer: Buffer.alloc(0), matches: 0 };
      return rewriteBuffer(rules, pending);
    },
    hasCarry() {
      return carry.length > 0;
    },
  };
}

function findPotentialMatchPrefixLength(buffer, rules) {
  const maxLength = Math.min(
    buffer.length,
    Math.max(...rules.map((rule) => rule.from.length)) - 1,
  );

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = buffer.subarray(buffer.length - length);
    if (rules.some((rule) => suffix.equals(rule.from.subarray(0, length)))) {
      return length;
    }
  }

  return 0;
}

function rewriteBuffer(rules, chunk) {
  let rewritten = chunk;
  let matches = 0;
  for (const rule of rules) {
    const result = replaceAllBuffers(rewritten, rule.from, rule.to);
    rewritten = result.buffer;
    matches += result.matches;
  }
  return { buffer: rewritten, matches };
}

function replaceAllBuffers(input, from, to) {
  let index = input.indexOf(from);
  if (index < 0) return { buffer: input, matches: 0 };

  const output = Buffer.from(input);
  let matches = 0;
  while (index >= 0) {
    to.copy(output, index);
    matches += 1;
    index = output.indexOf(from, index + to.length);
  }
  return { buffer: output, matches };
}
