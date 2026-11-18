import { UnrecoverableError } from 'bullmq';
import { ReceivedDocumentScanProcessor } from './received-document-scan.processor';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build() {
  const queue = { process: jest.fn() };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new ReceivedDocumentScanProcessor(queue as any, monitor as any);
  return { processor, queue, monitor };
}

const job = () =>
  ({
    id: '5',
    data: {
      document_id: 7,
      file_id: 8,
      context: {
        organization_id: 3,
        accounting_entity_id: 4,
        store_id: 11,
        actor_id: 9,
        is_organization: false,
        request_id: 'r1',
      },
    },
  }) as any;

describe('ReceivedDocumentScanProcessor', () => {
  it('runs the scan inside runAiWork and returns its result', async () => {
    const { processor, queue, monitor } = build();
    const result = { document_id: 7 };
    queue.process.mockResolvedValue(result);
    const j = job();

    await expect(processor.process(j)).resolves.toBe(result);

    expect(queue.process).toHaveBeenCalledWith(j.data);
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.receivedDocumentScan,
      expect.any(Function),
    );
  });

  it('a 4xx Vendix error leaves the CODE as failedReason and is not retried', async () => {
    const { processor, queue } = build();
    queue.process.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INV_SCAN_INVALID_FILE),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'INV_SCAN_INVALID_FILE' });
  });

  it.each(['INV_SCAN_AI_FAIL', 'INV_SCAN_PARSE_FAIL'])(
    'a model read/parse failure stays retryable (plain Error with the code): %s',
    async (code) => {
      const { processor, queue } = build();
      queue.process.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes[code as keyof typeof ErrorCodes] as any,
        ),
      );
      const p = processor.process(job());
      await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
      await expect(p).rejects.toMatchObject({ message: code });
    },
  );

  it('any other error is rethrown untouched so BullMQ retries', async () => {
    const { processor, queue } = build();
    const boom = new Error('boom');
    queue.process.mockRejectedValue(boom);
    await expect(processor.process(job())).rejects.toBe(boom);
  });

  it('onFailed delegates to the monitor mapping actor_id to user_id', async () => {
    const { processor, monitor } = build();
    const j = job();
    await processor.onFailed(j);
    expect(monitor.onFailed).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.receivedDocumentScan,
      { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' },
    );
    await processor.onFailed(undefined);
    expect(monitor.onFailed).toHaveBeenCalledTimes(1);
  });
});
