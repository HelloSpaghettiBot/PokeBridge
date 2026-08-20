import { mkdir, open } from 'node:fs/promises';
import { dirname, extname, join, basename } from 'node:path';

export class CaptureWriter {
  #handle;
  #path;
  #bytesWritten = 0;
  #fileIndex = 0;
  #maxBytes;
  #pending = Promise.resolve();

  static async open(path, options = {}) {
    await mkdir(dirname(path), { recursive: true });
    const writer = new CaptureWriter(path, options);
    await writer.#openNext();
    return writer;
  }

  constructor(path, options) {
    this.#path = path;
    this.#maxBytes = options.maxBytes ?? 0;
  }

  get activePath() {
    return this.#currentPath();
  }

  write(event) {
    const record = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(record);
    this.#pending = this.#pending.then(async () => {
      if (this.#shouldRotate(bytes)) await this.#rotate();
      await this.#handle.write(record);
      this.#bytesWritten += bytes;
    });
    return this.#pending;
  }

  async close() {
    await this.#pending;
    await this.#handle?.close();
  }

  async #openNext() {
    const path = this.#currentPath();
    this.#handle = await open(path, 'a');
    this.#bytesWritten = 0;
  }

  async #rotate() {
    await this.#handle?.close();
    this.#fileIndex += 1;
    await this.#openNext();
  }

  #shouldRotate(nextBytes) {
    return this.#maxBytes > 0 && this.#bytesWritten > 0 && this.#bytesWritten + nextBytes > this.#maxBytes;
  }

  #currentPath() {
    if (this.#maxBytes <= 0) return this.#path;
    const directory = dirname(this.#path);
    const extension = extname(this.#path);
    const stem = basename(this.#path, extension);
    return join(directory, `${stem}.${String(this.#fileIndex).padStart(6, '0')}${extension}`);
  }
}
