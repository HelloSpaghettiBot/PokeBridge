const patterns = [/cipher/i, /crypto/i, /aes/i, /engineupdate/i, /dofinal/i];
const module = Process.mainModule;
for (const symbol of module.enumerateSymbols()) {
  if (patterns.some((pattern) => pattern.test(symbol.name))) {
    send({ kind: 'symbol', name: symbol.name, address: symbol.address.toString(), offset: symbol.address.sub(module.base).toString() });
  }
}
send({ kind: 'done', module: module.name, base: module.base.toString() });
