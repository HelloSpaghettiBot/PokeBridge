import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const defaultClientPath = 'C:\\Program Files\\PokeMMO\\PokeMMO.exe';
const args = new Map(process.argv.slice(2).map((arg, index, list) => {
  if (!arg.startsWith('--')) return [String(index), arg];
  const next = list[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : true];
}));

const clientPath = resolve(String(args.get('client') ?? defaultClientPath));
const outDir = resolve(String(args.get('out') ?? 'analysis'));
const runGhidra = args.get('run-ghidra') === true || args.get('run-ghidra') === 'true';

function run(command, commandArgs, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const isWindowsBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
    const quoteForPowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const child = isWindowsBatch
      ? spawn('powershell.exe', [
          '-NoProfile',
          '-Command',
          ['&', quoteForPowerShell(command), ...commandArgs.map(quoteForPowerShell)].join(' '),
        ], { ...options, windowsHide: true })
      : spawn(command, commandArgs, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectCommand);
    child.once('close', (code) => {
      resolveCommand({ code, stdout, stderr });
    });
  });
}

async function commandExists(command) {
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-Command '${command}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source`,
  ]);
  return result.stdout.trim();
}

async function findGhidraHeadless() {
  const fromPath = await commandExists('analyzeHeadless.bat') || await commandExists('analyzeHeadless');
  if (fromPath) return fromPath;

  const localCandidate = resolve('..', 'tools', 'ghidra_12.1.2_PUBLIC', 'support', 'analyzeHeadless.bat');
  try {
    await readFile(localCandidate);
    return localCandidate;
  } catch {
    return '';
  }
}

function extractStrings(buffer) {
  const text = buffer.toString('latin1');
  const strings = text.match(/[ -~]{6,}/g) ?? [];
  const endpointPattern = /(https?:\/\/|[A-Za-z0-9.-]+\.[A-Za-z]{2,}|server|socket|connect|host|port)/i;
  return [...new Set(strings.filter((value) => endpointPattern.test(value)))].slice(0, 500);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const jarPath = await commandExists('jar.exe');
  const analyzeHeadlessPath = await findGhidraHeadless();
  const clientBytes = await readFile(clientPath);
  const strings = extractStrings(clientBytes);
  await writeFile(join(outDir, 'client-strings.json'), `${JSON.stringify(strings, null, 2)}\n`);

  let entries = [];
  let manifest = null;
  if (jarPath) {
    const jarList = await run(jarPath, ['tf', clientPath]);
    entries = jarList.stdout.split(/\r?\n/).filter(Boolean);
    await writeFile(join(outDir, 'client-entries.txt'), `${entries.join('\n')}\n`);

    const tempDir = join(outDir, '.manifest-extract');
    await mkdir(tempDir, { recursive: true });
    await run(jarPath, ['xf', clientPath, 'META-INF/MANIFEST.MF'], { cwd: tempDir });
    try {
      manifest = await readFile(join(tempDir, 'META-INF', 'MANIFEST.MF'), 'utf8');
      await writeFile(join(outDir, 'manifest.txt'), manifest);
    } catch {
      manifest = null;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  let ghidra = { available: Boolean(analyzeHeadlessPath), ran: false };
  if (runGhidra && analyzeHeadlessPath) {
    const projectDir = join(outDir, 'ghidra-project');
    await mkdir(projectDir, { recursive: true });
    const result = await run(analyzeHeadlessPath, [
      projectDir,
      `${basename(clientPath)}-project`,
      '-import',
      clientPath,
      '-overwrite',
      '-analysisTimeoutPerFile',
      '120',
    ]);
    ghidra = {
      available: true,
      ran: true,
      exitCode: result.code,
      stderrPath: join(outDir, 'ghidra-stderr.txt'),
      stdoutPath: join(outDir, 'ghidra-stdout.txt'),
    };
    await writeFile(ghidra.stdoutPath, result.stdout);
    await writeFile(ghidra.stderrPath, result.stderr);
  }

  const classCandidates = entries
    .filter((entry) => /\.class$/i.test(entry))
    .filter((entry) => /(client|server|socket|packet|protocol|connection|network|net)/i.test(entry))
    .slice(0, 500);
  const appClassCandidates = classCandidates
    .filter((entry) => entry.startsWith('com/pokeemu/'))
    .slice(0, 200);

  const report = {
    clientPath,
    outDir,
    jar: { available: Boolean(jarPath), entryCount: entries.length },
    ghidra,
    manifest,
    appClassCandidates,
    classCandidates,
    stringFindingCount: strings.length,
    notes: [
      'This client is a Launch4j Java bundle; use Java bytecode tooling for application classes.',
      'Use Ghidra for the native launcher or bundled native libraries when analyzeHeadless is installed.',
    ],
  };
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`analysis report written to ${join(outDir, 'report.json')}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
