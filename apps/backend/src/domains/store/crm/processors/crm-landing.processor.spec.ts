import { UnrecoverableError } from 'bullmq';
import { CrmLandingProcessor } from './crm-landing.processor';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

/** QUI-1020: the AI landing generation follows the shared AI job contract. */
function build() {
  const generation = { generateLanding: jest.fn().mockResolvedValue(undefined) };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new CrmLandingProcessor(generation as any, monitor as any);
  return { processor, generation, monitor };
}

const job = () =>
  ({
    id: '21',
    data: {
      store_id: 11,
      context: { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' },
    },
  }) as any;

describe('CrmLandingProcessor (QUI-1020)', () => {
  it('runs the generation inside runAiWork with the tenant context and returns a non-empty result', async () => {
    const { processor, generation, monitor } = build();
    let seen: any;
    generation.generateLanding.mockImplementation(async () => {
      seen = RequestContextService.getContext();
    });
    const j = job();

    await expect(processor.process(j)).resolves.toEqual({ ready: true });

    expect(generation.generateLanding).toHaveBeenCalledWith(11);
    expect(seen).toEqual(expect.objectContaining({ store_id: 11, request_id: 'r1' }));
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.crmLanding,
      expect.any(Function),
    );
  });

  it('a 4xx Vendix error leaves the CODE as failedReason and is not retried', async () => {
    const { processor, generation } = build();
    generation.generateLanding.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_QUEUE_002),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'AI_QUEUE_002' });
  });

  it('CRM_LANDING_003 (model returned unusable JSON) is retryable with the code as failedReason', async () => {
    const { processor, generation } = build();
    generation.generateLanding.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CRM_LANDING_003),
    );
    const p = processor.process(job());
    await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'CRM_LANDING_003' });
  });

  it('any other error is rethrown untouched so BullMQ retries', async () => {
    const { processor, generation } = build();
    const boom = new Error('boom');
    generation.generateLanding.mockRejectedValue(boom);
    await expect(processor.process(job())).rejects.toBe(boom);
  });

  it('onFailed alerts through the monitor with the job context', async () => {
    const { processor, monitor } = build();
    const j = job();
    await processor.onFailed(j);
    expect(monitor.onFailed).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.crmLanding,
      j.data.context,
    );
  });

  it('onFailed without a job does nothing', async () => {
    const { processor, monitor } = build();
    await processor.onFailed(undefined);
    expect(monitor.onFailed).not.toHaveBeenCalled();
  });
});
