import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { WorkflowActionsExecutor } from './workflow-actions.executor';

// The executor acts with the publisher's REAL store permissions.
const mockPublisherPermissions = jest.fn<Promise<string[]>, unknown[]>();
jest.mock('../../../../common/utils/user-store-permissions.util', () => ({
  resolveUserStorePermissions: (...args: unknown[]) =>
    mockPublisherPermissions(...args),
}));


const PO = {
  action: 'vendix.purchase_order.create_draft',
  map: {
    supplier_id: 7,
    location_id: 3,
    product_id: '{{fields.producto}}',
    quantity: '{{fields.cantidad}}',
    unit_price: '{{fields.precio}}',
    notes: 'Solicitud {{instance.reference}} — {{instance.title}}',
  },
};
const TASK = {
  action: 'vendix.crm_task.create',
  map: {
    title: 'Revisar {{fields.motivo}}',
    description: 'Ref {{instance.reference}}',
    due_in_days: 3,
  },
};

const flow = (onEnter: any[]): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key: 'oc',
    name: 'Solicitud de compra',
    fields: [
      { key: 'producto', type: 'number', label: 'Producto' },
      { key: 'cantidad', type: 'number', label: 'Cantidad' },
      { key: 'precio', type: 'money', label: 'Precio' },
      { key: 'motivo', type: 'text', label: 'Motivo' },
    ],
    stages: [
      {
        key: 'solicitud',
        name: 'Solicitud',
        type: 'form',
        start: true,
        assignee: { kind: 'initiator' },
        form: { fields: ['producto', 'cantidad', 'precio', 'motivo'] },
        transitions: [{ on: 'submit', to: 'crear' }],
      },
      {
        key: 'crear',
        name: 'Crear OC',
        type: 'automatic',
        on_enter: onEnter,
        transitions: [{ on: 'auto', to: 'fin' }],
      },
      { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  }) as WorkflowDefinitionV1;

describe('acciones Vendix en el motor (outbox kind=action)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const actionRows = () =>
    kit.db.table('workflow_outbox').filter((o) => o.kind === 'action');

  async function submit() {
    const started = await kit.engine.start({
      definitionKey: 'oc',
      idempotencyKey: 'k1',
    });
    const task = kit.db
      .table('workflow_tasks')
      .find((t) => t.status === 'open')!;
    return kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { producto: 11, cantidad: 4, precio: 2500.5, motivo: 'Tóner' },
      expectedRowVersion: started.instance.row_version,
    });
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('se escriben al outbox (no se ejecutan) con el map ya resuelto contra los datos de la instancia', async () => {
    seedDefinition(kit.db, flow([PO, TASK]));
    const done = await submit();
    expect(actionRows()).toHaveLength(2);
    expect(actionRows()[0]).toMatchObject({
      store_id: 1,
      instance_id: done.instance.id,
      status: 'pending',
      payload: {
        action: 'vendix.purchase_order.create_draft',
        stage_key: 'crear',
        map_resolved: {
          supplier_id: '7',
          location_id: '3',
          product_id: '11',
          quantity: '4',
          unit_price: '2500.5',
          notes: 'Solicitud FLU-000001 — Solicitud de compra',
        },
      },
    });
    expect(actionRows()[1].payload.map_resolved).toEqual({
      title: 'Revisar Tóner',
      description: 'Ref FLU-000001',
      due_in_days: '3',
    });
  });

  it('un token sin dato resuelve a vacío; el assignee viaja como definición', async () => {
    seedDefinition(
      kit.db,
      flow([
        {
          action: 'vendix.crm_task.create',
          map: {
            title: 'x {{fields.motivo}}',
            assignee: { kind: 'user', user_id: 2 },
          },
        },
      ]),
    );
    const started = await kit.engine.start({
      definitionKey: 'oc',
      idempotencyKey: 'k1',
    });
    const task = kit.db
      .table('workflow_tasks')
      .find((t) => t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: task.id,
      outcome: 'submit',
      values: { producto: 1, cantidad: 1, precio: 1 },
      expectedRowVersion: started.instance.row_version,
    });
    expect(actionRows()[0].payload.map_resolved).toEqual({
      title: 'x ',
      assignee: { kind: 'user', user_id: 2 },
    });
  });

  it('on_exit también encola y un rechazo antes de la etapa no encola nada', async () => {
    const def = flow([]);
    def.stages[0].on_exit = [TASK as any];
    seedDefinition(kit.db, def);
    expect(actionRows()).toHaveLength(0);
    await submit();
    expect(actionRows()).toHaveLength(1);
  });

  it('si la transacción falla, la acción no queda encolada', async () => {
    seedDefinition(kit.db, flow([TASK]));
    const started = await kit.engine.start({
      definitionKey: 'oc',
      idempotencyKey: 'k1',
    });
    const task = kit.db
      .table('workflow_tasks')
      .find((t) => t.status === 'open')!;
    await expect(
      kit.engine.completeTask({
        taskId: task.id,
        outcome: 'submit',
        values: { producto: 1, cantidad: 1, precio: 1 },
        expectedRowVersion: started.instance.row_version + 5,
      }),
    ).rejects.toBeDefined();
    expect(actionRows()).toHaveLength(0);
  });
});

describe('WorkflowActionsExecutor', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let executor: WorkflowActionsExecutor;
  const purchaseOrders = { create: jest.fn() };
  const crmTasks = { create: jest.fn() };
  const seen: Array<Record<string, any>> = [];

  const instance = () => kit.db.table('workflow_instances')[0];
  const actionEvents = (type?: string) =>
    kit.db
      .table('workflow_instance_events')
      .filter(
        (e) => e.type.startsWith('action_') && (!type || e.type === type),
      );
  const outboxRow = (
    action: string,
    map: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => {
    const r = kit.db.insert('workflow_outbox', {
      store_id: 1,
      instance_id: instance().id,
      kind: 'action',
      payload: { action, map_resolved: map, stage_key: 'crear' },
      available_at: new Date(),
      ...extra,
    });
    return r as any;
  };
  const inStore = <T>(fn: () => Promise<T>) =>
    RequestContextService.runIsolated(
      {
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
        is_owner: false,
      },
      fn,
    );

  beforeEach(async () => {
    mockPublisherPermissions.mockReset();
    mockPublisherPermissions.mockResolvedValue(['store:crm_tasks:create']);
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedDefinition(kit.db, flow([]));
    await kit.engine.start({ definitionKey: 'oc', idempotencyKey: 'k1' });
    seen.length = 0;
    purchaseOrders.create.mockReset().mockImplementation(async (dto: any) => {
      seen.push({ ctx: RequestContextService.getContext(), dto });
      return { id: 501, order_number: 'PO-1' };
    });
    crmTasks.create.mockReset().mockImplementation(async (dto: any) => {
      seen.push({ ctx: RequestContextService.getContext(), dto });
      return { id: 77 };
    });
    executor = new WorkflowActionsExecutor(
      kit.prisma,
      kit.assignment,
      (kit.engine as any).events,
      purchaseOrders as any,
      crmTasks as any,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const PO_MAP = {
    supplier_id: '7',
    location_id: '3',
    product_id: '11',
    quantity: '4',
    unit_price: '2500.5',
    notes: 'Solicitud FLU-000001',
  };

  it('OC: crea el BORRADOR por PurchaseOrdersService con los valores resueltos, en la tienda y como quien publicó', async () => {
    const row = outboxRow('vendix.purchase_order.create_draft', PO_MAP);
    await inStore(() => executor.execute(row));
    expect(purchaseOrders.create).toHaveBeenCalledTimes(1);
    expect(seen[0].dto).toMatchObject({
      supplier_id: 7,
      location_id: 3,
      items: [{ product_id: 11, quantity: 4, unit_price: 2500.5 }],
      notes: 'Solicitud FLU-000001',
      internal_notes: 'Creada por el flujo FLU-000001',
    });
    expect(seen[0].dto.status).toBeUndefined(); // el estado lo decide el servicio: nace en draft
    expect(seen[0].ctx).toMatchObject({
      store_id: 1,
      organization_id: 1,
      user_id: 1,
      is_owner: false,
      is_super_admin: false,
    });
    const ev = actionEvents('action_executed');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actor_type: 'system',
      actor_id: null,
      payload: {
        action: 'vendix.purchase_order.create_draft',
        created_id: 501,
      },
    });
  });

  it('OC: valores inválidos fallan SIN llamar al servicio (para que reintente / action_failed)', async () => {
    for (const bad of [
      { supplier_id: '' },
      { supplier_id: 'abc' },
      { location_id: '0' },
      { product_id: '1.5' },
      { quantity: '-2' },
      { unit_price: '' },
      { unit_price: 'caro' },
      { unit_price: '-1' },
    ]) {
      await expect(
        inStore(() =>
          executor.execute(
            outboxRow('vendix.purchase_order.create_draft', {
              ...PO_MAP,
              ...bad,
            }),
          ),
        ),
      ).rejects.toThrow();
    }
    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(actionEvents()).toHaveLength(0);
  });

  it('OC: si el servicio rechaza (validación de negocio) el error sube y no hay evento de éxito', async () => {
    purchaseOrders.create.mockRejectedValue(new Error('Supplier not found'));
    await expect(
      inStore(() =>
        executor.execute(
          outboxRow('vendix.purchase_order.create_draft', PO_MAP),
        ),
      ),
    ).rejects.toThrow('Supplier not found');
    expect(actionEvents('action_executed')).toHaveLength(0);
  });

  it('Tarea CRM: crea por CrmTasksService con vencimiento relativo y sin permiso de ver todo si no asigna a otro', async () => {
    const row = outboxRow('vendix.crm_task.create', {
      title: 'Llamar',
      description: 'Ref',
      due_in_days: '3',
    });
    const before = Date.now();
    await inStore(() => executor.execute(row));
    expect(crmTasks.create).toHaveBeenCalledTimes(1);
    const dto = seen[0].dto;
    expect(dto).toMatchObject({ title: 'Llamar', description: 'Ref' });
    expect(dto.assigned_user_id).toBeUndefined();
    const due = new Date(dto.due_at).getTime();
    expect(due).toBeGreaterThanOrEqual(before + 3 * 86_400_000);
    expect(due).toBeLessThanOrEqual(Date.now() + 3 * 86_400_000);
    expect(seen[0].ctx).toMatchObject({
      user_id: 1,
      permissions: ['store:crm_tasks:create'],
    });
    expect(actionEvents('action_executed')[0].payload.created_id).toBe(77);
  });

  it('Tarea CRM: asigna a otro con el ver-todo que el publicador SÍ tiene', async () => {
    mockPublisherPermissions.mockResolvedValue([
      'store:crm_tasks:create',
      'store:crm_inbox:assign',
    ]);
    await inStore(() =>
      executor.execute(
        outboxRow('vendix.crm_task.create', {
          title: 'T',
          assignee: { kind: 'user', user_id: 2 },
        }),
      ),
    );
    expect(seen[0].dto.assigned_user_id).toBe(2);
    expect(seen[0].ctx.permissions).toContain('store:crm_inbox:assign');
  });

  it('Tarea CRM: nunca concede un permiso que el publicador no tiene', async () => {
    mockPublisherPermissions.mockResolvedValue(['store:crm_tasks:create']);
    await inStore(() =>
      executor.execute(
        outboxRow('vendix.crm_task.create', {
          title: 'T',
          assignee: { kind: 'user', user_id: 2 },
        }),
      ),
    ).catch(() => undefined);
    expect(seen[0]?.ctx.permissions ?? []).not.toContain('store:crm_inbox:assign');
    expect(mockPublisherPermissions).toHaveBeenCalledWith(expect.anything(), 1, expect.any(Number));
  });

  it('Tarea CRM: título vacío tras resolver los tokens o vencimiento fuera de rango fallan sin llamar al servicio', async () => {
    for (const map of [
      { title: '' },
      { title: '   ' },
      { title: 'x', due_in_days: '999' },
      { title: 'x', due_in_days: 'tres' },
    ]) {
      await expect(
        inStore(() =>
          executor.execute(outboxRow('vendix.crm_task.create', map)),
        ),
      ).rejects.toThrow();
    }
    expect(crmTasks.create).not.toHaveBeenCalled();
  });

  it('Tarea CRM sobre una solicitud de un cliente enlaza al cliente', async () => {
    instance().subject_type = 'customer';
    instance().subject_id = 55;
    await inStore(() =>
      executor.execute(outboxRow('vendix.crm_task.create', { title: 'T' })),
    );
    expect(seen[0].dto.customer_id).toBe(55);
  });

  it('reintento tras un fallo posterior al efecto NO crea un segundo registro (created_id en el payload)', async () => {
    const row = outboxRow('vendix.purchase_order.create_draft', PO_MAP);
    await inStore(() => executor.execute(row));
    const saved = kit.db.table('workflow_outbox').find((o) => o.id === row.id)!;
    expect(saved.payload.created_id).toBe(501);
    // Simula el reintento: el evento ya existe y el outbox lleva created_id.
    await inStore(() => executor.execute({ ...row, payload: saved.payload }));
    expect(purchaseOrders.create).toHaveBeenCalledTimes(1);
    expect(actionEvents('action_executed')).toHaveLength(1);
  });

  it('recordFailure deja action_failed una sola vez con el error truncado y sin tocar secretos', async () => {
    const row = outboxRow('vendix.crm_task.create', { title: 'T' });
    await inStore(() => executor.recordFailure(row, 'x'.repeat(2000)));
    await inStore(() => executor.recordFailure(row, 'otra vez'));
    const ev = actionEvents('action_failed');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actor_type: 'system',
      payload: { action: 'vendix.crm_task.create' },
    });
    expect(ev[0].payload.error.length).toBeLessThanOrEqual(500);
  });

  it('una acción de otra tienda o una instancia inexistente no ejecuta nada', async () => {
    const row = outboxRow(
      'vendix.crm_task.create',
      { title: 'T' },
      { store_id: 2 },
    );
    await inStore(() => executor.execute(row));
    expect(crmTasks.create).not.toHaveBeenCalled();
    await inStore(() =>
      executor.execute({ ...row, store_id: 1, instance_id: 999 }),
    );
    expect(crmTasks.create).not.toHaveBeenCalled();
  });

  it('una acción desconocida en el outbox falla (nunca ejecuta algo no catalogado)', async () => {
    await expect(
      inStore(() =>
        executor.execute(outboxRow('http.request', { url: 'http://x' })),
      ),
    ).rejects.toThrow('Unsupported action');
    expect(purchaseOrders.create).not.toHaveBeenCalled();
    expect(crmTasks.create).not.toHaveBeenCalled();
  });
});
