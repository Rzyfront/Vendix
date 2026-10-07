import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import { DocumentReceptionSyncQueueService } from './document-reception-sync-queue.service';
import { DocumentReceptionManualSyncService } from './document-reception-manual-sync.service';

const ownerContext: ReceivedDocumentsContext = {
  organization_id: 1,
  accounting_entity_id: 30,
  store_id: 10,
  actor_id: 55,
  is_organization: true,
};
const requestDto = {
  expected_version: 4,
  idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
};

function harness(runOverrides: Record<string, any> = {}) {
  const run = {
    id: 70,
    status: 'failed',
    connection_version: 4,
    lease_token: null,
    connection: {
      enabled: true,
      version: 4,
      lease_token: null,
      lease_expires_at: null,
    },
    ...runOverrides,
  };
  const runFindFirst = jest.fn().mockResolvedValue(run);
  const prisma = { withoutScope: jest.fn(() => ({ document_reception_runs: { findFirst: runFindFirst } })) };
  const receivedDocuments = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const subscriptionAccess = {
    canUseModule: jest.fn().mockResolvedValue({ allowed: true, mode: 'allow', reason: 'active' }),
  };
  const leases = {
    claim: jest.fn().mockResolvedValue({ run_id: 71, duplicate: false }),
  };
  const queue = { enqueue: jest.fn().mockResolvedValue({ run_id: 71, job_id: 'dr-sync-71' }) };
  const service = new DocumentReceptionManualSyncService(
    prisma as unknown as GlobalPrismaService,
    receivedDocuments as unknown as ReceivedDocumentsService,
    subscriptionAccess as unknown as SubscriptionAccessService,
    leases as unknown as DocumentReceptionSyncLeaseService,
    queue as unknown as DocumentReceptionSyncQueueService,
  );
  return { service, prisma, runFindFirst, receivedDocuments, subscriptionAccess, leases, queue, run };
}

describe('DocumentReceptionManualSyncService', () => {
  it('authorizes, checks subscription, claims with current version, then queues only the durable run ID', async () => {
    const h = harness();
    await expect(h.service.request(ownerContext, 20, requestDto)).resolves.toEqual({
      run_id: 71, duplicate: false, queued: true,
    });
    expect(h.receivedDocuments.assertContext).toHaveBeenCalledWith(ownerContext);
    expect(h.subscriptionAccess.canUseModule).toHaveBeenCalledWith(10, 'received_documents');
    expect(h.leases.claim).toHaveBeenCalledWith(ownerContext, 20, {
      trigger: 'manual',
      idempotency_key: `manual:${requestDto.idempotency_key}`,
      expected_version: 4,
    });
    expect(h.queue.enqueue).toHaveBeenCalledWith(71);
  });

  it('rejects manager-like actorless contexts before subscription or claim', async () => {
    const h = harness();
    await expect(h.service.request({ ...ownerContext, actor_id: undefined }, 20, requestDto))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.receivedDocuments.assertContext).not.toHaveBeenCalled();
    expect(h.subscriptionAccess.canUseModule).not.toHaveBeenCalled();
    expect(h.leases.claim).not.toHaveBeenCalled();
  });

  it('fails closed on blocked or internally unavailable subscription access before claiming', async () => {
    const blocked = harness();
    blocked.subscriptionAccess.canUseModule.mockResolvedValueOnce({ allowed: false, mode: 'block', reason: 'SUBSCRIPTION_004' });
    await expect(blocked.service.request(ownerContext, 20, requestDto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(blocked.leases.claim).not.toHaveBeenCalled();

    const internal = harness();
    internal.subscriptionAccess.canUseModule.mockResolvedValueOnce({ allowed: true, mode: 'allow', reason: 'SUBSCRIPTION_INTERNAL_ERROR' });
    await expect(internal.service.request(ownerContext, 20, requestDto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(internal.leases.claim).not.toHaveBeenCalled();
  });

  it('returns a durable queued:false result if initial queue publication fails', async () => {
    const h = harness();
    h.queue.enqueue.mockRejectedValueOnce(new Error('redis secret must not escape'));
    await expect(h.service.request(ownerContext, 20, requestDto)).resolves.toEqual({
      run_id: 71, duplicate: false, queued: false,
    });
  });

  it('rejects malformed run identifiers and requires a UUIDv4 key', async () => {
    const h = harness();
    await expect(h.service.request(ownerContext, 0, requestDto)).rejects.toThrow();
    await expect(h.service.request(ownerContext, 20, { ...requestDto, idempotency_key: 'manual:one' }))
      .rejects.toThrow();
    expect(h.leases.claim).not.toHaveBeenCalled();
  });

  it('retries the same failed/partial run only after scoped status/version/lease checks', async () => {
    const h = harness({ status: 'partial' });
    await expect(h.service.retry(ownerContext, 20, 70)).resolves.toEqual({ run_id: 70, queued: true });
    expect(h.runFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 70,
        connection_id: 20,
        connection: { organization_id: 1, accounting_entity_id: 30, store_id: 10 },
      },
    }));
    expect(h.queue.enqueue).toHaveBeenCalledWith(70);
  });

  it('does not reveal foreign runs and rejects stale, non-retryable, or actively leased runs', async () => {
    const foreign = harness();
    foreign.runFindFirst.mockResolvedValueOnce(null);
    await expect(foreign.service.retry(ownerContext, 20, 70)).rejects.toBeInstanceOf(NotFoundException);
    expect(foreign.queue.enqueue).not.toHaveBeenCalled();

    const stale = harness({ connection: { enabled: true, version: 5, lease_token: null, lease_expires_at: null } });
    await expect(stale.service.retry(ownerContext, 20, 70)).rejects.toBeInstanceOf(ConflictException);
    expect(stale.queue.enqueue).not.toHaveBeenCalled();

    const completed = harness({ status: 'completed' });
    await expect(completed.service.retry(ownerContext, 20, 70)).rejects.toBeInstanceOf(ConflictException);
    expect(completed.queue.enqueue).not.toHaveBeenCalled();

    const active = harness({
      connection: {
        enabled: true, version: 4, lease_token: 'active-token',
        lease_expires_at: new Date(Date.now() + 60_000),
      },
    });
    await expect(active.service.retry(ownerContext, 20, 70)).rejects.toBeInstanceOf(ConflictException);
    expect(active.queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns safe service-unavailable when retry queue publication fails', async () => {
    const h = harness();
    h.queue.enqueue.mockRejectedValueOnce(new Error('redis internals'));
    await expect(h.service.retry(ownerContext, 20, 70)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
