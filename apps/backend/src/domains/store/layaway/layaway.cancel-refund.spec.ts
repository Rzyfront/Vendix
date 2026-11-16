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

  const build = (
    opts: {
      plan?: Partial<typeof PLAN>;
      userId?: number | null;
      storeSettings?: Record<string, unknown> | null;
    } = {},
  ) => {
    const plan = { ...PLAN, ...opts.plan };
    const tx = {
      layaway_plans: {
        findUnique: jest.fn().mockResolvedValue(plan),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      layaway_installments: { updateMany: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      layaway_plans: { findUnique: jest.fn().mockResolvedValue(plan) },
      store_settings: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.storeSettings ? { settings: opts.storeSettings } : null,
          ),
      },
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
    expect(tx.layaway_plans.updateMany).not.toHaveBeenCalled();
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
    const { service, tx, prisma, movements, wallet, eventEmitter } = build();
    await service.cancel(12, { cancellation_reason: 'x', refund_method: 'cash' });
    // Explicit budget for the cancel transaction (the 5 s default expired).
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function), { timeout: 20_000, maxWait: 5_000 },
    );
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
    expect(tx.layaway_plans.updateMany).toHaveBeenCalled();
    expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
    expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
    expect(wallet.creditInTransaction).not.toHaveBeenCalled();
  });

  it('full fee retained (refund 0): no method needed', async () => {
    const { service, movements } = build();
    await service.cancel(12, { cancellation_reason: 'x', cancellation_fee: 60000 });
    expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
  });

  const cancelledEvents = (eventEmitter: { emit: jest.Mock }) =>
    eventEmitter.emit.mock.calls.filter(([name]) => name === 'layaway.cancelled');

  describe('cancelling twice (P1-1)', () => {
    it('the transition is conditional on a non-terminal state', async () => {
      const { service, tx } = build();
      await service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' });
      expect(tx.layaway_plans.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 12, state: { notIn: ['completed', 'cancelled'] } },
          data: expect.objectContaining({ state: 'cancelled' }),
        }),
      );
    });

    it('a second sequential cancel is rejected and the wallet is credited once', async () => {
      const { service, prisma, tx, wallet, eventEmitter } = build();
      await service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' });
      // The plan is now cancelled for every later read.
      const cancelled = { ...PLAN, state: 'cancelled' };
      prisma.layaway_plans.findUnique.mockResolvedValue(cancelled);
      tx.layaway_plans.findUnique.mockResolvedValue(cancelled);

      await expect(
        service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' }),
      ).rejects.toMatchObject({ errorCode: 'LAY_STATE_001' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(wallet.creditInTransaction).toHaveBeenCalledTimes(1);
      expect(cancelledEvents(eventEmitter)).toHaveLength(1);
    });

    it('two concurrent cancels: the loser of the conditional update rolls back without crediting', async () => {
      const { service, tx, wallet, eventEmitter, movements } = build();
      // Both requests read the plan as active; only one row transition wins.
      tx.layaway_plans.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const results = await Promise.allSettled([
        service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' }),
        service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected?.reason).toMatchObject({ errorCode: 'LAY_STATE_001' });
      expect(wallet.creditInTransaction).toHaveBeenCalledTimes(1);
      expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
      expect(cancelledEvents(eventEmitter)).toHaveLength(1);
    });

    it.each(['cancelled', 'completed'])(
      'a %s plan is rejected with LAY_STATE_001 before the transaction',
      async (state) => {
        const { service, prisma, wallet, sessions } = build({ plan: { state } });
        await expect(
          service.cancel(12, { cancellation_reason: 'x', refund_method: 'cash' }),
        ).rejects.toMatchObject({ errorCode: 'LAY_STATE_001' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
        expect(wallet.creditInTransaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('non-cash refund needs an open drawer when the store tracks it (P2-1)', () => {
    const tracking = (track: boolean, enabled = true) => ({
      pos: { cash_register: { enabled, track_non_cash_payments: track } },
    });

    it.each(['bank_transfer', 'card'] as const)(
      '%s without an open drawer is blocked before the transaction',
      async (method) => {
        const { service, prisma, sessions, movements } = build({
          storeSettings: tracking(true),
        });
        sessions.assertSessionForSales.mockRejectedValue(
          new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
        );
        await expect(
          service.cancel(12, { cancellation_reason: 'x', refund_method: method }),
        ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_REQUIRED_001' });
        expect(sessions.assertSessionForSales).toHaveBeenCalledWith(9);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(movements.recordModuleCashMovement).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['tracking off', tracking(false)],
      ['cash register off', tracking(true, false)],
    ])('%s: no drawer needed for a transfer refund', async (_label, settings) => {
      const { service, prisma, sessions } = build({ storeSettings: settings });
      await service.cancel(12, { cancellation_reason: 'x', refund_method: 'bank_transfer' });
      expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('wallet never asks for a drawer even when tracking is on', async () => {
      const { service, sessions } = build({ storeSettings: tracking(true) });
      await service.cancel(12, { cancellation_reason: 'x', refund_method: 'wallet' });
      expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
    });
  });
});
