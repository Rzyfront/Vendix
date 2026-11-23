import { VendixHttpException, ErrorCodes } from '@common/errors';
import type { S3Service } from '@common/services/s3.service';
import { detectIngestFile, DetectedIngestFile } from '../ingest-file.detector';

/**
 * Document of a legacy AI queue (`expense-scan`, `receipt-scan`), as it
 * travels in the job (plan ia-cargas F5a).
 *
 * - New jobs carry `file_key`: the original upload lives in S3, as in the
 *   generic `ai-scan` queue. Redis never holds the file and the worker reads
 *   the REAL document (every PDF page, the native text) instead of a JPEG
 *   prepared at enqueue time.
 * - Jobs queued before this change carry `dataUri` (an image already reduced
 *   by sharp, or the raw PDF/file as base64). They keep working: the worker
 *   decodes it and reads it through the same shared reader.
 */
export interface QueuedDocumentRef {
  /** S3 key of the original upload (new jobs). */
  file_key?: string;
  /** `data:<mime>;base64,<...>` (jobs queued before F5a). */
  dataUri?: string;
  /** REAL type detected by signature at enqueue (old jobs: the encoded type). */
  mimeType: string;
  originalName?: string;
}

export interface QueuedDocumentFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface UploadedDocument {
  buffer: Buffer;
  originalname?: string | null;
  mimetype?: string | null;
}

/**
 * Real type of an upload by its bytes (never the multipart one). Only a PDF or
 * a photo is a document; anything else fails as a problem of the document.
 */
export function detectQueuedDocument(
  file: UploadedDocument,
  message = 'El archivo no es un PDF ni una imagen (JPG, PNG o WebP) que se pueda leer.',
): DetectedIngestFile {
  const detected = file?.buffer?.length
    ? detectIngestFile({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
      })
    : null;
  if (!detected || detected.kind === 'sheet') {
    throw new VendixHttpException(ErrorCodes.AI_INGEST_INVALID_FILE, message);
  }
  return detected;
}

function safeFileName(original?: string | null): string {
  return (
    (original ?? '')
      .split(/[\\/]/)
      .pop()!
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(0, 120) || 'documento'
  );
}

/**
 * Stores the upload in S3 under the same prefix the `ai-scan` queue uses
 * (`ai-scans/<org>/store-<id>/<kind>/…`) and returns what the job carries.
 * An S3 failure is `UPLOAD_FAILED_001`, as in `AiScanJobService.enqueue`.
 */
export async function stashQueuedDocument(
  s3: Pick<S3Service, 'uploadFile'>,
  input: {
    kind: string;
    file: UploadedDocument;
    detected: DetectedIngestFile;
    organizationId?: number | null;
    storeId?: number | null;
  },
): Promise<QueuedDocumentRef> {
  const prefix = `ai-scans/${input.organizationId ?? 'platform'}/${
    input.storeId ? 'store-' + input.storeId : 'org'
  }/${input.kind}`;
  const originalName = safeFileName(input.file.originalname);
  try {
    const file_key = await s3.uploadFile(
      input.file.buffer,
      `${prefix}/${Date.now()}-${originalName}`,
      input.detected.mime,
    );
    return { file_key, mimeType: input.detected.mime, originalName };
  } catch {
    throw new VendixHttpException(ErrorCodes.UPLOAD_FAILED_001);
  }
}

/** `data:<mime>;base64,<payload>` → bytes. Null when it is not a data URI. */
export function decodeDataUri(dataUri: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]*)(;base64)?,/.exec(dataUri ?? '');
  if (!match || !match[2]) return null;
  const buffer = Buffer.from(dataUri.slice(match[0].length), 'base64');
  return buffer.length ? { buffer, mime: match[1] || 'application/octet-stream' } : null;
}

/**
 * The job's document as bytes: from S3 (new jobs) or from the data URI (jobs
 * queued before F5a). An S3 failure is retried by BullMQ like any transient
 * error; a job with neither is a broken document.
 */
export async function loadQueuedDocument(
  s3: Pick<S3Service, 'downloadFile'>,
  ref: Partial<QueuedDocumentRef> | null | undefined,
): Promise<QueuedDocumentFile> {
  if (ref?.file_key) {
    const buffer = await s3.downloadFile(ref.file_key);
    return {
      buffer,
      mimeType: ref.mimeType ?? 'application/octet-stream',
      originalName: ref.originalName ?? 'documento',
    };
  }
  const decoded = ref?.dataUri ? decodeDataUri(ref.dataUri) : null;
  if (!decoded) {
    throw new VendixHttpException(
      ErrorCodes.AI_INGEST_INVALID_FILE,
      'El documento del escaneo no llegó completo. Súbelo de nuevo.',
    );
  }
  return {
    buffer: decoded.buffer,
    mimeType: ref?.mimeType ?? decoded.mime,
    originalName: ref?.originalName ?? 'documento',
  };
}

/**
 * Removes the S3 copy once the job is done with it (completed, or failed for
 * good). Best effort: a leftover file never fails the job.
 */
export async function discardQueuedDocument(
  s3: Pick<S3Service, 'deleteFile'>,
  ref: Partial<QueuedDocumentRef> | null | undefined,
): Promise<void> {
  if (!ref?.file_key) return;
  try {
    await s3.deleteFile(ref.file_key);
  } catch {
    // Best effort.
  }
}
