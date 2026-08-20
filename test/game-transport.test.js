import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { GameTransport } from '../src/headless/game-transport.js';
import { decodeClientHelloFrame } from '../src/headless/game-handshake.js';
import { LengthPrefixedPacketFramer } from '../src/headless/packet-framer.js';
import { GameSessionCrypto } from '../src/headless/session-crypto.js';

test('establishes a secure transport and exchanges encrypted packets', async () => {
  let serverCrypto;
  let receivedClientPacket;
  let resolveClientPacket;
  const clientPacketPromise = new Promise((resolve) => { resolveClientPacket = resolve; });
  const server = net.createServer((socket) => {
    const framer = new LengthPrefixedPacketFramer();
    let state = 'hello';
    socket.on('data', (chunk) => {
      for (const frame of framer.push(chunk)) {
        if (state === 'hello') {
          decodeClientHelloFrame(frame);
          const ecdh = createECDH('prime256v1');
          const publicKey = ecdh.generateKeys();
          const signature = Buffer.from('01020304', 'hex');
          const hello = Buffer.allocUnsafe(2 + 1 + 2 + publicKey.length + 2 + signature.length + 1);
          hello.writeUInt16LE(hello.length, 0);
          hello[2] = 1;
          hello.writeUInt16LE(publicKey.length, 3);
          publicKey.copy(hello, 5);
          let offset = 5 + publicKey.length;
          hello.writeUInt16LE(signature.length, offset);
          offset += 2;
          signature.copy(hello, offset);
          hello[hello.length - 1] = 2;
          socket.write(hello);
          socket.testEcdh = ecdh;
          state = 'key';
        } else if (state === 'key') {
          assert.equal(frame[2], 2);
          const keyLength = frame.readUInt16LE(3);
          const clientPublicKey = frame.subarray(5, 5 + keyLength);
          serverCrypto = new GameSessionCrypto(socket.testEcdh.computeSecret(clientPublicKey), { role: 'server' });
          state = 'secure';
          const reply = Buffer.from('060037aabbcc', 'hex');
          socket.write(serverCrypto.encryptFrame(reply));
        } else {
          receivedClientPacket = serverCrypto.decryptFrame(frame);
          resolveClientPacket(receivedClientPacket);
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const transport = new GameTransport({
    host: '127.0.0.1',
    port: server.address().port,
    verifyServerHello: () => true,
  });
  try {
    const incomingPromise = once(transport, 'packet');
    await transport.connect();
    const [incoming] = await incomingPromise;
    assert.equal(incoming.opcode, 0x37);
    assert.deepEqual(incoming.payload, Buffer.from('aabbcc', 'hex'));

    transport.sendPacket(0x42, Buffer.from('1020', 'hex'));
    await clientPacketPromise;
    assert.deepEqual(receivedClientPacket, Buffer.from('0500421020', 'hex'));
  } finally {
    transport.close();
    server.close();
  }
});
