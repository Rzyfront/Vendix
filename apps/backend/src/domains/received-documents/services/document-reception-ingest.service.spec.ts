import { BadRequestException, ConflictException } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { DocumentReceptionEnvelope } from '../interfaces/document-reception-envelope.interface';
import { ReceivedDocumentScanQueueService } from './received-document-scan-queue.service';
import { DocumentReceptionIngestService } from './document-reception-ingest.service';

const context: ReceivedDocumentsContext = {
  organization_id: 7, accounting_entity_id: 12, store_id: 19, actor_id: 44, is_organization: true,
};

function xmlDocument(external_id: string) {
  return { external_id, file_name: `${external_id}.xml`, mime_type: 'application/xml' as const, content: Buffer.from('<Invoice/>') };
}

function pdfDocument(external_id: string) {
  return { external_id, file_name: `${external_id}.pdf`, mime_type: 'application/pdf' as const, content: Buffer.from('%PDF-1.7') };
}

function envelope(documents: any[], next_cursor: string | null = 'provider-next-cursor'): DocumentReceptionEnvelope {
  return { version: 1, documents, next_cursor };
}

function harness() {
  const documents = { importXmlWithOutcome: jest.fn() };
  const scanQueue = { enqueue: jest.fn() };
  return {
    service: new DocumentReceptionIngestService(
      documents as unknown as ReceivedDocumentsService,
      scanQueue as unknown as ReceivedDocumentScanQueueService,
    ),
    documents,
    scanQueue,
  };
}

describe('DocumentReceptionIngestService', () => {
  it('imports XML sequentially and counts idempotent redelivery as duplicate', async () => {
    const h = harness();
    h.documents.importXmlWithOutcome
      .mockResolvedValueOnce({ document: { id: 101 }, created: true })
      .mockResolvedValueOnce({ document: { id: 101 }, created: false });
    let callbackCount = 0;
    const result = await h.service.ingest(context, envelope([xmlDocument('x1'), xmlDocument('x2')]), 'api', async () => { callbackCount += 1; });
    expect(result).toEqual({
      received_count: 1, duplicate_count: 1, error_count: 0, document_ids: [101], error_codes: [], next_cursor: 'provider-next-cursor',
    });
    expect(callbackCount).toBe(2);
    expect(h.documents.importXmlWithOutcome).toHaveBeenNthCalledWith(1, context, expect.objectContaining({
      originalname: 'x1.xml', mimetype: 'application/xml', buffer: Buffer.from('<Invoice/>'), size: 10,
    }), 'api');
    expect(h.scanQueue.enqueue).not.toHaveBeenCalled();
  });

  it('queues image/PDF originals as OCR intake without calling an AI provider directly', async () => {
    const h = harness();
    h.scanQueue.enqueue.mockResolvedValueOnce({ document_id: 202, job_id: 'job-1', already_processed: false, created: true });
    const result = await h.service.ingest(context, envelope([pdfDocument('p1')]), 'automated');
    expect(result).toMatchObject({ received_count: 1, duplicate_count: 0, error_count: 0, document_ids: [202] });
    expect(h.scanQueue.enqueue).toHaveBeenCalledWith(context, expect.objectContaining({
      originalname: 'p1.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7'), size: 8,
    }), 'automated');
    expect(h.documents.importXmlWithOutcome).not.toHaveBeenCalled();
  });

  it('continues after per-document failures with only safe codes and preserves proposed cursor metadata', async () => {
    const h = harness();
    h.documents.importXmlWithOutcome.mockRejectedValueOnce(new BadRequestException('secret XML details'));
    h.scanQueue.enqueue.mockRejectedValueOnce(new Error('bearer-token from provider response'));
    const result = await h.service.ingest(context, envelope([xmlDocument('bad'), pdfDocument('also-bad')]), 'email');
    expect(result).toEqual({
      received_count: 0,
      duplicate_count: 0,
      error_count: 2,
      document_ids: [],
      error_codes: [ErrorCodes.SYS_VALIDATION_001.code, ErrorCodes.SYS_INTERNAL_001.code],
      next_cursor: 'provider-next-cursor',
    });
    expect(JSON.stringify(result)).not.toContain('secret XML details');
    expect(JSON.stringify(result)).not.toContain('bearer-token');
  });

  it('preserves recognized Vendix codes but aborts the batch on lease/context callback failure', async () => {
    const h = harness();
    h.documents.importXmlWithOutcome.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.SUBSCRIPTION_006));
    const partial = await h.service.ingest(context, envelope([xmlDocument('blocked')]), 'api');
    expect(partial.error_codes).toEqual([ErrorCodes.SUBSCRIPTION_006.code]);

    const lostLease = new ConflictException('lease lost');
    const beforeEach = jest.fn().mockRejectedValue(lostLease);
    await expect(h.service.ingest(context, envelope([xmlDocument('never')]), 'api', beforeEach)).rejects.toBe(lostLease);
    expect(beforeEach).toHaveBeenCalledTimes(1);
    expect(h.documents.importXmlWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported ingestion source before touching intake services', async () => {
    const h = harness();
    await expect(h.service.ingest(context, envelope([xmlDocument('x')]), 'manual' as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.documents.importXmlWithOutcome).not.toHaveBeenCalled();
    expect(h.scanQueue.enqueue).not.toHaveBeenCalled();
  });
});
