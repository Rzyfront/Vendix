import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { ServiceDepositsService } from './service-deposits.service';

interface Row {
  id: number;
  store_id: number;
  booking_id: number | null;
  session_id: number | null;
  customer_id: number;
  kind: 'received' | 'applied' | 'refunded' | 'released';
  status: 'pending' | 'completed' | 'cancelled';
  amount: number;
  method?: string | null;
  request_id: string;
  payment_request_id?: number | null;
  wallet_transaction_id?: number | null;
  payment_id?: number | null;
}

const match = (row: any, where: any): boolean =>
  Object.entries(where ?? {}).every(([key, value]) => {
    if (key === 'OR') return (value as any[]).some((w) => match(row, w));
    if (value && typeof value === 'object' && 'in' in (value as any)) return (value as any).in.includes(row[key]);
    return row[key] === value;
  });

/**
 * Store 3, customer 9, a cava booking 70 with a $400.000 cash deposit.
 * The wallet of the customer holds `walletBalance`.
 */
function build(options: { walletBalance?: number; orderGrand?: number; orderPaid?: number } = {}) {
  const rows: Row[] = [];
  const wallet = { id: 60, store_id: 3, customer_id: 9, balance: options.walletBalance ?? 0, held_balance: 0 };
  const order = {
    id: 500,
    store_id: 3,
    organization_id: 1,
    customer_id: 9,
    order_number: 'SVC-500',
    currency: 'COP',
    grand_total: new Prisma.Decimal(options.orderGrand ?? 250000),
    subtotal_amount: new Prisma.Decimal(options.orderGrand ?? 250000),
    tip_amount: new Prisma.Decimal(0),
    total_paid: new Prisma.Decimal(options.orderPaid ?? 0),
    payments: [] as Array<{ amount: Prisma.Decimal; state: string }>,
  };
  if (options.orderPaid) order.payments.push({ amount: new Prisma.Decimal(options.orderPaid), state: 'succeeded' });
  const orderUpdates: any[] = [];
  const payments: any[] = [];

  const service_deposits = {
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: 40 + rows.length, ...data, amount: Number(data.amount) } as Row;
      rows.push(row);
      return { id: row.id, amount: row.amount };
    }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
  };
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 500 }]),
    service_deposits,
    wallets: { findFirst: jest.fn(async () => ({ ...wallet })) },
    orders: {
      findUnique: jest.fn(async () => order),
      update: jest.fn(async (args: any) => orderUpdates.push(args)),
    },
    payments: {
      create: jest.fn(async ({ data }: any) => {
        const payment = { id: 900 + payments.length, ...data };
        payments.push(payment);
        return payment;
      }),
    },
  };
  const prisma = { service_deposits, $transaction: jest.fn(async (fn: any) => fn(tx)) };

  let walletTx = 800;
  const walletBalance = {
    creditInTransaction: jest.fn(async (_tx: unknown, _id: number, amount: number) => {
      wallet.balance += amount;
      return { transaction: { id: ++walletTx }, balance_after: wallet.balance };
    }),
    debitInTransaction: jest.fn(async (_tx: unknown, _id: number, amount: number) => {
      wallet.balance -= amount;
      return { transaction: { id: ++walletTx }, balance_after: wallet.balance };
    }),
  };
  const wallets = { getOrCreateWallet: jest.fn(async () => ({ id: 60 })) };
  const movements = { recordModuleCashMovement: jest.fn(async () => ({ id: 1 })) };
  const orderHistory = { record: jest.fn(async () => ({ id: 1 })) };
  const eventEmitter = { emit: jest.fn() };

  const service = new ServiceDepositsService(
    prisma as any,
    wallets as any,
    walletBalance as any,
    movements as any,
    orderHistory as any,
    eventEmitter as any,
  );
  return { service, rows, wallet, order, orderUpdates, payments, tx: tx as any, walletBalance, wallets, movements, orderHistory, eventEmitter };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the operation to fail');
}

const receive = (service: ServiceDepositsService, tx: any, extra: Record<string, unknown> = {}) =>
  service.receiveInTx(tx, {
    store_id: 3,
    customer_id: 9,
    booking_id: 70,
    amount: 400000,
    method: 'cash',
    store_payment_method_id: 4,
    request_id: 'dep-1',
    user_id: 42,
    ...extra,
  });

describe('ServiceDepositsService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('receiving', () => {
    it('credits the wallet, writes a completed received row, enters the register and returns the event', async () => {
      const { service, tx, rows, wallet, movements } = build();

      const result = await receive(service, tx);

      expect(result.created).toBe(true);
      expect(wallet.balance).toBe(400000);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'received',
        status: 'completed',
        amount: 400000,
        booking_id: 70,
        customer_id: 9,
        method: 'cash',
        wallet_transaction_id: 801,
      });
      expect(movements.recordModuleCashMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ direction: 'in', amount: 400000, payment_method: 'cash', source_type: 'service_deposit' }),
      );
      expect(result.event).toMatchObject({
        store_id: 3,
        deposit_id: rows[0].id,
        amount: 400000,
        payment_method_type: 'cash',
        customer_id: 9,
        booking_id: 70,
      });
    });

    it('a repeated request_id changes nothing and returns no event (double click)', async () => {
      const { service, tx, rows, wallet, walletBalance } = build();
      await receive(service, tx);

      const again = await receive(service, tx);

      expect(again.created).toBe(false);
      expect(again.event).toBeNull();
      expect(rows).toHaveLength(1);
      expect(wallet.balance).toBe(400000);
      expect(walletBalance.creditInTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a deposit without an identified customer', async () => {
      const { service, tx, rows } = build();
      const error = await errorOf(receive(service, tx, { customer_id: null }));
      expect(error.errorCode).toBe('SERVICE_DEPOSIT_002');
      expect(rows).toHaveLength(0);
    });

    it('rejects a zero amount', async () => {
      const { service, tx } = build();
      const error = await errorOf(receive(service, tx, { amount: 0 }));
      expect(error.errorCode).toBe('SERVICE_DEPOSIT_001');
    });

    it('a transfer deposit does not touch the register', async () => {
      const { service, tx, movements } = build();
      const result = await receive(service, tx, { method: 'bank_transfer' });
      expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
      expect(result.event?.payment_method_type).toBe('bank_transfer');
    });
  });

  describe('balance', () => {
    it('received - applied - refunded over the completed rows of the booking and its session', async () => {
      const { service, tx, rows } = build();
      await receive(service, tx);
      rows.push({ id: 99, store_id: 3, booking_id: null, session_id: 8, customer_id: 9, kind: 'applied', status: 'completed', amount: 150000, request_id: 'a' });
      rows.push({ id: 98, store_id: 3, booking_id: 70, session_id: null, customer_id: 9, kind: 'received', status: 'pending', amount: 50000, request_id: 'p' });

      expect(await service.balanceOf({ bookingId: 70, sessionId: 8 })).toMatchObject({
        received: 400000,
        applied: 150000,
        refunded: 0,
        balance: 250000,
      });
      expect(await service.balanceOf({ bookingId: 70 })).toMatchObject({ balance: 400000 });
    });

    it('linking a booking to its session moves the booking deposits to the session', async () => {
      const { service, tx, rows } = build();
      await receive(service, tx);

      await service.linkBookingToSessionInTx(tx, 70, 8);

      expect(rows[0]).toMatchObject({ booking_id: 70, session_id: 8 });
      expect(await service.balanceOf({ sessionId: 8 })).toMatchObject({ balance: 400000 });
    });
  });

  describe('applying to an order', () => {
    it('applies min(deposit balance, order remaining, wallet available)', async () => {
      const { service, tx, rows, wallet, payments, orderUpdates, orderHistory } = build({ orderGrand: 250000 });
      await receive(service, tx);

      const result = await service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, session_id: 8, user_id: 42 });

      expect(result.applied).toBe(true);
      expect(result.amount).toBe(250000);
      expect(wallet.balance).toBe(150000);
      expect(payments[0]).toMatchObject({ order_id: 500, amount: 250000, state: 'succeeded' });
      expect(payments[0].transaction_id).toMatch(/^SVC-/);
      const applied = rows.find((r) => r.kind === 'applied')!;
      expect(applied).toMatchObject({ amount: 250000, payment_id: payments[0].id, status: 'completed', booking_id: 70, session_id: 8 });
      expect(orderUpdates[0].data.total_paid).toEqual({ increment: 250000 });
      expect(Number(orderUpdates[0].data.remaining_balance)).toBe(0);
      expect(orderHistory.record).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId: 500, type: 'payment_registered' }));
      expect(result.payment_received).toMatchObject({
        payment_id: payments[0].id,
        amount: 250000,
        accounting_method: 'wallet',
        order: expect.objectContaining({ id: 500, store_id: 3 }),
      });
      expect((await service.balanceOf({ bookingId: 70 })).balance).toBe(150000);
    });

    it('is capped by the deposit balance when the order is bigger', async () => {
      const { service, tx } = build({ orderGrand: 900000, walletBalance: 0 });
      await receive(service, tx);
      const result = await service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, user_id: 42 });
      expect(result.amount).toBe(400000);
    });

    it('is capped by what the wallet still has free', async () => {
      const { service, tx, wallet } = build({ orderGrand: 900000 });
      await receive(service, tx);
      wallet.balance = 100000; // the customer spent part of the credit elsewhere
      const result = await service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, user_id: 42 });
      expect(result.amount).toBe(100000);
    });

    it('is capped by the order remaining after earlier payments', async () => {
      const { service, tx } = build({ orderGrand: 250000, orderPaid: 100000 });
      await receive(service, tx);
      const result = await service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, user_id: 42 });
      expect(result.amount).toBe(150000);
    });

    it('with nothing to apply it changes nothing (non strict)', async () => {
      const { service, tx, payments, walletBalance } = build();
      const result = await service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, user_id: 42 });
      expect(result).toMatchObject({ applied: false, amount: 0, payment_received: null });
      expect(payments).toHaveLength(0);
      expect(walletBalance.debitInTransaction).not.toHaveBeenCalled();
    });

    it('with nothing to apply and strict it says the deposit does not cover', async () => {
      const { service, tx } = build();
      const error = await errorOf(
        service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, user_id: 42, strict: true }),
      );
      expect(error.errorCode).toBe('SERVICE_DEPOSIT_004');
    });

    it('debits the wallet of the order customer in this store', async () => {
      const { service, tx, walletBalance } = build();
      await receive(service, tx);
      await service.applyToOrderInTx(tx, { store_id: 3, order_id: 500, booking_id: 70, user_id: 42 });
      expect(walletBalance.debitInTransaction).toHaveBeenCalledWith(
        tx,
        60,
        250000,
        expect.objectContaining({ expected_store_id: 3, expected_customer_id: 9 }),
      );
    });
  });

  describe('refund and release', () => {
    it('a cash refund debits the wallet, writes a refunded row, moves cash out and returns the event', async () => {
      const { service, tx, rows, wallet, movements } = build();
      await receive(service, tx);

      const result = await service.refundInTx(tx, {
        store_id: 3,
        customer_id: 9,
        booking_id: 70,
        amount: 150000,
        method: 'cash',
        request_id: 'ref-1',
        user_id: 42,
      });

      expect(wallet.balance).toBe(250000);
      expect(rows.find((r) => r.kind === 'refunded')).toMatchObject({ amount: 150000, status: 'completed', wallet_transaction_id: 802 });
      expect(movements.recordModuleCashMovement).toHaveBeenLastCalledWith(
        tx,
        expect.objectContaining({ direction: 'out', amount: 150000, payment_method: 'cash', source_type: 'service_deposit' }),
      );
      expect(result.event).toMatchObject({ amount: 150000, payment_method_type: 'cash', customer_id: 9 });
      expect((await service.balanceOf({ bookingId: 70 })).balance).toBe(250000);
    });

    it('cannot refund more than the deposit balance', async () => {
      const { service, tx, wallet } = build();
      await receive(service, tx);
      const error = await errorOf(
        service.refundInTx(tx, { store_id: 3, customer_id: 9, booking_id: 70, amount: 500000, method: 'cash', request_id: 'ref-2', user_id: 42 }),
      );
      expect(error.errorCode).toBe('SERVICE_DEPOSIT_004');
      expect(wallet.balance).toBe(400000);
    });

    it('a repeated refund request_id is a no-op', async () => {
      const { service, tx, rows } = build();
      await receive(service, tx);
      const input = { store_id: 3, customer_id: 9, booking_id: 70, amount: 100000, method: 'cash', request_id: 'ref-3', user_id: 42 };
      await service.refundInTx(tx, input);
      const again = await service.refundInTx(tx, input);
      expect(again.created).toBe(false);
      expect(again.event).toBeNull();
      expect(rows.filter((r) => r.kind === 'refunded')).toHaveLength(1);
    });

    it('releasing writes a released row only: the money stays as wallet credit and no event is due', async () => {
      const { service, tx, rows, wallet, walletBalance, movements } = build();
      await receive(service, tx);
      movements.recordModuleCashMovement.mockClear();

      const result = await service.releaseInTx(tx, { store_id: 3, customer_id: 9, session_id: 8, booking_id: 70, amount: 120000, request_id: 'rel-1', user_id: 42 });

      expect(result.created).toBe(true);
      expect(rows.find((r) => r.kind === 'released')).toMatchObject({ amount: 120000, status: 'completed' });
      expect(wallet.balance).toBe(400000);
      expect(walletBalance.debitInTransaction).not.toHaveBeenCalled();
      expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
      // Released money is free wallet credit now, no longer this deposit's balance.
      const balance = await service.balanceOfInTx(tx, { store_id: 3, bookingId: 70 });
      expect(balance.balance).toBe(280000);
    });
  });

  describe('pending request deposits', () => {
    it('a pending deposit is not money until it is completed, and completing twice credits once', async () => {
      const { service, tx, rows, wallet, walletBalance } = build();
      const pending = await service.createPendingInTx(tx, {
        store_id: 3,
        customer_id: 9,
        booking_id: 70,
        amount: 400000,
        method: 'wompi',
        payment_request_id: 15,
        request_id: 'req-15',
        user_id: null,
      });
      expect(rows[0]).toMatchObject({ kind: 'received', status: 'pending', payment_request_id: 15 });
      expect((await service.balanceOf({ bookingId: 70 })).balance).toBe(0);
      expect(wallet.balance).toBe(0);

      const first = await service.completePendingInTx(tx, { payment_request_id: 15 });
      const second = await service.completePendingInTx(tx, { deposit_id: pending.deposit.id });

      expect(first.claimed).toBe(true);
      expect(first.event).toMatchObject({ amount: 400000, payment_method_type: 'wompi', booking_id: 70, customer_id: 9 });
      expect(second).toMatchObject({ claimed: false, event: null, reason: 'already_completed' });
      expect(walletBalance.creditInTransaction).toHaveBeenCalledTimes(1);
      expect(wallet.balance).toBe(400000);
      expect(rows[0]).toMatchObject({ status: 'completed', wallet_transaction_id: 801 });
    });

    it('a cancelled pending deposit is not credited', async () => {
      const { service, tx, rows, wallet } = build();
      await service.createPendingInTx(tx, {
        store_id: 3, customer_id: 9, booking_id: 70, amount: 1000, method: 'wompi', payment_request_id: 16, request_id: 'req-16', user_id: null,
      });
      rows[0].status = 'cancelled';
      const result = await service.completePendingInTx(tx, { payment_request_id: 16 });
      expect(result).toMatchObject({ claimed: false, reason: 'cancelled' });
      expect(wallet.balance).toBe(0);
    });
  });

  describe('events', () => {
    it('announces received and refunded after commit', () => {
      const { service, eventEmitter } = build();
      const event = { store_id: 3, deposit_id: 1, amount: 10 } as any;
      service.announceReceived(event);
      service.announceRefunded(event);
      service.announceReceived(null);
      expect(eventEmitter.emit).toHaveBeenCalledWith('service_deposit.received', event);
      expect(eventEmitter.emit).toHaveBeenCalledWith('service_deposit.refunded', event);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    });
  });
});
