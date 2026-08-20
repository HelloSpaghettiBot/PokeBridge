export class LengthPrefixedPacketFramer {
  constructor(options = {}) {
    this.maxFrameLength = options.maxFrameLength ?? 65535;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    if (chunk.length > 0) {
      this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    }

    const frames = [];
    while (this.buffer.length >= 2) {
      const frameLength = this.buffer.readUInt16LE(0);
      if (frameLength < 2) throw new Error(`Invalid frame length: ${frameLength}`);
      if (frameLength > this.maxFrameLength) {
        throw new Error(`Frame length ${frameLength} exceeds maximum ${this.maxFrameLength}`);
      }
      if (this.buffer.length < frameLength) break;
      frames.push(Buffer.from(this.buffer.subarray(0, frameLength)));
      this.buffer = Buffer.from(this.buffer.subarray(frameLength));
    }
    return frames;
  }

  getPendingBytes() {
    return Buffer.from(this.buffer);
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

export function hasMatchingLengthPrefix(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 2 && buffer.readUInt16LE(0) === buffer.length;
}
