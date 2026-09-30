import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { CancelDocumentReceptionRunDto } from '../dto/document-reception-run-resolution.dto';
import { DocumentReceptionRunResolutionService } from './document-reception-run-resolution.service';

const context: ReceivedDocumentsContext = {
  organization_id: 3,
  accounting_entity_id: 8,
  store_id: 21,
  actor_id: 55,
  is_organization: true,
};
const reason = 'Duplicate provider delivery confirmed';

function clone<T extends Record<string, any>>(value: T): T {
  return {
    ...value,
    ...(value.lease_expires_at instanceof Date ? { lease_expires_at: new Date(value.lease_expires_at) } : {}),
    ...(value.next_sync_at instanceof Date ? { next_sync_at: new Date(value.next_sync_at) } : {}),
  };
}

function harness(connectionOverrides: Record<string, any> = {}, runOverrides: Record<string, any> = {}) {
  const state: any = {
    connection: {
      id: 41,
      organization_id: 3,
      accounting_entity_id: 8,
      store_id: 21,
      version: 4,
      connection_type: 'api_poll',
      lease_token: null,
      lease_expires_at: null,
      next_sync_at: new Date('2026-10-01T00:00:00Z'),
      ...connectionOverrides,
    },
    run: {
      id: 90,
      connection_id: 41,
      status: 'pending',
      connection_version: 4,
      lease_token: null,
      received_count: 2,
      duplicate_count: 1,
      error_count: 0,
      cursor_before: 'cursor-before',
      cursor_after: null,
      input_payload: { event: 'private-payload' },
      payload_sha256: 'a'.repeat(64),
      ...runOverrides,
    },
  };
  let activeState = state;
  const connections = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (where.id !== activeState.connection.id ||
          where.organization_id !== activeState.connection.organization_id ||
          where.accounting_entity_id !== activeState.connection.accounting_entity_id ||
          where.store_id !== activeState.connection.store_id) return null;
      return clone(activeState.connection);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.id !== activeState.connection.id ||
          where.organization_id !== activeState.connection.organization_id ||
          where.accounting_entity_id !== activeState.connection.accounting_entity_id ||
          where.store_id !== activeState.connection.store_id ||
          where.version !== activeState.connection.version) return { count: 0 };
      Object.assign(activeState.connection, data);
      return { count: 1 };
    }),
  };
  const runs = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (where.id !== activeState.run.id || where.connection_id !== activeState.run.connection_id ||
          where.connection.organization_id !== activeState.connection.organization_id ||
          where.connection.accounting_entity_id !== activeState.connection.accounting_entity_id ||
          where.connection.store_id !== activeState.connection.store_id) return null;
      return clone(activeState.run);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.id !== activeState.run.id || where.connection_id !== activeState.run.connection_id ||
          where.status !== activeState.run.status || where.connection_version !== activeState.run.connection_version) return { count: 0 };
      const persisted = { ...data };
      if (persisted.input_payload === Prisma.DbNull) persisted.input_payload = null;
      Object.assign(activeState.run, persisted);
      return { count: 1 };
    }),
  };
  const audit = { create: jest.fn().mockResolvedValue({ id: 17 }) };
  const prisma: any = {
    document_reception_connections: connections,
    document_reception_runs: runs,
    audit_logs: audit,
    $queryRaw: jest.fn().mockResolvedValue([{ id: 41 }]),
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const working = { connection: clone(state.connection), run: clone(state.run) };
      activeState = working;
      try {
        const result = await callback(prisma);
        Object.assign(state.connection, working.connection);
        Object.assign(state.run, working.run);
        return result;
      } finally {
        activeState = state;
      }
    }),
  };
  const receivedDocuments = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const service = new DocumentReceptionRunResolutionService(
    prisma as unknown as GlobalPrismaService,
    receivedDocuments as unknown as ReceivedDocumentsService,
  );
  return { service, prisma, connections, runs, audit, receivedDocuments, state };
}

describe('DocumentReceptionRunResolutionService', () => {
  it('trims and validates the mandatory cancellation reason', () => {
    const valid = plainToInstance(CancelDocumentReceptionRunDto, { reason: `  ${reason}  ` });
    expect(valid.reason).toBe(reason);
    expect(validateSync(valid)).toHaveLength(0);
    for (const invalid of ['', 'short', `valid reason\n${reason}`, 'x'.repeat(501)]) {
      expect(validateSync(plainToInstance(CancelDocumentReceptionRunDto, { reason: invalid })).length).toBeGreaterThan(0);
    }
  });

  it.each(['pending', 'queued', 'failed', 'partial'])(
    'cancels scoped %s runs and audits one sanitized transition',
    async (status) => {
      const h = harness({}, { status });
      await expect(h.service.cancel(context, 41, 90, { reason } as any)).resolves.toEqual({
        run_id: 90, status: 'cancelled', duplicate: false,
      });
      expect(h.runs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 90, connection_id: 41, status }),
        data: expect.objectContaining({ status: 'cancelled', finished_at: expect.any(Date), input_payload: Prisma.DbNull }),
      }));
      expect(h.audit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        user_id: 55, organization_id: 3, store_id: 21, action: 'UPDATE',
        resource: 'document_reception_runs', resource_id: 90,
        metadata: { cancellation_reason: reason },
      }) }));
      const serialized = JSON.stringify(h.audit.create.mock.calls[0][0].data);
      expect(serialized).not.toContain('private-payload');
      expect(serialized).not.toContain('a'.repeat(64));
    },
  );

  it('locks connection then run, clears payload/releases its lease, and preserves cursor and counters', async () => {
    const h = harness({
      lease_token: 'owned-token',
      lease_expires_at: new Date(Date.now() + 60_000),
    }, {
      lease_token: 'owned-token',
      cursor_before: 'keep-before',
      cursor_after: 'keep-after',
      status: 'queued',
    });
    await h.service.cancel(context, 41, 90, { reason } as any);
    expect(h.prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(h.prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.connections.findFirst.mock.invocationCallOrder[0]);
    expect(h.prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(h.runs.findFirst.mock.invocationCallOrder[0]);
    expect(h.state.connection).toMatchObject({ lease_token: null, lease_expires_at: null, next_sync_at: null });
    expect(h.state.run).toMatchObject({
      status: 'cancelled', input_payload: null, payload_sha256: 'a'.repeat(64),
      cursor_before: 'keep-before', cursor_after: 'keep-after',
      received_count: 2, duplicate_count: 1, error_count: 0,
    });
  });

  it('does not clobber another run lease and pauses API polling', async () => {
    const otherLeaseExpiresAt = new Date(Date.now() + 60_000);
    const h = harness({
      lease_token: 'other-run-token',
      lease_expires_at: otherLeaseExpiresAt,
    }, { status: 'failed', lease_token: 'old-run-token' });
    await h.service.cancel(context, 41, 90, { reason } as any);
    expect(h.state.connection.lease_token).toBe('other-run-token');
    expect(h.state.connection.lease_expires_at).toEqual(otherLeaseExpiresAt);
    expect(h.state.connection.next_sync_at).toBeNull();
  });

  it('allows a running cancellation only when its matching lease has expired', async () => {
    const active = harness({ lease_token: 'run-token', lease_expires_at: new Date(Date.now() + 60_000) }, {
      status: 'running', lease_token: 'run-token',
    });
    await expect(active.service.cancel(context, 41, 90, { reason } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(active.runs.updateMany).not.toHaveBeenCalled();

    const stale = harness({ lease_token: 'run-token', lease_expires_at: new Date(Date.now() - 1000) }, {
      status: 'running', lease_token: 'run-token',
    });
    await expect(stale.service.cancel(context, 41, 90, { reason } as any)).resolves.toMatchObject({ duplicate: false });
    expect(stale.state.run.status).toBe('cancelled');
  });

  it('returns duplicate for already-cancelled, conflicts for completed, and hides foreign runs', async () => {
    const cancelled = harness({}, { status: 'cancelled' });
    await expect(cancelled.service.cancel(context, 41, 90, { reason } as any)).resolves.toEqual({
      run_id: 90, status: 'cancelled', duplicate: true,
    });
    expect(cancelled.audit.create).not.toHaveBeenCalled();

    const completed = harness({}, { status: 'completed' });
    await expect(completed.service.cancel(context, 41, 90, { reason } as any)).rejects.toBeInstanceOf(ConflictException);

    const foreign = harness();
    foreign.runs.findFirst.mockResolvedValueOnce(null);
    await expect(foreign.service.cancel(context, 41, 90, { reason } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(foreign.runs.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back cancellation if the audit insert fails', async () => {
    const h = harness({ lease_token: 'owned-token', lease_expires_at: new Date(Date.now() + 60_000) }, {
      lease_token: 'owned-token', status: 'pending',
    });
    h.audit.create.mockRejectedValueOnce(new Error('raw secret/audit failure'));
    await expect(h.service.cancel(context, 41, 90, { reason } as any)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.state.run.status).toBe('pending');
    expect(h.state.run.input_payload).toEqual({ event: 'private-payload' });
    expect(h.state.connection.lease_token).toBe('owned-token');
    expect(h.state.connection.next_sync_at).not.toBeNull();
  });

  it('requires actor, scoped context, and a valid reason', async () => {
    const actorless = harness();
    await expect(actorless.service.cancel({ ...context, actor_id: undefined }, 41, 90, { reason } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(actorless.receivedDocuments.assertContext).not.toHaveBeenCalled();

    const invalidReason = harness();
    await expect(invalidReason.service.cancel(context, 41, 90, { reason: 'short' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(invalidReason.prisma.$transaction).not.toHaveBeenCalled();
  });
});
