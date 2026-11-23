import { UnrecoverableError } from 'bullmq';
import { ReceiptScanProcessor } from './receipt-scan.processor';
import { ReceiptScanReaderService } from './receipt-scan-reader.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build() {
  const scanner = { scanReceiptFromFile: jest.fn() };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const s3 = {
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 recibo')),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  // Real reader: load/discard are what the processor uses from it.
  const reader = new ReceiptScanReaderService(s3 as any, {} as any, {} as any);
  const processor = new ReceiptScanProcessor(scanner as any, monitor as any, reader);
  return { processor, scanner, monitor, s3 };
}

const context = { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' };

/** Job queued after ia-cargas F5a: the upload lives in S3. */
const job = (overrides: Record<string, unknown> = {}) =>
  ({
    id: '5',
    attemptsMade: 0,
    opts: { attempts: 3 },
    updateProgress: jest.fn().mockResolvedValue(undefined),
    data: {
      file_key: 'ai-scans/3/store-11/receipt/1-recibo.pdf',
      mimeType: 'application/pdf',
      originalName: 'recibo.pdf',
      context,
    },
    ...overrides,
  }) as any;

/** Job queued before F5a: a JPEG data URI travelled in Redis. */
const legacyJob = () =>
  job({
    data: {
      dataUri: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
      mimeType: 'image/png',
      context,
    },
  });

describe('ReceiptScanProcessor', () => {
  it('restores the context, reads the S3 upload by pages and discards the copy', async () => {
    const { processor, scanner, monitor, s3 } = build();
    let seen: any;
    const result = { ok: true };
    scanner.scanReceiptFromFile.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return result;
    });
    const j = job();

    const res = await processor.process(j);

    expect(res).toBe(result);
    expect(seen).toEqual(expect.objectContaining({ store_id: 11, request_id: 'r1' }));
    expect(s3.downloadFile).toHaveBeenCalledWith(j.data.file_key);
    expect(scanner.scanReceiptFromFile).toHaveBeenCalledWith(
      { buffer: Buffer.from('%PDF-1.7 recibo'), mimeType: 'application/pdf', originalName: 'recibo.pdf' },
      { reportProgress: expect.any(Function) },
    );
    expect(s3.deleteFile).toHaveBeenCalledWith(j.data.file_key);
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.receiptScan,
      expect.any(Function),
    );
  });

  it('a job in the OLD format (data URI in Redis) still works through the same reader', async () => {
    const { processor, scanner, s3 } = build();
    scanner.scanReceiptFromFile.mockResolvedValue({ ok: true });

    await processor.process(legacyJob());

    expect(s3.downloadFile).not.toHaveBeenCalled();
    expect(scanner.scanReceiptFromFile).toHaveBeenCalledWith(
      { buffer: Buffer.from('png-bytes'), mimeType: 'image/png', originalName: 'documento' },
      expect.any(Object),
    );
    expect(s3.deleteFile).not.toHaveBeenCalled();
  });

  it('falls back to a fresh request id when the job carries none', async () => {
    const { processor, scanner } = build();
    let seen: any;
    scanner.scanReceiptFromFile.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return {};
    });
    await processor.process(job({ data: { file_key: 'k', mimeType: 'application/pdf', context: { store_id: 11 } } }));
    expect(seen.request_id).toMatch(/^queue-/);
  });

  it('a 4xx Vendix error leaves the CODE as failedReason, is not retried and discards the copy', async () => {
    const { processor, scanner, s3 } = build();
    scanner.scanReceiptFromFile.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_INGEST_NO_PAGES),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'AI_INGEST_NO_PAGES' });
    expect(s3.deleteFile).toHaveBeenCalled();
  });

  it.each(['DISPATCH_RECEIPT_SCAN_AI_FAIL', 'DISPATCH_RECEIPT_SCAN_PARSE_FAIL'])(
    'a model read/parse failure stays retryable and keeps the S3 copy: %s',
    async (code) => {
      const { processor, scanner, s3 } = build();
      scanner.scanReceiptFromFile.mockRejectedValue(
        new VendixHttpException(ErrorCodes[code as keyof typeof ErrorCodes] as any),
      );
      const p = processor.process(job());
      await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
      await expect(p).rejects.toMatchObject({ message: code });
      expect(s3.deleteFile).not.toHaveBeenCalled();
    },
  );

  it('any other error is rethrown untouched so BullMQ retries', async () => {
    const { processor, scanner } = build();
    const boom = new Error('boom');
    scanner.scanReceiptFromFile.mockRejectedValue(boom);
    await expect(processor.process(job())).rejects.toBe(boom);
  });

  it('onFailed delegates to the monitor with the job context', async () => {
    const { processor, monitor } = build();
    const j = job();
    await processor.onFailed(j);
    expect(monitor.onFailed).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.receiptScan,
      j.data.context,
    );
    await processor.onFailed(undefined);
    expect(monitor.onFailed).toHaveBeenCalledTimes(1);
  });
});
