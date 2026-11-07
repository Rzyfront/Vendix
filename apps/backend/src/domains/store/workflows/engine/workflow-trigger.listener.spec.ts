import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import {
  extractTriggerEvent,
  triggerIdempotencyKey,
} from './workflow-trigger.events';
import { WorkflowTriggerListener } from './workflow-trigger.listener';

const onOrderCreated = (
  over: Partial<WorkflowDefinitionV1> = {},
): WorkflowDefinitionV1 =>
  purchaseDefinition({
    key: 'on-order',
    name: 'Pedido nuevo',
    triggers: [
      {
        kind: 'event',
        event: 'order.created',
        map: {
          reason: 'Pedido {{event.order_number}}',
          amount: '{{event.grand_total}}',
        },
      },
    ],
    ...over,
  } as Partial<WorkflowDefinitionV1>) as WorkflowDefinitionV1;

function asRoleStart(def: WorkflowDefinitionV1): WorkflowDefinitionV1 {
  def.stages[0].assignee = { kind: 'role', role_key: 'manager' };
  return def;
}

describe('extractTriggerEvent', () => {
  it('lee los 6 eventos a un contexto plano y cerrado', () => {
    expect(
      extractTriggerEvent('order.created', {
        store_id: 3,
        order_id: 9,
        order_number: 'ORD-9',
        grand_total: 150.5,
        currency: 'COP',
        channel: 'pos',
        password: 'x',
      }),
    ).toEqual({
      store_id: 3,
      business_id: '9',
      context: {
        order_id: 9,
        order_number: 'ORD-9',
        grand_total: 150.5,
        currency: 'COP',
        channel: 'pos',
      },
    });
    expect(
      extractTriggerEvent('purchase_order.received', {
        store_id: 3,
        purchase_order_id: 7,
        reception_id: 2,
        supplier_id: 4,
        total_amount: { toFixed: () => '', toString: () => '99.50' },
      }),
    ).toMatchObject({
      business_id: '7:2',
      context: { supplier_id: 4, total_amount: '99.50' },
    });
    expect(
      extractTriggerEvent('expense.approved', {
        store_id: 3,
        expense_id: 5,
        amount: 10,
        category_id: 1,
      }),
    ).toMatchObject({ business_id: '5' });
    expect(
      extractTriggerEvent('customer.created', {
        store_id: 3,
        customer_id: 8,
        first_name: 'Ana',
        last_name: 'P',
        email: 'a@b.co',
      }),
    ).toMatchObject({ context: { email: 'a@b.co' } });
    expect(
      extractTriggerEvent('order.paid', {
        store_id: 3,
        order_id: 9,
        payment_id: 4,
        grand_total: 1,
        currency: 'COP',
      }),
    ).toMatchObject({ business_id: '9' });
    expect(
      extractTriggerEvent('pqr.created', {
        ticket: {
          id: 11,
          ticket_number: 'PQRS-1',
          title: 'Queja',
          description: 'd',
          category: 'c',
          store_id: 3,
        },
        contact: { name: 'Juan', email: 'j@x.co', phone: '1' },
      }),
    ).toEqual({
      store_id: 3,
      business_id: '11',
      context: {
        ticket_id: 11,
        ticket_number: 'PQRS-1',
        title: 'Queja',
        description: 'd',
        category: 'c',
        contact_name: 'Juan',
        contact_email: 'j@x.co',
      },
    });
  });

  it('descarta lo que no tiene tienda o id (p. ej. PQR de la plataforma) y lo malformado, sin lanzar', () => {
    expect(
      extractTriggerEvent('pqr.created', { ticket: { id: 1, store_id: null } }),
    ).toBeNull();
    expect(extractTriggerEvent('order.created', { order_id: 1 })).toBeNull();
    expect(extractTriggerEvent('order.created', { store_id: 1 })).toBeNull();
    expect(extractTriggerEvent('order.created', null)).toBeNull();
    expect(extractTriggerEvent('order.created', 'x')).toBeNull();
    expect(extractTriggerEvent('invoice.created', { store_id: 1 })).toBeNull();
    expect(
      extractTriggerEvent('order.created', { store_id: '1', order_id: '9' }),
    ).toMatchObject({ store_id: 1, business_id: '9' });
  });

  it('la clave de idempotencia es sha256(definición + evento + id de negocio) y es estable', () => {
    const k = triggerIdempotencyKey(1, 'order.created', '9');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(triggerIdempotencyKey(1, 'order.created', '9')).toBe(k);
    expect(triggerIdempotencyKey(2, 'order.created', '9')).not.toBe(k);
    expect(triggerIdempotencyKey(1, 'order.paid', '9')).not.toBe(k);
    expect(triggerIdempotencyKey(1, 'order.created', '10')).not.toBe(k);
  });
});

describe('WorkflowTriggerListener', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let listener: WorkflowTriggerListener;
  const outbox = () =>
    kit.db.table('workflow_outbox').filter((o) => o.kind === 'start_instance');
  const payload = {
    store_id: 1,
    order_id: 9,
    order_number: 'ORD-9',
    grand_total: 2500,
    currency: 'COP',
    channel: 'pos',
  };

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    listener = new WorkflowTriggerListener(kit.prisma);
  });
  afterEach(() => jest.restoreAllMocks());

  it('definición activa con trigger del evento → una fila start_instance con la clave idempotente', async () => {
    const { definitionId } = seedDefinition(
      kit.db,
      asRoleStart(onOrderCreated()),
    );
    expect(await listener.handle('order.created', payload)).toBe(1);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      store_id: 1,
      instance_id: null,
      status: 'pending',
      payload: {
        definition_id: definitionId,
        event: 'order.created',
        idempotency_key: triggerIdempotencyKey(
          definitionId,
          'order.created',
          '9',
        ),
        event_context: {
          order_id: 9,
          order_number: 'ORD-9',
          grand_total: 2500,
          currency: 'COP',
          channel: 'pos',
        },
      },
    });
    // Solo escribe en el outbox: no crea instancias en el hilo del emisor.
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('el mismo evento dos veces no duplica la fila (idempotente)', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()));
    await listener.handle('order.created', payload);
    await listener.handle('order.created', payload);
    expect(outbox()).toHaveLength(1);
    // Otro pedido sí genera otra.
    await listener.handle('order.created', { ...payload, order_id: 10 });
    expect(outbox()).toHaveLength(2);
  });

  it('no arranca definiciones de otra tienda ni de otro evento ni sin publicar ni inactivas', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()), 2); // otra tienda
    seedDefinition(
      kit.db,
      asRoleStart(
        onOrderCreated({
          key: 'other-ev',
          triggers: [{ kind: 'event', event: 'customer.created' }],
        } as any),
      ),
    );
    seedDefinition(
      kit.db,
      asRoleStart(
        onOrderCreated({
          key: 'manual',
          triggers: [{ kind: 'manual' }],
        } as any),
      ),
    );
    const inactive = seedDefinition(
      kit.db,
      asRoleStart(onOrderCreated({ key: 'off' })),
    );
    kit.db
      .table('workflow_definitions')
      .find((d) => d.id === inactive.definitionId)!.status = 'paused';
    const draft = seedDefinition(
      kit.db,
      asRoleStart(onOrderCreated({ key: 'draft' })),
    );
    kit.db
      .table('workflow_definitions')
      .find((d) => d.id === draft.definitionId)!.published_version_id = null;

    expect(await listener.handle('order.created', payload)).toBe(0);
    expect(outbox()).toHaveLength(0);
  });

  it('el evento de la tienda 2 solo arranca las definiciones de la tienda 2', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated({ key: 'mine' })), 1);
    const other = seedDefinition(
      kit.db,
      asRoleStart(onOrderCreated({ key: 'theirs' })),
      2,
    );
    await listener.handle('order.created', { ...payload, store_id: 2 });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      store_id: 2,
      payload: { definition_id: other.definitionId },
    });
  });

  it('varias definiciones con el mismo evento: una fila por definición', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated({ key: 'a' })));
    seedDefinition(kit.db, asRoleStart(onOrderCreated({ key: 'b' })));
    expect(await listener.handle('order.created', payload)).toBe(2);
  });

  it('nunca lanza hacia el emisor: payload basura, evento ajeno o base caída', async () => {
    await expect(listener.handle('order.created', undefined)).resolves.toBe(0);
    await expect(
      listener.handle('order.created', { store_id: 'x' }),
    ).resolves.toBe(0);
    await expect(listener.handle('nope', payload)).resolves.toBe(0);

    seedDefinition(kit.db, asRoleStart(onOrderCreated()));
    const broken = new WorkflowTriggerListener({
      withoutScope: () => {
        throw new Error('db down');
      },
    } as any);
    await expect(broken.handle('order.created', payload)).resolves.toBe(0);
    await expect(broken.onOrderCreated(payload)).resolves.toBe(0);
  });

  it('los 6 @OnEvent delegan en handle con su nombre de evento', async () => {
    const spy = jest.spyOn(listener, 'handle').mockResolvedValue(0);
    await listener.onOrderCreated(1);
    await listener.onOrderPaid(2);
    await listener.onPurchaseOrderReceived(3);
    await listener.onExpenseApproved(4);
    await listener.onCustomerCreated(5);
    await listener.onPqrCreated(6);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      'order.created',
      'order.paid',
      'purchase_order.received',
      'expense.approved',
      'customer.created',
      'pqr.created',
    ]);
    const meta = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      WorkflowTriggerListener.prototype.onOrderCreated,
    );
    expect(JSON.stringify(meta)).toContain('order.created');
  });
});
