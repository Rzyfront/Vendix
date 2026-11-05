import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { seedPeople } from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowOutboxDispatcher } from './workflow-outbox.dispatcher';

describe('WorkflowOutboxDispatcher · webhook / start_instance / action', () => {
  let db: FakeWorkflowDb;
  let dispatcher: WorkflowOutboxDispatcher;
  const engine = { tick: jest.fn(), startSystem: jest.fn() };
  const webhooks = { deliver: jest.fn() };
  const actions = { execute: jest.fn(), recordFailure: jest.fn() };
  const MIN = 60_000;
  const row = () => db.table('workflow_outbox')[0];
  const enqueue = (
    kind: string,
    payload: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    db.insert('workflow_outbox', {
      store_id: 1,
      instance_id: 1,
      kind,
      payload,
      available_at: new Date(Date.now() - MIN),
      created_at: new Date(),
      ...extra,
    });

  beforeEach(() => {
    db = new FakeWorkflowDb();
    seedPeople(db);
    engine.startSystem.mockReset().mockResolvedValue({});
    webhooks.deliver.mockReset().mockResolvedValue(undefined);
    actions.execute.mockReset().mockResolvedValue(undefined);
    actions.recordFailure.mockReset().mockResolvedValue(undefined);
    dispatcher = new WorkflowOutboxDispatcher(
      db.asStorePrisma(),
      engine as any,
      {} as any,
      {} as any,
      {} as any,
      webhooks as any,
      actions as any,
    );
  });

  it('webhook: delega en el servicio de entregas bajo el contexto de la tienda de la fila', async () => {
    let seen: any;
    webhooks.deliver.mockImplementation(async () => {
      seen = RequestContextService.getContext();
    });
    enqueue('webhook', { delivery_id: 7 }, { instance_id: null });
    expect(await dispatcher.dispatchBatch()).toMatchObject({ done: 1 });
    expect(webhooks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { delivery_id: 7 },
        attempts: 1,
        store_id: 1,
      }),
    );
    expect(seen).toMatchObject({
      store_id: 1,
      organization_id: 1,
      is_owner: false,
    });
  });

  it('webhook que falla: reintento con el backoff del outbox y dead al sexto intento', async () => {
    webhooks.deliver.mockRejectedValue(new Error('HTTP 500'));
    enqueue('webhook', { delivery_id: 7 }, { instance_id: null });
    for (let i = 1; i <= 5; i++) {
      expect(await dispatcher.dispatchBatch()).toMatchObject({ retried: 1 });
      row().available_at = new Date(Date.now() - MIN);
    }
    expect(await dispatcher.dispatchBatch()).toMatchObject({ dead: 1 });
    expect(row()).toMatchObject({
      status: 'dead',
      attempts: 6,
      last_error: 'HTTP 500',
    });
  });

  it('start_instance: llama engine.startSystem con la definición, el evento, el contexto y la clave', async () => {
    enqueue(
      'start_instance',
      {
        definition_id: 4,
        event: 'order.created',
        event_context: { order_id: 9 },
        idempotency_key: 'k',
      },
      { instance_id: null },
    );
    await dispatcher.dispatchBatch();
    expect(engine.startSystem).toHaveBeenCalledWith({
      definitionId: 4,
      event: 'order.created',
      eventContext: { order_id: 9 },
      idempotencyKey: 'k',
    });
    expect(row().status).toBe('done');
  });

  it('start_instance con definición desactivada o borrada: se omite sin reintentar', async () => {
    for (const entry of [
      ErrorCodes.WORKFLOW_NOT_ACTIVE,
      ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND,
    ]) {
      db.table('workflow_outbox').length = 0;
      engine.startSystem.mockRejectedValue(new VendixHttpException(entry));
      enqueue(
        'start_instance',
        { definition_id: 4, event: 'order.created', idempotency_key: 'k' },
        { instance_id: null },
      );
      expect(await dispatcher.dispatchBatch()).toMatchObject({
        done: 1,
        retried: 0,
      });
    }
  });

  it('start_instance con un error real se reintenta', async () => {
    engine.startSystem.mockRejectedValue(new Error('db down'));
    enqueue(
      'start_instance',
      { definition_id: 4, event: 'order.created', idempotency_key: 'k' },
      { instance_id: null },
    );
    expect(await dispatcher.dispatchBatch()).toMatchObject({ retried: 1 });
    expect(row().last_error).toBe('db down');
  });

  it('action: la ejecuta; si falla reintenta, y al agotarse deja action_failed una sola vez', async () => {
    actions.execute.mockRejectedValue(new Error('supplier not found'));
    enqueue('action', {
      action: 'vendix.purchase_order.create_draft',
      map_resolved: {},
    });
    for (let i = 1; i <= 5; i++) {
      expect(await dispatcher.dispatchBatch()).toMatchObject({ retried: 1 });
      expect(actions.recordFailure).not.toHaveBeenCalled();
      row().available_at = new Date(Date.now() - MIN);
    }
    expect(await dispatcher.dispatchBatch()).toMatchObject({ dead: 1 });
    expect(actions.recordFailure).toHaveBeenCalledTimes(1);
    expect(actions.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: row().id, instance_id: 1 }),
      'supplier not found',
    );
  });

  it('action que sale bien no registra fallo', async () => {
    enqueue('action', {
      action: 'vendix.crm_task.create',
      map_resolved: { title: 'x' },
    });
    expect(await dispatcher.dispatchBatch()).toMatchObject({ done: 1 });
    expect(actions.recordFailure).not.toHaveBeenCalled();
  });

  it('un webhook muerto no pasa por action_failed', async () => {
    webhooks.deliver.mockRejectedValue(new Error('x'));
    enqueue('webhook', { delivery_id: 1 }, { attempts: 5, instance_id: null });
    expect(await dispatcher.dispatchBatch()).toMatchObject({ dead: 1 });
    expect(actions.recordFailure).not.toHaveBeenCalled();
  });
});
