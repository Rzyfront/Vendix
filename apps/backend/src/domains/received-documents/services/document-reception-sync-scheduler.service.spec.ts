import { DocumentReceptionSyncSchedulerService } from './document-reception-sync-scheduler.service';
import { ReceivedDocumentsContext } from '../received-documents.service';

const context: ReceivedDocumentsContext = {
  organization_id: 1,
  store_id: 10,
  accounting_entity_id: 30,
  is_organization: true,
};

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    organization_id: 1,
    store_id: 10,
    accounting_entity_id: 30,
    version: 4,
    enabled: true,
    connection_type: 'api_poll',
    endpoint: 'https://supplier.example.test/api',
    encrypted_secret: 'encrypted-secret',
    lease_token: null,
    lease_expires_at: null,
    next_sync_at: new Date('2026-09-30T12:00:00.000Z'),
    ...overrides,
  };
}

function run(status = 'pending', overrides: Record<string, unknown> = {}) {
  return {
    id: 40,
    status,
    connection_version: 4,
    lease_token: null,
    created_at: new Date('2026-09-30T11:00:00.000Z'),
    connection: connection(),
    ...overrides,
  };
}

function makeHarness(options: {
  runs?: unknown[];
  connections?: unknown[];
  access?: { mode: string; reason?: string };
} = {}) {
  const runsFind = jest.fn().mockResolvedValue(options.runs ?? []);
  const connectionsFind = jest.fn().mockResolvedValue(options.connections ?? []);
  const client = {
    document_reception_runs: { findMany: runsFind },
    document_reception_connections: { findMany: connectionsFind },
  };
  const prisma = { withoutScope: jest.fn(() => client) };
  const leases = {
    getWorkerContext: jest.fn().mockResolvedValue(context),
    claim: jest.fn().mockResolvedValue({ run_id: 51, duplicate: false }),
  };
  const queue = { enqueue: jest.fn().mockResolvedValue({ run_id: 40, job_id: 'dr-sync-40' }) };
  const subscriptionAccess = {
    canUseModule: jest.fn().mockResolvedValue(options.access ?? { mode: 'allow' }),
  };
  const service = new DocumentReceptionSyncSchedulerService(
    prisma as any,
    leases as any,
    queue as any,
    subscriptionAccess as any,
  );
  return { service, prisma, client, runsFind, connectionsFind, leases, queue, subscriptionAccess };
}

describe('DocumentReceptionSyncSchedulerService', () => {
  it('recovers pending outbox work for an enabled connection without changing the durable run', async () => {
    const h = makeHarness({ runs: [run('pending')], access: { mode: 'warn' } });

    await h.service.tick();

    expect(h.prisma.withoutScope).toHaveBeenCalled();
    expect(h.runsFind).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(h.leases.getWorkerContext).toHaveBeenCalledWith(20);
    expect(h.subscriptionAccess.canUseModule).toHaveBeenCalledWith(10, 'received_documents');
    expect(h.queue.enqueue).toHaveBeenCalledWith(40);
    expect(h.leases.claim).not.toHaveBeenCalled();
    expect(h.runsFind.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([
      { status: { in: ['pending', 'queued'] } },
    ]));
    expect(h.runsFind.mock.calls[0][0].where.id).toEqual({ gt: 0 });
  });

  it('recovers an expired running lease only when the run still owns that lease', async () => {
    const expired = new Date('2026-09-30T11:59:00.000Z');
    const conn = connection({ lease_token: 'lease-1', lease_expires_at: expired });
    const h = makeHarness({ runs: [run('running', {
      connection: conn,
      connection_version: 4,
      lease_token: 'lease-1',
    })] });

    await h.service.tick();

    expect(h.queue.enqueue).toHaveBeenCalledWith(40);
    expect(h.runsFind.mock.calls[0][0].where.OR).toContainEqual({
      status: 'running',
      connection: { lease_expires_at: { lte: expect.any(Date) } },
    });
  });

  it.each(['completed', 'cancelled', 'failed', 'partial'])('never requeues terminal/unresolved %s runs', async (status) => {
    const h = makeHarness({ runs: [run(status)] });

    await h.service.tick();

    expect(h.queue.enqueue).not.toHaveBeenCalled();
    expect(h.leases.getWorkerContext).not.toHaveBeenCalled();
  });

  it('claims a due intact API poll with a stable UTC-minute idempotency key and enqueues its run', async () => {
    const due = connection({ next_sync_at: new Date('2026-09-30T12:34:00.000Z') });
    const h = makeHarness({ connections: [due] });

    await h.service.tick();

    expect(h.connectionsFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 0 }, enabled: true, connection_type: 'api_poll', next_sync_at: { lte: expect.any(Date) } }),
      take: 100,
    }));
    expect(h.leases.claim).toHaveBeenCalledWith(context, 20, {
      trigger: 'scheduler',
      idempotency_key: expect.stringMatching(/^scheduler:20:4:\d+$/),
      expected_version: 4,
    });
    expect(h.queue.enqueue).toHaveBeenCalledWith(51);
  });

  it('fails closed for subscription blocks and internal errors', async () => {
    for (const access of [
      { mode: 'block' },
      { mode: 'allow', reason: 'SUBSCRIPTION_INTERNAL_ERROR' },
    ]) {
      const h = makeHarness({ runs: [run()], connections: [connection()], access });

      await h.service.tick();

      expect(h.queue.enqueue).not.toHaveBeenCalled();
      expect(h.leases.claim).not.toHaveBeenCalled();
    }
  });

  it('leaves a durable run untouched when Redis enqueue fails so a later tick can recover it', async () => {
    const pending = run('pending');
    const h = makeHarness({ runs: [pending] });
    h.queue.enqueue
      .mockRejectedValueOnce(new Error('redis internals must not escape'))
      .mockResolvedValueOnce({ run_id: 40, job_id: 'dr-sync-40' });

    await expect(h.service.tick()).resolves.toBeUndefined();
    await expect(h.service.tick()).resolves.toBeUndefined();

    expect(h.queue.enqueue).toHaveBeenNthCalledWith(1, 40);
    expect(h.queue.enqueue).toHaveBeenNthCalledWith(2, 40);
    expect(h.runsFind).toHaveBeenCalledTimes(2);
    expect(Object.keys(h.client.document_reception_runs)).toEqual(['findMany']);
  });

  it('prevents overlapping cron ticks from duplicating discovery', async () => {
    let release!: (rows: unknown[]) => void;
    const h = makeHarness();
    h.runsFind.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const first = h.service.tick();
    await Promise.resolve();
    await h.service.tick();
    expect(h.runsFind).toHaveBeenCalledTimes(1);
    release([]);
    await first;
    expect(h.connectionsFind).toHaveBeenCalledTimes(1);
  });

  it('rotates the outbox keyset past a subscription-blocked first row on the next tick', async () => {
    const first = run('pending', { id: 1 });
    const second = run('pending', { id: 2 });
    const h = makeHarness();
    h.runsFind.mockImplementation(async ({ where }: any) => where.id.gt === 0 ? [first] : [second]);
    h.subscriptionAccess.canUseModule
      .mockResolvedValueOnce({ mode: 'block' })
      .mockResolvedValueOnce({ mode: 'allow' });

    await h.service.tick();
    await h.service.tick();

    expect(h.runsFind.mock.calls.map(([query]) => query.where.id.gt)).toEqual([0, 1]);
    expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(h.queue.enqueue).toHaveBeenCalledWith(2);
  });

  it('rotates due API polls past a blocked tenant instead of starving later connections', async () => {
    const first = connection({ id: 20 });
    const second = connection({ id: 21 });
    const h = makeHarness();
    h.connectionsFind.mockImplementation(async ({ where }: any) => where.id.gt === 0 ? [first] : [second]);
    h.subscriptionAccess.canUseModule
      .mockResolvedValueOnce({ mode: 'block' })
      .mockResolvedValueOnce({ mode: 'allow' });

    await h.service.tick();
    await h.service.tick();

    expect(h.connectionsFind.mock.calls.map(([query]) => query.where.id.gt)).toEqual([0, 20]);
    expect(h.leases.claim).toHaveBeenCalledTimes(1);
    expect(h.leases.claim).toHaveBeenCalledWith(context, 21, expect.objectContaining({ trigger: 'scheduler' }));
    expect(h.queue.enqueue).toHaveBeenCalledWith(51);
  });
});
