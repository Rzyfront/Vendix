import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DocumentReceptionSyncQueueService } from './document-reception-sync-queue.service';

describe('DocumentReceptionSyncQueueService', () => {
  const makeJob = (state: string) => ({
    id: 'dr-sync-42',
    getState: jest.fn().mockResolvedValue(state),
    remove: jest.fn().mockResolvedValue(undefined),
  });

  function harness(existing?: ReturnType<typeof makeJob> | null) {
    const added = { id: 'dr-sync-42' };
    const queue = {
      getJob: jest.fn().mockResolvedValue(existing ?? null),
      add: jest.fn().mockResolvedValue(added),
    };
    return { service: new DocumentReceptionSyncQueueService(queue as unknown as Queue), queue, added };
  }

  it('enqueues only a positive run id with stable ID, bounded retries, and cleanup', async () => {
    const h = harness();
    await expect(h.service.enqueue(42)).resolves.toEqual({ run_id: 42, job_id: 'dr-sync-42' });
    expect(h.queue.add).toHaveBeenCalledWith('sync', { run_id: 42 }, {
      jobId: 'dr-sync-42',
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
    const [, data] = h.queue.add.mock.calls[0];
    expect(Object.keys(data)).toEqual(['run_id']);
  });

  it.each(['waiting', 'active', 'delayed'])(
    'deduplicates an existing %s job', async (state) => {
      const existing = makeJob(state);
      const h = harness(existing);
      await expect(h.service.enqueue(42)).resolves.toEqual({ run_id: 42, job_id: 'dr-sync-42' });
      expect(h.queue.add).not.toHaveBeenCalled();
      expect(existing.remove).not.toHaveBeenCalled();
    },
  );

  it.each(['completed', 'failed'])('removes a retained %s job before re-enqueue', async (state) => {
    const existing = makeJob(state);
    const h = harness(existing);
    await h.service.enqueue(42);
    expect(existing.remove).toHaveBeenCalledTimes(1);
    expect(h.queue.add).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])('rejects invalid run id %s', async (runId) => {
    const h = harness();
    await expect(h.service.enqueue(runId)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.queue.getJob).not.toHaveBeenCalled();
  });

  it('returns a safe service-unavailable error for Redis failures', async () => {
    const h = harness();
    h.queue.getJob.mockRejectedValue(new Error('redis-password-and-job-data'));
    const error = await h.service.enqueue(42).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(String(error)).not.toContain('redis-password-and-job-data');
    expect(h.queue.getJob).toHaveBeenCalledTimes(1);
  });
});
