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
 *
 * NOTA: desde el incidente de Multimarcas Ever, el Escenario A ya no anula sin
 * antes preguntarle a la pasarela. Estos casos "sí anula" fijan la respuesta de
 * `syncInvoiceFromGateway` en `no_transaction_for_reference`, que es la única
 * que prueba que no hubo cobro.
 */
describe('ReconcileStuckPendingJob — ADR-2 scenario A (webhook never arrived)', () => {
  const STORE_ID = 99;
  const SUB_ID = 60;
  const INVOICE_ID = 13;

  const buildScenarioA = (
    revertState: string | null,
    syncImpl: () => Promise<any> = async () => ({
      status: 'pending',
      reason: 'no_transaction_for_reference',
    }),
  ) => {
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

    const syncInvoiceFromGateway = jest.fn().mockImplementation(syncImpl);

    const job = new ReconcileStuckPendingJob(prisma, stateService as any, {
      confirmPendingChange: jest.fn(),
      syncInvoiceFromGateway,
    } as any);

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    (job as any).logger = logger;

    return { job, tx, logger, syncInvoiceFromGateway };
  };

  /** Devuelve los eventos JSON emitidos por `logger.warn`. */
  const warnEvents = (logger: any): any[] =>
    logger.warn.mock.calls
      .map(([arg]: any[]) => {
        try {
          return typeof arg === 'string' ? JSON.parse(arg) : arg;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

  it('reverts a stuck trial conversion back to trial (real state machine)', async () => {
    const { job, tx, logger, syncInvoiceFromGateway } =
      buildScenarioA('trial');

    await expect(job.reconcile()).resolves.toBeUndefined();

    // La anulación pasa por la pasarela, siempre y antes de escribir nada.
    expect(syncInvoiceFromGateway).toHaveBeenCalledWith(INVOICE_ID);

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

  // ---------------------------------------------------------------------------
  // El incidente Multimarcas Ever (17/08/2026): Wompi aprobó a las 14:47, el
  // webhook llegó a las 14:47:48 y no se procesó, y a las 15:45 este cron anuló
  // la factura 17 y devolvió la tienda a `grace_soft`. El cliente había pagado
  // $69.900. Estos casos fijan la regla nueva: sin una respuesta de la pasarela
  // que PRUEBE que no hubo cobro, no se anula nada.
  // ---------------------------------------------------------------------------

  it('NO anula cuando la pasarela dice que la transacción fue aprobada', async () => {
    const { job, tx, logger, syncInvoiceFromGateway } = buildScenarioA(
      'grace_soft',
      async () => ({
        status: 'paid',
        transaction_id: '1439162-1786996019-19335',
      }),
    );

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(syncInvoiceFromGateway).toHaveBeenCalledWith(INVOICE_ID);
    expect(tx.subscription_invoices.update).not.toHaveBeenCalled();
    expect(tx.store_subscriptions.update).not.toHaveBeenCalled();

    const events = warnEvents(logger);
    const recovered = events.find(
      (e) => e.event === 'RECONCILE_RECOVERED_BEFORE_VOID',
    );
    expect(recovered).toBeDefined();
    expect(recovered.sub_id).toBe(SUB_ID);
    expect(recovered.store_id).toBe(STORE_ID);
    expect(recovered.invoice_id).toBe(INVOICE_ID);
    expect(recovered.transaction_id).toBe('1439162-1786996019-19335');
    expect(recovered.stuck_minutes).toBeGreaterThan(60);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('NO anula cuando la pasarela es inalcanzable (gateway_unreachable)', async () => {
    const { job, tx, logger } = buildScenarioA('grace_soft', async () => ({
      status: 'pending',
      payment_status: 'pending',
      reason: 'gateway_unreachable',
    }));

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).not.toHaveBeenCalled();
    expect(tx.store_subscriptions.update).not.toHaveBeenCalled();

    const deferred = warnEvents(logger).find(
      (e) => e.event === 'RECONCILE_VOID_DEFERRED_GATEWAY_UNREACHABLE',
    );
    expect(deferred).toBeDefined();
    expect(deferred.reason).toBe('gateway_unreachable');
    expect(deferred.invoice_id).toBe(INVOICE_ID);
  });

  it('NO anula cuando el pago no tiene referencia con la que preguntar', async () => {
    const { job, tx, logger } = buildScenarioA('grace_soft', async () => ({
      status: 'pending',
      reason: 'no_reference',
    }));

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).not.toHaveBeenCalled();
    const deferred = warnEvents(logger).find(
      (e) => e.event === 'RECONCILE_VOID_DEFERRED_GATEWAY_UNREACHABLE',
    );
    expect(deferred?.reason).toBe('no_reference');
  });

  it('NO anula cuando la transacción sigue viva en la pasarela (gateway_pending)', async () => {
    const { job, tx, logger } = buildScenarioA('grace_soft', async () => ({
      status: 'pending',
      reason: 'gateway_pending',
    }));

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).not.toHaveBeenCalled();
    const deferred = warnEvents(logger).find(
      (e) => e.event === 'RECONCILE_VOID_DEFERRED_GATEWAY_PENDING',
    );
    expect(deferred).toBeDefined();
    expect(deferred.reason).toBe('gateway_pending');
  });

  it('NO anula cuando la consulta a la pasarela lanza', async () => {
    const { job, tx, logger } = buildScenarioA('grace_soft', async () => {
      throw new Error('ECONNRESET');
    });

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).not.toHaveBeenCalled();
    expect(tx.store_subscriptions.update).not.toHaveBeenCalled();

    const deferred = warnEvents(logger).find(
      (e) => e.event === 'RECONCILE_VOID_DEFERRED_GATEWAY_UNREACHABLE',
    );
    expect(deferred).toBeDefined();
    expect(deferred.error).toContain('ECONNRESET');
    // Un throw esperado no debe escalar al catch por-suscripción del cron.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('SÍ anula cuando la pasarela no conoce ninguna transacción con esa referencia', async () => {
    const { job, tx, logger } = buildScenarioA('grace_soft', async () => ({
      status: 'pending',
      reason: 'no_transaction_for_reference',
    }));

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVOICE_ID },
        data: expect.objectContaining({ state: 'void' }),
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('SÍ anula cuando no hay siquiera fila de pago que consultar', async () => {
    const { job, tx } = buildScenarioA('grace_soft', async () => ({
      status: 'no_transaction',
    }));

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'void' }),
      }),
    );
  });

  it('SÍ anula cuando la pasarela reporta el cobro como fallido', async () => {
    const { job, tx } = buildScenarioA('grace_soft', async () => ({
      status: 'failed',
    }));

    await expect(job.reconcile()).resolves.toBeUndefined();

    expect(tx.subscription_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'void' }),
      }),
    );
  });
});
