import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import {
  SubscriptionPaymentService,
  SyncInvoiceFromGatewayResult,
} from '../services/subscription-payment.service';

/**
 * Safety-net cron that catches subscriptions stuck in `pending_payment`
 * even though their latest payment is already `succeeded`.
 *
 * Root cause covered (legacy path): when the synchronous `handleChargeSuccess`
 * promotion (inside the payment-success transaction) and the post-commit
 * `SubscriptionStateListener` BOTH fail or are dropped (NestJS event bus is
 * in-process and fire-and-forget), the subscription would stay in
 * `pending_payment` forever and the customer keeps being denied access
 * despite paying.
 *
 * ADR-2 path (new): subscriptions with a pending plan change tracked via
 * `pending_change_invoice_id` may get stuck when:
 *   A) The invoice is still in `issued` state after 60 min (webhook never
 *      arrived). Antes de anular NADA se le pregunta a la pasarela: un webhook
 *      perdido y un cobro inexistente se ven idénticos desde la base de datos,
 *      y sólo la pasarela puede distinguirlos.
 *   B) The invoice is `paid` but `confirmPendingChange()` failed after the webhook
 *   C) The invoice is `failed`/`void` but the pending_* fields were not cleared
 *
 * Strategy:
 *   - Every 5 minutes, run TWO reconciliation passes:
 *     1. Tipo A (ADR-2): subs with pending_change_invoice_id started > 60 min ago
 *     2. Tipo B (legacy): subs in pending_payment with a succeeded payment > 1 min ago
 *        and NO pending_change_invoice_id (avoids double-handling ADR-2 subs)
 *
 * Idempotent: `transition()` / `transitionInTx()` no-ops on same-state.
 */
@Injectable()
export class ReconcileStuckPendingJob {
  private readonly logger = new Logger(ReconcileStuckPendingJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly paymentService: SubscriptionPaymentService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcile(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'ReconcileStuckPendingJob already running, skipping this tick',
      );
      return;
    }

    this.isRunning = true;

    try {
      await this.reconcilePendingChanges();
      await this.reconcileLegacyStuckPayments();
    } catch (err: any) {
      this.logger.error(
        `ReconcileStuckPendingJob top-level failure: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Tipo A: ADR-2 — Pending plan changes stuck (pending_change_invoice_id)
  // ---------------------------------------------------------------------------

  /**
   * Find subscriptions with a pending plan change initiated more than 60 minutes
   * ago and reconcile them based on the invoice state.
   */
  private async reconcilePendingChanges(): Promise<void> {
    const cutoff60min = new Date(Date.now() - 60 * 60 * 1000);

    const stuckPendingChanges = await this.prisma
      .withoutScope()
      .store_subscriptions.findMany({
        where: {
          state: 'pending_payment',
          pending_change_started_at: {
            lt: cutoff60min,
          },
          pending_change_invoice_id: { not: null },
        },
        include: {
          pending_change_invoice: {
            select: {
              id: true,
              state: true,
              to_plan_id: true,
              from_plan_id: true,
              change_kind: true,
              store_subscription_id: true,
            },
          },
        },
        take: 100,
      });

    if (!stuckPendingChanges.length) {
      return;
    }

    this.logger.log(
      `ReconcileStuckPendingJob [ADR-2]: found ${stuckPendingChanges.length} stuck pending change(s)`,
    );

    for (const sub of stuckPendingChanges) {
      try {
        await this.reconcilePendingChange(sub);
      } catch (err: any) {
        this.logger.error(
          `Error reconciling pending change for sub ${sub.id} (store ${sub.store_id}): ${err?.message ?? err}`,
          err?.stack,
        );
      }
    }
  }

  /**
   * Reconcile a single subscription with a stuck pending plan change.
   *
   * Scenarios:
   *   - invoice.state === 'issued': webhook never arrived → PREGUNTAR a la
   *     pasarela y sólo entonces decidir si se anula (ver `shouldVoidStuckInvoice`)
   *   - invoice.state === 'paid':   webhook arrived but confirmPendingChange() failed → re-execute
   *   - invoice.state === 'failed' | 'void': payment failed → clean up orphaned pending_* fields
   */
  private async reconcilePendingChange(sub: any): Promise<void> {
    const invoice = sub.pending_change_invoice;
    if (!invoice) {
      return;
    }

    const stuckMinutes = Math.round(
      (Date.now() - new Date(sub.pending_change_started_at).getTime()) / 60000,
    );

    if (invoice.state === 'issued') {
      // I/O DE RED, y por eso va FUERA de la transacción: una consulta HTTP a
      // Wompi dentro de un `$transaction` mantiene abierta una conexión del pool
      // y un lock de fila durante todo el timeout de la pasarela.
      const shouldVoid = await this.shouldVoidStuckInvoice(
        sub,
        invoice,
        stuckMinutes,
      );

      // Cualquier respuesta que no pruebe que NO hubo cobro deja la factura
      // viva para el siguiente ciclo (corre cada 5 min). Anular a ciegas es lo
      // que anuló la factura 17 de Multimarcas Ever ya pagada por Nequi.
      if (!shouldVoid) {
        // OJO: si la pasarela acreditó, `syncInvoiceFromGateway` ya escribió
        // invoice=paid y promovió la suscripción. El `invoice` que tenemos en
        // memoria viene de la relación cargada ANTES de esa escritura: está
        // rancio. No se reutiliza para nada más — se sale.
        return;
      }
    }

    await this.prisma.withoutScope().$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (invoice.state === 'issued') {
          // ── Scenario A: Invoice stuck without a webhook after 60 min ─────────
          // La pasarela ya confirmó que no hay cobro contra esta referencia.
          // Void the invoice and revert the subscription state.
          await tx.subscription_invoices.update({
            where: { id: invoice.id },
            data: { state: 'void', updated_at: new Date() },
          });

          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: {
              pending_plan_id: null,
              pending_change_invoice_id: null,
              pending_change_kind: null,
              pending_change_started_at: null,
              pending_revert_state: null,
              updated_at: new Date(),
            },
          });

          const revertState = sub.pending_revert_state ?? 'cancelled';

          await this.stateService.transitionInTx(
            tx,
            sub.store_id,
            revertState,
            {
              reason: 'reconcile_stuck_pending_change',
              triggeredByJob: 'reconcile-stuck-pending',
              payload: {
                invoice_id: invoice.id,
                stuck_minutes: stuckMinutes,
              },
            },
          );

          this.logger.warn(
            JSON.stringify({
              event: 'RECONCILE_VOID_STUCK_INVOICE',
              sub_id: sub.id,
              store_id: sub.store_id,
              invoice_id: invoice.id,
              stuck_minutes: stuckMinutes,
              reverted_to: revertState,
            }),
          );
        } else if (invoice.state === 'paid') {
          // ── Scenario B: Invoice paid but confirmPendingChange() failed ────────
          // Re-execute the confirmation inside this transaction.
          await this.paymentService.confirmPendingChange(invoice, tx);

          this.logger.log(
            JSON.stringify({
              event: 'RECONCILE_CONFIRM_PAID_INVOICE',
              sub_id: sub.id,
              store_id: sub.store_id,
              invoice_id: invoice.id,
            }),
          );
        } else if (invoice.state === 'failed' || invoice.state === 'void') {
          // ── Scenario C: Payment failed / voided — clean up orphaned fields ────
          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: {
              pending_plan_id: null,
              pending_change_invoice_id: null,
              pending_change_kind: null,
              pending_change_started_at: null,
              pending_revert_state: null,
              updated_at: new Date(),
            },
          });

          if (sub.state === 'pending_payment' && sub.pending_revert_state) {
            await this.stateService.transitionInTx(
              tx,
              sub.store_id,
              sub.pending_revert_state,
              {
                reason: 'reconcile_cleanup_orphaned_pending',
                triggeredByJob: 'reconcile-stuck-pending',
              },
            );
          }

          this.logger.warn(
            JSON.stringify({
              event: 'RECONCILE_CLEANUP_ORPHANED',
              sub_id: sub.id,
              store_id: sub.store_id,
              invoice_id: invoice.id,
              invoice_state: invoice.state,
            }),
          );
        } else {
          // Unrecognized invoice state — log and skip.
          this.logger.warn(
            JSON.stringify({
              event: 'RECONCILE_UNKNOWN_INVOICE_STATE',
              sub_id: sub.id,
              invoice_id: invoice.id,
              invoice_state: invoice.state,
            }),
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  /**
   * ¿Puede este job anular la factura atascada?
   *
   * El defecto que cerró este método: el Escenario A anulaba una factura de 60
   * minutos SIN preguntarle a la pasarela. El 17/08/2026 Wompi había aprobado
   * `1439162-1786996019-19335` a las 14:47; el webhook llegó a las 14:47:48 y no
   * se procesó; a las 15:45 este cron anuló la factura 17 y devolvió la tienda a
   * `grace_soft`. El cliente había pagado $69.900. `reconcile_stuck_pending_change`
   * ya había disparado 6 veces sobre 5 suscripciones distintas: no fue un caso
   * aislado, fue la política.
   *
   * La política ahora es: SÓLO se anula cuando la pasarela AFIRMA que no hubo
   * cobro. El silencio de la pasarela no es un "no" — es un "no sé", y un "no sé"
   * cuesta cero si se difiere (el cron vuelve en 5 minutos) mientras que anular
   * mal cuesta una factura pagada, una tienda degradada y una reparación manual.
   *
   * @returns `true` sólo si consta que no hubo cobro.
   */
  private async shouldVoidStuckInvoice(
    sub: any,
    invoice: any,
    stuckMinutes: number,
  ): Promise<boolean> {
    const base = {
      sub_id: sub.id,
      store_id: sub.store_id,
      invoice_id: invoice.id,
      stuck_minutes: stuckMinutes,
    };

    let result: SyncInvoiceFromGatewayResult;
    try {
      result = await this.paymentService.syncInvoiceFromGateway(invoice.id);
    } catch (err: any) {
      // Lanzar es la forma más ruidosa de "no sé": credenciales de plataforma
      // ausentes, factura ilegible, red caída. Nunca autoriza a anular.
      this.logger.warn(
        JSON.stringify({
          ...base,
          event: 'RECONCILE_VOID_DEFERRED_GATEWAY_UNREACHABLE',
          reason: 'sync_threw',
          error: err?.message ?? String(err),
        }),
      );
      return false;
    }

    if (result.status === 'paid') {
      // La pasarela ya acreditó por el camino del webhook (o lo acaba de hacer
      // esta misma llamada, que reutiliza `markPaymentSucceededFromWebhook`).
      // El job sólo deja constancia y sale: no hay nada que anular ni que
      // revertir, y el estado de `invoice` en memoria ya es rancio.
      this.logger.warn(
        JSON.stringify({
          ...base,
          event: 'RECONCILE_RECOVERED_BEFORE_VOID',
          transaction_id: result.transaction_id ?? null,
        }),
      );
      return false;
    }

    if (result.status === 'pending') {
      if (result.reason === 'gateway_pending') {
        // La transacción sigue VIVA en la pasarela: todavía puede aprobar.
        this.logger.warn(
          JSON.stringify({
            ...base,
            event: 'RECONCILE_VOID_DEFERRED_GATEWAY_PENDING',
            reason: result.reason,
          }),
        );
        return false;
      }

      if (result.reason === 'no_transaction_for_reference') {
        // Único `pending` que es una RESPUESTA y no una ausencia de respuesta:
        // la pasarela contestó y no conoce esa referencia. Consta que no hubo
        // cobro → se anula.
        return true;
      }

      // `gateway_unreachable`, `no_reference`, o un `reason` que este job no
      // conoce todavía. Todos significan "no pude preguntar". Se difiere.
      this.logger.warn(
        JSON.stringify({
          ...base,
          event: 'RECONCILE_VOID_DEFERRED_GATEWAY_UNREACHABLE',
          reason: result.reason ?? 'unknown',
        }),
      );
      return false;
    }

    // `failed` (la pasarela rechazó o la transacción está en estado terminal
    // negativo) y `no_transaction` (no hay siquiera fila de pago que consultar).
    // En ambos consta que no hay dinero cobrado contra esta factura.
    return true;
  }

  // ---------------------------------------------------------------------------
  // Tipo B: Legacy — subs stuck in pending_payment with a succeeded payment
  //         (no pending_change_invoice_id — avoids double-handling ADR-2 subs)
  // ---------------------------------------------------------------------------

  /**
   * Legacy reconciliation path.
   *
   * Catches subscriptions stuck in `pending_payment` whose newest succeeded
   * payment was confirmed more than 1 minute ago AND that do NOT have an
   * active pending plan change (i.e. pending_change_invoice_id is null).
   *
   * Root cause: when `handleChargeSuccess` promotion (inside the payment-success
   * transaction) AND the post-commit `SubscriptionStateListener` BOTH fail or
   * are dropped, the subscription stays in `pending_payment` forever.
   *
   * The 1-minute buffer avoids racing the in-flight transaction. Idempotent:
   * `ensureOperational()` no-ops when the store is already active/trial, so a
   * row promoted by the listener mid-run costs nothing.
   */
  private async reconcileLegacyStuckPayments(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 1000); // 1 min buffer

    const candidates = await this.prisma
      .withoutScope()
      .store_subscriptions.findMany({
        where: {
          state: 'pending_payment',
          // Only legacy rows — ADR-2 rows are handled by reconcilePendingChanges()
          pending_change_invoice_id: null,
          invoices: {
            some: {
              payments: {
                some: {
                  state: 'succeeded',
                  paid_at: { lt: cutoff },
                },
              },
            },
          },
        },
        select: {
          id: true,
          store_id: true,
          invoices: {
            where: {
              payments: {
                some: {
                  state: 'succeeded',
                  paid_at: { lt: cutoff },
                },
              },
            },
            orderBy: { id: 'desc' },
            take: 1,
            select: {
              id: true,
              payments: {
                where: { state: 'succeeded' },
                orderBy: { paid_at: 'desc' },
                take: 1,
                select: { id: true, paid_at: true },
              },
            },
          },
        },
        take: 100,
      });

    if (!candidates.length) {
      return;
    }

    for (const sub of candidates) {
      const lastInvoice = sub.invoices[0];
      const lastPayment = lastInvoice?.payments[0];

      try {
        // Single reactivation seam. It owns the route to `active`, the
        // idempotent no-op when another writer got there first, the clearing
        // of stale dunning/cancellation columns, and the exit guard that
        // throws rather than let this job log a reconciliation that did not
        // actually leave the store operational.
        const { finalState, path } = await this.stateService.ensureOperational(
          sub.store_id,
          {
            reason: 'webhook_state_drift',
            triggeredByJob: 'cron_reconciliation',
            payload: {
              invoice_id: lastInvoice?.id,
              payment_id: lastPayment?.id,
              succeeded_at: lastPayment?.paid_at?.toISOString() ?? null,
              source: 'reconcile-stuck-pending-job',
            },
          },
        );

        // WARN level — every reconciliation is a signal that the
        // synchronous webhook promotion + listener BOTH missed this row.
        this.logger.warn({
          msg: 'STATE_ENGINE_RECONCILED',
          subscriptionId: sub.id,
          storeId: sub.store_id,
          invoiceId: lastInvoice?.id,
          paymentId: lastPayment?.id,
          succeededAt: lastPayment?.paid_at,
          finalState,
          path,
          note: 'subscription was stuck in pending_payment despite a succeeded payment; reconciled to active',
        });
      } catch (err: any) {
        this.logger.error(
          `Reconcile failed for subscription ${sub.id} (store ${sub.store_id}): ${err?.message ?? err}`,
          err?.stack,
        );
      }
    }
  }
}
