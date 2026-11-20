import { UnrecoverableError } from 'bullmq';
import { ExpenseScanProcessor } from './expense-scan.processor';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build() {
  const scanner = { scanFromFile: jest.fn() };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const s3 = {
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 file')),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new ExpenseScanProcessor(
    scanner as any,
    monitor as any,
    s3 as any,
  );
  return { processor, scanner, monitor, s3 };
}

const context = { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' };

/** Job queued after F5a: the upload is in S3. */
const job = (overrides: Record<string, unknown> = {}) =>
  ({
    id: '5',
    attemptsMade: 0,
    opts: { attempts: 3 },
    updateProgress: jest.fn().mockResolvedValue(undefined),
    data: {
      file_key: 'ai-scans/3/store-11/expense/1-factura.pdf',
      mimeType: 'application/pdf',
      originalName: 'factura.pdf',
      context,
    },
    ...overrides,
  }) as any;

/** Job queued before F5a: the image travelled as a data URI in Redis. */
const legacyJob = () =>
  job({
    data: {
      dataUri: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
      mimeType: 'image/png',
      context,
    },
  });

describe('ExpenseScanProcessor', () => {
  it('restores the context, reads the S3 upload by pages and discards the copy', async () => {
    const { processor, scanner, monitor, s3 } = build();
    let seen: any;
    const result = { ok: true };
    scanner.scanFromFile.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return result;
    });
    const j = job();

    const res = await processor.process(j);

    expect(res).toBe(result);
    expect(seen).toEqual(expect.objectContaining({ store_id: 11, request_id: 'r1' }));
    expect(s3.downloadFile).toHaveBeenCalledWith(j.data.file_key);
    expect(scanner.scanFromFile).toHaveBeenCalledWith(
      {
        buffer: Buffer.from('%PDF-1.7 file'),
        mimeType: 'application/pdf',
        originalName: 'factura.pdf',
      },
      { reportProgress: expect.any(Function) },
    );
    expect(s3.deleteFile).toHaveBeenCalledWith(j.data.file_key);
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.expenseScan,
      expect.any(Function),
    );
  });

  it('a job queued before F5a (data URI in Redis) still works through the same reader', async () => {
    const { processor, scanner, s3 } = build();
    scanner.scanFromFile.mockResolvedValue({ ok: true });

    await processor.process(legacyJob());

    expect(s3.downloadFile).not.toHaveBeenCalled();
    expect(scanner.scanFromFile).toHaveBeenCalledWith(
      {
        buffer: Buffer.from('png-bytes'),
        mimeType: 'image/png',
        originalName: 'documento',
      },
      expect.any(Object),
    );
    expect(s3.deleteFile).not.toHaveBeenCalled();
  });

  it('reports real progress by pages on the job', async () => {
    const { processor, scanner } = build();
    scanner.scanFromFile.mockImplementation(async (_file: unknown, options: any) => {
      await options.reportProgress({ done: 1, total: 2, unit: 'páginas' });
      return { ok: true };
    });
    const j = job();
    await processor.process(j);
    expect(j.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ done: 1, total: 2, unit: 'páginas', at: expect.any(Number) }),
    );
  });

  it('a 4xx Vendix error leaves the CODE as failedReason, is not retried and discards the copy', async () => {
    const { processor, scanner, s3 } = build();
    scanner.scanFromFile.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_INGEST_TOO_MANY_PAGES),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'AI_INGEST_TOO_MANY_PAGES' });
    expect(s3.deleteFile).toHaveBeenCalled();
  });

  it.each(['INV_SCAN_AI_FAIL', 'INV_SCAN_PARSE_FAIL'])(
    'a model read/parse failure stays retryable and keeps the S3 copy for the retry: %s',
    async (code) => {
      const { processor, scanner, s3 } = build();
      scanner.scanFromFile.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes[code as keyof typeof ErrorCodes] as any,
        ),
      );
      const p = processor.process(job());
      await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
      await expect(p).rejects.toMatchObject({ message: code });
      expect(s3.deleteFile).not.toHaveBeenCalled();
    },
  );

  it('the last attempt discards the S3 copy even on a retryable failure', async () => {
    const { processor, scanner, s3 } = build();
    scanner.scanFromFile.mockRejectedValue(new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL));
    await expect(processor.process(job({ attemptsMade: 2 }))).rejects.toMatchObject({
      message: 'INV_SCAN_AI_FAIL',
    });
    expect(s3.deleteFile).toHaveBeenCalled();
  });

  it('any other error is rethrown untouched so BullMQ retries', async () => {
    const { processor, scanner } = build();
    const boom = new Error('boom');
    scanner.scanFromFile.mockRejectedValue(boom);
    await expect(processor.process(job())).rejects.toBe(boom);
  });

  it('onFailed delegates to the monitor with the job context', async () => {
    const { processor, monitor } = build();
    const j = job();
    await processor.onFailed(j);
    expect(monitor.onFailed).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.expenseScan,
      j.data.context,
    );
    await processor.onFailed(undefined);
    expect(monitor.onFailed).toHaveBeenCalledTimes(1);
  });
});
