import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = new Map(process.argv.slice(2).map((arg, index, list) => {
  if (!arg.startsWith('--')) return [String(index), arg];
  const next = list[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : true];
}));

const clientPath = resolve(String(args.get('client') ?? 'C:\\Program Files\\PokeMMO\\PokeMMO.exe'));
const outPath = resolve(String(args.get('out') ?? 'analysis/java-constants.json'));
const patterns = String(args.get('patterns') ?? 'pokemmo,loginserver,185.180,207.246,2106,7777,7780,server,connect,socket')
  .split(',')
  .map((pattern) => pattern.trim())
  .filter(Boolean);

function run(command, commandArgs, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, commandArgs, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectCommand);
    child.once('close', (code) => resolveCommand({ code, stdout, stderr }));
  });
}

async function commandPath(command) {
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-Command '${command}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source`,
  ]);
  return result.stdout.trim();
}

function printableStrings(buffer) {
  const latin = buffer.toString('latin1').match(/[ -~]{4,}/g) ?? [];
  const utf16 = [];
  for (let offset = 0; offset < buffer.length - 8; offset += 2) {
    let value = '';
    for (let index = offset; index < buffer.length - 1; index += 2) {
      const code = buffer[index] | (buffer[index + 1] << 8);
      if (code < 0x20 || code > 0x7e) break;
      value += String.fromCharCode(code);
    }
    if (value.length >= 4) utf16.push(value);
  }
  return [...new Set([...latin, ...utf16])];
}

function matchesPatterns(value) {
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

async function main() {
  const jar = await commandPath('jar.exe');
  if (!jar) throw new Error('jar.exe was not found on PATH');

  const tempDir = await mkdtemp(join(tmpdir(), 'tcp-bridge-classes-'));
  try {
    const extract = await run(jar, ['xf', clientPath], { cwd: tempDir });
    if (extract.code !== 0) throw new Error(extract.stderr || `jar extraction failed with ${extract.code}`);

    const classFilesRaw = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-ChildItem -Recurse -Filter '*.class' '${tempDir.replaceAll("'", "''")}' | Select-Object -ExpandProperty FullName`,
    ]);
    const classFiles = classFilesRaw.stdout.split(/\r?\n/).filter(Boolean);
    const findings = [];

    for (const classFile of classFiles) {
      const buffer = await readFile(classFile);
      const strings = printableStrings(buffer).filter(matchesPatterns);
      if (strings.length === 0) continue;
      findings.push({
        classFile: classFile.slice(tempDir.length + 1).replaceAll('\\', '/'),
        strings: strings.slice(0, 100),
      });
    }

    await writeFile(outPath, `${JSON.stringify({
      clientPath,
      patterns,
      classFileCount: classFiles.length,
      findingCount: findings.length,
      findings,
    }, null, 2)}\n`);
    console.log(`scanned ${classFiles.length} class files; wrote ${outPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
