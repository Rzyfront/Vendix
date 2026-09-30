import { BadRequestException, Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { DocumentReceptionEnvelope, DocumentReceptionEnvelopeDocument } from '../interfaces/document-reception-envelope.interface';
import { ReceivedDocumentScanQueueService } from './received-document-scan-queue.service';

export type DocumentReceptionIngestSource = 'api' | 'email' | 'automated';

export interface DocumentReceptionIngestResult {
  received_count: number;
  duplicate_count: number;
  error_count: number;
  document_ids: number[];
  error_codes: string[];
  /** Provider proposal only. This service never commits connection cursor state. */
  next_cursor: string | null;
}

@Injectable()
export class DocumentReceptionIngestService {
  constructor(
    private readonly documents: ReceivedDocumentsService,
    private readonly scanQueue: ReceivedDocumentScanQueueService,
  ) {}

  async ingest(
    ctx: ReceivedDocumentsContext,
    envelope: DocumentReceptionEnvelope,
    source: DocumentReceptionIngestSource,
    beforeEach?: () => Promise<void>,
  ): Promise<DocumentReceptionIngestResult> {
    if (!['api', 'email', 'automated'].includes(source)) throw new BadRequestException('Canal de recepción no válido.');

    let receivedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const documentIds: number[] = [];
    const seenDocumentIds = new Set<number>();
    const errorCodes: string[] = [];

    for (const document of envelope.documents) {
      // A lost lease/context aborts the batch rather than being recorded as a bad document.
      if (beforeEach) await beforeEach();
      try {
        const file = this.asMulterFile(document);
        const outcome = this.isXml(document.mime_type)
          ? await this.documents.importXmlWithOutcome(ctx, file, source)
          : await this.scanQueue.enqueue(ctx, file, source);
        const documentId = 'document' in outcome ? outcome.document.id : outcome.document_id;
        const created = outcome.created;
        if (Number.isSafeInteger(documentId) && documentId > 0 && !seenDocumentIds.has(documentId)) {
          seenDocumentIds.add(documentId);
          documentIds.push(documentId);
        }
        if (created) receivedCount += 1;
        else duplicateCount += 1;
      } catch (error) {
        errorCount += 1;
        const code = this.safeErrorCode(error);
        if (!errorCodes.includes(code)) errorCodes.push(code);
      }
    }

    return {
      received_count: receivedCount,
      duplicate_count: duplicateCount,
      error_count: errorCount,
      document_ids: documentIds,
      error_codes: errorCodes,
      // This is an uncommitted provider proposal; guarded connection finish owns cursor updates.
      next_cursor: envelope.next_cursor,
    };
  }

  private asMulterFile(document: DocumentReceptionEnvelopeDocument): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname: document.file_name,
      encoding: '7bit',
      mimetype: document.mime_type,
      size: document.content.length,
      buffer: document.content,
    } as Express.Multer.File;
  }

  private isXml(mimeType: string): boolean {
    return mimeType === 'application/xml' || mimeType === 'text/xml';
  }

  private safeErrorCode(error: unknown): string {
    if (error instanceof VendixHttpException) {
      const recognized = Object.values(ErrorCodes).find((entry) => entry.code === error.errorCode);
      if (recognized) return recognized.code;
    }
    if (error instanceof BadRequestException) return ErrorCodes.SYS_VALIDATION_001.code;
    return ErrorCodes.SYS_INTERNAL_001.code;
  }
}
