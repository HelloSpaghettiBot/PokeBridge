import { GameTransport } from '../src/headless/game-transport.js';

const args = new Map(process.argv.slice(2).map((value, index, values) => [
  value.replace(/^--/, ''),
  values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : true,
]));
const host = String(args.get('host') ?? '127.0.0.1');
const port = Number(args.get('port') ?? 7777);
const serverKeyId = String(args.get('server-key') ?? 'primary');
const transport = new GameTransport({ host, port, serverKeyId });

transport.on('transportError', (error) => {
  console.error(`transport error: ${error.message}`);
});

try {
  const result = await transport.connect();
  console.log(JSON.stringify({
    secure: true,
    host,
    port,
    serverKeyId,
    checksumMode: result.checksumMode,
    serverPublicKeyBytes: result.serverPublicKey.length,
  }));
} finally {
  transport.close();
}
