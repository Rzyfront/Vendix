import { ExpensesController } from './expenses.controller';
import { RequestContextService } from '@common/context/request-context.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build(job: unknown) {
  const queue = { getJob: jest.fn().mockResolvedValue(job) };
  const monitor = {
    describe: jest.fn().mockResolvedValue({ progress: { done: 1, total: 2 }, stalled: false }),
  };
  const response = { success: jest.fn((data) => ({ data })) };
  const controller = new ExpensesController(
    {} as any,
    {} as any,
    {} as any,
    queue as any,
    response as any,
    monitor as any,
  );
  return { controller, monitor, queue };
}

const ctx = (store_id: number) => ({
  is_super_admin: false,
  is_owner: false,
  store_id,
  organization_id: 3,
  user_id: 9,
  request_id: 'r1',
});

describe('ExpensesController GET scan/:jobId', () => {
  const job = () => ({
    id: '5',
    data: { context: { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' } },
    returnvalue: { scan: {} },
    failedReason: undefined,
    getState: jest.fn().mockResolvedValue('active'),
  });

  it('adds the AI job meta without removing the existing fields', async () => {
    const j = job();
    const { controller, monitor, queue } = build(j);

    const res = await RequestContextService.run(ctx(11), () => controller.getScanStatus('5'));

    expect(res).toEqual({
      data: {
        status: 'active',
        result: { scan: {} },
        error: undefined,
        progress: { done: 1, total: 2 },
        stalled: false,
      },
    });
    expect(monitor.describe).toHaveBeenCalledWith(
      j,
      'active',
      LEGACY_AI_SOURCES.expenseScan,
      j.data.context,
      queue,
    );
  });

  it("keeps the IDOR guard: another store's job is a 404 and is never described", async () => {
    const { controller, monitor } = build(job());

    await expect(
      RequestContextService.run(ctx(99), () => controller.getScanStatus('5')),
    ).rejects.toMatchObject({ errorCode: 'AI_QUEUE_002' });
    expect(monitor.describe).not.toHaveBeenCalled();
  });
});
