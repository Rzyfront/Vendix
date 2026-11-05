import { RequestContextService } from '@common/context/request-context.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { seedPeople, seedWorkGroup } from '../../../../testing/workflows/workflow-test-kit';
import { WorkGroupsService } from '../work-groups.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  OUTBOX_BACKOFF_MINUTES,
  WorkflowOutboxDispatcher,
} from './workflow-outbox.dispatcher';

describe('WorkflowOutboxDispatcher', () => {
  let db: FakeWorkflowDb;
  let dispatcher: WorkflowOutboxDispatcher;
  const engine = { tick: jest.fn() };
  const notifications = { sendToUser: jest.fn() };
  const MIN = 60_000;
  const past = () => new Date(Date.now() - MIN);
  const row = (i = 0) => db.table('workflow_outbox')[i];
  const enqueue = (kind: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    db.insert('workflow_outbox', {
      store_id: 1, instance_id: 1, kind, payload, available_at: past(), created_at: new Date(), ...extra,
    });

  beforeEach(() => {
    db = new FakeWorkflowDb();
    seedPeople(db);
    seedWorkGroup(db, 'ops', [4, 5]);
    db.insert('workflow_instances', {
      id: 1, store_id: 1, organization_id: 1, reference: 'FLU-000001', title: 'Compra',
      current_stage_key: 'a', stage_entry_seq: 1, started_by_type: 'user', started_by_id: 1,
    });
    engine.tick.mockReset().mockResolvedValue({ action: 'advanced' });
    notifications.sendToUser.mockReset().mockResolvedValue({ id: 1 });
    const prisma = db.asStorePrisma();
    dispatcher = new WorkflowOutboxDispatcher(
      prisma,
      engine as any,
      new WorkflowAssignmentService(new WorkGroupsService(prisma)),
      notifications as any,
    );
  });

  it('notify: resuelve a los destinatarios y crea una notificación in-app por persona', async () => {
    db.insert('workflow_tasks', {
      id: 5, store_id: 1, organization_id: 1, instance_id: 1, stage_key: 'a',
      stage_entry_seq: 1, kind: 'form', assignee_group_id: 1,
    });
    enqueue('notify', { title: 'FLU-000001 · Compra', message: 'Tienes una tarea', task_ids: [5], user_ids: [1] });
    const summary = await dispatcher.dispatchBatch();
    expect(summary).toMatchObject({ claimed: 1, done: 1, retried: 0, dead: 0 });
    const sent = notifications.sendToUser.mock.calls.map((c) => c[1]).sort();
    expect(sent).toEqual([1, 4, 5]);
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      1, expect.any(Number), 'workflow_task', 'FLU-000001 · Compra', 'Tienes una tarea',
      expect.objectContaining({ instance_id: 1 }),
    );
    expect(row()).toMatchObject({ status: 'done', attempts: 1, last_error: null });
  });

  it('advance: llama a engine.tick bajo el contexto aislado de la tienda de la fila', async () => {
    let seen: any;
    engine.tick.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return { action: 'advanced' };
    });
    enqueue('advance', { instance_id: 1, stage_key: 'auto', stage_entry_seq: 3 }, { store_id: 1 });
    await dispatcher.dispatchBatch();
    expect(engine.tick).toHaveBeenCalledWith(1, { expectStageEntrySeq: 3 });
    expect(seen).toMatchObject({ store_id: 1, organization_id: 1, is_super_admin: false });
    expect(row().status).toBe('done');
  });

  it('no toma filas con available_at en el futuro ni ya terminadas', async () => {
    enqueue('advance', { instance_id: 1 }, { available_at: new Date(Date.now() + 10 * MIN) });
    enqueue('advance', { instance_id: 1 }, { status: 'done' });
    expect((await dispatcher.dispatchBatch()).claimed).toBe(0);
    expect(engine.tick).not.toHaveBeenCalled();
  });

  it('falla → pendiente de nuevo con backoff 1m, 5m, 30m, 2h, 12h y dead al 6.º intento', async () => {
    engine.tick.mockRejectedValue(new Error('boom'));
    enqueue('advance', { instance_id: 1, stage_entry_seq: 1 });
    expect(OUTBOX_BACKOFF_MINUTES).toEqual([1, 5, 30, 120, 720]);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const now = new Date();
      const summary = await dispatcher.dispatchBatch(20, now);
      expect(summary).toMatchObject({ claimed: 1, retried: 1, dead: 0 });
      expect(row()).toMatchObject({ status: 'pending', attempts: attempt, last_error: 'boom' });
      expect(row().available_at.getTime() - now.getTime()).toBe(OUTBOX_BACKOFF_MINUTES[attempt - 1] * MIN);
      row().available_at = past(); // llega la hora del siguiente intento
    }
    const last = await dispatcher.dispatchBatch();
    expect(last).toMatchObject({ claimed: 1, retried: 0, dead: 1 });
    expect(row()).toMatchObject({ status: 'dead', attempts: 6, last_error: 'boom' });
    expect((await dispatcher.dispatchBatch()).claimed).toBe(0);
  });

  it('un tipo desconocido falla y reintenta (no se pierde en silencio)', async () => {
    enqueue('webhook', {});
    const s = await dispatcher.dispatchBatch();
    expect(s.retried).toBe(1);
    expect(row().last_error).toMatch(/Unsupported outbox kind/);
  });

  it('una fila "processing" abandonada hace más de 10 minutos se vuelve a tomar', async () => {
    enqueue('advance', { instance_id: 1 }, { status: 'processing', available_at: new Date(Date.now() - 11 * MIN), attempts: 1 });
    const s = await dispatcher.dispatchBatch();
    expect(s.done).toBe(1);
    expect(row().attempts).toBe(2);
  });
});
