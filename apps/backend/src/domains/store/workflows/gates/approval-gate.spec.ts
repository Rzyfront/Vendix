import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import {
  GATE_RETRY_BY_REQUESTER,
  consumeApproval,
  enforceApproval,
  requestApproval,
} from './approval-gate';
import { ApprovalGateProcessor, GateOutboxRow } from './approval-gate.processor';

const mockPermissions = jest.fn<Promise<string[]>, unknown[]>();
jest.mock('../../../../common/utils/user-store-permissions.util', () => ({
  resolveUserStorePermissions: (...args: unknown[]) => mockPermissions(...args),
}));

/** "Este flujo gobierna: compras desde 2.000.000" (H-P1). */
const governingFlow = (minAmount = 2_000_000): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key: `compras-${minAmount}`,
    name: 'Aprobación de compras',
    subject: { type: 'purchase_order' },
    governs: {
      operation: 'purchase_order.approve',
      min_amount: minAmount,
      map: {
        proveedor: '{{event.supplier_name}}',
        monto: '{{event.total_amount}}',
        productos: '{{event.products}}',
      },
    },
    fields: [
      { key: 'proveedor', type: 'text', label: 'Proveedor' },
      { key: 'monto', type: 'money', label: 'Monto' },
      { key: 'productos', type: 'textarea', label: 'Productos' },
    ],
    stages: [
      {
        key: 'gerente',
        name: 'Aprobación gerente',
        type: 'approval',
        start: true,
        assignee: { kind: 'role', role_key: 'manager' },
        transitions: [
          { on: 'approve', to: 'aprobada' },
          { on: 'reject', to: 'rechazada' },
        ],
      },
      { key: 'aprobada', name: 'Aprobada', type: 'end', outcome: 'completed' },
      { key: 'rechazada', name: 'Rechazada', type: 'end', outcome: 'rejected' },
    ],
  }) as unknown as WorkflowDefinitionV1;

const PO_INPUT = (amount = 3_000_000, id = 55) => ({
  operation: 'purchase_order.approve' as const,
  entity_id: id,
  amount,
  context: {
    purchase_order_id: id,
    order_number: 'OC-0055',
    supplier_id: 7,
    supplier_name: 'Papelería Central',
    total_amount: String(amount),
    products: 'Resma carta x 40',
    requested_by: 'Ana',
    secret: 'never mapped',
  },
});

describe('approval gate (P1.3)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let processor: ApprovalGateProcessor;
  const purchaseOrders = { cancel: jest.fn(), registerPayment: jest.fn() };
  const expenseFlow = { reject: jest.fn() };
  const payrollFlow = { cancel: jest.fn() };
  const adjustments = { createAdjustment: jest.fn() };
  const notifications = { sendToUser: jest.fn() };

  const gates = () => kit.db.table('workflow_approval_gates');
  const outbox = (kind: string) => kit.db.table('workflow_outbox').filter((o) => o.kind === kind);
  const asRequester = () => kit.as({ user_id: 4, permissions: ['store:orders:purchase_orders:approve'] });

  /** What the worker does with the gate rows (start, then resolve). */
  async function drain() {
    for (const row of outbox('gate_start').filter((r) => !r.done)) {
      await processor.start(row as GateOutboxRow);
      row.done = true;
    }
    for (const row of outbox('gate_resolved').filter((r) => !r.done)) {
      await processor.resolved(row as GateOutboxRow);
      row.done = true;
    }
  }
  async function decide(outcome: 'approve' | 'reject', comment?: string) {
    const instance = kit.db.table('workflow_instances')[0];
    const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === instance.id && t.status === 'open')!;
    kit.as({ user_id: 2, permissions: ['store:workflows:task'] });
    await kit.engine.completeTask({
      taskId: task.id,
      outcome,
      comment,
      expectedRowVersion: instance.row_version,
    });
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    mockPermissions.mockReset().mockResolvedValue([
      'store:orders:purchase_orders:cancel',
      'store:inventory:adjustments:create',
    ]);
    for (const m of [purchaseOrders.cancel, expenseFlow.reject, payrollFlow.cancel, adjustments.createAdjustment, notifications.sendToUser]) {
      m.mockReset().mockResolvedValue({ id: 900 });
    }
    processor = new ApprovalGateProcessor(
      kit.prisma,
      kit.engine,
      (kit.engine as any).events,
      notifications as any,
      purchaseOrders as any,
      expenseFlow as any,
      payrollFlow as any,
      adjustments as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    asRequester();
  });
  afterEach(() => jest.restoreAllMocks());

  it('no governing flow, or an amount under the threshold: the operation is free', async () => {
    expect(await requestApproval(kit.prisma, PO_INPUT())).toEqual({ status: 'free' });
    seedDefinition(kit.db, governingFlow());
    expect(await requestApproval(kit.prisma, PO_INPUT(1_999_999))).toEqual({ status: 'free' });
    expect(gates()).toHaveLength(0);
  });

  it('H-P1: an OC of 3.000.000 stays pending, the request starts with supplier, amount and products, and approve is blocked by 409', async () => {
    seedDefinition(kit.db, governingFlow());
    const first = await requestApproval(kit.prisma, PO_INPUT());
    expect(first.status).toBe('pending');
    expect(gates()).toHaveLength(1);
    expect(gates()[0]).toMatchObject({
      store_id: 1,
      operation: 'purchase_order.approve',
      entity_type: 'purchase_order',
      entity_id: 55,
      revision: 1,
      status: 'pending',
      requested_by_user_id: 4,
    });
    expect(gates()[0].context.secret).toBeUndefined(); // closed token catalog
    expect(outbox('gate_start')).toHaveLength(1);

    await drain();
    const instance = kit.db.table('workflow_instances')[0];
    expect(instance).toMatchObject({
      subject_type: 'purchase_order',
      subject_id: 55,
      started_by_type: 'system',
      current_stage_key: 'gerente',
    });
    expect(instance.data).toEqual({
      proveedor: 'Papelería Central',
      monto: 3_000_000,
      productos: 'Resma carta x 40',
    });
    expect(gates()[0].instance_id).toBe(instance.id);

    asRequester();
    await expect(enforceApproval(kit.prisma, PO_INPUT())).rejects.toMatchObject({
      response: expect.objectContaining({
        error_code: 'WORKFLOW_APPROVAL_PENDING',
        message: expect.stringContaining(instance.reference),
      }),
    });
    expect(gates()).toHaveLength(1); // asking again never opens a second request
  });

  it('approved: the operation passes ONCE (consumed in its transaction) and the requester is told', async () => {
    seedDefinition(kit.db, governingFlow());
    await requestApproval(kit.prisma, PO_INPUT());
    await drain();
    await decide('approve');
    expect(gates()[0]).toMatchObject({ status: 'approved' });
    await drain();
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      1,
      4,
      'workflow_task',
      expect.stringContaining('Compras'),
      expect.stringContaining('Aprobada'),
      expect.objectContaining({ instance_id: expect.any(Number) }),
    );
    expect(purchaseOrders.cancel).not.toHaveBeenCalled();

    asRequester();
    const decision = await enforceApproval(kit.prisma, PO_INPUT());
    expect(decision.status).toBe('approved');
    await kit.prisma.$transaction((tx: any) => consumeApproval(tx, decision));
    await expect(
      kit.prisma.$transaction((tx: any) => consumeApproval(tx, decision)),
    ).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'WORKFLOW_APPROVAL_PENDING' }) });
  });

  it('an approved gate whose amount then grows past the approval asks again', async () => {
    seedDefinition(kit.db, governingFlow());
    await requestApproval(kit.prisma, PO_INPUT());
    await drain();
    await decide('approve');
    asRequester();
    const again = await requestApproval(kit.prisma, PO_INPUT(3_500_000));
    expect(again.status).toBe('pending');
    expect(gates().map((g) => [g.revision, g.status])).toEqual([
      [1, 'cancelled'],
      [2, 'pending'],
    ]);
  });

  it('rejected: the OC is voided with the reason, acting as the publisher, and stays rejected', async () => {
    seedDefinition(kit.db, governingFlow());
    await requestApproval(kit.prisma, PO_INPUT());
    await drain();
    await decide('reject', 'Proveedor sin cotización');
    expect(gates()[0]).toMatchObject({ status: 'rejected', reason: 'Proveedor sin cotización' });
    await drain();
    expect(purchaseOrders.cancel).toHaveBeenCalledWith(55, 'Proveedor sin cotización');
    const timeline = kit.db.table('workflow_instance_events').map((e) => e.type);
    expect(timeline).toContain('gate_voided');
    asRequester();
    await expect(enforceApproval(kit.prisma, PO_INPUT())).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'WORKFLOW_APPROVAL_REJECTED' }),
    });
  });

  it('rejected, but the publisher lacks the cancel permission: nothing is voided and the record stays blocked', async () => {
    mockPermissions.mockResolvedValue([]);
    seedDefinition(kit.db, governingFlow());
    await requestApproval(kit.prisma, PO_INPUT());
    await drain();
    await decide('reject', 'No');
    await drain();
    expect(purchaseOrders.cancel).not.toHaveBeenCalled();
    expect(kit.db.table('workflow_instance_events').map((e) => e.type)).toContain('gate_effect_failed');
  });

  it('a cancelled request frees the gate: the next attempt opens a new revision', async () => {
    seedDefinition(kit.db, governingFlow());
    await requestApproval(kit.prisma, PO_INPUT());
    await drain();
    const instance = kit.db.table('workflow_instances')[0];
    kit.as({ user_id: 1, is_owner: true, permissions: ['store:workflows:manage'] } as any);
    await kit.engine.cancel({ instanceId: instance.id, reason: 'Duplicada' });
    expect(gates()[0]).toMatchObject({ status: 'cancelled', reason: 'Duplicada' });
    asRequester();
    expect((await requestApproval(kit.prisma, PO_INPUT())).status).toBe('pending');
    expect(gates().map((g) => g.revision)).toEqual([1, 2]);
  });

  it('a flow that stopped governing before the request opened cancels the gate instead of hanging', async () => {
    const { definitionId } = seedDefinition(kit.db, governingFlow());
    await requestApproval(kit.prisma, PO_INPUT());
    kit.db.table('workflow_definitions').find((d) => d.id === definitionId)!.status = 'archived';
    await drain();
    expect(gates()[0]).toMatchObject({ status: 'cancelled' });
    expect(kit.db.table('workflow_instances')).toHaveLength(0);
    expect(notifications.sendToUser).toHaveBeenCalledWith(1, 4, 'workflow_task', expect.any(String), expect.stringContaining('Cancelada'), expect.anything());
  });

  it('tiers: the flow with the highest threshold not above the amount governs', async () => {
    const low = seedDefinition(kit.db, governingFlow(1_000_000));
    const high = seedDefinition(kit.db, governingFlow(20_000_000));
    await requestApproval(kit.prisma, PO_INPUT(3_000_000, 1));
    await requestApproval(kit.prisma, PO_INPUT(25_000_000, 2));
    expect(gates().map((g) => [g.entity_id, g.definition_id])).toEqual([
      [1, low.definitionId],
      [2, high.definitionId],
    ]);
  });

  it('records of two types with the same id never share a request (order #7 vs payable #7)', async () => {
    const d = governingFlow(10) as any;
    d.key = 'pagos';
    d.subject = undefined;
    d.governs = { operation: 'supplier_payment.register', min_amount: 10 };
    seedDefinition(kit.db, d);
    const pay = (entity_type: string) => ({
      operation: 'supplier_payment.register' as const,
      entity_type,
      entity_id: 7,
      amount: 500,
      context: { amount: 500 },
      request: { method: 'pay', args: [7, { amount: 500 }] },
    });
    await expect(enforceApproval(kit.prisma, pay('purchase_order'))).rejects.toBeDefined();
    await expect(enforceApproval(kit.prisma, pay('accounts_payable'))).rejects.toBeDefined();
    await expect(enforceApproval(kit.prisma, pay('purchase_order'))).rejects.toBeDefined();
    expect(gates().map((g) => [g.entity_type, g.revision])).toEqual([
      ['purchase_order', 1],
      ['accounts_payable', 2],
    ]);
  });

  it('a store without the administration industry is never held', async () => {
    seedDefinition(kit.db, governingFlow());
    kit.db.table('stores').forEach((s: any) => (s.industries = ['retail']));
    expect(await requestApproval(kit.prisma, PO_INPUT())).toEqual({ status: 'free' });
  });

  describe('defer: an adjustment runs only after approval, as the requester', () => {
    const adjustmentFlow = (): WorkflowDefinitionV1 => {
      const d = governingFlow(10) as any;
      d.key = 'ajustes';
      d.subject = undefined;
      d.governs = { operation: 'inventory_adjustment.create', min_amount: 10 };
      return d;
    };
    const dto = { product_id: 3, location_id: 1, quantity_after: 2, type: 'damage' };
    const ADJ = () => ({
      operation: 'inventory_adjustment.create' as const,
      entity_type: 'product',
      entity_id: 3,
      amount: 40,
      context: { product_id: 3, quantity_change: -40 },
      request: { method: 'createAdjustment', args: [dto] },
    });

    it('nothing is created while pending; on approval the same request runs through the service once', async () => {
      seedDefinition(kit.db, adjustmentFlow());
      await expect(enforceApproval(kit.prisma, ADJ())).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'WORKFLOW_APPROVAL_PENDING' }),
      });
      // Same requester, same JSON: no second request (double click).
      await expect(enforceApproval(kit.prisma, ADJ())).rejects.toBeDefined();
      expect(gates()).toHaveLength(1);
      await drain();
      await decide('approve');
      adjustments.createAdjustment.mockImplementation(async (arg: unknown) => {
        // The service's own guard finds the approval of the same request.
        const decision = await enforceApproval(kit.prisma, { ...ADJ(), request: { method: 'createAdjustment', args: [arg] } });
        expect(decision.status).toBe('approved');
        await kit.prisma.$transaction((tx: any) => consumeApproval(tx, decision));
        return { id: 321 };
      });
      await drain();
      expect(adjustments.createAdjustment).toHaveBeenCalledTimes(1);
      expect(adjustments.createAdjustment).toHaveBeenCalledWith(dto);
      expect(gates()[0].consumed_at).toBeInstanceOf(Date);
      const executed = kit.db.table('workflow_instance_events').find((e) => e.type === 'gate_executed')!;
      expect(executed.payload).toMatchObject({ record_id: 321 });
    });

    it('another person asking the same thing opens their own request', async () => {
      seedDefinition(kit.db, adjustmentFlow());
      await expect(enforceApproval(kit.prisma, ADJ())).rejects.toBeDefined();
      kit.as({ user_id: 5 });
      await expect(enforceApproval(kit.prisma, ADJ())).rejects.toBeDefined();
      expect(gates().map((g) => g.requested_by_user_id)).toEqual([4, 5]);
    });

    it('rejected: the deferred operation never runs', async () => {
      seedDefinition(kit.db, adjustmentFlow());
      await expect(enforceApproval(kit.prisma, ADJ())).rejects.toBeDefined();
      await drain();
      await decide('reject', 'No cuadra');
      await drain();
      expect(adjustments.createAdjustment).not.toHaveBeenCalled();
    });

    it('the requester lost the permission: the approved operation is not run and the timeline says why', async () => {
      seedDefinition(kit.db, adjustmentFlow());
      await expect(enforceApproval(kit.prisma, ADJ())).rejects.toBeDefined();
      await drain();
      await decide('approve');
      mockPermissions.mockResolvedValue([]);
      await drain();
      expect(adjustments.createAdjustment).not.toHaveBeenCalled();
      expect(kit.db.table('workflow_instance_events').map((e) => e.type)).toContain('gate_effect_failed');
    });
  });

  describe('defer, repeated by the requester: a POS sale with a governed discount', () => {
    const discountFlow = (): WorkflowDefinitionV1 => {
      const d = governingFlow(100_000) as any;
      d.key = 'descuentos';
      d.subject = undefined;
      d.governs = { operation: 'order.discount', min_amount: 100_000 };
      return d;
    };
    const sale = { sale: 'pos', items: [[3, null, 1, 1_000_000]], discount_amount: 400_000 };
    const DISCOUNT = () => ({
      operation: 'order.discount' as const,
      entity_type: 'order',
      entity_id: 0,
      amount: 400_000,
      context: { order_id: null, discount_amount: 400_000, grand_total: 600_000 },
      request: { method: GATE_RETRY_BY_REQUESTER, args: [sale] },
    });

    it('the worker runs nothing; the requester is told to repeat the sale, which then passes once', async () => {
      seedDefinition(kit.db, discountFlow());
      await expect(enforceApproval(kit.prisma, DISCOUNT())).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'WORKFLOW_APPROVAL_PENDING' }),
      });
      await drain();
      await decide('approve');
      await drain();
      const types = kit.db.table('workflow_instance_events').map((e) => e.type);
      expect(types).not.toContain('gate_executed');
      expect(types).not.toContain('gate_effect_failed');
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        1,
        4,
        'workflow_task',
        expect.any(String),
        expect.stringContaining('ya puedes continuar con la operación'),
        expect.anything(),
      );
      kit.as({ user_id: 4 });
      const decision = await enforceApproval(kit.prisma, DISCOUNT());
      expect(decision.status).toBe('approved');
      await kit.prisma.$transaction((tx: any) => consumeApproval(tx, decision));
      // Used once: the next identical sale asks again.
      await expect(enforceApproval(kit.prisma, DISCOUNT())).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'WORKFLOW_APPROVAL_PENDING' }),
      });
    });
  });
});
