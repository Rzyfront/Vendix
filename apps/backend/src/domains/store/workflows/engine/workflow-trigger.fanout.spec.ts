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
import { WorkflowOutboxDispatcher } from './workflow-outbox.dispatcher';
import { WorkflowTriggerFanout } from './workflow-trigger.fanout';
import {
  BUSINESS_EVENT_OUTBOX_KIND,
  BusinessEventOutboxPayload,
  recordTriggerEvent,
} from './workflow-trigger.outbox';

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

/** The row the domain transaction writes, as the dispatcher hands it over. */
const businessEvent = (
  event: string,
  raw: unknown,
): { storeId: number; row: BusinessEventOutboxPayload } => {
  const info = extractTriggerEvent(event, raw)!;
  return {
    storeId: info.store_id,
    row: {
      event: event as BusinessEventOutboxPayload['event'],
      business_id: info.business_id,
      context: info.context,
    },
  };
};

const orderPayload = {
  store_id: 1,
  order_id: 9,
  order_number: 'ORD-9',
  grand_total: 2500,
  currency: 'COP',
  channel: 'pos',
};

describe('recordTriggerEvent', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const rows = () =>
    kit.db
      .table('workflow_outbox')
      .filter((o) => o.kind === BUSINESS_EVENT_OUTBOX_KIND);

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('escribe una fila con el hecho de negocio y su contexto cerrado, usando el cliente que recibe', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()));
    const tx = kit.prisma.withoutScope();
    await expect(
      recordTriggerEvent(tx as any, 'order.created', {
        ...orderPayload,
        password: 'x',
      }),
    ).resolves.toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      store_id: 1,
      instance_id: null,
      status: 'pending',
      payload: {
        event: 'order.created',
        business_id: '9',
        context: {
          order_id: 9,
          order_number: 'ORD-9',
          grand_total: 2500,
          currency: 'COP',
          channel: 'pos',
        },
      },
    });
    expect(JSON.stringify(rows()[0].payload)).not.toContain('password');
  });

  it('una tienda sin flujos activos no escribe nada', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()), 2);
    await expect(
      recordTriggerEvent(
        kit.prisma.withoutScope() as any,
        'order.created',
        orderPayload,
      ),
    ).resolves.toBe(false);
    expect(rows()).toHaveLength(0);
  });

  it('lo que no tiene tienda (PQR de plataforma) ni id no toca la base', async () => {
    const tx = {
      workflow_definitions: { findFirst: jest.fn() },
      workflow_outbox: { create: jest.fn() },
    };
    await expect(
      recordTriggerEvent(tx, 'pqr.created', {
        ticket: { id: 1, store_id: null },
      }),
    ).resolves.toBe(false);
    await expect(
      recordTriggerEvent(tx, 'order.created', { order_id: 1 }),
    ).resolves.toBe(false);
    expect(tx.workflow_definitions.findFirst).not.toHaveBeenCalled();
    expect(tx.workflow_outbox.create).not.toHaveBeenCalled();
  });

  it('un error de base llega a la transacción del dominio para que aborte junta', async () => {
    const tx = {
      workflow_definitions: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      workflow_outbox: {
        create: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    await expect(
      recordTriggerEvent(tx, 'order.created', orderPayload),
    ).rejects.toThrow('db down');
  });
});

describe('WorkflowTriggerFanout', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let fanout: WorkflowTriggerFanout;
  const outbox = () =>
    kit.db.table('workflow_outbox').filter((o) => o.kind === 'start_instance');
  const fan = (raw: unknown = orderPayload, event = 'order.created') => {
    const { storeId, row } = businessEvent(event, raw);
    return fanout.fanOut(storeId, row);
  };

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    fanout = new WorkflowTriggerFanout(kit.prisma);
  });
  afterEach(() => jest.restoreAllMocks());

  it('definición activa con trigger del evento → una fila start_instance con la clave idempotente', async () => {
    const { definitionId } = seedDefinition(
      kit.db,
      asRoleStart(onOrderCreated()),
    );
    expect(await fan()).toBe(1);
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
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
  });

  it('el mismo evento dos veces no duplica la fila (idempotente)', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()));
    await fan();
    await fan();
    expect(outbox()).toHaveLength(1);
    await fan({ ...orderPayload, order_id: 10 });
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

    expect(await fan()).toBe(0);
    expect(outbox()).toHaveLength(0);
  });

  it('el evento de la tienda 2 solo arranca las definiciones de la tienda 2', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated({ key: 'mine' })), 1);
    const other = seedDefinition(
      kit.db,
      asRoleStart(onOrderCreated({ key: 'theirs' })),
      2,
    );
    kit.as({ store_id: 2 }); // el despachador corre bajo la tienda de la fila
    await fan({ ...orderPayload, store_id: 2 });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      store_id: 2,
      payload: { definition_id: other.definitionId },
    });
  });

  it('varias definiciones con el mismo evento: una fila por definición', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated({ key: 'a' })));
    seedDefinition(kit.db, asRoleStart(onOrderCreated({ key: 'b' })));
    expect(await fan()).toBe(2);
  });

  it('un pedido cancelado antes del despacho (compensación del checkout) no arranca flujo', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()));
    kit.db.table('orders').push({ id: 9, store_id: 1, state: 'cancelled' });
    expect(await fan()).toBe(0);
    expect(outbox()).toHaveLength(0);
    kit.db.table('orders').push({ id: 10, store_id: 1, state: 'created' });
    expect(await fan({ ...orderPayload, order_id: 10 })).toBe(1);
  });

  it('un fallo de base se propaga para que el outbox reintente, en vez de perder el evento', async () => {
    const broken = new WorkflowTriggerFanout({
      withoutScope: () => {
        throw new Error('db down');
      },
    } as any);
    const { storeId, row } = businessEvent('order.created', orderPayload);
    await expect(broken.fanOut(storeId, row)).rejects.toThrow('db down');
  });
});

describe('disparador durable de punta a punta (P0.2)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const restart = () =>
    new WorkflowOutboxDispatcher(
      kit.db.asStorePrisma(),
      kit.engine,
      {} as any,
      { sendToUser: jest.fn() } as any,
      { send: jest.fn().mockResolvedValue('sent') } as any,
      {} as any,
      {} as any,
      new WorkflowTriggerFanout(kit.db.asStorePrisma()),
      {} as any,
      {} as any,
    );
  const started = () =>
    kit.db
      .table('workflow_instances')
      .filter((i) => i.started_by_type === 'system');

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('el proceso cae tras el commit: al volver, el flujo se inicia una sola vez', async () => {
    seedDefinition(kit.db, asRoleStart(onOrderCreated()));
    // Commit del dominio y caída: solo sobrevive lo que escribió la transacción.
    await recordTriggerEvent(
      kit.prisma.withoutScope() as any,
      'order.created',
      orderPayload,
    );
    expect(started()).toHaveLength(0);

    const worker = restart();
    await worker.dispatchBatch(); // business_event → start_instance
    await worker.dispatchBatch(); // start_instance → solicitud
    expect(started()).toHaveLength(1);

    // El mismo hecho otra vez (reintento, doble emisión) no crea otra solicitud.
    await recordTriggerEvent(
      kit.prisma.withoutScope() as any,
      'order.created',
      orderPayload,
    );
    const again = restart();
    await again.dispatchBatch();
    await again.dispatchBatch();
    expect(started()).toHaveLength(1);
    expect(
      kit.db.table('workflow_outbox').filter((o) => o.kind === 'business_event'),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'done' })]),
    );
  });
});
