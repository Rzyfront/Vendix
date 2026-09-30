import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { FiscalScopeService } from '../../../common/services/fiscal-scope.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

const ctx: ReceivedDocumentsContext = {
  organization_id: 1,
  accounting_entity_id: 30,
  store_id: 10,
  is_organization: true,
};

interface HarnessOptions {
  activeOrg?: boolean;
  activeStore?: boolean;
  activeEntity?: boolean;
  expectedEntity?: number | null;
  foreignStore?: boolean;
  foreignEntity?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const state = {
    connection: {
      id: 20,
      organization_id: 1,
      store_id: 10,
      accounting_entity_id: 30,
      version: 4,
      public_token: 'public-token',
      lease_token: null as string | null,
      lease_expires_at: null as Date | null,
      name: 'Supplier inbox',
      connection_type: 'api_poll',
      enabled: true,
      endpoint: 'https://supplier.example.test/feed',
      encrypted_secret: 'encrypted-only',
      settings: null,
      cursor: 'cursor-before',
      poll_interval_minutes: 15,
      next_sync_at: null as Date | null,
      last_synced_at: null,
      last_error: null,
      created_by: 55,
      created_at: new Date('2026-09-30T12:00:00Z'),
      updated_at: new Date('2026-09-30T12:00:00Z'),
    },
    run: null as any,
  };
  let nextRunId = 40;
  const connectionFind = jest.fn(async ({ where }: any = {}) => {
    if (where?.id != null && where.id !== state.connection.id) return null;
    if (where?.organization_id != null && where.organization_id !== state.connection.organization_id) return null;
    if (where?.accounting_entity_id != null && where.accounting_entity_id !== state.connection.accounting_entity_id) return null;
    if (where?.store_id != null && where.store_id !== state.connection.store_id) return null;
    return { ...state.connection };
  });
  const connectionUpdateMany = jest.fn(async ({ where, data }: any) => {
    if (where?.id !== state.connection.id ||
        (where?.organization_id != null && where.organization_id !== state.connection.organization_id) ||
        (where?.accounting_entity_id != null && where.accounting_entity_id !== state.connection.accounting_entity_id) ||
        (where?.store_id != null && where.store_id !== state.connection.store_id) ||
        (where?.version != null && where.version !== state.connection.version) ||
        (where?.lease_token !== undefined && where.lease_token !== state.connection.lease_token)) {
      return { count: 0 };
    }
    if (where?.lease_expires_at?.gt && (!state.connection.lease_expires_at || state.connection.lease_expires_at <= where.lease_expires_at.gt)) return { count: 0 };
    if (where?.lease_expires_at?.lte && (!state.connection.lease_expires_at || state.connection.lease_expires_at > where.lease_expires_at.lte)) return { count: 0 };
    if (where?.OR && !where.OR.some((branch: any) =>
      (branch.lease_token === null && state.connection.lease_token === null) ||
      (branch.lease_token != null && branch.lease_token === state.connection.lease_token) ||
      (branch.lease_expires_at?.lte && state.connection.lease_expires_at != null && state.connection.lease_expires_at <= branch.lease_expires_at.lte))) {
      return { count: 0 };
    }
    Object.assign(state.connection, data);
    return { count: 1 };
  });
  const runFind = jest.fn(async ({ where }: any = {}) => {
    if (!state.run || (where?.id != null && where.id !== state.run.id) ||
        (where?.connection_id != null && where.connection_id !== state.run.connection_id) ||
        (where?.idempotency_key != null && where.idempotency_key !== state.run.idempotency_key) ||
        (where?.status?.in && !where.status.in.includes(state.run.status))) return null;
    return { ...state.run };
  });
  const runCreate = jest.fn(async ({ data }: any) => {
    state.run = { id: nextRunId++, ...data, created_at: new Date(), finished_at: null, started_at: null };
    return { ...state.run };
  });
  const runUpdateMany = jest.fn(async ({ where, data }: any) => {
    if (!state.run || where?.id !== state.run.id ||
        (where?.connection_id != null && where.connection_id !== state.run.connection_id) ||
        (where?.connection_version != null && where.connection_version !== state.run.connection_version) ||
        (where?.lease_token !== undefined && where.lease_token !== state.run.lease_token) ||
        (where?.status != null && where.status !== state.run.status)) return { count: 0 };
    // Prisma.DbNull is a write sentinel; the persisted SQL JSON value is null.
    const persistedData = { ...data };
    if (persistedData.input_payload === Prisma.DbNull) persistedData.input_payload = null;
    Object.assign(state.run, persistedData);
    return { count: 1 };
  });
  const runFindUnique = jest.fn(async ({ where }: any) => {
    if (!state.run || where?.id !== state.run.id) return null;
    return { ...state.run, connection: { ...state.connection } };
  });
  const queryRaw = jest.fn(async (query: any) =>
    String(query?.sql ?? '').includes('document_reception_runs') ? [{ id: state.run?.id ?? 40 }] : [{ id: state.connection.id }],
  );
  const client: any = {
    organizations: {
      findFirst: jest.fn().mockResolvedValue(options.activeOrg === false ? null : {
        id: 1, state: 'active', operating_scope: 'ORGANIZATION', fiscal_scope: 'STORE',
      }),
    },
    stores: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => options.activeStore === false ? null : {
        id: 10,
        organization_id: options.foreignStore ? 2 : where.organization_id,
        is_active: true,
      }),
    },
    accounting_entities: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => options.activeEntity === false ? null : {
        id: 30,
        organization_id: options.foreignEntity ? 2 : where.organization_id,
        store_id: 10, scope: 'STORE', fiscal_scope: 'STORE', is_active: true,
      }),
    },
    document_reception_connections: {
      findUnique: connectionFind,
      findFirst: connectionFind,
      updateMany: connectionUpdateMany,
    },
    document_reception_runs: {
      findUnique: runFindUnique,
      findFirst: runFind,
      create: runCreate,
      updateMany: runUpdateMany,
    },
    withoutScope: jest.fn(() => client),
    $queryRaw: queryRaw,
    $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => callback(client)),
  };
  const fiscalScope = {
    findFiscalAccountingEntityId: jest.fn().mockResolvedValue(options.expectedEntity === undefined ? 30 : options.expectedEntity),
    assertValidScopeCombination: jest.fn(),
  };
  const receivedDocuments = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const service = new DocumentReceptionSyncLeaseService(
    client as unknown as GlobalPrismaService,
    fiscalScope as unknown as FiscalScopeService,
    receivedDocuments as unknown as ReceivedDocumentsService,
  );
  return { service, client, fiscalScope, receivedDocuments, state };
}

const hashA = 'a'.repeat(64);

describe('DocumentReceptionSyncLeaseService', () => {
  it('derives an active worker context from persisted ownership and never sets an ambient actor', async () => {
    const h = makeHarness();
    await expect(h.service.getWorkerContext(20)).resolves.toEqual({
      organization_id: 1,
      accounting_entity_id: 30,
      store_id: 10,
      actor_id: undefined,
      is_organization: true,
    });
    expect(h.fiscalScope.findFiscalAccountingEntityId).toHaveBeenCalledWith({
      organization_id: 1, store_id: 10, tx: expect.any(Object),
    });
    expect(h.fiscalScope.assertValidScopeCombination).toHaveBeenCalledWith('ORGANIZATION', 'STORE');
    expect(h.receivedDocuments.assertContext).toHaveBeenCalled();
    expect(h.client.accounting_entities.create).toBeUndefined();
  });

  it.each<[string, HarnessOptions]>([
    ['inactive organization', { activeOrg: false }],
    ['inactive store', { activeStore: false }],
    ['inactive entity', { activeEntity: false }],
    ['foreign store relation', { foreignStore: true }],
    ['foreign accounting entity relation', { foreignEntity: true }],
    ['stale fiscal entity mapping', { expectedEntity: 99 }],
  ])('fails closed for %s without creating a fiscal entity', async (_reason, options) => {
    const h = makeHarness(options);
    await expect(h.service.getWorkerContext(20)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.accounting_entities.create).toBeUndefined();
  });

  it('requires an actor for manual claims and validates trigger/payload combinations', async () => {
    const h = makeHarness();
    await expect(h.service.claim({ ...ctx, actor_id: undefined }, 20, {
      trigger: 'manual', idempotency_key: 'manual:1',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.claim(ctx, 20, {
      trigger: 'webhook', idempotency_key: 'hook:1',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replays the same webhook idempotency key and hash even while its lease is active', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'active-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.connection.enabled = false;
    h.state.connection.connection_type = 'webhook';
    h.state.run = {
      id: 88, connection_id: 20, connection_version: 4, lease_token: 'active-token',
      status: 'running', trigger: 'webhook', idempotency_key: 'hook:event-1', payload_sha256: hashA,
    };

    await expect(h.service.claim(ctx, 20, {
      trigger: 'webhook', idempotency_key: 'hook:event-1',
      input_payload: { event: 1 }, payload_sha256: hashA,
    })).resolves.toEqual({ run_id: 88, duplicate: true });
    expect(h.client.document_reception_runs.create).not.toHaveBeenCalled();
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a reused webhook idempotency key with a different payload hash', async () => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.run = {
      id: 89, connection_id: 20, connection_version: 4, status: 'completed',
      trigger: 'webhook', idempotency_key: 'hook:event-2', payload_sha256: hashA,
    };
    await expect(h.service.claim(ctx, 20, {
      trigger: 'webhook', idempotency_key: 'hook:event-2',
      input_payload: { event: 2 }, payload_sha256: 'b'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists a distinct webhook event while another run owns the active connection lease', async () => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.connection.lease_token = 'run-a-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 90, connection_id: 20, connection_version: 4, lease_token: 'run-a-token',
      status: 'running', trigger: 'webhook', idempotency_key: 'hook:A', payload_sha256: hashA,
    };

    await expect(h.service.claim(ctx, 20, {
      trigger: 'webhook', idempotency_key: 'hook:B',
      input_payload: { event: 'B' }, payload_sha256: 'b'.repeat(64),
    })).resolves.toEqual({ run_id: 40, duplicate: false });
    expect(h.client.document_reception_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'pending', trigger: 'webhook', idempotency_key: 'hook:B',
        connection_version: 4, lease_token: null,
        input_payload: { event: 'B' }, payload_sha256: 'b'.repeat(64),
      }),
    });
    expect(h.state.connection.lease_token).toBe('run-a-token');
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();

    // Once A completes, B is still the same durable event, but its first
    // attempt begins from the now-current connection cursor.
    h.state.connection.lease_token = null;
    h.state.connection.lease_expires_at = null;
    h.state.connection.cursor = 'cursor-after-A';
    const started = await h.service.start(40);
    expect(started?.run_id).toBe(40);
    expect(started?.cursor_before).toBe('cursor-after-A');
    expect(h.state.run.cursor_before).toBe('cursor-after-A');
  });

  it('replays an expired webhook run and restarts the same run id', async () => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.connection.connection_type = 'webhook';
    h.state.connection.lease_token = 'expired-token';
    h.state.connection.lease_expires_at = new Date(Date.now() - 1000);
    h.state.run = {
      id: 91, connection_id: 20, connection_version: 4, lease_token: 'expired-token',
      status: 'running', started_at: new Date('2026-09-30T12:00:00Z'),
      trigger: 'webhook', idempotency_key: 'hook:expired', payload_sha256: hashA,
      cursor_before: 'cursor-before', input_payload: { event: 'A' },
    };

    await expect(h.service.claim(ctx, 20, {
      trigger: 'webhook', idempotency_key: 'hook:expired',
      input_payload: { event: 'A' }, payload_sha256: hashA,
    })).resolves.toEqual({ run_id: 91, duplicate: true });
    const started = await h.service.start(91);
    expect(started).toMatchObject({ run_id: 91, connection_version: 4 });
    expect(started?.lease_token).not.toBe('expired-token');
    expect(h.state.run.id).toBe(91);
  });

  it.each(['failed', 'partial'])('retries a released %s run without changing its identity or cursor_before', async (status) => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.run = {
      id: 92, connection_id: 20, connection_version: 4, lease_token: 'previous-token',
      status, started_at: new Date('2026-09-30T12:00:00Z'),
      trigger: 'webhook', idempotency_key: `hook:${status}`, payload_sha256: hashA,
      cursor_before: 'cursor-before', input_payload: { event: status },
    };

    const started = await h.service.start(92);
    expect(started).toMatchObject({ run_id: 92, cursor_before: 'cursor-before' });
    expect(h.state.run).toMatchObject({ id: 92, status: 'running', cursor_before: 'cursor-before' });
    expect(h.state.run.started_at).toEqual(new Date('2026-09-30T12:00:00Z'));
  });

  it('rejects a nonterminal idempotency replay when its configuration version is stale', async () => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.connection.version = 5;
    h.state.run = {
      id: 93, connection_id: 20, connection_version: 4, lease_token: null,
      status: 'failed', trigger: 'webhook', idempotency_key: 'hook:old-version', payload_sha256: hashA,
    };

    await expect(h.service.claim(ctx, 20, {
      trigger: 'webhook', idempotency_key: 'hook:old-version',
      input_payload: { event: 'old' }, payload_sha256: hashA,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(h.client.document_reception_runs.create).not.toHaveBeenCalled();
  });

  it('claims an enabled API connection with version, scoped run relation, and a fresh lease', async () => {
    const h = makeHarness();
    await expect(h.service.claim({ ...ctx, actor_id: 55 }, 20, {
      trigger: 'manual', idempotency_key: 'manual:run-1', expected_version: 4,
    })).resolves.toMatchObject({ run_id: 40, duplicate: false });
    expect(h.client.document_reception_connections.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 20, organization_id: 1, accounting_entity_id: 30, store_id: 10, version: 4 }),
      data: expect.objectContaining({ lease_token: expect.any(String), lease_expires_at: expect.any(Date) }),
    }));
    expect(h.state.run).toMatchObject({
      idempotency_key: 'manual:run-1', connection_version: 4, trigger: 'manual',
      cursor_before: 'cursor-before', summary: { requested_by: 55 },
    });
  });

  it('rejects active leases and stale expected versions before creating a run', async () => {
    const active = makeHarness();
    active.state.connection.lease_token = 'already-held';
    active.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    await expect(active.service.claim(ctx, 20, {
      trigger: 'scheduler', idempotency_key: 'scheduler:1',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(active.client.document_reception_runs.create).not.toHaveBeenCalled();

    const stale = makeHarness();
    await expect(stale.service.claim({ ...ctx, actor_id: 55 }, 20, {
      trigger: 'manual', idempotency_key: 'manual:stale', expected_version: 3,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(stale.client.document_reception_runs.create).not.toHaveBeenCalled();
  });

  it('does not strand an older incomplete run when a manual or scheduled API claim sees its expired lease', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'older-run-token';
    h.state.connection.lease_expires_at = new Date(Date.now() - 1000);
    h.state.run = {
      id: 95, connection_id: 20, connection_version: 4, lease_token: 'older-run-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:older',
    };

    await expect(h.service.claim(ctx, 20, {
      trigger: 'scheduler', idempotency_key: 'scheduler:new',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(h.client.document_reception_runs.create).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'partial'])(
    'does not create a new API run while a prior %s run has released its lease',
    async (status) => {
      const h = makeHarness();
      h.state.connection.connection_type = 'api_poll';
      h.state.connection.lease_token = null;
      h.state.connection.lease_expires_at = null;
      h.state.run = {
        id: 96, connection_id: 20, connection_version: 4, lease_token: null,
        status, trigger: 'manual', idempotency_key: `manual:prior-${status}`,
      };

      await expect(h.service.claim({ ...ctx, actor_id: 55 }, 20, {
        trigger: 'manual', idempotency_key: `manual:new-${status}`,
      })).rejects.toBeInstanceOf(ConflictException);
      expect(h.client.document_reception_runs.create).not.toHaveBeenCalled();
    },
  );

  it('rotates a pending run lease on start and prevents starting an actively running run twice', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'claim-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: 'claim-token',
      status: 'pending', trigger: 'manual', idempotency_key: 'manual:run',
      cursor_before: 'cursor-before', input_payload: null, payload_sha256: null,
      started_at: null,
    };

    const started = await h.service.start(44);
    expect(started).toMatchObject({ run_id: 44, connection_id: 20, connection_version: 4, context: { actor_id: undefined } });
    expect(started?.lease_token).not.toBe('claim-token');
    expect(h.state.run).toMatchObject({ status: 'running', lease_token: started?.lease_token });
    expect(h.state.connection.lease_token).toBe(started?.lease_token);

    await expect(h.service.start(44)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reclaims an expired running lease but fails closed on disabled or changed configuration', async () => {
    const expired = makeHarness();
    expired.state.connection.lease_token = 'old-token';
    expired.state.connection.lease_expires_at = new Date(Date.now() - 1000);
    expired.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: 'old-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:run',
      cursor_before: 'cursor-before', input_payload: null, payload_sha256: null,
      started_at: new Date('2026-09-30T12:00:00Z'),
    };
    const reclaimed = await expired.service.start(44);
    expect(reclaimed?.lease_token).not.toBe('old-token');
    expect(expired.state.run.started_at).toEqual(new Date('2026-09-30T12:00:00Z'));

    const disabled = makeHarness();
    disabled.state.connection.enabled = false;
    disabled.state.connection.lease_token = 'old-token';
    disabled.state.connection.lease_expires_at = new Date(Date.now() - 1000);
    disabled.state.run = { ...expired.state.run, id: 44, lease_token: 'old-token', connection_version: 4 };
    await expect(disabled.service.start(44)).rejects.toBeInstanceOf(ConflictException);

    const stale = makeHarness();
    stale.state.connection.version = 5;
    stale.state.connection.lease_token = 'old-token';
    stale.state.connection.lease_expires_at = new Date(Date.now() - 1000);
    stale.state.run = { ...expired.state.run, id: 44, lease_token: 'old-token', connection_version: 4 };
    await expect(stale.service.start(44)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not start a pending webhook run while another run owns the active lease', async () => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.connection.lease_token = 'other-active-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 94, connection_id: 20, connection_version: 4, lease_token: null,
      status: 'pending', trigger: 'webhook', idempotency_key: 'hook:queued', payload_sha256: hashA,
      cursor_before: 'cursor-before',
    };

    await expect(h.service.start(94)).rejects.toBeInstanceOf(ConflictException);
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
    expect(h.client.document_reception_runs.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to rewind the cursor when retrying an attempted run after another run advanced it', async () => {
    const h = makeHarness();
    h.state.connection.connection_type = 'webhook';
    h.state.connection.cursor = 'cursor-after-other-run';
    h.state.run = {
      id: 96, connection_id: 20, connection_version: 4, lease_token: 'released-token',
      status: 'partial', started_at: new Date('2026-09-30T12:00:00Z'),
      trigger: 'webhook', idempotency_key: 'hook:stale-cursor', payload_sha256: hashA,
      cursor_before: 'cursor-before',
    };
    await expect(h.service.start(96)).rejects.toBeInstanceOf(ConflictException);
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
    expect(h.client.document_reception_runs.updateMany).not.toHaveBeenCalled();
  });

  it('returns null without changing terminal runs', async () => {
    const h = makeHarness();
    h.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: null,
      status: 'completed', trigger: 'manual', idempotency_key: 'manual:done',
    };
    await expect(h.service.start(44)).resolves.toBeNull();
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
    expect(h.client.document_reception_runs.updateMany).not.toHaveBeenCalled();
  });

  it('heartbeats only a live matching running lease', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'worker-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 30_000);
    h.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: 'worker-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:live',
    };
    await expect(h.service.heartbeat(44, 'worker-token')).resolves.toBe(true);
    expect(h.state.connection.lease_expires_at!.getTime()).toBeGreaterThan(Date.now() + 100_000);

    const lost = makeHarness();
    lost.state.connection.lease_token = 'current-token';
    lost.state.connection.lease_expires_at = new Date(Date.now() + 30_000);
    lost.state.run = { ...h.state.run, id: 44, lease_token: 'stale-token' };
    await expect(lost.service.heartbeat(44, 'stale-token')).resolves.toBe(false);
    expect(lost.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
  });

  it('commits the cursor only on full success and releases the connection lease', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'finish-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: 'finish-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:success',
      input_payload: { event: 'safe-to-clear-after-commit' }, payload_sha256: hashA,
      summary: { requested_by: 55 },
    };

    await expect(h.service.finish(44, 'finish-token', {
      received_count: 3, duplicate_count: 1, error_count: 0,
      document_ids: [1, 2, 3], error_codes: [], next_cursor: 'cursor-after',
    })).resolves.toBe(true);
    expect(h.state.connection).toMatchObject({
      cursor: 'cursor-after', last_error: null, lease_token: null, lease_expires_at: null,
    });
    expect(h.state.connection.last_synced_at).toBeInstanceOf(Date);
    expect(h.state.run).toMatchObject({
      status: 'completed', received_count: 3, duplicate_count: 1, error_count: 0,
      cursor_after: 'cursor-after', input_payload: null,
      summary: { counts: { received: 3, duplicates: 1, errors: 0 }, requested_by: 55, document_ids: [1, 2, 3] },
    });
    expect(h.state.run.payload_sha256).toBe(hashA);
  });

  it('schedules a successful API poll immediately when more pages are available', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'continue-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 45, connection_id: 20, connection_version: 4, lease_token: 'continue-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:continue',
    };

    await expect(h.service.finish(45, 'continue-token', {
      received_count: 100, duplicate_count: 0, error_count: 0,
      next_cursor: 'cursor-page-1', continue_immediately: true,
    })).resolves.toBe(true);
    expect(h.state.connection.next_sync_at).toBeInstanceOf(Date);
    expect(h.state.connection.next_sync_at!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rejects a non-boolean continue_immediately value before persistence work', async () => {
    const h = makeHarness();
    await expect(h.service.finish(45, 'some-token', {
      received_count: 0, duplicate_count: 0, error_count: 0,
      next_cursor: null, continue_immediately: 'yes' as any,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(h.client.document_reception_runs.findUnique).not.toHaveBeenCalled();
  });

  it('does not schedule an immediate retry for partial failure or a webhook', async () => {
    const partial = makeHarness();
    partial.state.connection.lease_token = 'partial-immediate-token';
    partial.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    partial.state.run = {
      id: 46, connection_id: 20, connection_version: 4, lease_token: 'partial-immediate-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:partial-immediate',
    };
    await expect(partial.service.finish(46, 'partial-immediate-token', {
      received_count: 100, duplicate_count: 0, error_count: 1,
      next_cursor: 'not-committed', continue_immediately: true,
    })).resolves.toBe(true);
    expect(partial.state.connection.next_sync_at!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    const webhook = makeHarness();
    webhook.state.connection.connection_type = 'webhook';
    webhook.state.connection.lease_token = 'webhook-finish-token';
    webhook.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    webhook.state.run = {
      id: 47, connection_id: 20, connection_version: 4, lease_token: 'webhook-finish-token',
      status: 'running', trigger: 'webhook', idempotency_key: 'hook:finish',
    };
    await expect(webhook.service.finish(47, 'webhook-finish-token', {
      received_count: 1, duplicate_count: 0, error_count: 0,
      next_cursor: null, continue_immediately: true,
    })).resolves.toBe(true);
    expect(webhook.state.connection.next_sync_at).toBeNull();
  });

  it('preserves cursor on partial failure and stores only registered error codes', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'partial-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: 'partial-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:partial',
      input_payload: { retry: true }, payload_sha256: hashA,
    };

    await expect(h.service.finish(44, 'partial-token', {
      received_count: 1, duplicate_count: 0, error_count: 1,
      document_ids: [1], error_codes: ['SYS_INTERNAL_001', 'RAW PROVIDER ERROR'], next_cursor: 'cursor-should-not-commit',
    })).resolves.toBe(true);
    expect(h.state.connection.cursor).toBe('cursor-before');
    expect(h.state.connection.last_error).toBe('SYS_INTERNAL_001');
    expect(h.state.connection.lease_token).toBeNull();
    expect(h.state.run).toMatchObject({
      status: 'partial', cursor_after: null, input_payload: { retry: true },
      summary: { error_codes: ['SYS_INTERNAL_001'] },
    });
  });

  it('returns false without writes for stale finish tokens or a lost/expired lease', async () => {
    const h = makeHarness();
    h.state.connection.lease_token = 'current-token';
    h.state.connection.lease_expires_at = new Date(Date.now() + 60_000);
    h.state.run = {
      id: 44, connection_id: 20, connection_version: 4, lease_token: 'current-token',
      status: 'running', trigger: 'scheduler', idempotency_key: 'scheduler:current',
    };
    await expect(h.service.finish(44, 'stale-token', {
      received_count: 0, duplicate_count: 0, error_count: 1, next_cursor: null,
    })).resolves.toBe(false);
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
    expect(h.client.document_reception_runs.updateMany).not.toHaveBeenCalled();

    h.state.connection.lease_expires_at = new Date(Date.now() - 1000);
    await expect(h.service.finish(44, 'current-token', {
      received_count: 0, duplicate_count: 0, error_count: 1, next_cursor: null,
    })).resolves.toBe(false);
    expect(h.client.document_reception_connections.updateMany).not.toHaveBeenCalled();
    expect(h.client.document_reception_runs.updateMany).not.toHaveBeenCalled();
  });
});
