import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { Readable } from 'node:stream';
import { posix } from 'node:path';
import * as yauzl from 'yauzl';
import type { DocumentEmailWarning } from '../interfaces/document-email-reception.interface';

export const DOCUMENT_EMAIL_ZIP_LIMITS = Symbol('DOCUMENT_EMAIL_ZIP_LIMITS');
export interface DocumentEmailZipLimits {
  compressed_bytes: number;
  inflated_bytes: number;
  entry_bytes: number;
  entries: number;
  ratio: number;
}
/** One mutable budget per email, shared across every archive and nested principal. */
export interface DocumentEmailZipBudget {
  inflated_bytes: number;
  entries: number;
}
export interface DocumentEmailZipEntry {
  filename: string;
  bytes: Buffer;
  kind: 'xml' | 'pdf' | 'zip' | 'other';
}
export interface DocumentEmailZipResult {
  entries: DocumentEmailZipEntry[];
  warnings: DocumentEmailWarning[];
}
const DEFAULTS: DocumentEmailZipLimits = {
  compressed_bytes: 10 * 1024 * 1024,
  inflated_bytes: 30 * 1024 * 1024,
  entry_bytes: 10 * 1024 * 1024,
  entries: 40,
  ratio: 100,
};
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

@Injectable()
export class DocumentEmailZipService {
  private readonly limits: DocumentEmailZipLimits;
  constructor(@Optional() @Inject(DOCUMENT_EMAIL_ZIP_LIMITS) limits: Partial<DocumentEmailZipLimits> = {}) {
    this.limits = { ...DEFAULTS, ...limits };
    if (Object.values(this.limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw this.error('LIMIT_EXCEEDED', 'Los límites del archivo no son válidos.');
    }
  }

  async extract(
    bytes: Buffer,
    budget: DocumentEmailZipBudget = { inflated_bytes: 0, entries: 0 },
    signal?: AbortSignal,
  ): Promise<DocumentEmailZipResult> {
    this.assertBudget(budget);
    return this.extractLevel(bytes, budget, signal, 0);
  }

  private async extractLevel(
    bytes: Buffer,
    budget: DocumentEmailZipBudget,
    signal: AbortSignal | undefined,
    depth: number,
  ): Promise<DocumentEmailZipResult> {
    this.assertActive(signal);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || !this.isZip(bytes)) {
      throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El archivo comprimido no es válido.');
    }
    if (bytes.length > this.limits.compressed_bytes) {
      throw this.error('LIMIT_EXCEEDED', 'El archivo comprimido supera el límite permitido.');
    }
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, opened) => {
        if (error || !opened) reject(this.error('CORRUPT_OR_ENCRYPTED_FILE', 'No pudimos abrir el archivo comprimido.'));
        else resolve(opened);
      });
    });
    const streams = new Set<Readable>();
    const files: DocumentEmailZipEntry[] = [];
    const names = new Set<string>();
    let failure: BadRequestException | undefined;
    const fail = (error: unknown): void => {
      if (failure) return;
      failure = error instanceof BadRequestException ? error : this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El archivo comprimido está dañado.');
      for (const stream of streams) stream.destroy(failure);
      zip.close();
    };
    const abort = (): void => fail(this.error('TECHNICAL_PROCESSING_ERROR', 'Se interrumpió la lectura del archivo.'));
    zip.on('error', fail);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      // Lazy entries: only open and inflate one entry at a time.
      await new Promise<void>((resolve, reject) => {
        const stop = (error: unknown): void => { fail(error); reject(failure); };
        zip.once('end', resolve);
        zip.once('error', stop);
        const onAbort = (): void => stop(this.error('TECHNICAL_PROCESSING_ERROR', 'Se interrumpió la lectura del archivo.'));
        signal?.addEventListener('abort', onAbort, { once: true });
        const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
        zip.once('end', cleanup);
        zip.once('close', () => { cleanup(); if (failure) reject(failure); });
        zip.on('entry', (entry: yauzl.Entry) => {
          void (async () => {
            this.assertActive(signal);
            budget.entries += 1;
            if (budget.entries > this.limits.entries) throw this.error('LIMIT_EXCEEDED', 'El correo contiene demasiadas entradas comprimidas.');
            const name = this.safeName(entry.fileName);
            const collisionName = name.replace(/\/$/, '');
            if (names.has(collisionName)) throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El archivo tiene nombres duplicados.');
            names.add(collisionName);
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode === 0xa000 || (entry.generalPurposeBitFlag & 0x41)) {
              throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'No admitimos archivos con contraseña o enlaces simbólicos.');
            }
            if (![0, 8].includes(entry.compressionMethod)) throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El método de compresión no está admitido.');
            if (!Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize)) {
              throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El tamaño del archivo no es válido.');
            }
            const local = await zip.readLocalFileHeaderPromise(entry);
            if (local.generalPurposeBitFlag !== entry.generalPurposeBitFlag || local.compressionMethod !== entry.compressionMethod || !local.fileName.equals(entry.fileNameRaw)) {
              throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'Las cabeceras del archivo son inconsistentes.');
            }
            if (!(entry.generalPurposeBitFlag & 8) && (local.crc32 !== entry.crc32 || local.compressedSize !== entry.compressedSize || local.uncompressedSize !== entry.uncompressedSize)) {
              throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'Los tamaños o el CRC de las cabeceras no coinciden.');
            }
            if (name.endsWith('/')) {
              if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'Una carpeta comprimida contiene datos no válidos.');
              zip.readEntry();
              return;
            }
            const stream = await zip.openReadStreamPromise(entry);
            streams.add(stream);
            let crc = 0xffffffff;
            let actual = 0;
            const chunks: Buffer[] = [];
            try {
              for await (const chunk of stream) {
                this.assertActive(signal);
                const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
                actual += value.length;
                budget.inflated_bytes += value.length;
                if (actual > this.limits.entry_bytes || budget.inflated_bytes > this.limits.inflated_bytes || actual > Math.max(1, entry.compressedSize) * this.limits.ratio) {
                  throw this.error('LIMIT_EXCEEDED', 'El archivo supera los límites de descompresión.');
                }
                for (const byte of value) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
                chunks.push(value);
              }
              if (actual !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== (entry.crc32 >>> 0)) {
                throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El archivo no supera la comprobación de integridad.');
              }
              const content = Buffer.concat(chunks, actual);
              files.push({ filename: name.slice(0, 120), bytes: content, kind: this.kind(content) });
            } finally {
              streams.delete(stream);
              stream.destroy();
            }
            zip.readEntry();
          })().catch(stop);
        });
        zip.readEntry();
      });
      if (failure) throw failure;
      this.assertActive(signal);
    } catch (error) {
      fail(error);
      throw failure;
    } finally {
      signal?.removeEventListener('abort', abort);
      for (const stream of streams) stream.destroy();
      zip.close();
    }
    const nested = files.filter((file) => file.kind === 'zip');
    if (nested.length && files.length === 1) {
      if (depth >= 1) throw this.error('NESTING_LIMIT_EXCEEDED', 'Hay demasiados archivos comprimidos dentro de otros.');
      return this.extractLevel(nested[0].bytes, budget, signal, depth + 1);
    }
    if (nested.length) {
      if (!files.some((file) => file.kind === 'xml')) {
        throw this.error('NESTING_LIMIT_EXCEEDED', 'El archivo comprimido principal debe ser el único contenido.');
      }
      // No recursion/inspection of complementary ZIPs. They remain opaque in the original.
      return { entries: files.filter((file) => file.kind !== 'zip'), warnings: ['COMPLEMENT_ARCHIVE_NOT_EXPANDED'] };
    }
    return { entries: files, warnings: [] };
  }

  private safeName(raw: string): string {
    if (!raw || /[\x00-\x1f\x7f]/.test(raw) || /^[A-Za-z]:/.test(raw) || /^[\/\\]/.test(raw)) {
      throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El archivo contiene una ruta no permitida.');
    }
    const slash = raw.replace(/\\/g, '/').normalize('NFC');
    if (slash.split('/').includes('..')) throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El archivo contiene una ruta no permitida.');
    const canonical = posix.normalize(slash);
    if (canonical === '.' || canonical.startsWith('../') || canonical.length > 120) {
      throw this.error('CORRUPT_OR_ENCRYPTED_FILE', 'El nombre de una entrada no es válido.');
    }
    return canonical;
  }

  private kind(bytes: Buffer): DocumentEmailZipEntry['kind'] {
    if (this.isZip(bytes)) return 'zip';
    if (bytes.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
    const prefix = bytes.subarray(0, 1024).toString('latin1').replace(/^ï»¿/, '').trimStart();
    if (/^<\?xml\b|^<(?:[\w-]+:)?(?:Invoice|CreditNote|DebitNote|AttachedDocument|ApplicationResponse)\b/.test(prefix)) return 'xml';
    return 'other';
  }
  private isZip(bytes: Buffer): boolean { return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50; }
  private assertBudget(budget: DocumentEmailZipBudget): void {
    if (!budget || !Number.isSafeInteger(budget.inflated_bytes) || budget.inflated_bytes < 0 || !Number.isSafeInteger(budget.entries) || budget.entries < 0) {
      throw this.error('LIMIT_EXCEEDED', 'El presupuesto de descompresión no es válido.');
    }
  }
  private assertActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.error('TECHNICAL_PROCESSING_ERROR', 'Se interrumpió la lectura del archivo.');
  }
  private error(reason_code: string, message: string): BadRequestException { return new BadRequestException({ reason_code, message }); }
}
