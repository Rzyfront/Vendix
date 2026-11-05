import { RequestContextService } from '@common/context/request-context.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { seedPeople, seedWorkGroup } from '../../../../testing/workflows/workflow-test-kit';
import { WorkGroupsService } from '../work-groups.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  OUTBOX_ABANDONED_ERROR,
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_MAX_ATTEMPTS,
  WorkflowOutboxDispatcher,
} from './workflow-outbox.dispatcher';

describe('WorkflowOutboxDispatcher', () => {
  let db: FakeWorkflowDb;
  let dispatcher: WorkflowOutboxDispatcher;
  const engine = { tick: jest.fn() };
  const notifications = { sendToUser: jest.fn() };
  const actions = { execute: jest.fn(), recordFailure: jest.fn() };
  const mailer = { send: jest.fn() };
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
    mailer.send.mockReset().mockResolvedValue('sent');
    actions.execute.mockReset();
    actions.recordFailure.mockReset();
    const prisma = db.asStorePrisma();
    dispatcher = new WorkflowOutboxDispatcher(
      prisma,
      engine as any,
      new WorkflowAssignmentService(new WorkGroupsService(prisma)),
      notifications as any,
      mailer as any,
      { deliver: jest.fn() } as any,
      actions as any,
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
    enqueue('telepathy', {});
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

  describe('fila que tumba al worker (abandonada en processing con los intentos agotados)', () => {
    const stale = () => new Date(Date.now() - 11 * MIN);

    it('pasa a dead conservando last_error y no se vuelve a reclamar', async () => {
      enqueue('advance', { instance_id: 1 }, {
        status: 'processing', available_at: stale(), attempts: OUTBOX_MAX_ATTEMPTS, last_error: 'boom previo',
      });
      const s = await dispatcher.dispatchBatch();
      expect(s).toMatchObject({ claimed: 0, done: 0, retried: 0, dead: 1 });
      expect(engine.tick).not.toHaveBeenCalled();
      expect(row()).toMatchObject({ status: 'dead', attempts: OUTBOX_MAX_ATTEMPTS, last_error: 'boom previo' });
      // siguientes vueltas del cron: nada que hacer
      expect(await dispatcher.dispatchBatch()).toMatchObject({ claimed: 0, dead: 0 });
      expect(row().attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    });

    it('sin last_error previo deja constancia de que el worker murió', async () => {
      enqueue('advance', { instance_id: 1 }, {
        status: 'processing', available_at: stale(), attempts: OUTBOX_MAX_ATTEMPTS + 2, last_error: null,
      });
      await dispatcher.dispatchBatch();
      expect(row()).toMatchObject({ status: 'dead', last_error: OUTBOX_ABANDONED_ERROR });
    });

    it('una acción enterrada así deja action_failed en el historial, como un dead normal', async () => {
      enqueue('action', { instance_id: 1 }, {
        status: 'processing', available_at: stale(), attempts: OUTBOX_MAX_ATTEMPTS, last_error: 'timeout',
      });
      await dispatcher.dispatchBatch();
      expect(actions.execute).not.toHaveBeenCalled();
      expect(actions.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ id: row().id, kind: 'action' }), 'timeout',
      );
    });

    it('con intentos restantes o aún no abandonada (< 10 min) no se entierra', async () => {
      enqueue('advance', { instance_id: 1 }, {
        status: 'processing', available_at: stale(), attempts: OUTBOX_MAX_ATTEMPTS - 1,
      });
      enqueue('advance', { instance_id: 1 }, {
        status: 'processing', available_at: new Date(Date.now() - 2 * MIN), attempts: OUTBOX_MAX_ATTEMPTS,
      });
      const s = await dispatcher.dispatchBatch();
      expect(s).toMatchObject({ claimed: 1, done: 1, dead: 0 });
      expect(row(0)).toMatchObject({ status: 'done', attempts: OUTBOX_MAX_ATTEMPTS });
      expect(row(1)).toMatchObject({ status: 'processing', attempts: OUTBOX_MAX_ATTEMPTS });
    });

    it('el reclamo SQL excluye por sí mismo las processing con los intentos agotados', async () => {
      const raw = jest.spyOn(db as any, 'raw');
      // Sin el paso de entierro (simula que otro worker lo ganó): el reclamo no la toma.
      jest.spyOn(dispatcher as any, 'buryExhaustedStale').mockResolvedValue(0);
      enqueue('advance', { instance_id: 1 }, {
        status: 'processing', available_at: stale(), attempts: OUTBOX_MAX_ATTEMPTS,
      });
      expect((await dispatcher.dispatchBatch()).claimed).toBe(0);
      expect(row().status).toBe('processing');
      const claimSql = String(raw.mock.calls[0][0]);
      expect(claimSql).toContain('UPDATE workflow_outbox');
      expect(claimSql).toMatch(
        new RegExp(`status = 'processing'\\s+AND attempts < ${OUTBOX_MAX_ATTEMPTS}\\b`),
      );
    });
  });

  describe('correo', () => {
    const notifyRow = () =>
      enqueue('notify', { title: 'FLU-000001 · Compra', message: 'Tienes una tarea', user_ids: [1, 4, 5] });

    it('envía el correo después de la notificación in-app, una vez por persona, con asunto "<referencia> · <etapa>"', async () => {
      const def = { schema: 'vendix.workflow/v1', key: 'p', name: 'P', fields: [], stages: [{ key: 'a', name: 'Aprobación', type: 'approval' }] };
      db.insert('workflow_versions', { id: 7, store_id: 1, definition_id: 1, version: 1, definition: def });
      db.table('workflow_instances')[0].version_id = 7;
      notifyRow();
      const order: string[] = [];
      notifications.sendToUser.mockImplementation(async (_s: number, u: number) => void order.push(`app${u}`));
      mailer.send.mockImplementation(async (m: any) => (order.push(`mail${m.userId}`), 'sent'));
      await dispatcher.dispatchBatch();
      expect(order).toEqual(['app1', 'app4', 'app5', 'mail1', 'mail4', 'mail5']);
      expect(mailer.send).toHaveBeenCalledWith({
        storeId: 1, userId: 4, instanceId: 1, subject: 'FLU-000001 · Aprobación', message: 'Tienes una tarea',
      });
      expect(row()).toMatchObject({ status: 'done' });
    });

    it('un fallo de correo reintenta por backoff solo lo pendiente: nadie recibe el mismo canal dos veces', async () => {
      notifyRow();
      mailer.send.mockImplementation(async (m: any) => (m.userId === 4 ? 'failed' : 'sent'));
      const first = await dispatcher.dispatchBatch();
      expect(first).toMatchObject({ retried: 1, done: 0 });
      expect(row()).toMatchObject({ status: 'pending', last_error: expect.stringContaining('4') });
      expect(row().payload.delivered).toEqual({ in_app: [1, 4, 5], email: [1, 5] });
      row().available_at = past();
      mailer.send.mockClear();
      notifications.sendToUser.mockClear();
      mailer.send.mockResolvedValue('sent');
      const second = await dispatcher.dispatchBatch();
      expect(second).toMatchObject({ done: 1 });
      expect(notifications.sendToUser).not.toHaveBeenCalled();
      expect(mailer.send.mock.calls.map((c) => c[0].userId)).toEqual([4]);
      expect(row().payload.delivered.email.sort()).toEqual([1, 4, 5]);
    });

    it('sin dirección de correo (skipped) la fila termina sin reintentos; exclude_user_ids no recibe nada', async () => {
      enqueue('notify', { title: 't', message: 'm', user_ids: [1, 4], exclude_user_ids: [1] });
      mailer.send.mockResolvedValue('skipped');
      expect(await dispatcher.dispatchBatch()).toMatchObject({ done: 1, retried: 0 });
      expect(notifications.sendToUser.mock.calls.map((c) => c[1])).toEqual([4]);
      expect(mailer.send.mock.calls.map((c) => c[0].userId)).toEqual([4]);
    });
  });
});
