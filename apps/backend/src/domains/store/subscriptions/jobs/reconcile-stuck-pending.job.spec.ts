// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models). Same reason
// as subscription-state.listener.spec.ts.
/// <reference types="jest" />
import { ReconcileStuckPendingJob } from './reconcile-stuck-pending.job';
import { SubscriptionStateService } from '../services/subscription-state.service';

/**
 * The legacy pass of this cron rescues subscriptions stranded in
 * `pending_payment` despite a `succeeded` payment — i.e. the customer paid and
 * is still locked out. It used to hand-roll `transition(storeId, 'active')`,
 * which throws for any source state whose TRANSITIONS row lacks `'active'`.
 * It now delegates to the single reactivation seam.
 */
describe('ReconcileStuckPendingJob — legacy stuck-payment pass', () => {
  const STORE_ID = 50;
  const SUB_ID = 100;
  const PAID_AT = new Date('2026-07-01T10:00:00.000Z');

  let ensureOperational: jest.Mock;
  let transitionInTx: jest.Mock;
  let job: ReconcileStuckPendingJob;

  const buildJob = (candidates: unknown[]) => {
    ensureOperational = jest
      .fn()
      .mockResolvedValue({ finalState: 'active', path: ['active'] });
    transitionInTx = jest.fn().mockResolvedValue(undefined);

    // Two passes call findMany with different filters. Discriminate on the
    // ADR-2 marker so the pending-change pass stays empty and only the legacy
    // pass under test returns rows.
    const findMany = jest.fn().mockImplementation(async ({ where }: any) => {
      const isAdr2Pass = where?.pending_change_invoice_id?.not === null;
      return isAdr2Pass ? [] : candidates;
    });

    const prisma: any = {
      withoutScope: () => ({
        store_subscriptions: { findMany },
        $transaction: jest.fn(),
      }),
    };

    job = new ReconcileStuckPendingJob(
      prisma,
      { ensureOperational, transitionInTx } as any,
      { confirmPendingChange: jest.fn() } as any,
    );
    return job;
  };

  const stuckCandidate = {
    id: SUB_ID,
    store_id: STORE_ID,
    invoices: [{ id: 900, payments: [{ id: 800, paid_at: PAID_AT }] }],
  };

  it('reactivates a subscription stuck in pending_payment through the seam', async () => {
    const j = buildJob([stuckCandidate]);

    await j.reconcile();

    expect(ensureOperational).toHaveBeenCalledTimes(1);
    const [storeId, ctx] = ensureOperational.mock.calls[0];
    expect(storeId).toBe(STORE_ID);
    expect(ctx.reason).toBe('webhook_state_drift');
    // A cron write must be attributable: `triggeredByJob` is what stamps the
    // subscription_events audit row with its origin.
    expect(ctx.triggeredByJob).toBe('cron_reconciliation');
    expect(ctx.payload.invoice_id).toBe(900);
    expect(ctx.payload.payment_id).toBe(800);
    expect(ctx.payload.succeeded_at).toBe(PAID_AT.toISOString());
    expect(ctx.payload.source).toBe('reconcile-stuck-pending-job');
  });

  it('tolerates an idempotent no-op result (another writer got there first)', async () => {
    const j = buildJob([stuckCandidate]);
    ensureOperational.mockResolvedValueOnce({
      finalState: 'active',
      path: [],
    });

    await expect(j.reconcile()).resolves.toBeUndefined();
    expect(ensureOperational).toHaveBeenCalledTimes(1);
  });

  it('keeps reconciling the remaining rows when one store fails', async () => {
    const second = {
      id: SUB_ID + 1,
      store_id: STORE_ID + 1,
      invoices: [{ id: 901, payments: [{ id: 801, paid_at: PAID_AT }] }],
    };
    const j = buildJob([stuckCandidate, second]);
    ensureOperational.mockRejectedValueOnce(new Error('exit guard tripped'));

    await expect(j.reconcile()).resolves.toBeUndefined();

    expect(ensureOperational).toHaveBeenCalledTimes(2);
    expect(ensureOperational.mock.calls[1][0]).toBe(STORE_ID + 1);
  });

  it('does nothing when no subscription is stuck', async () => {
    const j = buildJob([]);

    await j.reconcile();

    expect(ensureOperational).not.toHaveBeenCalled();
  });
});

/**
 * QUI-676 — ADR-2 scenario A: the invoice is still `issued` 60+ minutes later
 * because the Wompi webhook never arrived. The job voids the invoice and sends
 * the subscription back to `pending_revert_state`.
 *
 * This suite wires the REAL SubscriptionStateService instead of a mock, because
 * the defect lived in its TRANSITIONS map, not in the job: `pending_payment ->
 * trial` was not a legal edge, so the revert threw SUBSCRIPTION_010, the job
 * swallowed it into its per-subscription catch, and the cron re-failed every 5
 * minutes while the store stayed locked out (store 99 sat there 11 days).
 * A mocked state service cannot see that — it happily "reverts" to anything.
 */
describe('ReconcileStuckPendingJob — ADR-2 scenario A (webhook never arrived)', () => {
  const STORE_ID = 99;
  const SUB_ID = 60;
  const INVOICE_ID = 13;

  const buildScenarioA = (revertState: string | null) => {
    const startedAt = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);

    const sub = {
      id: SUB_ID,
      store_id: STORE_ID,
      state: 'pending_payment',
      pending_revert_state: revertState,
      pending_change_kind: 'trial_conversion',
      pending_change_invoice_id: INVOICE_ID,
      pending_change_started_at: startedAt,
      pending_change_invoice: {
        id: INVOICE_ID,
        state: 'issued',
        to_plan_id: 3,
        from_plan_id: null,
        change_kind: 'trial_conversion',
        store_subscription_id: SUB_ID,
      },
    };

    // Transaction client the state service actually writes through. The
    // FOR UPDATE probe reports the state production had.
    const tx: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: SUB_ID, state: 'pending_payment' }]),
      store_subscriptions: {
        update: jest.fn().mockResolvedValue({ id: SUB_ID, state: revertState }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: SUB_ID, state: 'pending_payment' }),
      },
      subscription_events: { create: jest.fn().mockResolvedValue({}) },
      subscription_invoices: { update: jest.fn().mockResolvedValue({}) },
    };

    const findMany = jest.fn().mockImplementation(async ({ where }: any) => {
      const isAdr2Pass = where?.pending_change_invoice_id?.not === null;
      return isAdr2Pass ? [sub] : [];
    });

    const prisma: any = {
      withoutScope: () => ({
        store_subscriptions: { findMany },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      }),
    };

    const stateService = new SubscriptionStateService(
      prisma,
      { invalidateCache: jest.fn().mockResolvedValue(undefined) } as any,
      { emit: jest.fn() } as any,
    );

    const job = new ReconcileStuckPendingJob(prisma, stateService as any, {
      confirmPendingChange: jest.fn(),
    } as any);

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    (job as any).logger = logger;

    return { job, tx, logger };
  };

  it('reverts a stuck trial conversion back to trial (real state machine)', async () => {
    const { job, tx, logger } = buildScenarioA('trial');

    await expect(job.reconcile()).resolves.toBeUndefined();

    // The invoice is voided…
    expect(tx.subscription_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVOICE_ID },
        data: expect.objectContaining({ state: 'void' }),
      }),
    );

    // …and the state actually moved back to trial. Two updates run: the job
    // clears the pending_* columns, then transitionInTx writes the state.
    const stateWrite = tx.store_subscriptions.update.mock.calls.find(
      ([arg]: any[]) => arg?.data?.state !== undefined,
    );
    expect(stateWrite).toBeDefined();
    expect(stateWrite[0].data.state).toBe('trial');

    const evt = tx.subscription_events.create.mock.calls[0][0];
    expect(evt.data.from_state).toBe('pending_payment');
    expect(evt.data.to_state).toBe('trial');
    expect(evt.data.triggered_by_job).toBe('reconcile-stuck-pending');

    // The per-subscription catch must not have fired: an "Illegal transition"
    // here is exactly the silent failure this ticket is about.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reverts a stuck first purchase back to draft', async () => {
    const { job, tx, logger } = buildScenarioA('draft');

    await expect(job.reconcile()).resolves.toBeUndefined();

    const stateWrite = tx.store_subscriptions.update.mock.calls.find(
      ([arg]: any[]) => arg?.data?.state !== undefined,
    );
    expect(stateWrite[0].data.state).toBe('draft');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('falls back to cancelled when pending_revert_state was never stamped', async () => {
    const { job, tx, logger } = buildScenarioA(null);

    await expect(job.reconcile()).resolves.toBeUndefined();

    const stateWrite = tx.store_subscriptions.update.mock.calls.find(
      ([arg]: any[]) => arg?.data?.state !== undefined,
    );
    expect(stateWrite[0].data.state).toBe('cancelled');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
