import { DispatchNotesController } from './dispatch-notes.controller';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build(job: unknown) {
  const service = {
    getReceiptScanJobStatus: jest
      .fn()
      .mockResolvedValue({ status: 'active', result: undefined, error: undefined }),
  };
  const queue = { getJob: jest.fn().mockResolvedValue(job) };
  const monitor = {
    describe: jest.fn().mockResolvedValue({ progress: null, stalled: true }),
  };
  const response = { success: jest.fn((data) => ({ data })) };
  const controller = new DispatchNotesController(
    service as any,
    {} as any,
    {} as any,
    response as any,
    queue as any,
    monitor as any,
  );
  return { controller, service, monitor, queue };
}

describe('DispatchNotesController GET receipt-scan/:jobId', () => {
  it('adds the AI job meta to the state the service validated', async () => {
    const job = { id: '5', data: { context: { store_id: 11, request_id: 'r1' } } };
    const { controller, monitor, queue } = build(job);

    const res = await controller.receiptScanStatus('5');

    expect(res).toEqual({
      data: { status: 'active', result: undefined, error: undefined, progress: null, stalled: true },
    });
    expect(monitor.describe).toHaveBeenCalledWith(
      job,
      'active',
      LEGACY_AI_SOURCES.receiptScan,
      job.data.context,
      queue,
    );
  });

  it('returns the plain state when the job vanished between reads', async () => {
    const { controller, monitor } = build(null);

    const res = await controller.receiptScanStatus('5');

    expect(res).toEqual({ data: { status: 'active', result: undefined, error: undefined } });
    expect(monitor.describe).not.toHaveBeenCalled();
  });

  it('without queue and monitor (optional deps) returns the plain status', async () => {
    const service = {
      getReceiptScanJobStatus: jest
        .fn()
        .mockResolvedValue({ status: 'active', result: undefined, error: undefined }),
    };
    const response = { success: jest.fn((data) => ({ data })) };
    const controller = new DispatchNotesController(
      service as any,
      {} as any,
      {} as any,
      response as any,
    );

    await expect(controller.receiptScanStatus('5')).resolves.toEqual({
      data: { status: 'active', result: undefined, error: undefined },
    });
  });
});
