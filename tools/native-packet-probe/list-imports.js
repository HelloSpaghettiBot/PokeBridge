const main = Process.getModuleByName('PokeMMO.exe');
for (const item of main.enumerateImports()) {
  const text = `${item.module ?? ''}!${item.name ?? ''}`;
  if (/WS2|socket|send|recv|connect|read|write|bcrypt|crypt|ssl|http|iocp|completion/i.test(text)) {
    send({ kind: 'import', module: item.module, name: item.name, address: item.address?.toString() });
  }
}
send({ kind: 'done', imports: main.enumerateImports().length, base: main.base.toString(), size: main.size });
