import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedDocumentScanQueueService } from './received-document-scan-queue.service';

describe('ReceivedDocumentScanQueueService', () => {
  const context: ReceivedDocumentsContext = {
    organization_id: 7,
    accounting_entity_id: 12,
    store_id: 19,
    actor_id: 44,
    is_organization: true,
  };
  const makePdf = (): Express.Multer.File => ({
    buffer: Buffer.from('%PDF-1.7 test'),
    size: 13,
    mimetype: 'application/pdf',
    originalname: 'supplier.pdf',
  } as Express.Multer.File);
  let queue: any;
  let documents: jest.Mocked<Pick<ReceivedDocumentsService, 'createPendingFileWithOutcome' | 'findOne' | 'getFile' | 'replaceFromExtraction'>>;
  let scanner: any;
  let prisma: any;
  let subscription: any;
  let service: ReceivedDocumentScanQueueService;

  beforeEach(() => {
    queue = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    documents = {
      createPendingFileWithOutcome: jest.fn().mockResolvedValue({ document: {
        id: 101,
        version: 1,
        processing_status: 'pending_ocr',
        validation_status: 'pending',
        review_status: 'pending',
        fiscal_status: 'pending',
        posting_status: 'pending',
        metadata: { source_format: 'pending_file' },
        files: [{ id: 303, role: 'original', sha256: 'abc', file_size: 13, file_name: 'supplier.pdf', mime_type: 'application/pdf' }],
      }, created: true }),
      findOne: jest.fn(),
      getFile: jest.fn(),
      replaceFromExtraction: jest.fn(),
    } as unknown as typeof documents;
    scanner = { assertConfigured: jest.fn().mockResolvedValue(undefined), extract: jest.fn() };
    prisma = { received_documents: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, received_document_events: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn(), findFirst: jest.fn() }, $transaction: jest.fn((fn) => fn(prisma)) };
    subscription = { canUseAIFeature: jest.fn().mockResolvedValue({ mode: 'allow', allowed: true }) };
    service = new ReceivedDocumentScanQueueService(queue, documents as any, scanner, prisma, subscription);
  });

  it('enqueues a small tenant-scoped payload with deterministic id and retries', async () => {
    const result = await service.enqueue(context, makePdf());
    expect(result).toEqual({ document_id: 101, job_id: 'job-1', already_processed: false, created: true });
    expect(subscription.canUseAIFeature).toHaveBeenCalledWith(19, 'async_queue');
    expect(scanner.assertConfigured).toHaveBeenCalledTimes(1);
    expect(documents.createPendingFileWithOutcome).toHaveBeenCalledWith(context, expect.any(Object), 'manual');
    expect(queue.add).toHaveBeenCalledWith('scan', {
      document_id: 101,
      file_id: 303,
      context: { ...context, request_id: 'received-ocr-7-12-101-v1' },
    }, expect.objectContaining({
      jobId: 'rd-7-12-19-101-v1',
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    }));
    expect(JSON.stringify(queue.add.mock.calls)).not.toContain('%PDF-');
    expect(queue.add.mock.calls[0][1].context).not.toHaveProperty('access_token');
    expect(queue.add.mock.calls[0][1].context).not.toHaveProperty('unexpected_runtime_secret');
  });

  it('rejects MIME spoofing before touching storage', async () => {
    const bad = makePdf();
    bad.buffer = Buffer.from('not a PDF');
    bad.size = bad.buffer.length;
    await expect(service.enqueue(context, bad)).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.createPendingFileWithOutcome).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('requires an operational store even for organization fiscal scope', async () => {
    await expect(service.enqueue({ ...context, store_id: null }, makePdf())).rejects.toBeInstanceOf(BadRequestException);
    expect(subscription.canUseAIFeature).not.toHaveBeenCalled();
  });

  it('persists the caller intake channel and rejects unapproved source values before storage', async () => {
    await service.enqueue(context, makePdf(), 'api');
    expect(documents.createPendingFileWithOutcome).toHaveBeenCalledWith(context, expect.any(Object), 'api');

    (documents.createPendingFileWithOutcome as jest.Mock).mockClear();
    await expect(service.enqueue(context, makePdf(), 'provider' as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.createPendingFileWithOutcome).not.toHaveBeenCalled();
  });

  it('does not queue a re-upload of an already processed or merged document', async () => {
    (documents.createPendingFileWithOutcome as jest.Mock).mockResolvedValueOnce({ document: {
      id: 101,
      version: 3,
      processing_status: 'ready',
      metadata: { source_format: 'pending_file' },
      files: [{ id: 303, role: 'original' }],
    }, created: false });
    await expect(service.enqueue(context, makePdf())).resolves.toEqual({ document_id: 101, job_id: null, already_processed: true, created: false });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('reuses and retries the deterministic failed queue job', async () => {
    const existing = { id: 'same', getState: jest.fn().mockResolvedValue('failed'), retry: jest.fn().mockResolvedValue(undefined) };
    queue.getJob.mockResolvedValueOnce(existing);
    const result = await service.enqueue(context, makePdf());
    expect(result.job_id).toBe('same');
    expect(existing.retry).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('blocks subscription mode and uses the canonical error entry', async () => {
    subscription.canUseAIFeature.mockResolvedValueOnce({ mode: 'block', reason: 'SUBSCRIPTION_006', subscription_state: 'locked', plan_id: 4, has_record: true });
    await expect(service.enqueue(context, makePdf())).rejects.toMatchObject({ errorCode: ErrorCodes.SUBSCRIPTION_006.code });
    expect(documents.createPendingFileWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('returns the same 404 for an unknown and a foreign tenant queue id', async () => {
    queue.getJob.mockResolvedValueOnce({ data: { document_id: 2, context: { organization_id: 8, accounting_entity_id: 12, store_id: 19 } } });
    await expect(service.getStatus(context, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.findOne).not.toHaveBeenCalled();
  });

  it('requires scanner readiness before creating a queue job', async () => {
    scanner.assertConfigured.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL));
    await expect(service.enqueue(context, makePdf())).rejects.toBeInstanceOf(VendixHttpException);
    expect(documents.createPendingFileWithOutcome).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('restores isolated tenant context, verifies original SHA, and saves complete evidence before replacing facts', async () => {
    const original = Buffer.from('%PDF-1.7 original');
    const sha = createHash('sha256').update(original).digest('hex');
    const extracted = {
      normalized: { document_type: 'invoice', validation: { errors: [], warnings: [], has_signature: false, document_key_format_valid: false } },
      raw_extraction: { facts: { invoice_number: 'A-1' }, evidence: [{ page: 1 }] },
      page_count: 2,
      model: 'vision-test',
    };
    const document = {
      id: 101, version: 1, processing_status: 'processing', validation_status: 'pending', review_status: 'pending',
      fiscal_status: 'pending', posting_status: 'pending', metadata: { source_format: 'pending_file' }, events: [],
      files: [{ id: 303, role: 'original', file_size: original.length, sha256: sha, file_name: 'supplier.pdf', mime_type: 'application/pdf' }],
    };
    documents.findOne.mockResolvedValue(document as any);
    documents.getFile.mockResolvedValue(original);
    let cachedEvent: any = null;
    const tx = {
      $executeRaw: jest.fn(),
      received_document_events: {
        findUnique: jest.fn().mockImplementation(async () => cachedEvent),
        upsert: jest.fn().mockImplementation(async (args) => {
          if (args.create.event_type === 'AI_EXTRACTION') cachedEvent = { status: 'completed', result: args.create.result };
          return cachedEvent;
        }),
      },
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    prisma.received_document_events.findUnique.mockResolvedValue(null);
    scanner.extract.mockImplementation(async () => {
      expect(RequestContextService.getContext()).toMatchObject({ organization_id: 7, store_id: 19, user_id: 44, request_id: 'received-ocr-7-12-101-v1', is_super_admin: false, is_owner: false });
      return extracted;
    });
    documents.replaceFromExtraction.mockImplementation(async (_ctx: any, _id: number, normalized: any) => {
      expect(tx.received_document_events.upsert).toHaveBeenCalled();
      expect(normalized).toBe(extracted.normalized);
      return { id: 101, version: 2, validation_status: 'needs_review' } as any;
    });

    await expect(service.process({ document_id: 101, file_id: 303, context: { ...context, request_id: 'received-ocr-7-12-101-v1' } })).resolves.toEqual({
      document_id: 101, version: 2, validation_status: 'needs_review', review_required: true, page_count: 2,
    });
    expect(scanner.extract).toHaveBeenCalledTimes(1);
    expect(prisma.received_documents.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 101, organization_id: 7, accounting_entity_id: 12, store_id: 19, version: 1, validation_status: 'pending', review_status: 'pending' }),
      data: { processing_status: 'processing' },
    }));
    expect(tx.received_document_events.upsert.mock.calls[0][0].create.result).toMatchObject({ raw_extraction: extracted.raw_extraction, page_count: 2, model: 'vision-test', source_hash: sha });
  });

  it('reuses cached extraction after persistence failure without calling the AI provider twice', async () => {
    const original = Buffer.from('%PDF-1.7 original');
    const sha = createHash('sha256').update(original).digest('hex');
    const extracted = { normalized: { document_type: 'invoice', validation: { errors: [], warnings: [], has_signature: false, document_key_format_valid: false } }, raw_extraction: { facts: {} }, page_count: 1, model: 'm' };
    const document = { id: 101, version: 1, processing_status: 'processing', validation_status: 'pending', review_status: 'pending', fiscal_status: 'pending', posting_status: 'pending', metadata: {}, events: [], files: [{ id: 303, role: 'original', file_size: original.length, sha256: sha, file_name: 'x.pdf', mime_type: 'application/pdf' }] };
    documents.findOne.mockResolvedValue(document as any);
    documents.getFile.mockResolvedValue(original);
    let cached: any = null;
    prisma.received_document_events.findUnique.mockImplementation(async () => cached);
    const tx = { $executeRaw: jest.fn(), received_document_events: { findUnique: jest.fn().mockImplementation(async () => cached), upsert: jest.fn().mockImplementation(async (args) => { if (args.create.event_type === 'AI_EXTRACTION') cached = { status: 'completed', result: args.create.result }; return cached; }) } };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    scanner.extract.mockResolvedValue(extracted as any);
    documents.replaceFromExtraction.mockRejectedValueOnce(new Error('transient storage/database failure')).mockResolvedValueOnce({ id: 101, version: 2, validation_status: 'valid' } as any);
    const job = { document_id: 101, file_id: 303, context: { ...context, request_id: 'received-ocr-7-12-101-v1' } };
    await expect(service.process(job)).rejects.toThrow('No se pudo leer el documento');
    await expect(service.process(job)).resolves.toMatchObject({ document_id: 101, page_count: 1 });
    expect(scanner.extract).toHaveBeenCalledTimes(1);
    expect(documents.replaceFromExtraction).toHaveBeenCalledTimes(2);
  });

  it('rejects a corrupted original before using even a completed cached extraction', async () => {
    const cached = { normalized: {}, raw_extraction: {}, page_count: 4, model: null, source_hash: 'expected' };
    documents.findOne.mockResolvedValue({ id: 101, version: 1, processing_status: 'processing', validation_status: 'pending', review_status: 'pending', fiscal_status: 'pending', posting_status: 'pending', metadata: {}, files: [{ id: 303, role: 'original', file_size: 20, sha256: 'expected', file_name: 'x.pdf', mime_type: 'application/pdf' }] } as any);
    documents.getFile.mockResolvedValue(Buffer.from('tampered content'));
    prisma.received_document_events.findUnique.mockResolvedValue({ status: 'completed', result: cached });
    await expect(service.process({ document_id: 101, file_id: 303, context: { ...context, request_id: 'received-ocr-7-12-101-v1' } })).rejects.toBeInstanceOf(ConflictException);
    expect(scanner.extract).not.toHaveBeenCalled();
    expect(documents.replaceFromExtraction).not.toHaveBeenCalled();
  });

  it('does not call AI when a worker retries an already ready document', async () => {
    documents.findOne.mockResolvedValue({ id: 101, version: 2, processing_status: 'ready', validation_status: 'valid', metadata: { extraction_snapshot: {} }, events: [], files: [] } as any);
    await expect(service.process({ document_id: 101, file_id: 303, context: { ...context, request_id: 'received-ocr-7-12-101-v1' } })).resolves.toMatchObject({ document_id: 101, review_required: true });
    expect(scanner.extract).not.toHaveBeenCalled();
    expect(documents.getFile).not.toHaveBeenCalled();
  });

  it('rechecks async-queue access in the worker and preserves only a registered safe code', async () => {
    const original = Buffer.from('%PDF-1.7 original');
    const sha = createHash('sha256').update(original).digest('hex');
    documents.findOne.mockResolvedValue({ id: 101, version: 1, processing_status: 'processing', validation_status: 'pending', review_status: 'pending', fiscal_status: 'pending', posting_status: 'pending', metadata: {}, files: [{ id: 303, role: 'original', file_size: original.length, sha256: sha, file_name: 'x.pdf', mime_type: 'application/pdf' }] } as any);
    documents.getFile.mockResolvedValue(original);
    subscription.canUseAIFeature.mockResolvedValue({ mode: 'block', reason: 'SUBSCRIPTION_006', subscription_state: 'locked', plan_id: 4, has_record: true });
    await expect(service.process({ document_id: 101, file_id: 303, context: { ...context, request_id: 'received-ocr-7-12-101-v1' } })).rejects.toMatchObject({ errorCode: ErrorCodes.SUBSCRIPTION_006.code });
    expect(scanner.extract).not.toHaveBeenCalled();
    expect(prisma.received_document_events.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ result: expect.objectContaining({ error_code: ErrorCodes.SUBSCRIPTION_006.code }) }) }));
  });

  it.each([
    [{ organization_id: 8, accounting_entity_id: 12, store_id: 19 }, 'foreign-org'],
    [{ organization_id: 7, accounting_entity_id: 99, store_id: 19 }, 'foreign-entity'],
    [{ organization_id: 7, accounting_entity_id: 12, store_id: 20 }, 'foreign-store'],
  ])('returns 404 and never reads foreign Redis result (%s)', async (captured, id) => {
    queue.getJob.mockResolvedValueOnce({ data: { document_id: 101, context: captured }, getState: jest.fn(), returnvalue: { secret: true } });
    await expect(service.getStatus(context, id as string)).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.findOne).not.toHaveBeenCalled();
  });

  it('polls a failed job with a registered error code but never exposes failedReason', async () => {
    queue.getJob.mockResolvedValueOnce({
      data: { document_id: 101, context: { organization_id: 7, accounting_entity_id: 12, store_id: 19 } },
      getState: jest.fn().mockResolvedValue('failed'),
      failedReason: 'secret provider token / raw stack',
      returnvalue: null,
    });
    documents.findOne.mockResolvedValue({ id: 101 } as any);
    prisma.received_document_events.findFirst.mockResolvedValue({ result: { error_code: ErrorCodes.SUBSCRIPTION_006.code } });
    await expect(service.getStatus(context, 'owned-job')).resolves.toEqual({
      status: 'failed', error: 'No se pudo leer el documento. Puedes reintentar.', error_code: ErrorCodes.SUBSCRIPTION_006.code,
    });
    expect(prisma.received_document_events.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { document_id: 101, event_type: 'SCAN_FAILED' } }));
  });
});
