import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowInstanceRow } from '../workflow-engine.types';
import { WorkflowPurchasingActions } from './purchasing.actions';
import {
  WorkflowActionContext,
  WorkflowActionInputError,
} from './workflow-action.types';

const PERMISSIONS = ['store:orders:purchase_orders:create'];

describe('WorkflowPurchasingActions', () => {
  let seen: Array<Record<string, unknown> | undefined>;
  const snapshot = () => {
    seen.push(
      RequestContextService.getContext() as unknown as Record<string, unknown>,
    );
  };
  const expenses = { create: jest.fn() };
  const expenseFlow = { approve: jest.fn(), pay: jest.fn() };
  const purchaseOrders = {
    create: jest.fn(),
    approve: jest.fn(),
    cancel: jest.fn(),
    registerPayment: jest.fn(),
  };
  const accountsPayable = { registerPayment: jest.fn() };
  let actions: WorkflowPurchasingActions;

  const ctx = (map: Record<string, unknown>): WorkflowActionContext => ({
    instance: {
      id: 9,
      store_id: 1,
      organization_id: 2,
      reference: 'FLU-000001',
    } as unknown as WorkflowInstanceRow,
    map,
    actingUserId: 5,
    permissions: PERMISSIONS,
    asPublisher: (fn) =>
      RequestContextService.runIsolated(
        {
          store_id: 1,
          organization_id: 2,
          user_id: 5,
          is_super_admin: false,
          is_owner: false,
          permissions: PERMISSIONS,
        },
        fn,
      ),
  });
  const run = (action: keyof WorkflowPurchasingActions['handlers'], map: Record<string, unknown>) =>
    actions.handlers[action]!(ctx(map));

  beforeEach(() => {
    jest.resetAllMocks();
    seen = [];
    expenses.create.mockImplementation(async () => (snapshot(), { id: 31 }));
    expenseFlow.approve.mockImplementation(async () => (snapshot(), { id: 32 }));
    expenseFlow.pay.mockImplementation(async () => (snapshot(), { id: 33 }));
    purchaseOrders.create.mockImplementation(async () => (snapshot(), { id: 501 }));
    purchaseOrders.approve.mockImplementation(async () => (snapshot(), { id: 502 }));
    purchaseOrders.cancel.mockImplementation(async () => (snapshot(), { id: 503 }));
    purchaseOrders.registerPayment.mockImplementation(
      async () => (snapshot(), { id: 701 }),
    );
    accountsPayable.registerPayment.mockImplementation(
      async () => (snapshot(), { payment: { id: 801 }, ap: { id: 40 } }),
    );
    actions = new WorkflowPurchasingActions(
      expenses as never,
      expenseFlow as never,
      purchaseOrders as never,
      accountsPayable as never,
    );
  });

  const expectPublisherContext = () =>
    expect(seen[0]).toMatchObject({
      store_id: 1,
      organization_id: 2,
      user_id: 5,
      is_owner: false,
      is_super_admin: false,
    });

  it('registers a handler for every purchasing action', () => {
    expect(Object.keys(actions.handlers).sort()).toEqual(
      [
        'vendix.expense.approve',
        'vendix.expense.create',
        'vendix.expense.pay',
        'vendix.payable.register_payment',
        'vendix.purchase_order.approve',
        'vendix.purchase_order.cancel',
        'vendix.purchase_order.create_draft',
        'vendix.purchase_order.register_payment',
      ].sort(),
    );
  });

  describe('gastos', () => {
    it('create: calls the service with the DTO in the publisher context', async () => {
      const result = await run('vendix.expense.create', {
        amount: '125000.456',
        category_id: '4',
        description: 'Papelería',
        expense_date: '2026-11-05',
      });
      expect(result).toEqual({ record_id: 31 });
      expect(expenses.create).toHaveBeenCalledWith({
        amount: 125000.46,
        category_id: 4,
        description: 'Papelería',
        expense_date: '2026-11-05',
      });
      expectPublisherContext();
    });

    it('create: category and date are optional (date defaults to today)', async () => {
      await run('vendix.expense.create', { amount: 10, description: 'X' });
      const dto = expenses.create.mock.calls[0][0];
      expect(dto.category_id).toBeUndefined();
      expect(dto.expense_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('approve and pay: call the flow service and return the expense id', async () => {
      expect(await run('vendix.expense.approve', { expense_id: '12' })).toEqual({
        record_id: 32,
      });
      expect(expenseFlow.approve).toHaveBeenCalledWith(12);
      expect(await run('vendix.expense.pay', { expense_id: 12 })).toEqual({
        record_id: 33,
      });
      expect(expenseFlow.pay).toHaveBeenCalledWith(12);
      expect(seen).toHaveLength(2);
      expectPublisherContext();
    });

    it('invalid input fails without calling the service', async () => {
      for (const map of [
        { description: 'X' },
        { amount: 'caro', description: 'X' },
        { amount: '-1', description: 'X' },
        { amount: 5 },
        { amount: 5, description: 'X', category_id: 'abc' },
        { amount: 5, description: 'X', expense_date: '05/11/2026' },
      ]) {
        await expect(run('vendix.expense.create', map)).rejects.toBeInstanceOf(
          WorkflowActionInputError,
        );
      }
      for (const action of ['vendix.expense.approve', 'vendix.expense.pay'] as const) {
        await expect(run(action, { expense_id: '' })).rejects.toBeInstanceOf(
          WorkflowActionInputError,
        );
        await expect(run(action, { expense_id: '0' })).rejects.toBeInstanceOf(
          WorkflowActionInputError,
        );
      }
      expect(expenses.create).not.toHaveBeenCalled();
      expect(expenseFlow.approve).not.toHaveBeenCalled();
      expect(expenseFlow.pay).not.toHaveBeenCalled();
    });

    it('a service without an id never reports success', async () => {
      expenseFlow.approve.mockResolvedValue({});
      await expect(run('vendix.expense.approve', { expense_id: 1 })).rejects.toThrow(
        'returned no id',
      );
    });
  });

  describe('órdenes de compra', () => {
    const PO_MAP = {
      supplier_id: 7,
      location_id: 3,
      product_id: '11',
      quantity: '4',
      unit_price: '2500.504',
      notes: 'Solicitud FLU-000001',
    };

    it('OC: crea el BORRADOR por PurchaseOrdersService con los valores resueltos, en la tienda y como quien publicó', async () => {
      const result = await run('vendix.purchase_order.create_draft', PO_MAP);
      expect(result).toEqual({ record_id: 501 });
      const dto = purchaseOrders.create.mock.calls[0][0];
      expect(dto).toMatchObject({
        supplier_id: 7,
        location_id: 3,
        items: [{ product_id: 11, quantity: 4, unit_price: 2500.5 }],
        notes: 'Solicitud FLU-000001',
        internal_notes: 'Creada por el flujo FLU-000001',
      });
      expect(dto.status).toBeUndefined();
      expect(dto.expected_date).toBeUndefined();
      expectPublisherContext();
    });

    it('OC: passes the expected date when given', async () => {
      await run('vendix.purchase_order.create_draft', {
        ...PO_MAP,
        expected_date: '2026-12-01',
      });
      expect(purchaseOrders.create.mock.calls[0][0].expected_date).toBe(
        '2026-12-01',
      );
    });

    it('OC: valores inválidos fallan SIN llamar al servicio', async () => {
      for (const bad of [
        { supplier_id: '' },
        { supplier_id: 'abc' },
        { location_id: '0' },
        { product_id: '1.5' },
        { quantity: '-2' },
        { quantity: '0' },
        { unit_price: '' },
        { unit_price: 'caro' },
        { unit_price: '-1' },
        { expected_date: 'mañana' },
      ]) {
        await expect(
          run('vendix.purchase_order.create_draft', { ...PO_MAP, ...bad }),
        ).rejects.toBeInstanceOf(WorkflowActionInputError);
      }
      expect(purchaseOrders.create).not.toHaveBeenCalled();
    });

    it('OC: si el servicio rechaza, el error sube tal cual', async () => {
      purchaseOrders.create.mockRejectedValue(new Error('Supplier not found'));
      await expect(
        run('vendix.purchase_order.create_draft', PO_MAP),
      ).rejects.toThrow('Supplier not found');
    });

    it('OC: a service without an id never reports success', async () => {
      purchaseOrders.create.mockResolvedValue({});
      await expect(
        run('vendix.purchase_order.create_draft', PO_MAP),
      ).rejects.toThrow('returned no id');
    });

    it('approve and cancel call the service with the order id', async () => {
      expect(
        await run('vendix.purchase_order.approve', { purchase_order_id: '8' }),
      ).toEqual({ record_id: 502 });
      expect(purchaseOrders.approve).toHaveBeenCalledWith(8);
      expect(
        await run('vendix.purchase_order.cancel', {
          purchase_order_id: 8,
          reason: 'duplicada',
        }),
      ).toEqual({ record_id: 503 });
      expect(purchaseOrders.cancel).toHaveBeenCalledWith(8, 'duplicada');
      expect(seen).toHaveLength(2);
      await run('vendix.purchase_order.cancel', { purchase_order_id: 8 });
      expect(purchaseOrders.cancel).toHaveBeenLastCalledWith(8, 'Anulada por el flujo FLU-000001');
      expectPublisherContext();
    });

    it('approve and cancel reject a missing order id without calling the service', async () => {
      for (const action of [
        'vendix.purchase_order.approve',
        'vendix.purchase_order.cancel',
      ] as const) {
        await expect(run(action, {})).rejects.toBeInstanceOf(WorkflowActionInputError);
        await expect(
          run(action, { purchase_order_id: 'x' }),
        ).rejects.toBeInstanceOf(WorkflowActionInputError);
      }
      expect(purchaseOrders.approve).not.toHaveBeenCalled();
      expect(purchaseOrders.cancel).not.toHaveBeenCalled();
    });

    it('register_payment: builds the payment DTO and returns the payment id', async () => {
      const result = await run('vendix.purchase_order.register_payment', {
        purchase_order_id: '8',
        amount: '1500.5',
        payment_method: 'bank_transfer',
        reference: 'TRX-9',
      });
      expect(result).toEqual({ record_id: 701 });
      const [orderId, dto] = purchaseOrders.registerPayment.mock.calls[0];
      expect(orderId).toBe(8);
      expect(dto).toMatchObject({
        amount: 1500.5,
        payment_method: 'bank_transfer',
        reference: 'TRX-9',
        notes: 'Registrado por el flujo FLU-000001',
      });
      expect(dto.payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expectPublisherContext();
    });

    it('register_payment: invalid input fails without calling the service', async () => {
      const ok = {
        purchase_order_id: 8,
        amount: 10,
        payment_method: 'cash',
      };
      for (const bad of [
        { purchase_order_id: '' },
        { amount: '' },
        { amount: '0' },
        { amount: '0.001' },
        { amount: '-3' },
        { amount: '99999999999' },
        { payment_method: '' },
      ]) {
        await expect(
          run('vendix.purchase_order.register_payment', { ...ok, ...bad }),
        ).rejects.toBeInstanceOf(WorkflowActionInputError);
      }
      expect(purchaseOrders.registerPayment).not.toHaveBeenCalled();
    });
  });

  describe('cuentas por pagar', () => {
    it('register_payment: calls the service as the publisher and returns the payment id', async () => {
      const result = await run('vendix.payable.register_payment', {
        payable_id: '40',
        amount: '300',
        payment_method: 'cash',
      });
      expect(result).toEqual({ record_id: 801 });
      const [id, dto, userId] = accountsPayable.registerPayment.mock.calls[0];
      expect(id).toBe(40);
      expect(userId).toBe(5);
      expect(dto).toMatchObject({
        amount: 300,
        payment_method: 'cash',
        notes: 'Registrado por el flujo FLU-000001',
      });
      expect(dto.reference).toBeUndefined();
      expectPublisherContext();
    });

    it('register_payment: invalid input fails without calling the service', async () => {
      const ok = { payable_id: 40, amount: 10, payment_method: 'cash' };
      for (const bad of [
        { payable_id: 'abc' },
        { amount: '0' },
        { amount: 'x' },
        { payment_method: '' },
      ]) {
        await expect(
          run('vendix.payable.register_payment', { ...ok, ...bad }),
        ).rejects.toBeInstanceOf(WorkflowActionInputError);
      }
      expect(accountsPayable.registerPayment).not.toHaveBeenCalled();
    });

    it('a payment without id never reports success', async () => {
      accountsPayable.registerPayment.mockResolvedValue({ payment: {} });
      await expect(
        run('vendix.payable.register_payment', {
          payable_id: 40,
          amount: 1,
          payment_method: 'cash',
        }),
      ).rejects.toThrow('returned no id');
    });
  });
});
