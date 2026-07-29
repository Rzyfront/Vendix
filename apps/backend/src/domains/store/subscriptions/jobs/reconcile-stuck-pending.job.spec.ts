// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models). Same reason
// as subscription-state.listener.spec.ts.
/// <reference types="jest" />
import { ReconcileStuckPendingJob } from './reconcile-stuck-pending.job';

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
