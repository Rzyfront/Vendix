import { UnrecoverableError } from 'bullmq';
import { ExpenseScanProcessor } from './expense-scan.processor';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build() {
  const scanner = { scanFromImage: jest.fn() };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new ExpenseScanProcessor(scanner as any, monitor as any);
  return { processor, scanner, monitor };
}

const job = () =>
  ({
    id: '5',
    data: {
      dataUri: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      context: { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' },
    },
  }) as any;

describe('ExpenseScanProcessor', () => {
  it('restores the context and runs the work inside runAiWork', async () => {
    const { processor, scanner, monitor } = build();
    let seen: any;
    const result = { ok: true };
    scanner.scanFromImage.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return result;
    });
    const j = job();

    const res = await processor.process(j);

    expect(res).toBe(result);
    expect(seen).toEqual(expect.objectContaining({ store_id: 11, request_id: 'r1' }));
    expect(scanner.scanFromImage).toHaveBeenCalledWith(
      'data:image/png;base64,AAAA',
      'image/png',
    );
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.expenseScan,
      expect.any(Function),
    );
  });

  it('a 4xx Vendix error leaves the CODE as failedReason and is not retried', async () => {
    const { processor, scanner } = build();
    scanner.scanFromImage.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INV_SCAN_INVALID_FILE),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'INV_SCAN_INVALID_FILE' });
  });

  it('any other error is rethrown untouched so BullMQ retries', async () => {
    const { processor, scanner } = build();
    const boom = new Error('boom');
    scanner.scanFromImage.mockRejectedValue(boom);
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
