import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionBillingService } from '../domains/store/subscriptions/services/subscription-billing.service';
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';
import {
  SubscriptionStateService,
  LOCK_REASON_PLAN_RETIRED,
} from '../domains/store/subscriptions/services/subscription-state.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Retry schedule for failed SaaS subscription charges. Hours: 1h, 4h, 24h, 72h.
// MUST stay aligned with SubscriptionPaymentRetryJob — both files share the
// same constants at module-local scope so a change here does not silently
// drift from the processor.
export const BACKOFF_DELAYS = [
  60 * 60 * 1000, // 1h
  4 * 60 * 60 * 1000, // 4h
  24 * 60 * 60 * 1000, // 24h
  72 * 60 * 60 * 1000, // 72h
];
export const MAX_ATTEMPTS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionRenewalBillingJob {
  private readonly logger = new Logger(SubscriptionRenewalBillingJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly billingService: SubscriptionBillingService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly stateService: SubscriptionStateService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly gateConfig: SubscriptionGateConfig,
    @InjectQueue('subscription-payment-retry')
    private readonly retryQueue: Queue,
    @InjectQueue('billing-warning')
    private readonly billingWarningQueue: Queue,
  ) {}

  @Cron('0 2 * * *')
  async handleRenewalBilling(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Subscription renewal billing already running, skipping',
      );
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const subscriptions = await this.prisma.store_subscriptions.findMany({
        where: {
          state: { in: ['active', 'grace_soft', 'grace_hard'] },
          // RNC-39: defensive — never bill subscriptions without a plan.
          plan_id: { not: null },
          OR: [
            { next_billing_at: { lte: tomorrow } },
            { scheduled_cancel_at: { lte: now } },
          ],
        },
        select: {
          id: true,
          store_id: true,
          state: true,
          plan_id: true,
          current_period_end: true,
          next_billing_at: true,
          scheduled_cancel_at: true,
          // Defecto 2: el cobro automático se decide con estas dos columnas + EL
          // predicado. Antes el cron cobraba por `next_billing_at` y estado, sin
          // mirar `auto_renew`, y el docstring del gate ("el cron omite esta
          // tienda hasta que el usuario tokenice una tarjeta") describía un
          // contrato que no existía en el código.
          auto_renew: true,
          metadata: true,
          plan: {
            select: {
              state: true,
              archived_at: true,
              grace_period_soft_days: true,
              grace_period_hard_days: true,
            },
          },
        },
        take: 20,
      });

      if (subscriptions.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${subscriptions.length} subscriptions due for billing`,
      );

      const retryEnabled =
        this.config.get<string>('SUBSCRIPTION_RETRY_QUEUE_ENABLED') === 'true';

      for (const sub of subscriptions) {
        try {
          if (this.gateConfig.isCronDryRun()) {
            this.logger.log({
              msg: 'DRY_RUN_SKIP',
              job: 'subscription-renewal-billing',
              wouldProcess: {
                subscriptionId: sub.id,
                hasScheduledCancel: !!sub.scheduled_cancel_at,
              },
            });
            continue;
          }

          // Scheduled cancellation check — if the user requested cancellation
          // at end of cycle and the period has ended, transition to cancelled
          // and do NOT emit an invoice.
          if (
            sub.scheduled_cancel_at &&
            new Date(sub.scheduled_cancel_at) <= new Date()
          ) {
            this.logger.log(
              `Subscription ${sub.id}: scheduled cancellation reached, transitioning to cancelled`,
            );

            await this.prisma.store_subscriptions.update({
              where: { id: sub.id },
              data: {
                state: 'cancelled',
                cancelled_at: new Date(),
                scheduled_cancel_at: null,
                auto_renew: false,
                updated_at: new Date(),
              },
            });

            await this.prisma.subscription_events.create({
              data: {
                store_subscription_id: sub.id,
                type: 'state_transition',
                from_state: sub.state,
                to_state: 'cancelled',
                payload: {
                  reason: 'scheduled_cancel_executed',
                  scheduled_cancel_at: sub.scheduled_cancel_at.toISOString(),
                } as any,
                triggered_by_job: 'subscription-renewal-billing',
              },
            });

            this.eventEmitter.emit('subscription.state.changed', {
              storeId: sub.store_id,
              fromState: sub.state,
              toState: 'cancelled',
              reason: 'scheduled_cancel_executed',
              triggeredByJob: 'subscription-renewal-billing',
            });

            continue;
          }

          if (this.isPlanUnavailable(sub)) {
            await this.handleUnavailablePlanAtRenewal(sub);
            continue;
          }

          const invoice = await this.billingService.issueInvoice(sub.id);

          if (!invoice) {
            // Free-plan / zero-price skip — no charge needed.
            this.logger.log(
              `Subscription ${sub.id}: no invoice issued (zero-price or skipped)`,
            );
            continue;
          }

          await this.prisma.store_subscriptions.update({
            where: { id: sub.id },
            data: { next_billing_at: invoice.period_end },
          });

          this.eventEmitter.emit('subscription.invoice.issued', {
            subscriptionId: sub.id,
            storeId: sub.store_id,
            invoiceId: invoice.id,
            total: invoice.total.toString(),
          });

          this.logger.log(
            `Issued invoice ${invoice.id} for subscription ${sub.id}`,
          );

          // Defecto 2 — COBRAR SOLO SI SE PUEDE COBRAR.
          //
          // La factura se emite igual (es la vía del cliente para pagar a mano y
          // lo que el tablero de mora suma como deuda), pero el cargo automático
          // exige `auto_renew` encendido Y un medio apto según EL predicado. Sin
          // eso el cargo terminaba en `WOMPI_CHARGE_PATH path=no_pm`, fallaba, y
          // ese fallo alimentaba hasta 4 campanas y 4 correos de "renovación
          // fallida" por ciclo, mintiendo sobre la causa: nunca hubo tarjeta.
          const chargeable = await this.resolveChargeability(sub);

          if (!chargeable.canCharge) {
            this.logger.warn(
              `RENEWAL_CHARGE_SKIPPED sub=${sub.id} store=${sub.store_id} ` +
                `invoice=${invoice.id} auto_renew=${chargeable.autoRenew} ` +
                `eligible_pm=${chargeable.hasEligiblePm} reason=${chargeable.reason}`,
            );

            if (chargeable.reason === 'no_eligible_payment_method') {
              // Pausa + aviso (campana y correo, deduplicados por el gate) en vez
              // de cobrar contra el vacío.
              await this.pauseAutoRenewForRenewalCron(sub, invoice.id);
            }

            continue;
          }

          // Attempt the immediate first charge inline. If the gateway accepts,
          // we are done. If it rejects (state='failed') or throws, we hand off
          // to the BullMQ retry queue with exponential backoff.
          await this.attemptCharge(
            invoice.id,
            sub.id,
            sub.store_id,
            retryEnabled,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to bill subscription ${sub.id}: ${error?.message ?? error}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Subscription renewal billing failed: ${error?.message ?? error}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * ¿Se puede cobrar automáticamente esta suscripción?
   *
   * Dos condiciones, y ninguna se evalúa aquí a mano:
   *   1. `auto_renew` encendido — la voluntad del cliente.
   *   2. Un medio apto según `renewal-eligibility.contract.ts` — la capacidad
   *      técnica. Se consulta por `SubscriptionPaymentService`, el mismo servicio
   *      que hará el cargo, para que cron y cobrador no puedan discrepar.
   *
   * `auto_renew=false` NO es un error: es la tienda que apagó el autopago (o que
   * el gate pausó). La factura ya quedó emitida y el cliente puede pagarla a mano;
   * lo que no se hace es golpear la pasarela sin credencial.
   */
  private async resolveChargeability(sub: {
    id: number;
    store_id: number;
    auto_renew: boolean | null;
  }): Promise<{
    canCharge: boolean;
    autoRenew: boolean;
    hasEligiblePm: boolean;
    reason: 'ok' | 'auto_renew_off' | 'no_eligible_payment_method';
  }> {
    const autoRenew = sub.auto_renew === true;
    const hasEligiblePm =
      await this.paymentService.hasRenewalEligiblePaymentMethod(sub.id);

    if (!autoRenew) {
      return {
        canCharge: false,
        autoRenew,
        hasEligiblePm,
        reason: 'auto_renew_off',
      };
    }

    if (!hasEligiblePm) {
      return {
        canCharge: false,
        autoRenew,
        hasEligiblePm,
        reason: 'no_eligible_payment_method',
      };
    }

    return { canCharge: true, autoRenew, hasEligiblePm, reason: 'ok' };
  }

  /**
   * `auto_renew` encendido sin medio apto: se pausa y se avisa (campana + correo,
   * deduplicados por el gate) en vez de cobrar contra el vacío.
   *
   * Nunca lanza: la renovación de las demás tiendas no se detiene porque un aviso
   * no se pudo emitir.
   */
  private async pauseAutoRenewForRenewalCron(
    sub: { id: number; store_id: number },
    invoiceId: number,
  ): Promise<void> {
    try {
      await this.paymentService.pauseAutoRenewForMissingCredential({
        subscriptionId: sub.id,
        storeId: sub.store_id,
        source: 'renewal_cron',
        triggeredByJob: 'subscription-renewal-billing',
        auditSource: 'renewal_cron_no_credential',
        eventKey: `renewal-cron-${sub.id}-${invoiceId}`,
        payload: { invoice_id: invoiceId },
      });
    } catch (err: any) {
      this.logger.error(
        `AUTO_RENEW_PAUSE_FAILED sub=${sub.id} store=${sub.store_id} ` +
          `invoice=${invoiceId}: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  /**
   * Charge the freshly issued invoice. On failure, hand off to the retry
   * queue (when feature flag is enabled) with exponential backoff. When the
   * flag is off we fall back to the legacy log-and-skip behaviour so a bad
   * rollout cannot stall renewals.
   */
  private async attemptCharge(
    invoiceId: number,
    subscriptionId: number,
    storeId: number,
    retryEnabled: boolean,
  ): Promise<void> {
    try {
      const result = await this.paymentService.chargeInvoice(invoiceId);

      if (result.state === 'succeeded') {
        this.logger.log(
          `Charge succeeded for invoice ${invoiceId} (subscription ${subscriptionId})`,
        );
        return;
      }

      if (result.state === 'failed') {
        await this.handleChargeFailure(
          invoiceId,
          subscriptionId,
          storeId,
          retryEnabled,
          `Gateway returned failed state (payment ${result.id})`,
        );
        return;
      }

      // Pending / unknown — leave it to the state engine + retry queue if
      // configured. Treat as failure so the retry queue picks it up.
      await this.handleChargeFailure(
        invoiceId,
        subscriptionId,
        storeId,
        retryEnabled,
        `Charge ended in non-terminal state '${result.state}'`,
      );
    } catch (error: any) {
      await this.handleChargeFailure(
        invoiceId,
        subscriptionId,
        storeId,
        retryEnabled,
        error?.message ?? 'Unknown charge error',
      );
    }
  }

  private isPlanUnavailable(sub: {
    plan: { state: string; archived_at: Date | null } | null;
  }): boolean {
    return !sub.plan || sub.plan.state !== 'active' || !!sub.plan.archived_at;
  }

  private async handleUnavailablePlanAtRenewal(sub: {
    id: number;
    store_id: number;
    state: string;
    plan_id: number | null;
    current_period_end: Date | null;
    next_billing_at: Date | null;
    plan: {
      state: string;
      archived_at: Date | null;
      grace_period_soft_days: number;
      grace_period_hard_days: number;
    } | null;
  }): Promise<void> {
    const now = new Date();
    const periodEnd = sub.current_period_end ?? sub.next_billing_at;

    this.logger.warn(
      JSON.stringify({
        event: 'RENEWAL_SKIPPED_PLAN_UNAVAILABLE',
        subscription_id: sub.id,
        store_id: sub.store_id,
        plan_id: sub.plan_id,
        plan_state: sub.plan?.state ?? null,
        archived_at: sub.plan?.archived_at?.toISOString() ?? null,
        current_period_end: sub.current_period_end?.toISOString() ?? null,
        next_billing_at: sub.next_billing_at?.toISOString() ?? null,
      }),
    );

    if (!periodEnd || periodEnd.getTime() > now.getTime()) {
      return;
    }

    if (sub.state !== 'active') {
      return;
    }

    const softDays = sub.plan?.grace_period_soft_days ?? 5;
    const hardDays = sub.plan?.grace_period_hard_days ?? 10;
    await this.stateService.transition(sub.store_id, 'grace_soft', {
      reason: LOCK_REASON_PLAN_RETIRED,
      // `reason` above is audit payload only (subscription_events.payload).
      // The COLUMN the access gate reads is `store_subscriptions.lock_reason`,
      // and it is written from `lockReason` — without this line the store is
      // degraded with an empty motive and SUBSCRIPTION_011 ("plan retirado")
      // is dead code, so the customer is told it owes a bill it never owed.
      lockReason: LOCK_REASON_PLAN_RETIRED,
      triggeredByJob: 'subscription-renewal-billing',
      graceSoftUntil: new Date(periodEnd.getTime() + softDays * DAY_MS),
      graceHardUntil: new Date(periodEnd.getTime() + hardDays * DAY_MS),
      payload: {
        plan_id: sub.plan_id,
        plan_state: sub.plan?.state ?? null,
        archived_at: sub.plan?.archived_at?.toISOString() ?? null,
        current_period_end: sub.current_period_end?.toISOString() ?? null,
        next_billing_at: sub.next_billing_at?.toISOString() ?? null,
      },
    });
  }

  private async handleChargeFailure(
    invoiceId: number,
    subscriptionId: number,
    storeId: number,
    retryEnabled: boolean,
    reason: string,
  ): Promise<void> {
    if (!retryEnabled) {
      this.logger.error(
        `Charge failed for invoice ${invoiceId} (subscription ${subscriptionId}): ${reason}. ` +
          `Retry queue disabled (SUBSCRIPTION_RETRY_QUEUE_ENABLED!=true) — skipping retry.`,
      );
      try {
        await this.enqueueBillingWarningOnRetryExhausted(
          invoiceId,
          subscriptionId,
          storeId,
          reason,
        );
      } catch (enqueueError: any) {
        this.logger.error(
          `Failed to enqueue billing warning for invoice ${invoiceId}: ${enqueueError?.message ?? enqueueError}`,
        );
      }
      return;
    }

    this.logger.warn(
      `Charge failed for invoice ${invoiceId} (subscription ${subscriptionId}): ${reason}. ` +
        `Enqueuing retry job (max ${MAX_ATTEMPTS} attempts).`,
    );

    try {
      await this.retryQueue.add(
        'retry',
        {
          invoiceId,
          subscriptionId,
          storeId,
          attempt: 1,
        },
        {
          delay: BACKOFF_DELAYS[0],
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 60 * 60 * 1000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    } catch (enqueueError: any) {
      this.logger.error(
        `Failed to enqueue retry for invoice ${invoiceId}: ${enqueueError?.message ?? enqueueError}`,
      );
    }
  }

  /**
   * Enqueue the customer-visible billing warning when the retry budget is
   * exhausted. Wrapped in try/catch — a lost enqueue is logged but never
   * breaks the renewal loop.
   *
   * DEFECTO 8 — el ancla del deduplicado es la FACTURA, no el intento.
   *
   * `charge()` crea un `subscription_payments` nuevo por intento, así que usar
   * `payment.id` como `source_event_id` hacía que el UNIQUE
   * `(store_id, type, source_event_id)` de `billing_warning_logs` no colapsara
   * nada: hasta 4 campanas y 4 correos por ciclo diciendo lo mismo. La factura es
   * constante durante todo el ciclo de reintentos, así que el aviso queda uno por
   * ciclo — estrictamente más estricto, nunca más laxo.
   *
   * `paymentId` se sigue enviando (lo usa el cuerpo del correo y la traza), pero
   * ya no decide la identidad del aviso.
   */
  private async enqueueBillingWarningOnRetryExhausted(
    invoiceId: number,
    subscriptionId: number,
    storeId: number,
    reason: string,
  ): Promise<void> {
    const payment = await this.prisma.subscription_payments.findFirst({
      where: { invoice_id: invoiceId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });

    try {
      await this.billingWarningQueue.add(
        'billing-warning-renewal-failed',
        {
          storeId,
          invoiceId,
          paymentId: payment?.id ?? invoiceId,
          storeSubscriptionId: subscriptionId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
      this.logger.log(
        `BILLING_WARNING_ENQUEUED invoice=${invoiceId} subscription=${subscriptionId} store=${storeId} source=${reason}`,
      );
    } catch (err: any) {
      this.logger.error(
        `BILLING_WARNING_ENQUEUE_FAILED invoice=${invoiceId} err=${err?.message ?? err}`,
        err?.stack,
      );
    }
  }
}
