import { Writable } from 'stream';
import type { S3Service } from '../../../../common/services/s3.service';

/** S3 needs 5 MiB per part but the last; 8 MiB keeps 10 000 parts far away. */
export const EXPORT_PART_BYTES = 8 * 1024 * 1024;

/** The slice of `S3Service` the sink needs (so a spec can fake it). */
export type S3MultipartApi = Pick<
  S3Service,
  'createMultipartUpload' | 'uploadMultipartPart' | 'completeMultipartUpload' | 'abortMultipartUpload'
>;

/**
 * Writable that turns a byte stream into one S3 multipart upload with parts of
 * `partBytes`, never holding more than one part in memory. Backpressure is the
 * stream's own: `write` calls back after the part is uploaded. On any failure
 * or `destroy`, the unfinished upload is aborted, so no object (and no orphan
 * part) is left behind.
 */
export class S3MultipartWritable extends Writable {
  private uploadId: string | null = null;
  private chunks: Buffer[] = [];
  private buffered = 0;
  private partNumber = 0;
  private readonly parts: Array<{ partNumber: number; etag: string }> = [];
  private completed = false;
  /** Bytes accepted so far (the size of the final object). */
  total = 0;

  constructor(
    private readonly s3: S3MultipartApi,
    private readonly key: string,
    private readonly contentType: string,
    private readonly partBytes: number = EXPORT_PART_BYTES,
  ) {
    super();
  }

  /** True once the object exists in S3. */
  get isCompleted(): boolean {
    return this.completed;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.total += chunk.length;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    if (this.buffered < this.partBytes) return callback();
    this.flushPart().then(() => callback(), callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.finish().then(() => callback(), callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.uploadId && !this.completed) {
      this.s3.abortMultipartUpload(this.key, this.uploadId).finally(() => callback(error));
      return;
    }
    callback(error);
  }

  private async flushPart(): Promise<void> {
    if (!this.uploadId) this.uploadId = await this.s3.createMultipartUpload(this.key, this.contentType);
    const body = Buffer.concat(this.chunks);
    this.chunks = [];
    this.buffered = 0;
    this.partNumber += 1;
    const etag = await this.s3.uploadMultipartPart(this.key, this.uploadId, this.partNumber, body);
    this.parts.push({ partNumber: this.partNumber, etag });
  }

  private async finish(): Promise<void> {
    if (this.buffered > 0 || !this.uploadId) await this.flushPart();
    await this.s3.completeMultipartUpload(this.key, this.uploadId as string, this.parts);
    this.completed = true;
  }
}
