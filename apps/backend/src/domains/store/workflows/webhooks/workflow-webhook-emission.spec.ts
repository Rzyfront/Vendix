import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowTimersCron } from '../engine/workflow-timers.cron';
import { WORKFLOW_WEBHOOK_EVENTS } from './workflow-webhook.constants';

describe('emisión de webhooks desde el motor', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const ALL = [...WORKFLOW_WEBHOOK_EVENTS];

  const endpoint = (over: Record<string, unknown> = {}) =>
    kit.db.insert('workflow_webhook_endpoints', {
      organization_id: 1,
      store_id: 1,
      url: 'https://hooks.example.com/a',
      secret_enc: 'enc',
      event_types: ALL,
      created_by_user_id: 1,
      ...over,
    });
  const deliveries = (type?: string) =>
    kit.db
      .table('workflow_webhook_deliveries')
      .filter((d) => !type || d.event_type === type);
  const types = () => deliveries().map((d) => d.event_type);
  const webhookOutbox = () =>
    kit.db.table('workflow_outbox').filter((o) => o.kind === 'webhook');

  async function startAndSubmit(amount: number) {
    const started = await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: `k-${Math.random()}`,
    });
    const task = kit.db
      .table('workflow_tasks')
      .find(
        (t) => t.instance_id === started.instance.id && t.status === 'open',
      )!;
    const done = await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { amount, reason: 'x' },
      expectedRowVersion: started.instance.row_version,
    });
    return { started, done };
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedDefinition(kit.db, purchaseDefinition());
  });
  afterEach(() => jest.restoreAllMocks());

  it('sin endpoints no escribe nada', async () => {
    await startAndSubmit(10);
    expect(deliveries()).toHaveLength(0);
    expect(webhookOutbox()).toHaveLength(0);
  });

  it('start: instance.started + task.created, con el cuerpo {event_id, occurred_at, store_id, type, data}', async () => {
    const ep = endpoint();
    await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k1' });
    expect(types()).toEqual([
      'workflow.instance.started',
      'workflow.task.created',
    ]);
    const started = deliveries('workflow.instance.started')[0];
    expect(started).toMatchObject({
      store_id: 1,
      endpoint_id: ep.id,
      status: 'pending',
      attempts: 0,
    });
    expect(started.payload).toMatchObject({
      store_id: 1,
      type: 'workflow.instance.started',
      data: {
        reference: 'FLU-000001',
        stage_key: 'request',
        definition_key: 'purchase',
      },
    });
    expect(started.payload.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(started.event_id).toBe(started.payload.event_id);
    expect(new Date(started.payload.occurred_at).toString()).not.toBe(
      'Invalid Date',
    );
    // Nunca datos del formulario
    expect(JSON.stringify(started.payload)).not.toMatch(/amount|reason/);
  });

  it('cada entrega tiene su fila de outbox kind=webhook en la misma transacción', async () => {
    endpoint();
    await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k1' });
    expect(webhookOutbox()).toHaveLength(2);
    expect(webhookOutbox().map((o) => o.payload.delivery_id)).toEqual(
      deliveries().map((d) => d.id),
    );
    expect(
      webhookOutbox().every((o) => o.status === 'pending' && o.store_id === 1),
    ).toBe(true);
  });

  it('una fila por endpoint con el MISMO event_id; respeta event_types y is_active', async () => {
    const a = endpoint();
    const b = endpoint({
      url: 'https://hooks.example.com/b',
      event_types: ['workflow.instance.started'],
    });
    endpoint({ url: 'https://off.example.com/', is_active: false });
    endpoint({
      url: 'https://tasks.example.com/',
      event_types: ['workflow.task.created'],
    });
    await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k1' });
    const started = deliveries('workflow.instance.started');
    expect(started.map((d) => d.endpoint_id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(new Set(started.map((d) => d.event_id)).size).toBe(1);
    expect(deliveries('workflow.task.created')).toHaveLength(2); // a + tasks.example.com
  });

  it('endpoints de otra tienda no reciben nada', async () => {
    endpoint({ store_id: 2 });
    await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k1' });
    expect(deliveries()).toHaveLength(0);
  });

  it('completar la tarea: task.completed, instance.transitioned y, en la etapa final, instance.completed', async () => {
    endpoint();
    await startAndSubmit(10);
    expect(types()).toEqual([
      'workflow.instance.started',
      'workflow.task.created',
      'workflow.task.completed',
      'workflow.instance.transitioned',
      'workflow.instance.completed',
    ]);
    expect(
      deliveries('workflow.instance.transitioned')[0].payload.data,
    ).toMatchObject({
      from_stage_key: 'request',
      to_stage_key: 'done',
      status: 'completed',
    });
    expect(deliveries('workflow.task.completed')[0].payload.data).toMatchObject(
      {
        stage_key: 'request',
        outcome: 'submit',
      },
    );
    expect(
      deliveries('workflow.instance.completed')[0].payload.data,
    ).toMatchObject({ outcome: 'completed' });
  });

  it('rechazar en una etapa final con outcome rejected emite instance.rejected (no completed)', async () => {
    endpoint();
    const { done } = await startAndSubmit(5000); // → manager
    const task = kit.db
      .table('workflow_tasks')
      .find((t) => t.stage_key === 'manager' && t.status === 'open')!;
    kit.as({ user_id: 2 });
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'reject',
      comment: 'no',
      expectedRowVersion: done.instance.row_version,
    });
    expect(deliveries('workflow.instance.rejected')).toHaveLength(1);
    expect(deliveries('workflow.instance.completed')).toHaveLength(0);
  });

  it('una transacción que falla no deja entregas ni filas de outbox (todo o nada)', async () => {
    endpoint();
    const started = await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: 'k1',
    });
    const task = kit.db
      .table('workflow_tasks')
      .find((t) => t.status === 'open')!;
    const before = { d: deliveries().length, o: webhookOutbox().length };
    await expect(
      kit.engine.completeTask({
        taskId: task.id,
        outcome: 'submit',
        values: { amount: 10, reason: 'x' },
        expectedRowVersion: started.instance.row_version + 99, // CAS stale
      }),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(deliveries()).toHaveLength(before.d);
    expect(webhookOutbox()).toHaveLength(before.o);
  });

  it('un reintento idempotente del mismo comando no duplica entregas', async () => {
    endpoint();
    await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: 'same',
    });
    const n = deliveries().length;
    const again = await kit.engine.start({
      definitionKey: 'purchase',
      idempotencyKey: 'same',
    });
    expect(again.replayed).toBe(true);
    expect(deliveries()).toHaveLength(n);
  });

  it('vencimiento: task.overdue al recordar y al escalar', async () => {
    endpoint();
    seedDefinition(kit.db, {
      schema: 'vendix.workflow/v1',
      key: 'slow',
      name: 'Lento',
      fields: [],
      stages: [
        {
          key: 'review',
          name: 'Revisión',
          type: 'approval',
          start: true,
          assignee: { kind: 'role', role_key: 'manager' },
          due: { hours: 24, on_overdue: { remind_every_hours: 12 } },
          transitions: [
            { on: 'approve', to: 'end' },
            { on: 'reject', to: 'end' },
          ],
        },
        { key: 'end', name: 'Fin', type: 'end', outcome: 'completed' },
      ],
    } as any);
    await kit.engine.start({ definitionKey: 'slow' });
    kit.db.table('workflow_instances')[0].stage_due_at = new Date(
      Date.now() - 3_600_000,
    );
    const cron = new WorkflowTimersCron(kit.prisma, kit.engine);
    expect(await cron.runOnce(new Date())).toBe(1);
    const overdue = deliveries('workflow.task.overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].payload.data).toMatchObject({
      stage_key: 'review',
      action: 'reminded',
    });
  });
});
