import { ConflictException } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocumentReceptionSyncJob } from '../interfaces/document-reception-sync-job.interface';
import { DocumentReceptionSyncProcessResult, DocumentReceptionSyncService } from './document-reception-sync.service';
import { DocumentReceptionSyncProcessor } from './document-reception-sync.processor';

describe('DocumentReceptionSyncProcessor', () => {
  const result = (status: DocumentReceptionSyncProcessResult['status']): DocumentReceptionSyncProcessResult => ({
    run_id: 42,
    status,
    received_count: 1,
    duplicate_count: 0,
    error_count: status === 'failed' || status === 'partial' ? 1 : 0,
  });

  function harness(status: DocumentReceptionSyncProcessResult['status']) {
    const sync = { process: jest.fn().mockResolvedValue(result(status)) };
    const processor = new DocumentReceptionSyncProcessor(sync as unknown as DocumentReceptionSyncService);
    const job = { data: { run_id: 42 } } as Job<DocumentReceptionSyncJob>;
    return { processor, sync, job };
  }

  it.each(['completed', 'terminal'] as const)('returns safe %s results', async (status) => {
    const h = harness(status);
    await expect(h.processor.process(h.job)).resolves.toEqual(result(status));
    expect(h.sync.process).toHaveBeenCalledWith(42);
  });

  it.each(['failed', 'partial'] as const)('throws a generic retryable error for %s results', async (status) => {
    const h = harness(status);
    await expect(h.processor.process(h.job)).rejects.toThrow('Document reception sync run incomplete.');
    expect(h.sync.process).toHaveBeenCalledTimes(1);
  });

  it('does not swallow lease conflicts from the sync worker', async () => {
    const h = harness('completed');
    h.sync.process.mockRejectedValue(new ConflictException('lease lost'));
    await expect(h.processor.process(h.job)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects corrupt job IDs without invoking sync', async () => {
    const h = harness('completed');
    const badJob = { data: { run_id: -1 } } as Job<DocumentReceptionSyncJob>;
    await expect(h.processor.process(badJob)).rejects.toThrow('Invalid document reception sync job.');
    expect(h.sync.process).not.toHaveBeenCalled();
  });
});
