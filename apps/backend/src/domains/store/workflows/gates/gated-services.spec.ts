import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PurchaseOrdersService } from '../../orders/purchase-orders/purchase-orders.service';
import { ExpenseFlowService } from '../../expenses/expense-flow/expense-flow.service';
import { PayrollFlowService } from '../../payroll/payroll-runs/payroll-flow.service';
import { InventoryAdjustmentsService } from '../../inventory/adjustments/inventory-adjustments.service';
import { CreditNotesService } from '../../invoicing/credit-notes/credit-notes.service';
import { InvoiceFlowService } from '../../invoicing/invoice-flow/invoice-flow.service';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';
import { PaymentsService } from '../../payments/payments.service';
import { ProductVariantService } from '../../products/services/product-variant.service';
import { ProductsService } from '../../products/products.service';
import { OrdersService } from '../../orders/orders.service';

const mockGoverned = jest.fn<Promise<boolean>, unknown[]>();
const mockEnforce = jest.fn();
const mockRequest = jest.fn();
jest.mock('./approval-gate', () => ({
  ...jest.requireActual('./approval-gate'),
  operationIsGoverned: (...a: unknown[]) => mockGoverned(...a),
  enforceApproval: (...a: unknown[]) => mockEnforce(...a),
  requestApproval: (...a: unknown[]) => mockRequest(...a),
}));

const PENDING = () =>
  new VendixHttpException(
    ErrorCodes.WORKFLOW_APPROVAL_PENDING,
    'Pendiente de aprobación',
  );

/** A service instance without Nest: only the fields the gated path reads. */
function bare<T>(cls: { prototype: T }, fields: Record<string, unknown>): T {
  return Object.assign(Object.create(cls.prototype as object), fields) as T;
}
const inStore = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    {
      store_id: 1,
      organization_id: 1,
      user_id: 4,
      is_super_admin: false,
      is_owner: false,
    },
    fn,
  );

/**
 * P1.3, "una operación pendiente no se puede ejecutar por ninguna ruta": the
 * guard lives in the domain service, under every controller, AI tool and flow
 * action. While the request is pending the service throws 409 and writes
 * nothing; the gate is asked with the operation's real data.
 */
describe('governed domain services (P1.3)', () => {
  const tx = jest.fn();
  beforeEach(() => {
    mockGoverned.mockReset().mockResolvedValue(true);
    mockEnforce.mockReset().mockRejectedValue(PENDING());
    mockRequest.mockReset().mockResolvedValue({ status: 'pending' });
    tx.mockReset();
  });

  it('purchase order approve (hold): 409 before the transaction, with supplier, total and products', async () => {
    const prisma = {
      purchase_orders: {
        findFirst: jest.fn().mockResolvedValue({
          id: 55,
          order_number: 'OC-0055',
          supplier_id: 7,
          total_amount: 3000000,
          suppliers: { name: 'Papelería Central' },
          purchase_order_items: [
            { quantity_ordered: 40, products: { name: 'Resma' } },
          ],
        }),
      },
      users: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ first_name: 'Ana', last_name: 'Ruiz' }),
      },
      $transaction: tx,
    };
    const svc = bare(PurchaseOrdersService, { prisma });
    await expect(inStore(() => svc.approve(55))).rejects.toMatchObject({
      errorCode: 'WORKFLOW_APPROVAL_PENDING',
    });
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce).toHaveBeenCalledWith(prisma, {
      operation: 'purchase_order.approve',
      entity_id: 55,
      amount: 3000000,
      context: expect.objectContaining({
        supplier_name: 'Papelería Central',
        products: 'Resma x 40',
        requested_by: 'Ana Ruiz',
      }),
    });
  });

  it('purchase order approve with no governing flow does not ask the gate', async () => {
    mockGoverned.mockResolvedValue(false);
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(new Error('reached the write')),
    };
    const svc = bare(PurchaseOrdersService, { prisma });
    await expect(inStore(() => svc.approve(55))).rejects.toThrow(
      'reached the write',
    );
    expect(mockEnforce).not.toHaveBeenCalled();
  });

  it('supplier payment on a purchase order (defer): the same DTO is what runs once approved', async () => {
    const dto = {
      amount: 500000,
      payment_date: '2026-11-07',
      payment_method: 'transfer',
    };
    const prisma = {
      purchase_orders: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 9, supplier_id: 7, total_amount: 900000 }),
      },
      $transaction: tx,
    };
    const svc = bare(PurchaseOrdersService, { prisma });
    await expect(
      inStore(() => svc.registerPayment(9, dto as never)),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        operation: 'supplier_payment.register',
        entity_id: 9,
        amount: 500000,
        request: { method: 'registerPurchaseOrderPayment', args: [9, dto] },
      }),
    );
  });

  it('accounts payable payment (defer) is held the same way', async () => {
    const dto = { amount: 100, payment_method: 'cash' };
    const prisma = {
      accounts_payable: {
        findFirst: jest.fn().mockResolvedValue({
          id: 3,
          supplier_id: 7,
          balance: 1000,
          status: 'open',
        }),
      },
      $transaction: tx,
    };
    const svc = bare(AccountsPayableService, { prisma });
    await expect(
      inStore(() => svc.registerPayment(3, dto as never, 4)),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce.mock.calls[0][1]).toMatchObject({
      entity_type: 'accounts_payable',
      request: { method: 'registerPayablePayment', args: [3, dto] },
    });
  });

  it('expense approve (hold): 409 and no write', async () => {
    const prisma = {
      expenses: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          state: 'pending',
          amount: 2500000,
          description: 'Viáticos',
          expense_categories: { name: 'Viajes' },
        }),
      },
      users: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: tx,
    };
    const svc = bare(ExpenseFlowService, {
      prisma,
      logger: { log: jest.fn() },
    });
    await expect(inStore(() => svc.approve(8))).rejects.toMatchObject({
      errorCode: 'WORKFLOW_APPROVAL_PENDING',
    });
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce.mock.calls[0][1]).toMatchObject({
      operation: 'expense.approve',
      entity_id: 8,
      amount: 2500000,
    });
  });

  it('payroll run approve (hold): 409 and no write', async () => {
    const prisma = {
      payroll_runs: {
        findFirst: jest.fn().mockResolvedValue({
          id: 12,
          status: 'calculated',
          total_net_pay: 18000000,
          payroll_number: 'NOM-12',
          payroll_items: [],
        }),
      },
      users: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: tx,
    };
    const svc = bare(PayrollFlowService, {
      prisma,
      logger: { log: jest.fn() },
    });
    await expect(inStore(() => svc.approve(12))).rejects.toMatchObject({
      errorCode: 'WORKFLOW_APPROVAL_PENDING',
    });
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce.mock.calls[0][1]).toMatchObject({
      operation: 'payroll_run.approve',
      entity_id: 12,
      amount: 18000000,
    });
  });

  it('inventory adjustment (defer): units moved = |target − on hand|; nothing applied while pending', async () => {
    const dto = {
      product_id: 3,
      location_id: 1,
      quantity_after: 2,
      type: 'damage',
    };
    const prisma = {
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue({ quantity_on_hand: 42 }),
      },
      products: { findFirst: jest.fn().mockResolvedValue({ name: 'Resma' }) },
      $transaction: tx,
    };
    const svc = bare(InventoryAdjustmentsService, { prisma });
    await expect(
      inStore(() => svc.createAdjustment(dto as never)),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce.mock.calls[0][1]).toMatchObject({
      operation: 'inventory_adjustment.create',
      entity_type: 'product',
      entity_id: 3,
      amount: 40,
      context: expect.objectContaining({ quantity_change: -40, quantity_after: 2 }),
      request: { method: 'createAdjustment', args: [dto] },
    });
  });

  it('an adjustment without a stock record is left to the service (no request for one that cannot run)', async () => {
    const prisma = {
      stock_levels: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockRejectedValue(new Error('reached the service')),
    };
    const svc = bare(InventoryAdjustmentsService, { prisma });
    await expect(
      inStore(() =>
        svc.createAdjustment({
          product_id: 9,
          location_id: 1,
          quantity_after: 900,
          type: 'damage',
        } as never),
      ),
    ).rejects.toThrow('reached the service');
    expect(mockEnforce).not.toHaveBeenCalled();
  });

  it('an initial stock load is not a correction and is never held', async () => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(new Error('reached the write')),
    };
    const svc = bare(InventoryAdjustmentsService, { prisma });
    await expect(
      inStore(() =>
        svc.createAdjustment({
          product_id: 3,
          location_id: 1,
          quantity_after: 900,
          type: 'initial_load',
        } as never),
      ),
    ).rejects.toThrow('reached the write');
    expect(mockEnforce).not.toHaveBeenCalled();
  });

  it('credit note (defer): amount from its lines; the note is not created while pending', async () => {
    const dto = {
      related_invoice_id: 70,
      reason: 'Devolución',
      items: [{ quantity: 2, unit_price: 150000 }],
    };
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          id: 70,
          invoice_number: 'FV-70',
          total_amount: 900000,
        }),
      },
      users: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const createNote = jest.fn();
    const svc = bare(CreditNotesService, { prisma, createNote });
    await expect(
      inStore(() => svc.createCreditNote(dto as never)),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(createNote).not.toHaveBeenCalled();
    expect(mockEnforce.mock.calls[0][1]).toMatchObject({
      operation: 'credit_note.create',
      entity_id: 70,
      amount: 300000,
      request: { method: 'createCreditNote', args: [dto] },
    });
  });

  it('invoice void (defer): checked after the state and period rules; no write while pending', async () => {
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          id: 70,
          invoice_number: 'FV-70',
          total_amount: 900000,
          invoice_type: 'sales_invoice',
        }),
      },
      users: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: tx,
    };
    const svc = bare(InvoiceFlowService, {
      prisma,
      getInvoice: jest.fn().mockResolvedValue({
        id: 70,
        status: 'rejected',
        invoice_type: 'sales_invoice',
      }),
      validateTransition: jest.fn(),
      assertFiscalPeriodOpen: jest.fn(),
    });
    await expect(inStore(() => svc.void(70))).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(tx).not.toHaveBeenCalled();
    expect(mockEnforce.mock.calls[0][1]).toMatchObject({
      operation: 'invoice.void',
      entity_id: 70,
      request: { method: 'void', args: [70] },
    });
  });

  describe('routes that also write a governed effect (P1.3, review r1)', () => {
    it('advance configured on an existing order (PATCH payment-plan) is held: 409, no write, same DTO replays', async () => {
      const dto = { payment_plan: 'partial', down_payment_amount: 2900000 };
      const prisma = {
        purchase_orders: {
          findUnique: jest.fn().mockResolvedValue({
            id: 9,
            status: 'draft',
            total_amount: 3000000,
            suppliers: { id: 7, name: 'Papelería Central', tax_id: '900' },
          }),
        },
        purchase_order_payments: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: tx,
      };
      const svc = bare(PurchaseOrdersService, { prisma });
      await expect(
        inStore(() => svc.configurePaymentPlan(9, dto as never, 4)),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_APPROVAL_PENDING' });
      expect(tx).not.toHaveBeenCalled();
      expect(mockEnforce).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          operation: 'supplier_payment.register',
          entity_type: 'purchase_order',
          entity_id: 9,
          amount: 2900000,
          request: { method: 'configurePurchaseOrderPaymentPlan', args: [9, dto] },
        }),
      );
    });

    it('a payment plan without an advance is not a payment and is not held', async () => {
      const prisma = {
        purchase_orders: {
          findUnique: jest.fn().mockResolvedValue({
            id: 9,
            status: 'draft',
            total_amount: 3000000,
            suppliers: { id: 7 },
          }),
        },
        purchase_order_payments: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn().mockRejectedValue(new Error('reached the write')),
      };
      const svc = bare(PurchaseOrdersService, { prisma });
      await expect(
        inStore(() =>
          svc.configurePaymentPlan(
            9,
            { payment_plan: 'deferred', payment_due_date: '2999-01-01' } as never,
            4,
          ),
        ),
      ).rejects.toThrow('reached the write');
      expect(mockEnforce).not.toHaveBeenCalled();
    });

    it('advance declared while creating an order: governed for its amount → 409 and the order is not created', async () => {
      const svc = bare(PurchaseOrdersService, { prisma: {} });
      const guard = (amount: number) =>
        (
          svc as unknown as {
            assertCreateAdvanceNotGoverned(a: number): Promise<void>;
          }
        ).assertCreateAdvanceNotGoverned(amount);
      await expect(inStore(() => guard(2900000))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_REQUIRED',
      });
      expect(mockGoverned).toHaveBeenCalledWith(
        {},
        'supplier_payment.register',
        2900000,
      );
      mockGoverned.mockResolvedValue(false);
      await expect(inStore(() => guard(1000))).resolves.toBeUndefined();
    });

    it('an adjustment written inside a caller transaction (bulk session, archive) is held: 409, nothing written', async () => {
      const prisma = {
        stock_levels: {
          findFirst: jest.fn().mockResolvedValue({ quantity_on_hand: 500 }),
        },
        products: { findFirst: jest.fn().mockResolvedValue({ name: 'Resma' }) },
      };
      const callerTx = {
        workflow_approval_gates: { updateMany: jest.fn() },
        inventory_adjustments: { create: jest.fn() },
      };
      const svc = bare(InventoryAdjustmentsService, { prisma });
      const dto = {
        product_id: 3,
        location_id: 1,
        quantity_after: 0,
        type: 'loss',
      };
      await expect(
        inStore(() => svc.createAdjustmentInTransaction(callerTx, dto as never)),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_APPROVAL_PENDING' });
      expect(callerTx.inventory_adjustments.create).not.toHaveBeenCalled();
      expect(mockEnforce.mock.calls[0][1]).toMatchObject({
        operation: 'inventory_adjustment.create',
        entity_id: 3,
        amount: 500,
        request: { method: 'createAdjustment', args: [dto] },
      });
    });

    it('an approval asked before the caller transaction is used once inside it', async () => {
      const callerTx = {
        workflow_approval_gates: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        inventory_adjustments: { create: jest.fn() },
      };
      const svc = bare(InventoryAdjustmentsService, { prisma: {} });
      await expect(
        inStore(() =>
          svc.createAdjustmentInTransaction(
            callerTx,
            { product_id: 3, location_id: 1, quantity_after: 0, type: 'loss' } as never,
            { approval: { status: 'approved', gate: { id: 5 } } as never },
          ),
        ),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_APPROVAL_PENDING' });
      expect(mockEnforce).not.toHaveBeenCalled();
      expect(callerTx.workflow_approval_gates.updateMany).toHaveBeenCalledWith({
        where: { id: 5, status: 'approved', consumed_at: null },
        data: { consumed_at: expect.any(Date) },
      });
      expect(callerTx.inventory_adjustments.create).not.toHaveBeenCalled();
    });

    it('an initial load that falls back to a count difference (stock moved since the preview) is refused when governed (review r2)', async () => {
      const callerTx = {
        $executeRawUnsafe: jest.fn(),
        stock_levels: {
          findFirst: jest.fn().mockResolvedValue({ quantity_on_hand: 20 }),
        },
        inventory_adjustments: { create: jest.fn() },
      };
      const svc = bare(InventoryAdjustmentsService, { prisma: {} });
      const load = () =>
        svc.createAdjustmentInTransaction(
          callerTx,
          { product_id: 3, location_id: 1, quantity_after: 600, type: 'initial_load' } as never,
          { initialLoadFallback: true },
        );
      await expect(inStore(load)).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_REQUIRED',
      });
      expect(mockGoverned).toHaveBeenCalledWith(
        {},
        'inventory_adjustment.create',
        580,
      );
      expect(mockEnforce).not.toHaveBeenCalled();
      expect(callerTx.inventory_adjustments.create).not.toHaveBeenCalled();
    });

    it('archive write-offs: every governed line gets its request before the 409', async () => {
      const prisma = {
        stock_levels: {
          findFirst: jest.fn().mockResolvedValue({ quantity_on_hand: 500 }),
        },
        products: { findFirst: jest.fn().mockResolvedValue({ name: 'Resma' }) },
      };
      const svc = bare(InventoryAdjustmentsService, { prisma });
      const lines = [1, 2].map((location_id) => ({
        product_id: 3,
        location_id,
        quantity_after: 0,
        type: 'loss',
      }));
      await expect(
        inStore(() => svc.requestAdjustmentApprovals(lines as never)),
      ).rejects.toMatchObject({ errorCode: 'WORKFLOW_APPROVAL_PENDING' });
      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(mockRequest.mock.calls.map((c) => c[1].context.location_id)).toEqual([1, 2]);
      expect(mockEnforce.mock.calls[0][1]).toMatchObject({
        context: expect.objectContaining({ location_id: 1 }),
      });
    });

    it('archive write-offs with no governing flow ask nothing and pass free', async () => {
      mockGoverned.mockResolvedValue(false);
      const svc = bare(InventoryAdjustmentsService, { prisma: {} });
      await expect(
        inStore(() =>
          svc.requestAdjustmentApprovals([
            { product_id: 3, location_id: 1, quantity_after: 0, type: 'loss' },
          ] as never),
        ),
      ).resolves.toEqual([{ status: 'free' }]);
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('POS sale with a governed discount (order.discount, review r1)', () => {
    const dto = {
      customer_id: 30,
      coupon_code: 'VIP40',
      items: [{ product_id: 3, quantity: 2, unit_price: 500000 }],
    };
    const gateOf = (svc: PaymentsService, order: Record<string, unknown>) =>
      (
        svc as unknown as {
          enforcePosDiscountApproval(d: unknown, o: unknown): Promise<unknown>;
        }
      ).enforcePosDiscountApproval(dto, order);

    it('a discount over the threshold is held (409) and repeating the same sale asks the same request', async () => {
      const svc = bare(PaymentsService, { prisma: {} });
      const order = { order_number: 'POS-9', discount_amount: 400000, grand_total: 600000 };
      await expect(inStore(() => gateOf(svc, order))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_PENDING',
      });
      await expect(inStore(() => gateOf(svc, order))).rejects.toBeDefined();
      expect(mockGoverned).toHaveBeenCalledWith({}, 'order.discount', 400000);
      const [first, second] = mockEnforce.mock.calls.map((c) => c[1]);
      expect(first).toMatchObject({
        operation: 'order.discount',
        entity_type: 'order',
        entity_id: 0,
        amount: 400000,
        context: { order_id: null, order_number: null, discount_amount: 400000 },
        request: { method: 'retry_by_requester' },
      });
      expect(second.request).toEqual(first.request);
    });

    it('a sale without a discount, or with no governing flow, is never held', async () => {
      const svc = bare(PaymentsService, { prisma: {} });
      await expect(
        inStore(() => gateOf(svc, { discount_amount: 0, grand_total: 1000 })),
      ).resolves.toEqual({ status: 'free' });
      expect(mockGoverned).not.toHaveBeenCalled();
      mockGoverned.mockResolvedValue(false);
      await expect(
        inStore(() => gateOf(svc, { discount_amount: 50, grand_total: 950 })),
      ).resolves.toEqual({ status: 'free' });
      expect(mockEnforce).not.toHaveBeenCalled();
    });
  });

  describe('stock typed in the product edit (inventory_adjustment.create, review r2)', () => {
    const variant = {
      product_id: 3,
      is_on_sale: false,
      products: { product_type: 'physical', base_price: 1000, store_id: 1 },
    };
    const editVariant = (
      svc: ProductVariantService,
      tx: Record<string, unknown>,
      stock: number,
    ) =>
      (
        svc as unknown as {
          executeUpdateVariant(
            tx: unknown,
            id: number,
            dto: unknown,
            existing: unknown,
            userId: number,
          ): Promise<unknown>;
        }
      ).executeUpdateVariant(tx, 7, { stock_quantity: stock }, variant, 4);
    const variantTx = () => ({
      $queryRaw: jest.fn().mockResolvedValue([{ location_id: 2, total: 500 }]),
      product_variants: { update: jest.fn().mockResolvedValue({ id: 7 }) },
    });

    it('variant stock 500 → 0 (product page and PATCH variants/:id): 409, the variant is not saved, no stock moves', async () => {
      const updateStock = jest.fn();
      const svc = bare(ProductVariantService, {
        prisma: {},
        stockLevelManager: { updateStock },
      });
      const tx = variantTx();
      await expect(inStore(() => editVariant(svc, tx, 0))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_REQUIRED',
      });
      expect(mockGoverned).toHaveBeenCalledWith(
        {},
        'inventory_adjustment.create',
        500,
      );
      expect(tx.product_variants.update).not.toHaveBeenCalled();
      expect(updateStock).not.toHaveBeenCalled();
    });

    it('variant stock change with no governing flow is applied where the stock lives', async () => {
      mockGoverned.mockResolvedValue(false);
      const updateStock = jest.fn();
      const svc = bare(ProductVariantService, {
        prisma: {},
        stockLevelManager: { updateStock },
      });
      const tx = variantTx();
      await inStore(() => editVariant(svc, tx, 0));
      expect(tx.product_variants.update).toHaveBeenCalled();
      expect(updateStock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant_id: 7,
          location_id: 2,
          quantity_change: -500,
          movement_type: 'adjustment',
        }),
        tx,
      );
    });

    it('variant edit that keeps the stock does not ask the gate', async () => {
      const svc = bare(ProductVariantService, {
        prisma: {},
        stockLevelManager: { updateStock: jest.fn() },
      });
      await inStore(() => editVariant(svc, variantTx(), 500));
      expect(mockGoverned).not.toHaveBeenCalled();
    });

    it('base stock in PATCH products/:id (stock_quantity, stock_by_location): governed change → 409, otherwise passes', async () => {
      const svc = bare(ProductsService, { prisma: {} });
      const guard = (change: number) =>
        (
          svc as unknown as {
            assertStockEditNotGoverned(c: number): Promise<void>;
          }
        ).assertStockEditNotGoverned(change);
      await expect(inStore(() => guard(-500))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_REQUIRED',
      });
      expect(mockGoverned).toHaveBeenCalledWith(
        {},
        'inventory_adjustment.create',
        500,
      );
      mockGoverned.mockResolvedValue(false);
      await expect(inStore(() => guard(-10))).resolves.toBeUndefined();
    });
  });

  describe('discount typed into the order by API (order.discount, review r2)', () => {
    const svc = bare(OrdersService, { prisma: {} });
    const guard = (discount: number, previous: number, route: 'create' | 'edit') =>
      (
        svc as unknown as {
          assertApiDiscountNotGoverned(
            d: number,
            p: number,
            r: 'create' | 'edit',
          ): Promise<void>;
        }
      ).assertApiDiscountNotGoverned(discount, previous, route);

    it('POST orders with a governed discount: 409, the order is not created', async () => {
      await expect(inStore(() => guard(400000, 0, 'create'))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_REQUIRED',
      });
      expect(mockGoverned).toHaveBeenCalledWith({}, 'order.discount', 400000);
    });

    it('PUT orders/:id/items and PATCH orders/:id raising the discount to a governed amount: 409', async () => {
      await expect(inStore(() => guard(400000, 50000, 'edit'))).rejects.toMatchObject({
        errorCode: 'WORKFLOW_APPROVAL_REQUIRED',
      });
    });

    it('keeping or lowering a discount, or no governing flow, always passes', async () => {
      await expect(inStore(() => guard(400000, 400000, 'edit'))).resolves.toBeUndefined();
      await expect(inStore(() => guard(0, 0, 'create'))).resolves.toBeUndefined();
      expect(mockGoverned).not.toHaveBeenCalled();
      mockGoverned.mockResolvedValue(false);
      await expect(inStore(() => guard(400000, 0, 'create'))).resolves.toBeUndefined();
    });
  });
});
