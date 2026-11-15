import { LayawayService } from './layaway.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * QUI-893 B2 — cancelling a layaway with money to give back makes the cashier
 * choose how it is returned: cash leaves their drawer (gate + cash_out),
 * transfer/card leave an informative row (per track_non_cash_payments) and
 * wallet credits the customer's balance. The accounting entry follows the
 * method actually used.
 */
describe('LayawayService.cancel — refund method (QUI-893 B2)', () => {
  const PLAN = {
    id: 12,
    plan_number: 'LAY-0012',
    store_id: 10,
    customer_id: 3,
    state: 'active',
    paid_amount: 60000,
  };

  const build = (opts: { plan?: Partial<typeof PLAN>; userId?: number | null } = {}) => {
    const plan = { ...PLAN, ...opts.plan };
    const tx = {
      layaway_plans: {
        findUnique: jest.fn().mockResolvedValue(plan),
        update: jest.fn().mockResolvedValue({}),
      },
      layaway_installments: { updateMany: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      layaway_plans: { findUnique: jest.fn().mockResolvedValue(plan) },
    };
    const stockLevelManager = {
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    const eventEmitter = { emit: jest.fn() };
    const movements = { recordModuleCashMovement: jest.fn().mockResolvedValue({ id: 1 }) };
    const sessions = { assertSessionForSales: jest.fn().mockResolvedValue(undefined) };
    const wallet = { creditInTransaction: jest.fn().mockResolvedValue({ wallet_id: 4 }) };
    const service = new LayawayService(
      prisma as never,
      stockLevelManager as never,
      eventEmitter as never,
      movements as never,
      sessions as never,
      wallet as never,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 10,
      user_id: opts.userId === undefined ? 9 : opts.userId,
      organization_id: 1,
    } as never);
    return { service, tx, prisma, eventEmitter, movements, sessions, wallet };
  };

  const cancelledEvent = (eventEmitter: { emit: jest.Mock }) =>
    eventEmitter.emit.mock.calls.find(([name]) => name === 'layaway.cancelled')?.[1];

  afterEach(() => jest.restoreAllMocks());

  it('requires a refund method when there is money to give back, before touching anything', async () => {
    const { service, prisma, tx, sessions } = build();
    const call = service.cancel(12, { cancellation_reason: 'cliente desiste' });
    await expect(call).rejects.toBeInstanceOf(VendixHttpException);
    await call.catch((error: VendixHttpException) => {
      expect(error.errorCode).toBe('LAY_REFUND_METHOD_REQUIRED_001');
      expect(error.getStatus()).toBe(400);
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.layaway_plans.update).not.toHaveBeenCalled();
    expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
  });

  it('cash without an open drawer is blocked before the transaction', async () => {
    const { service, prisma, sessions } = build();
    sessions.assertSessionForSales.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
    );
    await expect(
      service.cancel(12, { cancellation_reason: 'x', refund_method: 'cash' }),
    ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_REQUIRED_001' });
    expect(sessions.assertSessionForSales).toHaveBeenCalledWith(9);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cash records a cash_out in the canceller drawer and the event carries the method', async () => {
    const { service, tx, movements, wallet, eventEmitter } = build();
    await service.cancel(12, { cancellation_reason: 'x', refund_method: 'cash' });
    expect(movements.recordModuleCashMovement).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        store_id: 10,
        user_id: 9,
        direction: 'out',
        amount: 60000,
        payment_method: 'cash',
        source_type: 'layaway_cancel_refund',
        source_id: 12,
        include_non_cash: true,
      }),
    );
    expect(wallet.creditInTransaction).not.toHaveBeenCalled();
    expect(cancelledEvent(eventEmitter)).toEqual(
      expect.objectContaining({ refund_amount: 60000, refund_method: 'cash', user_id: 9 }),
    );
  });

  it('a retained fee lowers the cash refund to what actually leaves', async () => {
    const { service, movements, eventEmitter } = build();
    await service.cancel(12, {
      cancellation_reason: 'x',
      cancellation_fee: 10000,
      refund_method: 'cash',
    });
    expect(movements.recordModuleCashMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 50000 }),
    );
    expect(cancelledEvent(eventEmitter)).toEqual(
      expect.objectContaining({ refund_amount: 50000, cancellation_fee: 10000 }),
    );
  });

  it.each(['bank_transfer', 'card'] as const)(
    '%s leaves an informative row (the helper applies track_non_cash_payments) without the cash gate',
    async (method) => {
      const { service, tx, movements, sessions } = build();
      await service.cancel(12, { cancellation_reason: 'x', refund_method: method });
      expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
      expect(movements.recordModuleCashMovement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          direction: 'out',
          payment_method: method,
          source_type: 'layaway_cancel_refund',
          include_non_cash: true,
        }),
      );
    },
  );

  it('wallet credits the customer balance inside the transaction and never touches the drawer', async () => {
    const { service, tx, movements, sessions, wallet } = build();
    await service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' });
    expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
    expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
    expect(wallet.creditInTransaction).toHaveBeenCalledWith(
      tx,
      3,
      60000,
      expect.objectContaining({
        reference_type: 'layaway_cancel_refund',
        reference_id: 12,
        created_by: 9,
      }),
    );
  });

  it('nothing paid: no method needed, no money movement', async () => {
    const { service, movements, wallet, sessions, tx } = build({ plan: { paid_amount: 0 } });
    await service.cancel(12, { cancellation_reason: 'x' });
    expect(tx.layaway_plans.update).toHaveBeenCalled();
    expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
    expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
    expect(wallet.creditInTransaction).not.toHaveBeenCalled();
  });

  it('full fee retained (refund 0): no method needed', async () => {
    const { service, movements } = build();
    await service.cancel(12, { cancellation_reason: 'x', cancellation_fee: 60000 });
    expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
  });
});
