import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WORKFLOW_ACTION_CATALOG, WORKFLOW_VENDIX_ACTIONS } from '@common/workflows/contract';
import { ActionOutboxRow, WorkflowActionsExecutor } from './workflow-actions.executor';
import { WorkflowNonRetryableError } from './workflow-engine.types';
import { WorkflowActionInputError } from './actions/workflow-action.types';
import { WorkflowPeopleActions } from './actions/people.actions';
import { WorkflowPurchasingActions } from './actions/purchasing.actions';
import { WorkflowOperationsActions } from './actions/operations.actions';

// The executor acts with the publisher's REAL store permissions.
const mockPublisherPermissions = jest.fn<Promise<string[]>, unknown[]>();
jest.mock('../../../../common/utils/user-store-permissions.util', () => ({
  resolveUserStorePermissions: (...args: unknown[]) =>
    mockPublisherPermissions(...args),
}));


/** Exactly what the HTTP routes of the two actions under test require. */
const PUBLISHER_PERMISSIONS = [
  'store:orders:purchase_orders:create',
  'store:expenses:create',
];

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

describe('WorkflowActionsExecutor (registry P1.2)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let executor: WorkflowActionsExecutor;
  const createDraft = jest.fn();
  const createExpense = jest.fn();
  const seen: Array<Record<string, any>> = [];

  const instance = () => kit.db.table('workflow_instances')[0];
  const actionEvents = (type?: string) =>
    kit.db
      .table('workflow_instance_events')
      .filter((e) => e.type.startsWith('action_') && (!type || e.type === type));
  const outboxRow = (action: string, map: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    kit.db.insert('workflow_outbox', {
      store_id: 1,
      instance_id: instance().id,
      kind: 'action',
      payload: { action, map_resolved: map, stage_key: 'crear' },
      available_at: new Date(),
      ...extra,
    }) as any;
  const inStore = <T>(fn: () => Promise<T>) =>
    RequestContextService.runIsolated(
      { store_id: 1, organization_id: 1, is_super_admin: false, is_owner: false },
      fn,
    );

  beforeEach(async () => {
    mockPublisherPermissions.mockReset();
    mockPublisherPermissions.mockResolvedValue(PUBLISHER_PERMISSIONS);
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedDefinition(kit.db, flow([]));
    await kit.engine.start({ definitionKey: 'oc', idempotencyKey: 'k1' });
    seen.length = 0;
    createDraft.mockReset().mockImplementation(async (ctx: any) =>
      ctx.asPublisher(async () => {
        seen.push({ ctx: RequestContextService.getContext(), map: ctx.map, permissions: ctx.permissions });
        return { record_id: 501 };
      }),
    );
    createExpense.mockReset().mockResolvedValue({ record_id: 9 });
    executor = new WorkflowActionsExecutor(
      kit.prisma,
      (kit.engine as any).events,
      { handlers: { 'vendix.purchase_order.create_draft': createDraft } } as any,
      { handlers: { 'vendix.expense.create': createExpense } } as any,
      { handlers: {} } as any,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('R1: every action of the registry has a handler in the three real groups', () => {
    const real = new WorkflowActionsExecutor(
      {} as any,
      {} as any,
      new WorkflowPeopleActions({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any),
      new WorkflowPurchasingActions({} as any, {} as any, {} as any, {} as any),
      new WorkflowOperationsActions({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any),
    );
    expect([...real.registered()].sort()).toEqual([...WORKFLOW_VENDIX_ACTIONS].sort());
  });

  it('runs the handler in the store, as the publisher with their REAL permissions, and records action_executed', async () => {
    const row = outboxRow('vendix.purchase_order.create_draft', { supplier_id: '7' });
    await inStore(() => executor.execute(row));
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(seen[0].map).toEqual({ supplier_id: '7' });
    expect(seen[0].permissions).toEqual(PUBLISHER_PERMISSIONS);
    expect(seen[0].ctx).toMatchObject({
      store_id: 1,
      organization_id: 1,
      user_id: 1,
      is_owner: false,
      is_super_admin: false,
      permissions: PUBLISHER_PERMISSIONS,
    });
    const ev = actionEvents('action_executed');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actor_type: 'system',
      actor_id: null,
      payload: { action: 'vendix.purchase_order.create_draft', created_id: 501 },
    });
  });

  it('without the permission of the UI route it fails at once, without calling the handler', async () => {
    mockPublisherPermissions.mockResolvedValue(['store:expenses:create']);
    const row = outboxRow('vendix.purchase_order.create_draft', {});
    await expect(inStore(() => executor.execute(row))).rejects.toBeInstanceOf(WorkflowNonRetryableError);
    expect(createDraft).not.toHaveBeenCalled();
    expect(actionEvents()).toHaveLength(0);
  });

  it('wrong input or a business rejection (4xx) fails without retries; a 5xx or a plain error retries', async () => {
    createExpense.mockRejectedValueOnce(new WorkflowActionInputError('"amount" resolved to an empty value'));
    await expect(
      inStore(() => executor.execute(outboxRow('vendix.expense.create', {}))),
    ).rejects.toBeInstanceOf(WorkflowNonRetryableError);
    createExpense.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.WORKFLOW_APPROVAL_PENDING));
    await expect(
      inStore(() => executor.execute(outboxRow('vendix.expense.create', {}))),
    ).rejects.toBeInstanceOf(WorkflowNonRetryableError);
    const boom = new Error('db down');
    createExpense.mockRejectedValueOnce(boom);
    await expect(inStore(() => executor.execute(outboxRow('vendix.expense.create', {})))).rejects.toBe(boom);
    expect(actionEvents()).toHaveLength(0);
  });

  it('a retry after a failure later than the effect does NOT repeat it (created_id in the payload)', async () => {
    const row = outboxRow('vendix.expense.create', {});
    await inStore(() => executor.execute(row));
    const saved = kit.db.table('workflow_outbox').find((o) => o.id === row.id) as ActionOutboxRow;
    expect(saved.payload.created_id).toBe(9);
    await inStore(() => executor.execute(saved));
    expect(createExpense).toHaveBeenCalledTimes(1);
    expect(actionEvents('action_executed')).toHaveLength(1);
  });

  it('an update action that returns no record id is stored as null and not repeated', async () => {
    createExpense.mockResolvedValueOnce({ record_id: null });
    const row = outboxRow('vendix.expense.create', {});
    await inStore(() => executor.execute(row));
    const saved = kit.db.table('workflow_outbox').find((o) => o.id === row.id) as ActionOutboxRow;
    expect(saved.payload.created_id).toBeNull();
    await inStore(() => executor.execute(saved));
    expect(createExpense).toHaveBeenCalledTimes(1);
  });

  it('P1.2 idempotency: a run interrupted after the effect started is not repeated (money, records)', async () => {
    // A previous attempt marked the row and died before saving its result.
    const row = outboxRow('vendix.expense.create', {}, {});
    row.payload.effect_started_at = '2026-11-07T10:00:00.000Z';
    await expect(inStore(() => executor.execute(row))).rejects.toThrow(
      /no se pudo confirmar si se ejecutó/,
    );
    await expect(inStore(() => executor.execute(row))).rejects.toBeInstanceOf(
      WorkflowNonRetryableError,
    );
    expect(createExpense).not.toHaveBeenCalled();
    expect(actionEvents('action_executed')).toHaveLength(0);
  });

  it('P1.2 idempotency: the start mark is saved before the effect and cleared when the effect fails', async () => {
    const row = outboxRow('vendix.expense.create', {});
    const stored = () => kit.db.table('workflow_outbox').find((o) => o.id === row.id)!;
    createExpense.mockImplementationOnce(async () => {
      expect(stored().payload.effect_started_at).toEqual(expect.any(String));
      throw new Error('db down');
    });
    await expect(inStore(() => executor.execute(row))).rejects.toThrow('db down');
    expect(stored().payload.effect_started_at).toBeUndefined();
    // The retry runs the effect, once.
    await inStore(() => executor.execute(stored() as ActionOutboxRow));
    expect(createExpense).toHaveBeenCalledTimes(2);
    expect(actionEvents('action_executed')).toHaveLength(1);
  });

  it('P1.2 idempotency: the registry declares it; only field updates and tags may be replayed', () => {
    const replaySafe = Object.entries(WORKFLOW_ACTION_CATALOG)
      .filter(([, spec]) => spec.idempotency === 'replay_safe')
      .map(([name]) => name)
      .sort();
    expect(replaySafe).toEqual([
      'vendix.customer.add_tag',
      'vendix.customer.update',
      'vendix.employee.update',
      'vendix.supplier.update',
    ]);
    for (const money of [
      'vendix.order.register_payment',
      'vendix.expense.create',
      'vendix.payable.register_payment',
      'vendix.purchase_order.register_payment',
    ] as const) {
      expect(WORKFLOW_ACTION_CATALOG[money].idempotency).toBe('at_most_once');
    }
  });

  it('recordFailure leaves action_failed once with the error truncated', async () => {
    const row = outboxRow('vendix.expense.create', {});
    await inStore(() => executor.recordFailure(row, 'x'.repeat(900)));
    await inStore(() => executor.recordFailure(row, 'x'.repeat(900)));
    const ev = actionEvents('action_failed');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload.error).toHaveLength(500);
  });

  it('an action of another store or a missing instance runs nothing', async () => {
    const other = outboxRow('vendix.expense.create', {}, { store_id: 2 });
    await inStore(() => executor.execute(other));
    const missing = outboxRow('vendix.expense.create', {}, { instance_id: 999 });
    await inStore(() => executor.execute(missing));
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('if the store lost the administration industry the action is skipped (no effect, no error)', async () => {
    kit.db.table('stores').forEach((s: any) => (s.industries = ['retail']));
    await inStore(() => executor.execute(outboxRow('vendix.expense.create', {})));
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('an action that is not in the registry fails without retries (never runs something uncatalogued)', async () => {
    await expect(
      inStore(() => executor.execute(outboxRow('vendix.order.delete', {}))),
    ).rejects.toBeInstanceOf(WorkflowNonRetryableError);
  });
});
