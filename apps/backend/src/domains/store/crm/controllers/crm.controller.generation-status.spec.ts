import { CrmController } from './crm.controller';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

/** QUI-1020: additive contract of the CRM landing generation endpoints. */
function build() {
  const crmService = {
    activate: jest.fn(),
    getGenerationJobStatus: jest.fn(),
  };
  const responses = { success: jest.fn((data: unknown) => ({ success: true, data })) };
  const queue = { getJob: jest.fn() };
  const monitor = { describe: jest.fn() };
  const controller = new CrmController(
    crmService as any,
    {} as any,
    responses as any,
    queue as any,
    monitor as any,
  );
  return { controller, crmService, queue, monitor };
}

describe('CrmController generation (QUI-1020)', () => {
  it('activate keeps the landing state and adds job_id', async () => {
    const { controller, crmService } = build();
    crmService.activate.mockResolvedValue({ enabled: true, last_job_id: '21' });

    const res: any = await controller.activate({} as any);

    expect(res.data).toEqual({ enabled: true, last_job_id: '21', job_id: '21' });
  });

  it('status keeps its fields and adds the result and the AI job meta', async () => {
    const { controller, crmService, queue, monitor } = build();
    crmService.getGenerationJobStatus.mockResolvedValue({ status: 'completed' });
    const job = { returnvalue: { ready: true }, data: { context: { store_id: 11 } } };
    queue.getJob.mockResolvedValue(job);
    monitor.describe.mockResolvedValue({ kind: 'crm_landing', stalled: false });

    const res: any = await controller.getGenerationStatus('21');

    expect(res.data).toEqual({
      status: 'completed',
      result: { ready: true },
      kind: 'crm_landing',
      stalled: false,
    });
    expect(monitor.describe).toHaveBeenCalledWith(
      job,
      'completed',
      LEGACY_AI_SOURCES.crmLanding,
      { store_id: 11 },
      queue,
    );
  });

  it('a job of another store fails in the service before the queue is read', async () => {
    const { controller, crmService, queue } = build();
    crmService.getGenerationJobStatus.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_QUEUE_002),
    );

    await expect(controller.getGenerationStatus('21')).rejects.toMatchObject({
      errorCode: 'AI_QUEUE_002',
    });
    expect(queue.getJob).not.toHaveBeenCalled();
  });
});
