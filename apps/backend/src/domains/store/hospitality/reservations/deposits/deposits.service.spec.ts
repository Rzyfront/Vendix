import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { LodgingDepositsService } from './deposits.service';

interface Row {
  id: number;
  store_id: number;
  reservation_id: number;
  kind: 'received' | 'applied' | 'retained';
  status: 'pending' | 'completed' | 'cancelled';
  amount: number;
  method?: string | null;
  request_id?: string | null;
  payment_link_id?: number | null;
  wallet_transaction_id?: number | null;
}

/**
 * H3.5 — reservation H-0001 (Doble, 3 nights, $750.000) of holder 9 asks a
 * 30 % deposit ($225.000). Store 3 uses the cash register.
 */
function build(options: { status?: string; walletBalance?: number } = {}) {
  const rows: Row[] = [];
  const reservation = {
    id: 1,
    reservation_number: 'H-0001',
    status: options.status ?? 'confirmed',
    customer_id: 9,
    total_amount: new Prisma.Decimal(750000),
    cancellation_penalty_amount: null as Prisma.Decimal | null,
    cancellation_penalty_detail: null as string | null,
    rooms: [{ deposit_percent: new Prisma.Decimal(30), total_amount: new Prisma.Decimal(750000), cancelled_at: null }],
  };
  const wallet = { id: 60, balance: options.walletBalance ?? 0, held_balance: 0 };
  const movements: Array<Record<string, unknown>> = [];
  const match = (row: Row, where: any) =>
    Object.entries(where ?? {}).every(([key, value]) => (row as any)[key] === value);

  const lodging_deposits = {
    findFirst: jest.fn(async ({ where }: any) => {
      const row = rows.find((r) => match(r, where));
      if (!row) return null;
      return { ...row, reservation: { id: 1, reservation_number: 'H-0001', customer_id: 9 } };
    }),
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter((r) => match(r, where)).map((r) => ({ ...r, created_at: new Date(), payment_link: null })),
    ),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: 40 + rows.length, ...data, amount: Number(data.amount) } as Row;
      rows.push(row);
      return { id: row.id, amount: row.amount };
    }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const ids: number[] = where.id?.in ?? [where.id];
      const hit = rows.filter((r) => ids.includes(r.id) && r.status === where.status);
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
  };
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 1 }]),
    lodging_deposits,
    cash_register_movements: { create: jest.fn(async ({ data }: any) => movements.push(data)) },
    wallets: { findFirst: jest.fn(async () => ({ ...wallet })) },
  };
  const prisma = {
    lodging_deposits,
    lodging_reservations: { findFirst: jest.fn(async () => reservation) },
    wallets: { findFirst: jest.fn(async () => ({ ...wallet })) },
    store_payment_methods: {
      findFirst: jest.fn(async () => ({ id: 4, system_payment_method: { type: 'cash' } })),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  let walletTx = 900;
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
  const cashSessions = {
    assertSessionForSales: jest.fn(async () => undefined),
    getActiveSession: jest.fn(async () => ({ id: 30 })),
  };
  const recordModuleCashMovement = jest.fn(async (_tx: unknown, data: any) => {
    movements.push({ session_id: 30, type: 'cash_in', amount: new Prisma.Decimal(data.amount), payment_method: data.payment_method, source_type: data.source_type, source_id: data.source_id });
    return { id: 1 };
  });
  const movementsService = { recordModuleCashMovement };
  const paymentLinks = {
    create: jest.fn(async () => ({ success: true, data: { id: 77, checkout_url: 'https://checkout.wompi.co/l/abc' } })),
    deactivate: jest.fn(async () => ({})),
  };
  const eventEmitter = { emit: jest.fn() };
  const storeContextRunner = { runInStoreContext: jest.fn(async (_store: number, fn: () => unknown) => fn()) };

  const service = new LodgingDepositsService(
    prisma as any,
    wallets as any,
    walletBalance as any,
    cashSessions as any,
    movementsService as any,
    paymentLinks as any,
    eventEmitter as any,
    storeContextRunner as any,
  );
  return { service, rows, reservation, wallet, movements, walletBalance, paymentLinks, eventEmitter, tx, prisma, recordModuleCashMovement, cashSessions };
}

async function errorOf(promise: Promise<unknown>): Promise<VendixHttpException> {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected the deposit operation to fail');
}

const request_id = 'dep-0001-abcd';

describe('LodgingDepositsService (H3.5)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3, user_id: 42 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('collecting at the desk', () => {
    it('a cash deposit credits the wallet, enters the register and is booked as an advance', async () => {
      const { service, rows, wallet, movements, eventEmitter, prisma } = build();

      const summary = await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      expect(summary.received).toBe(225000);
      expect(summary.balance).toBe(225000);
      expect(summary.required).toEqual({ percent: '30', amount: '225000.00' });
      expect(summary.pending).toBe(0);
      expect(rows).toEqual([
        expect.objectContaining({ kind: 'received', status: 'completed', amount: 225000, method: 'cash', request_id }),
      ]);
      expect(wallet.balance).toBe(225000);
      expect(movements).toEqual([
        expect.objectContaining({ session_id: 30, type: 'cash_in', amount: new Prisma.Decimal(225000), payment_method: 'cash' }),
      ]);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'lodging.deposit.received',
        expect.objectContaining({ store_id: 3, deposit_id: rows[0].id, amount: 225000, payment_method_type: 'cash', customer_id: 9 }),
      );
      // A deposit is never a sale: no payment.received, no folio payment.
      expect(eventEmitter.emit).not.toHaveBeenCalledWith('payment.received', expect.anything());
      expect(eventEmitter.emit.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.$transaction.mock.invocationCallOrder.at(-1)!,
      );
    });

    it('B12: the cash movement is recorded inside the deposit tx, not from a session read outside', async () => {
      const { service, rows, tx, recordModuleCashMovement, cashSessions } = build();

      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      expect(recordModuleCashMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          store_id: 3,
          user_id: 42,
          direction: 'in',
          amount: 225000,
          payment_method: 'cash',
          source_type: 'lodging_deposit',
          source_id: rows[0].id,
        }),
      );
      expect(cashSessions.getActiveSession).not.toHaveBeenCalled();
    });

    it('B12: a register closed meanwhile rejects the movement and no deposit event goes out', async () => {
      const { service, eventEmitter, recordModuleCashMovement } = build();
      recordModuleCashMovement.mockRejectedValueOnce(new Error('La sesión de caja ya no está abierta'));

      await expect(service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id })).rejects.toThrow(
        'ya no está abierta',
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('a double click registers the deposit once', async () => {
      const { service, rows, eventEmitter } = build();

      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });
      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      expect(rows).toHaveLength(1);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('after check-in the guest pays the folio instead (D3)', async () => {
      const { service, rows } = build({ status: 'checked_in' });

      const error = await errorOf(service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_DEPOSIT_001.code);
      expect(rows).toHaveLength(0);
    });

    it('rejects a deposit above the reservation total', async () => {
      const { service, rows } = build();

      const error = await errorOf(service.collect(1, { amount: 800000, store_payment_method_id: 4, request_id }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_DEPOSIT_001.code);
      expect(rows).toHaveLength(0);
    });
  });

  describe('Wompi payment link', () => {
    it('stays pending until Wompi confirms, then credits the wallet once', async () => {
      const { service, rows, wallet, eventEmitter, paymentLinks } = build();

      const created = await service.createLink(1, { amount: 225000 });
      expect(paymentLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount_in_cents: 22500000, single_use: true, name: 'Depósito reserva H-0001' }),
      );
      expect(created.received).toBe(0);
      expect(rows[0]).toMatchObject({ status: 'pending', method: 'wompi_link', payment_link_id: 77 });

      await service.onPaymentLinkPaid({ payment_link_id: 77, store_id: 3 });
      await service.onPaymentLinkPaid({ payment_link_id: 77, store_id: 3 }); // repeated webhook

      expect(rows[0].status).toBe('completed');
      expect(wallet.balance).toBe(225000);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'lodging.deposit.received',
        expect.objectContaining({ amount: 225000, payment_method_type: 'wompi' }),
      );
      expect((await service.summary(1)).received).toBe(225000);
    });
  });

  describe('Wompi payment link — cap and lifecycle', () => {
    it('a pending link reserves its share: a second link for the full total is rejected', async () => {
      const { service, rows, paymentLinks } = build();
      await service.createLink(1, { amount: 750000, request_id: 'link-0001-abcd' });

      const error = await errorOf(service.createLink(1, { amount: 750000, request_id: 'link-0002-abcd' }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_DEPOSIT_001.code);
      expect(paymentLinks.create).toHaveBeenCalledTimes(1);
      expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
    });

    it('a double click with the same request_id creates one link', async () => {
      const { service, rows, paymentLinks } = build();
      await service.createLink(1, { amount: 225000, request_id: 'link-0001-abcd' });
      await service.createLink(1, { amount: 225000, request_id: 'link-0001-abcd' });

      expect(paymentLinks.create).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });

    it('a link Wompi did not create frees the cap', async () => {
      const { service, rows, paymentLinks } = build();
      paymentLinks.create.mockRejectedValueOnce(new Error('Wompi down'));

      const error = await errorOf(service.createLink(1, { amount: 750000 }));

      expect(error.errorCode).toBe(ErrorCodes.LODGING_DEPOSIT_001.code);
      expect(rows[0].status).toBe('cancelled');
      await service.createLink(1, { amount: 750000 });
      expect(rows[1]).toMatchObject({ status: 'pending', payment_link_id: 77 });
    });

    it('cancelling the reservation cancels its pending links; a late payment is not credited', async () => {
      const { service, rows, tx, paymentLinks, wallet, eventEmitter } = build();
      await service.createLink(1, { amount: 225000 });

      const links = await service.cancelPendingLinksInTx(tx as any, 1);
      await service.deactivateLinks(links);
      const credited = await service.completeLinkDeposit(77);

      expect(links).toEqual([77]);
      expect(paymentLinks.deactivate).toHaveBeenCalledWith(77);
      expect(rows[0].status).toBe('cancelled');
      expect(credited).toBe(false);
      expect(wallet.balance).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('cancellation penalty', () => {
    it('retains the deposit up to the penalty: "retenido $225.000 · por cobrar $25.000"', async () => {
      const { service, rows, wallet, tx, reservation } = build();
      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      const event = await service.retainInTx(tx as any, {
        store_id: 3,
        reservation_id: 1,
        reservation_number: 'H-0001',
        customer_id: 9,
        penalty: new Prisma.Decimal(250000),
        user_id: 42,
      });
      reservation.status = 'cancelled';
      reservation.cancellation_penalty_amount = new Prisma.Decimal(250000);
      reservation.cancellation_penalty_detail = '1 noche';

      expect(event).toMatchObject({ amount: 225000, reservation_number: 'H-0001' });
      expect(rows.at(-1)).toMatchObject({ kind: 'retained', amount: 225000 });
      expect(wallet.balance).toBe(0);
      expect((await service.summary(1)).settlement).toEqual({
        penalty: 250000,
        penalty_detail: '1 noche',
        retained: 225000,
        to_collect: 25000,
        to_refund: 0,
      });
    });

    it('a smaller penalty leaves the rest "por devolver" in the wallet', async () => {
      const { service, wallet, tx, reservation } = build();
      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      await service.retainInTx(tx as any, {
        store_id: 3,
        reservation_id: 1,
        reservation_number: 'H-0001',
        customer_id: 9,
        penalty: new Prisma.Decimal(100000),
        user_id: 42,
      });
      reservation.status = 'cancelled';
      reservation.cancellation_penalty_amount = new Prisma.Decimal(100000);

      expect(wallet.balance).toBe(125000);
      expect((await service.summary(1)).settlement).toMatchObject({ retained: 100000, to_collect: 0, to_refund: 125000 });
    });

    it('the cancel dialog quotes the same split before cancelling', async () => {
      const { service, rows } = build();
      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      const quote = await service.quoteSettlement(1, new Prisma.Decimal(250000));

      expect(quote).toEqual({
        deposit_balance: '225000.00',
        deposit_retained: '225000.00',
        to_collect: '25000.00',
        to_refund: '0.00',
      });
      expect(rows).toHaveLength(1); // a quote writes nothing
    });

    it('the quote is capped by what the wallet still has free (same as the retention)', async () => {
      const { service, wallet } = build();
      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });
      wallet.balance = 100000; // the holder spent part of it in the POS

      const quote = await service.quoteSettlement(1, new Prisma.Decimal(250000));

      expect(quote).toMatchObject({ deposit_retained: '100000.00', to_collect: '150000.00' });
    });

    it('a free cancellation retains nothing', async () => {
      const { service, rows, tx, walletBalance } = build();
      await service.collect(1, { amount: 225000, store_payment_method_id: 4, request_id });

      const event = await service.retainInTx(tx as any, {
        store_id: 3,
        reservation_id: 1,
        reservation_number: 'H-0001',
        customer_id: 9,
        penalty: null,
        user_id: 42,
      });

      expect(event).toBeNull();
      expect(rows).toHaveLength(1);
      expect(walletBalance.debitInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('online payment of a cancelled reservation (H6.6)', () => {
    const onlineTx = (rows: Record<string, any>[]) => ({
      lodging_reservation_payments: {
        findMany: jest.fn(async () => rows.map((row) => ({ ...row }))),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id)!;
          row.retained_amount = new Prisma.Decimal(row.retained_amount).add(data.retained_amount.increment);
          return row;
        }),
      },
    });
    const input = {
      store_id: 3,
      reservation_id: 1,
      reservation_number: 'H-0001',
      customer_id: 9,
      user_id: 42,
    };

    it('keeps the penalty from the web payment (no wallet) and leaves the rest "por devolver"', async () => {
      const { service, walletBalance, eventEmitter } = build();
      const rows = [{ id: 7, amount: new Prisma.Decimal(300000), applied_amount: 0, retained_amount: 0 }];
      const tx = onlineTx(rows);

      const settlement = await service.settleOnlinePaymentsInTx(tx as any, {
        ...input,
        penalty: new Prisma.Decimal(100000),
      });

      expect(settlement).toEqual({
        retained: [
          { store_id: 3, reservation_payment_id: 7, reservation_number: 'H-0001', amount: 100000, customer_id: 9, user_id: 42 },
        ],
        retained_total: 100000,
        owed: 200000,
      });
      expect(Number(rows[0].retained_amount)).toBe(100000);
      expect(walletBalance.debitInTransaction).not.toHaveBeenCalled();
      // Booked only after the status change commits.
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      service.announceOnlineRetained(settlement.retained);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'lodging.reservation_payment.retained',
        expect.objectContaining({ reservation_payment_id: 7, amount: 100000 }),
      );
    });

    it('without a penalty nothing is kept: the whole open payment is owed back', async () => {
      const { service } = build();
      const tx = onlineTx([
        { id: 7, amount: new Prisma.Decimal(300000), applied_amount: 50000, retained_amount: 0 },
      ]);

      const settlement = await service.settleOnlinePaymentsInTx(tx as any, {
        ...input,
        penalty: new Prisma.Decimal(0),
      });

      expect(settlement).toEqual({ retained: [], retained_total: 0, owed: 250000 });
      expect(tx.lodging_reservation_payments.update).not.toHaveBeenCalled();
    });
  });
});
