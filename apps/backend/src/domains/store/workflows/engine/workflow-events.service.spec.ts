import { Prisma } from '@prisma/client';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowWebhookEmitter } from '../webhooks/workflow-webhook-emitter.service';
import { WorkflowTx } from './workflow-engine.types';

function makeTx(data: Record<string, unknown> | null, lastSeq = 2) {
  const create = jest.fn().mockResolvedValue({ id: 1 });
  const instanceFind = jest.fn().mockResolvedValue(data === null ? null : { data });
  const tx = {
    workflow_instance_events: {
      findFirst: jest.fn().mockResolvedValue({ seq: lastSeq }),
      create,
    },
    workflow_instances: { findFirst: instanceFind },
  } as unknown as WorkflowTx;
  return { tx, create, instanceFind };
}

const base = {
  store_id: 7,
  instance_id: 9,
  type: 'joined',
  actor: { type: 'user' as const, id: 3 },
};

describe('WorkflowEventsService.append data snapshot', () => {
  const service = new WorkflowEventsService(new WorkflowWebhookEmitter());

  it('records the instance data read in the same tx, scoped by store', async () => {
    const { tx, create, instanceFind } = makeTx({ monto: 5 });
    await service.append(tx, base);
    expect(instanceFind).toHaveBeenCalledWith({
      where: { id: 9, store_id: 7 },
      select: { data: true },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ seq: 3, data_snapshot: { monto: 5 } });
  });

  it('an explicit dataSnapshot wins and skips the extra query', async () => {
    const { tx, create, instanceFind } = makeTx({ monto: 5 });
    await service.append(tx, { ...base, dataSnapshot: { monto: 9 } });
    expect(instanceFind).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.data_snapshot).toEqual({ monto: 9 });
  });

  it('stores a database null when the instance does not exist yet', async () => {
    const { tx, create } = makeTx(null);
    await service.append(tx, base);
    expect(create.mock.calls[0][0].data.data_snapshot).toBe(Prisma.DbNull);
  });
});
