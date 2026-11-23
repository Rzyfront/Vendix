import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import {
  AiExtractionError,
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import type { AiDocumentPage } from '@common/ai-ingest/documents/document-pages.service';
import {
  readDocumentWithAi,
  ReadDocumentBatchContext,
} from '@common/ai-ingest/documents/document-reader';
import {
  detectQueuedDocument,
  discardQueuedDocument,
  loadQueuedDocument,
  QueuedDocumentFile,
  QueuedDocumentRef,
  stashQueuedDocument,
  UploadedDocument,
} from '@common/ai-ingest/documents/queued-document';
import {
  mergeInvoiceBatches,
  PURCHASE_INVOICE_SCHEMA,
} from '../orders/purchase-orders/purchase-invoice-ingest.profile';

/** Same cap as the upload endpoint (10 MB). */
export const RECEIPT_SCAN_MAX_BYTES = 10 * 1024 * 1024;

const RECEIPT_LIMITS = {
  maxPages: 10,
  // Up to 5 pages in ONE call: a short receipt is read in a single answer,
  // with its supplier and lines in view, as before.
  pagesPerBatch: 5,
};

/** The text the scanner always sent with a photo; kept word for word. */
export const RECEIPT_IMAGE_INSTRUCTION =
  'Extract all data from this purchase receipt / invoice image. Return ONLY the JSON object matching the schema defined in your system instructions.';

const RECEIPT_DOCUMENT_INSTRUCTION =
  'Extract all data from this purchase receipt / invoice. Its pages follow, each one as the text extracted from the PDF or as an image of the page. Return ONLY the JSON object matching the schema defined in your system instructions.';

export function buildReceiptInstruction(
  batch: AiDocumentPage[],
  context: ReadDocumentBatchContext,
): string {
  const single = context.totalBatches <= 1;
  const photo =
    single && context.totalPages === 1 && batch.every((p) => p.mode === 'image');
  if (photo) return RECEIPT_IMAGE_INSTRUCTION;
  if (single) return RECEIPT_DOCUMENT_INSTRUCTION;
  const numbers = batch.map((p) => p.page_number);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return (
    `${RECEIPT_DOCUMENT_INSTRUCTION}\n\nThis message holds ${first === last ? `page ${first}` : `pages ${first}-${last}`} of a ${context.totalPages}-page document; the other pages are read in separate messages. ` +
    'Report ONLY the line items printed on these pages, each exactly once and in printed order. Fill the supplier only if it is printed on these pages; otherwise use null.'
  );
}

export interface ReceiptReading {
  /** ONE raw `invoice_ocr` answer for `normalizeReceiptScan`. */
  data: Record<string, any>;
  /** Spanish, ready to show: pages not read, lines merged across batches. */
  warnings: string[];
  pages: number;
  textPages: number;
  batches: number;
}

/**
 * Document side of the purchase-receipt scanner (plan ia-cargas F5a, #11).
 *
 * - Enqueue: the REAL type is checked by signature and the original upload
 *   goes to S3; the `receipt-scan` job carries only the key (Redis no longer
 *   holds a base64 image). Jobs queued before keep their `dataUri` and still
 *   work.
 * - Worker: the shared page reader (native PDF text first, scans and photos
 *   as images, never the raw PDF), the `invoice_ocr` answer checked with the
 *   purchase-invoice schema and repaired once, several batches merged with
 *   the same rules as the purchase invoice scanner.
 *
 * A separate provider so `DispatchNotesService` (positional constructor used
 * by many specs) only gains one optional dependency.
 */
@Injectable()
export class ReceiptScanReaderService {
  constructor(
    private readonly s3: S3Service,
    private readonly documentPages: DocumentPagesService,
    private readonly extraction: AiExtractionService,
  ) {}

  /** Real type check + S3 copy of the upload, before enqueueing. */
  async stash(
    file: UploadedDocument,
    tenant: { organizationId?: number | null; storeId?: number | null },
  ): Promise<QueuedDocumentRef> {
    const detected = this.detect(file);
    return stashQueuedDocument(this.s3, {
      kind: 'receipt',
      file,
      detected,
      organizationId: tenant.organizationId,
      storeId: tenant.storeId,
    });
  }

  detect(file: UploadedDocument) {
    if ((file?.buffer?.length ?? 0) > RECEIPT_SCAN_MAX_BYTES) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'El recibo debe pesar como máximo 10 MB.',
      );
    }
    return detectQueuedDocument(
      file,
      'El recibo debe ser un PDF o una foto (JPG, PNG o WebP).',
    );
  }

  load(ref: Partial<QueuedDocumentRef>): Promise<QueuedDocumentFile> {
    return loadQueuedDocument(this.s3, ref);
  }

  discard(ref: Partial<QueuedDocumentRef>): Promise<void> {
    return discardQueuedDocument(this.s3, ref);
  }

  /**
   * The receipt by pages → ONE raw answer. Keeps the scanner's error
   * contract: an unusable answer is `DISPATCH_RECEIPT_SCAN_PARSE_FAIL`, an AI
   * failure `DISPATCH_RECEIPT_SCAN_AI_FAIL`; document problems keep their
   * `AI_INGEST_*` code.
   */
  async read(
    file: { buffer: Buffer; mimeType?: string | null; originalName?: string | null },
    options: { reportProgress?: (progress: AiJobProgress) => Promise<void> } = {},
  ): Promise<ReceiptReading> {
    const detected = this.detect({
      buffer: file.buffer,
      originalname: file.originalName,
      mimetype: file.mimeType,
    });
    let read;
    try {
      read = await readDocumentWithAi<Record<string, any>>({
        file: { buffer: file.buffer, originalName: file.originalName ?? 'recibo' },
        mimeType: detected.mime,
        pages: this.documentPages,
        extraction: this.extraction,
        appKey: 'invoice_ocr',
        schema: { name: 'purchase_receipt', schema: PURCHASE_INVOICE_SCHEMA },
        instruction: buildReceiptInstruction,
        limits: RECEIPT_LIMITS,
        maxBytes: RECEIPT_SCAN_MAX_BYTES,
        // A photo stays ONE image, as before: strips could read a line twice.
        splitTallImages: false,
        // One unit of quota per scan, as the single call charged before.
        quotaKey: newIngestQuotaKey(),
        reportProgress: options.reportProgress,
        logLabel: 'ReceiptScan',
      });
    } catch (err) {
      throw this.toScanError(err);
    }
    const merged = mergeInvoiceBatches(read.batches);
    return {
      data: merged.data,
      warnings: [...read.warnings, ...merged.warnings],
      pages: read.pages,
      textPages: read.textPages,
      batches: read.batches.length,
    };
  }

  private toScanError(err: unknown): unknown {
    const error = err instanceof AiExtractionError ? err.toHttpException() : err;
    if (!(error instanceof VendixHttpException)) return error;
    if (error.errorCode === ErrorCodes.AI_INGEST_PARSE_FAIL.code) {
      return new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_PARSE_FAIL);
    }
    if (error.errorCode === ErrorCodes.AI_REQUEST_001.code) {
      return new VendixHttpException(ErrorCodes.DISPATCH_RECEIPT_SCAN_AI_FAIL);
    }
    return error;
  }
}
