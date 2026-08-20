import path from 'node:path';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { createDashboardServer } from '../src/headless/dashboard-server.js';
import { HeadlessRuntime } from '../src/headless/headless-runtime.js';
import { HeadlessState } from '../src/headless/headless-state.js';
import { OfficialHeadlessSession } from '../src/headless/official-headless-session.js';

const root = path.resolve(process.env.POKEMMO_DATA_ROOT ?? '.');
const host = process.env.POKEMMO_DASHBOARD_HOST ?? '127.0.0.1';
const port = Number(process.env.POKEMMO_DASHBOARD_PORT ?? 8787);
const basePath = process.env.POKEMMO_DASHBOARD_BASE_PATH ?? '/pokemmo';
const token = process.env.POKEMMO_DASHBOARD_TOKEN ?? '';
const graph = readJson(path.join(root, 'captures/world-graph.json'), {});
const speciesIndex = readJson(path.join(root, 'captures/client-species-index.json'), {});
const centers = readJson(path.join(root, 'captures/pokemon-centers.json'), {});
const explorerStatus = readJson(path.join(root, 'captures/explorer-status.json'), {});
const speciesNames = Object.fromEntries(Object.entries(speciesIndex.species ?? {}).map(([id, value]) => [id, value.name]));
const state = new HeadlessState();
state.patch({
  survey: {
    maps: Object.keys(graph.maps ?? {}).length,
    tiles: Object.values(graph.maps ?? {}).reduce((sum, value) => sum + (value.visited?.length ?? 0), 0),
    speciesIndexed: Object.keys(speciesNames).length,
    pokemonCenters: Object.keys(centers.centers ?? {}).length,
    centers: Object.values(centers.centers ?? {}),
  },
});
const loginAdapter = new OfficialHeadlessSession({
  state,
  loginHost: process.env.POKEMMO_LOGIN_HOST ?? '207.246.96.200',
  loginPort: Number(process.env.POKEMMO_LOGIN_PORT ?? 2106),
  serverKeyId: process.env.POKEMMO_SERVER_KEY_ID ?? 'primary',
  characterName: process.env.POKEMMO_CHARACTER_NAME ?? 'Deltron',
  characterId: process.env.POKEMMO_CHARACTER_ID ?? '1902562831166377984',
  characterProof: process.env.POKEMMO_CHARACTER_PROOF ?? '16022381992908638383',
  graph,
  dex: readJson(path.join(root, 'captures/encounter-dex.json'), {}),
  centers,
  initialPosition: explorerStatus.world,
  speciesNames,
  persist: createPersistence(root),
});
const runtime = new HeadlessRuntime({
  root,
  state,
  loginAdapter,
  surveyEnabled: false,
  telemetryPort: Number(process.env.POKEMMO_TELEMETRY_PORT ?? 0),
});
await runtime.start();
const viewPassword = process.env.POKEMMO_VIEW_PASSWORD ?? 'Loldeedle';
const server = createDashboardServer({ runtime, host, basePath, token, viewPassword });
server.listen(port, host, () => process.stdout.write(`PokeMMO headless dashboard listening at http://${host}:${port}${basePath}\n`));
function shutdown() {
  runtime.close();
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function createPersistence(dataRoot) {
  let timer = null;
  let latest = null;
  return payload => {
    latest = payload;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const value = latest;
      latest = null;
      await Promise.all([
        atomicJson(path.join(dataRoot, 'captures/world-graph.json'), value.graph.toJSON()),
        atomicJson(path.join(dataRoot, 'captures/encounter-dex.json'), value.dex.toJSON()),
        atomicJson(path.join(dataRoot, 'captures/pokemon-centers.json'), value.centers.toJSON()),
      ]);
    }, 750);
  };
}

async function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}
