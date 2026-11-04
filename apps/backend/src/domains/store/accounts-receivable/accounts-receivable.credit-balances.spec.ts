import {
  AccountsReceivableService,
  AR_INITIAL_PAYMENT_REFERENCE,
} from './accounts-receivable.service';
import { lockOrderLifecycle } from '../orders/order-flow/order-lifecycle-lock.util';

jest.mock('../orders/order-flow/order-lifecycle-lock.util', () => ({
  lockOrderLifecycle: jest.fn(),
}));

const lifecycleLock = lockOrderLifecycle as jest.Mock;

/**
 * QUI-979 — la CxC de una venta a crédito nace de la obligación real y los
 * abonos fraccionados mueven AMBOS ledgers (CxC + orden).
 *
 * Antes: `original_amount = grand_total` con `paid_amount = 0` — con cuota
 * inicial o con interés la cuenta NUNCA cerraba (saldo fantasma) por más
 * abonos que entraran. Y los abonos del módulo CxC no tocaban
 * `orders.total_paid/remaining_balance`, así que el POS validaba contra un
 * saldo viejo y el tiquete lo imprimía.
 */
describe('AccountsReceivableService — saldos de crédito (QUI-979)', () => {
  beforeEach(() => jest.resetAllMocks());

  const orderRow = (over: any = {}) => ({
    id: 42,
    store_id: 7,
    customer_id: 9,
    order_number: 'POS-0042',
    grand_total: 100000,
    total_paid: 0,
    remaining_balance: 100000,
    total_with_interest: null,
    stores: { organization_id: 3 },
    ...over,
  });

  function setupCreate(order: any, succeededPayments: any[] = []) {
    const tx = {
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
      accounts_receivable: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => ({ id: 55, ...data })),
      },
      order_installments: { findFirst: jest.fn().mockResolvedValue(null) },
      payments: { findMany: jest.fn().mockResolvedValue(succeededPayments) },
      ar_payments: { create: jest.fn().mockResolvedValue({ id: 80 }) },
    };
    const prisma = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({ id: 42, store_id: 7 }),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = new AccountsReceivableService(
      prisma as any,
      { emit: jest.fn() } as any,
      { recordModuleCashMovement: jest.fn() } as any,
    );
    return { tx, service };
  }

  it('crédito sin inicial ni interés: original = total, paid = 0, sin fila de historial', async () => {
    const { service, tx } = setupCreate(orderRow());
    lifecycleLock.mockResolvedValue({ id: 42, state: 'created' });

    const ar = await service.createCreditSaleFromEvent({
      order_id: 42,
      store_id: 7,
      total_amount: 100000,
    });

    expect(tx.accounts_receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        original_amount: 100000,
        paid_amount: 0,
        balance: 100000,
      }),
    });
    expect(tx.ar_payments.create).not.toHaveBeenCalled();
    expect(ar).toMatchObject({ id: 55 });
  });

  it('crédito con inicial: paid = inicial, saldo = financiado, historial enlazado al pago POS', async () => {
    const initial = {
      id: 11,
      paid_at: new Date('2026-08-27T14:15:00.000Z'),
      gateway_response: { metadata: { is_initial_credit_payment: true } },
      store_payment_method: {
        display_name: null,
        system_payment_method: { display_name: 'Efectivo' },
      },
    };
    const { service, tx } = setupCreate(
      orderRow({
        total_paid: 20000,
        remaining_balance: 80000,
        total_with_interest: 100000,
      }),
      [initial],
    );
    lifecycleLock.mockResolvedValue({ id: 42, state: 'created' });

    await service.createCreditSaleFromEvent({
      order_id: 42,
      store_id: 7,
      total_amount: 100000,
    });

    expect(tx.accounts_receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        original_amount: 100000,
        paid_amount: 20000,
        balance: 80000,
      }),
    });
    // Enlazada al pago POS: el historial del tiquete no la duplica.
    expect(tx.ar_payments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accounts_receivable_id: 55,
        payment_id: 11,
        amount: 20000,
        payment_method: 'Efectivo',
        reference: AR_INITIAL_PAYMENT_REFERENCE,
      }),
    });
  });

  it('dashboard: "cobrado este mes" excluye la cuota inicial (ya es venta POS)', async () => {
    const empty = { _sum: { balance: null }, _count: 0 };
    const prisma = {
      accounts_receivable: { aggregate: jest.fn().mockResolvedValue(empty) },
      ar_payments: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 50000 } }),
      },
    };
    const service = new AccountsReceivableService(
      prisma as any,
      { emit: jest.fn() } as any,
      { recordModuleCashMovement: jest.fn() } as any,
    );

    const result = await service.getDashboard();

    expect(result.collected_this_month).toBe(50000);
    expect(prisma.ar_payments.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: [
          { reference: null },
          { reference: { not: AR_INITIAL_PAYMENT_REFERENCE } },
        ],
      }),
      _sum: { amount: true },
    });
  });

  it('crédito con interés: la obligación incluye el interés', async () => {
    const { service, tx } = setupCreate(
      orderRow({
        total_paid: 0,
        remaining_balance: 105000,
        total_with_interest: 105000,
      }),
    );
    lifecycleLock.mockResolvedValue({ id: 42, state: 'created' });

    await service.createCreditSaleFromEvent({
      order_id: 42,
      store_id: 7,
      total_amount: 100000,
    });

    expect(tx.accounts_receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        original_amount: 105000,
        paid_amount: 0,
        balance: 105000,
      }),
    });
  });

  function setupPayment(ar: any) {
    const tx = {
      accounts_receivable: {
        findFirst: jest.fn().mockResolvedValue(ar),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) => ({ ...ar, ...data })),
      },
      ar_payments: { create: jest.fn().mockResolvedValue({ id: 80 }) },
      orders: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ total_paid: 20000, remaining_balance: 80000 }),
        update: jest.fn().mockResolvedValue({}),
      },
      order_installments: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      agreement_installments: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      accounts_receivable: { findFirst: jest.fn().mockResolvedValue(ar) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = new AccountsReceivableService(
      prisma as any,
      { emit: jest.fn() } as any,
      { recordModuleCashMovement: jest.fn() } as any,
    );
    return { tx, service };
  }

  const creditAr = {
    id: 55,
    store_id: 7,
    source_id: 42,
    source_type: 'credit_sale',
    original_amount: 100000,
    paid_amount: 20000,
    cancelled_amount: 0,
    balance: 80000,
    status: 'partial',
  };

  it('abono CxC mueve el ledger de la orden (total_paid + saldo)', async () => {
    const { service, tx } = setupPayment(creditAr);
    lifecycleLock.mockResolvedValue({ id: 42, state: 'created' });

    await service.registerPayment(55, { amount: 30000 } as any, 9);

    expect(tx.accounts_receivable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paid_amount: 50000,
          balance: 50000,
          status: 'partial',
        }),
      }),
    );
    expect(tx.orders.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { total_paid: 50000, remaining_balance: 50000 },
    });
  });

  it('abono ligado a pago POS no duplica la escritura en la orden', async () => {
    const { service, tx } = setupPayment(creditAr);
    lifecycleLock.mockResolvedValue({ id: 42, state: 'created' });

    await service.registerPayment(
      55,
      { amount: 30000, payment_id: 12 } as any,
      9,
    );

    expect(tx.accounts_receivable.update).toHaveBeenCalled();
    // El carril POS (`registerCreditPayment`) ya escribió la orden.
    expect(tx.orders.update).not.toHaveBeenCalled();
    expect(tx.order_installments.findMany).not.toHaveBeenCalled();
  });

  it('abono CxC distribuye en cuotas pendientes por número ascendente', async () => {
    const { service, tx } = setupPayment(creditAr);
    lifecycleLock.mockResolvedValue({ id: 42, state: 'created' });
    (tx.order_installments.findMany as jest.Mock).mockResolvedValue([
      {
        id: 1,
        installment_number: 1,
        state: 'pending',
        amount_paid: 0,
        remaining_balance: 20000,
      },
      {
        id: 2,
        installment_number: 2,
        state: 'pending',
        amount_paid: 0,
        remaining_balance: 20000,
      },
    ]);
    await service.registerPayment(55, { amount: 30000 } as any, 9);

    expect(tx.order_installments.update).toHaveBeenCalledTimes(2);
    expect(tx.order_installments.update).toHaveBeenNthCalledWith(1, {
      where: { id: 1 },
      data: expect.objectContaining({
        amount_paid: 20000,
        remaining_balance: 0,
        state: 'paid',
      }),
    });
    expect(tx.order_installments.update).toHaveBeenNthCalledWith(2, {
      where: { id: 2 },
      data: expect.objectContaining({
        amount_paid: 10000,
        remaining_balance: 10000,
        state: 'partial',
      }),
    });
  });
});
