import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PurchaseOrdersService } from '../../orders/purchase-orders/purchase-orders.service';
import { ExpenseFlowService } from '../../expenses/expense-flow/expense-flow.service';
import { PayrollFlowService } from '../../payroll/payroll-runs/payroll-flow.service';
import { InventoryAdjustmentsService } from '../../inventory/adjustments/inventory-adjustments.service';
import { CreditNotesService } from '../../invoicing/credit-notes/credit-notes.service';
import { InvoiceFlowService } from '../../invoicing/invoice-flow/invoice-flow.service';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';

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
      context: expect.objectContaining({ quantity_change: -40 }),
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
});
