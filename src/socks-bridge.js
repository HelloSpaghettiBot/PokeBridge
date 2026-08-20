import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { CaptureWriter } from './capture-writer.js';

const SOCKS_VERSION = 0x05;
const COMMAND_CONNECT = 0x01;
const ADDRESS_IPV4 = 0x01;
const ADDRESS_DOMAIN = 0x03;
const ADDRESS_IPV6 = 0x04;

export async function createSocksBridge(options) {
  const {
    listenHost = '127.0.0.1',
    listenPort = 1080,
    capturePath,
    captureMaxBytes = 0,
    capturePayload = true,
    connectTimeoutMs = 10000,
    idleTimeoutMs = 0,
    maxConnections = 100,
    allowedPorts,
    logger = console,
  } = options;

  validatePort(listenPort, 'listenPort', true);
  const allowedPortSet = allowedPorts ? new Set(allowedPorts.map((port) => validatePort(port, 'allowedPorts'))) : null;
  const capture = capturePath ? await CaptureWriter.open(capturePath, { maxBytes: captureMaxBytes }) : null;
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
      client.destroy();
      return;
    }

    const connectionId = randomUUID();
    stats.connectionsOpened += 1;
    stats.activeConnections += 1;
    sockets.add(client);
    client.setNoDelay(true);

    let upstream;
    let closed = false;
    let handshakeBuffer = Buffer.alloc(0);
    let stage = 'method';
    let connectTimer;

    const closeBoth = (origin, error) => {
      if (closed) return;
      closed = true;
      clearTimeout(connectTimer);
      stats.activeConnections -= 1;
      record({ type: 'socks_close', connectionId, origin, error: error?.message });
      if (!client.destroyed) client.destroy(error);
      if (upstream && !upstream.destroyed) upstream.destroy(error);
    };

    const failHandshake = (replyCode, message) => {
      try {
        client.write(Buffer.from([SOCKS_VERSION, replyCode, 0x00, ADDRESS_IPV4, 0, 0, 0, 0, 0, 0]));
      } finally {
        closeBoth('handshake', new Error(message));
      }
    };

    const onHandshakeData = (chunk) => {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      try {
        while (true) {
          if (stage === 'method') {
            if (handshakeBuffer.length < 2) return;
            const version = handshakeBuffer[0];
            const methodCount = handshakeBuffer[1];
            if (version !== SOCKS_VERSION) return closeBoth('handshake', new Error('unsupported SOCKS version'));
            if (handshakeBuffer.length < 2 + methodCount) return;
            const methods = handshakeBuffer.subarray(2, 2 + methodCount);
            handshakeBuffer = handshakeBuffer.subarray(2 + methodCount);
            if (!methods.includes(0x00)) {
              client.write(Buffer.from([SOCKS_VERSION, 0xff]));
              return closeBoth('handshake', new Error('SOCKS no-auth method not offered'));
            }
            client.write(Buffer.from([SOCKS_VERSION, 0x00]));
            stage = 'request';
          }

          if (stage === 'request') {
            const parsed = parseRequest(handshakeBuffer);
            if (!parsed) return;
            handshakeBuffer = handshakeBuffer.subarray(parsed.bytesRead);
            if (parsed.command !== COMMAND_CONNECT) return failHandshake(0x07, 'unsupported SOCKS command');
            if (allowedPortSet && !allowedPortSet.has(parsed.port)) return failHandshake(0x02, `port not allowed: ${parsed.port}`);

            client.off('data', onHandshakeData);
            connectUpstream(parsed.host, parsed.port, handshakeBuffer);
            handshakeBuffer = Buffer.alloc(0);
            return;
          }
        }
      } catch (error) {
        closeBoth('handshake', error);
      }
    };

    const connectUpstream = (host, port, initialClientBytes) => {
      record({ type: 'socks_connect', connectionId, target: `${host}:${port}` });
      upstream = net.createConnection({ host, port });
      sockets.add(upstream);
      upstream.setNoDelay(true);
      connectTimer = setTimeout(() => {
        failHandshake(0x04, `upstream connect timed out after ${connectTimeoutMs}ms`);
      }, connectTimeoutMs);

      upstream.once('connect', () => {
        clearTimeout(connectTimer);
        client.write(Buffer.from([SOCKS_VERSION, 0x00, 0x00, ADDRESS_IPV4, 0, 0, 0, 0, 0, 0]));
        if (idleTimeoutMs > 0) {
          client.setTimeout(idleTimeoutMs, () => closeBoth('client_idle_timeout'));
          upstream.setTimeout(idleTimeoutMs, () => closeBoth('upstream_idle_timeout'));
        }
        forward(client, upstream, 'client_to_upstream');
        forward(upstream, client, 'upstream_to_client');
        if (initialClientBytes.length > 0) client.emit('data', initialClientBytes);
      });

      upstream.once('error', (error) => failHandshake(0x05, error.message));
      upstream.once('close', () => {
        sockets.delete(upstream);
        closeBoth('upstream');
      });
    };

    const forward = (source, destination, direction) => {
      source.on('data', (chunk) => {
        if (direction === 'client_to_upstream') stats.bytesClientToUpstream += chunk.length;
        if (direction === 'upstream_to_client') stats.bytesUpstreamToClient += chunk.length;
        record({
          type: 'socks_data',
          connectionId,
          direction,
          length: chunk.length,
          ...(capturePayload ? { dataHex: chunk.toString('hex') } : {}),
        });
        if (!destination.write(chunk)) source.pause();
      });
      destination.on('drain', () => source.resume());
      source.on('end', () => destination.end());
    };

    client.on('data', onHandshakeData);
    client.once('error', (error) => closeBoth('client', error));
    client.once('close', () => {
      sockets.delete(client);
      closeBoth('client');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, resolve);
  });

  const address = server.address();
  logger.log(`socks bridge listening on ${address.address}:${address.port}`);

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

function parseRequest(buffer) {
  if (buffer.length < 4) return null;
  if (buffer[0] !== SOCKS_VERSION) throw new Error('invalid SOCKS request version');
  const command = buffer[1];
  const addressType = buffer[3];
  let offset = 4;
  let host;

  if (addressType === ADDRESS_IPV4) {
    if (buffer.length < offset + 4 + 2) return null;
    host = [...buffer.subarray(offset, offset + 4)].join('.');
    offset += 4;
  } else if (addressType === ADDRESS_DOMAIN) {
    if (buffer.length < offset + 1) return null;
    const length = buffer[offset];
    offset += 1;
    if (buffer.length < offset + length + 2) return null;
    host = buffer.subarray(offset, offset + length).toString('utf8');
    offset += length;
  } else if (addressType === ADDRESS_IPV6) {
    if (buffer.length < offset + 16 + 2) return null;
    const parts = [];
    for (let index = offset; index < offset + 16; index += 2) {
      parts.push(buffer.readUInt16BE(index).toString(16));
    }
    host = parts.join(':');
    offset += 16;
  } else {
    throw new Error(`unsupported address type: ${addressType}`);
  }

  const port = buffer.readUInt16BE(offset);
  offset += 2;
  return { command, host, port, bytesRead: offset };
}

function validatePort(value, name, allowZero = false) {
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(port) || port < minimum || port > 65535) {
    throw new TypeError(`${name} must be an integer from ${minimum} through 65535`);
  }
  return port;
}
