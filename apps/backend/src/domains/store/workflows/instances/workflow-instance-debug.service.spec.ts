import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowInstanceDebugController } from './workflow-instance-debug.controller';
import {
  WorkflowInstanceDebugService,
  diffData,
} from './workflow-instance-debug.service';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';

const at = (n: number) => new Date(2026, 10, n);
const ev = (seq: number, snapshot: unknown, type = 'transitioned') => ({
  seq,
  type,
  from_stage_key: 'a',
  to_stage_key: 'b',
  actor_type: 'user',
  actor_id: 3,
  occurred_at: at(seq),
  payload: { seq },
  data_snapshot: snapshot,
});

function setup(instance: unknown, events: unknown[]) {
  const prisma = {
    workflow_instances: { findFirst: jest.fn().mockResolvedValue(instance) },
    workflow_instance_events: { findMany: jest.fn().mockResolvedValue(events) },
  };
  jest
    .spyOn(RequestContextService, 'getContext')
    .mockReturnValue({ store_id: 7 } as ReturnType<typeof RequestContextService.getContext>);
  return {
    prisma,
    service: new WorkflowInstanceDebugService(prisma as unknown as StorePrismaService),
  };
}

describe('diffData', () => {
  it('reports added, removed and modified keys sorted by key', () => {
    expect(diffData({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 })).toEqual([
      { key: 'b', before: 2, after: 9 },
      { key: 'c', before: 3, after: null },
      { key: 'd', before: null, after: 4 },
    ]);
  });

  it('compares nested values by content', () => {
    expect(diffData({ x: { n: 1 } }, { x: { n: 1 } })).toEqual([]);
  });
});

describe('WorkflowInstanceDebugService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns events in seq order with changes against the previous snapshot', async () => {
    const { service, prisma } = setup({ id: 5, data: { monto: 30 } }, [
      ev(1, { monto: 10 }, 'started'),
      ev(2, null, 'legacy'),
      ev(3, { monto: 30, nota: 'ok' }),
    ]);
    const r = await service.debug(5);
    expect(prisma.workflow_instance_events.findMany).toHaveBeenCalledWith({
      where: { store_id: 7, instance_id: 5 },
      orderBy: { seq: 'asc' },
    });
    expect(r.current_data).toEqual({ monto: 30 });
    expect(r.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(r.events[0].changes).toEqual([]);
    expect(r.events[1]).toMatchObject({ data_snapshot: null, changes: [] });
    // Diffed against event 1: the legacy event in between is skipped.
    expect(r.events[2].changes).toEqual([
      { key: 'monto', before: 10, after: 30 },
      { key: 'nota', before: null, after: 'ok' },
    ]);
    expect(r.events[2]).toMatchObject({ occurred_at: at(3), actor_type: 'user', actor_id: 3 });
  });

  it('another store (or unknown) instance is a 404 and no event is read', async () => {
    const { service, prisma } = setup(null, []);
    await expect(service.debug(99)).rejects.toBeInstanceOf(VendixHttpException);
    expect(prisma.workflow_instances.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, store_id: 7 } }),
    );
    expect(prisma.workflow_instance_events.findMany).not.toHaveBeenCalled();
  });
});

describe('WorkflowInstanceDebugController', () => {
  it('requires store:workflows:manage', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, WorkflowInstanceDebugController.prototype.debug),
    ).toEqual(['store:workflows:manage']);
  });
});
