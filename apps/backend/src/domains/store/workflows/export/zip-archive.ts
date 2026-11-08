import { finished } from 'stream/promises';
import type { Readable, Writable } from 'stream';
import archiverFactory = require('archiver');

/** Exactly the slice of `archiver` the export uses (the package ships no types). */
interface ArchiverLike {
  append(source: Buffer | string | Readable, data: { name: string }): ArchiverLike;
  pipe<T extends Writable>(destination: T): T;
  finalize(): Promise<void>;
  abort(): ArchiverLike;
  pointer(): number;
  on(event: 'entry', listener: (entry: { name: string }) => void): ArchiverLike;
  on(event: 'warning' | 'error', listener: (error: Error) => void): ArchiverLike;
}

type ArchiverFactory = (
  format: 'zip',
  options: { forceZip64: boolean; zlib: { level: number } },
) => ArchiverLike;

const createArchiver = archiverFactory as unknown as ArchiverFactory;

/**
 * Streaming ZIP writer. Entries are added one at a time and each `add` settles
 * when the entry has been fully consumed, so the caller can compute hashes and
 * write the manifest last, while memory stays bounded by one entry chunk.
 * ZIP64 is forced: an export can pass 4 GB and the entries are streamed, so
 * their size is unknown when the header is written.
 */
export class ZipWriter {
  private readonly archive: ArchiverLike;
  private readonly waiting = new Map<string, () => void>();
  private failure: Error | null = null;
  private readonly onFailure: Array<(error: Error) => void> = [];
  private outFinished = false;

  constructor(private readonly out: Writable) {
    this.archive = createArchiver('zip', { forceZip64: true, zlib: { level: 6 } });
    this.archive.on('entry', (entry) => {
      const done = this.waiting.get(entry.name);
      this.waiting.delete(entry.name);
      done?.();
    });
    const fail = (error: Error): void => {
      if (this.failure) return;
      this.failure = error;
      this.onFailure.splice(0).forEach((reject) => reject(error));
      this.out.destroy(error);
    };
    this.archive.on('error', fail);
    this.archive.on('warning', fail);
    // `pipe` only unpipes when the destination fails (a multipart part that
    // does not upload), so the archive would wait forever for a reader: the
    // destination's own failure or early close settles every pending call.
    this.out.on('error', fail);
    this.out.on('finish', () => {
      this.outFinished = true;
    });
    this.out.on('close', () => {
      if (!this.outFinished) fail(new Error('The export destination closed before the archive finished'));
    });
    this.archive.pipe(this.out);
  }

  /** Adds one entry and resolves once the archive has taken all of its bytes. */
  add(path: string, source: Buffer | string | Readable): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<void>((resolve, reject) => {
      this.waiting.set(path, resolve);
      this.onFailure.push(reject);
      this.archive.append(source, { name: path });
    });
  }

  /** Closes the archive and resolves when the destination has finished. */
  async finalize(): Promise<void> {
    if (this.failure) throw this.failure;
    const failed = new Promise<never>((_, reject) => this.onFailure.push(reject));
    await Promise.race([Promise.all([this.archive.finalize(), finished(this.out)]), failed]);
    if (this.failure) throw this.failure;
  }

  /** Stops the archive (the destination is aborted by its owner). */
  abort(): void {
    this.archive.abort();
  }

  /** Bytes of the archive produced so far. */
  get bytes(): number {
    return this.archive.pointer();
  }
}
