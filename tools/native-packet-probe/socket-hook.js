const moduleName = 'WS2_32.dll';
const pendingReceives = new Map();
const mainModule = Process.mainModule;

function describeAddress(address) {
  const module = Process.findModuleByAddress(address);
  const symbol = DebugSymbol.fromAddress(address);
  return {
    address: address.toString(),
    module: module ? module.name : null,
    offset: module ? address.sub(module.base).toString() : null,
    symbol: symbol ? symbol.toString() : null,
  };
}

function callerTrace(context) {
  try {
    return Thread.backtrace(context, Backtracer.ACCURATE)
      .slice(0, 24)
      .map(describeAddress);
  } catch (error) {
    return [{ error: String(error) }];
  }
}

function hex(address, length) {
  try { return address.readByteArray(Math.min(length, 96)); }
  catch (_) { return null; }
}

function attachSimple(name, inbound) {
  const target = Module.getExportByName(moduleName, name);
  Interceptor.attach(target, {
    onEnter(args) {
      this.buffer = args[1];
      this.requested = args[2].toInt32();
      if (!inbound && this.requested > 0) {
        send({ kind: name, direction: 'out', length: this.requested }, hex(this.buffer, this.requested));
      }
    },
    onLeave(result) {
      if (!inbound) return;
      const length = result.toInt32();
      if (length > 0) send({ kind: name, direction: 'in', length }, hex(this.buffer, length));
    },
  });
  send({ kind: 'hook', name, address: target.toString() });
}

for (const [name, inbound] of [['send', false], ['recv', true]]) {
  try { attachSimple(name, inbound); }
  catch (error) { send({ kind: 'hook_error', name, error: String(error) }); }
}

function readWsabufs(pointer, count) {
  const chunks = [];
  for (let index = 0; index < Math.min(count, 16); index += 1) {
    const entry = pointer.add(index * 16);
    const length = entry.readU32();
    const buffer = entry.add(8).readPointer();
    if (length > 0 && length < 16 * 1024 * 1024 && !buffer.isNull()) chunks.push({ length, buffer });
  }
  return chunks;
}

try {
  const target = Module.getExportByName(moduleName, 'WSASend');
  Interceptor.attach(target, {
    onEnter(args) {
      const trace = callerTrace(this.context);
      for (const chunk of readWsabufs(args[1], args[2].toInt32())) {
        send({
          kind: 'WSASend',
          direction: 'out',
          length: chunk.length,
          mainModule: { name: mainModule.name, base: mainModule.base.toString(), size: mainModule.size },
          trace,
        }, hex(chunk.buffer, chunk.length));
      }
    },
  });
  send({ kind: 'hook', name: 'WSASend', address: target.toString() });
} catch (error) { send({ kind: 'hook_error', name: 'WSASend', error: String(error) }); }

try {
  const target = Module.getExportByName(moduleName, 'WSARecv');
  Interceptor.attach(target, {
    onEnter(args) {
      this.chunks = readWsabufs(args[1], args[2].toInt32());
      this.bytesPointer = args[3];
      this.overlapped = args[5];
      if (!this.overlapped.isNull()) {
        pendingReceives.set(this.overlapped.toString(), {
          chunks: this.chunks,
          trace: callerTrace(this.context),
        });
      }
    },
    onLeave(result) {
      if (result.toInt32() !== 0 || this.bytesPointer.isNull()) return;
      let remaining = this.bytesPointer.readU32();
      if (!this.overlapped.isNull()) pendingReceives.delete(this.overlapped.toString());
      for (const chunk of this.chunks) {
        const length = Math.min(remaining, chunk.length);
        if (length > 0) send({ kind: 'WSARecv', direction: 'in', completion: 'synchronous', length }, hex(chunk.buffer, length));
        remaining -= length;
        if (remaining <= 0) break;
      }
    },
  });
  send({ kind: 'hook', name: 'WSARecv', address: target.toString() });
} catch (error) { send({ kind: 'hook_error', name: 'WSARecv', error: String(error) }); }

function emitCompletedReceive(overlapped, transferred, completionKind) {
  if (overlapped.isNull() || transferred <= 0) return;
  const key = overlapped.toString();
  const pending = pendingReceives.get(key);
  if (!pending) return;
  pendingReceives.delete(key);
  let remaining = transferred;
  for (const chunk of pending.chunks) {
    const length = Math.min(remaining, chunk.length);
    if (length > 0) {
      send({
        kind: 'WSARecv',
        direction: 'in',
        completion: completionKind,
        length,
        overlapped: key,
        trace: pending.trace,
      }, hex(chunk.buffer, length));
    }
    remaining -= length;
    if (remaining <= 0) break;
  }
}

try {
  const target = Module.getExportByName('KERNEL32.dll', 'GetQueuedCompletionStatus');
  Interceptor.attach(target, {
    onEnter(args) {
      this.transferredPointer = args[1];
      this.overlappedPointer = args[3];
    },
    onLeave() {
      if (this.transferredPointer.isNull() || this.overlappedPointer.isNull()) return;
      const overlapped = this.overlappedPointer.readPointer();
      emitCompletedReceive(overlapped, this.transferredPointer.readU32(), 'iocp');
    },
  });
  send({ kind: 'hook', name: 'GetQueuedCompletionStatus', address: target.toString() });
} catch (error) { send({ kind: 'hook_error', name: 'GetQueuedCompletionStatus', error: String(error) }); }

try {
  const target = Module.getExportByName('KERNEL32.dll', 'GetQueuedCompletionStatusEx');
  Interceptor.attach(target, {
    onEnter(args) {
      this.entries = args[1];
      this.count = args[2].toInt32();
      this.removedPointer = args[3];
    },
    onLeave() {
      if (this.entries.isNull() || this.removedPointer.isNull()) return;
      const removed = Math.min(this.removedPointer.readU32(), this.count);
      for (let index = 0; index < removed; index += 1) {
        const entry = this.entries.add(index * 32);
        emitCompletedReceive(entry.add(8).readPointer(), entry.add(24).readU32(), 'iocp-ex');
      }
    },
  });
  send({ kind: 'hook', name: 'GetQueuedCompletionStatusEx', address: target.toString() });
} catch (error) { send({ kind: 'hook_error', name: 'GetQueuedCompletionStatusEx', error: String(error) }); }
