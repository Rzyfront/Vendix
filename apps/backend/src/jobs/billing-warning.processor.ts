import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue, Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { NotificationsService } from '../domains/store/notifications/notifications.service';

/**
 * Job name the renewal-billing cron emits when the retry ladder has been
 * fully consumed without producing a successful charge. The store-side bell
 * and email fan out from here.
 */
export const BILLING_WARNING_RENEWAL_FAILED = 'billing-warning-renewal-failed';

export interface BillingWarningRenewalFailedData {
  storeId: number;
  /**
   * ANCLA DEL DEDUPLICADO (defecto 8): `subscription_invoices.id`.
   *
   * La factura es constante durante todo el ciclo de reintentos; el intento no.
   * Con `subscription_payments.id` como ancla, el UNIQUE
   * `(store_id, type, source_event_id)` de `billing_warning_logs` no colapsaba
   * nada y el comerciante recibía hasta 4 campanas y 4 correos por ciclo.
   */
  invoiceId?: number | null;
  /**
   * LEGADO — id del último intento de pago. Solo se usa como ancla cuando el job
   * viene de una versión anterior que ya estaba en Redis al desplegar. Los
   * emisores nuevos mandan `invoiceId`.
   */
  sourceEventId?: number | null;
  /** Id del intento fallido. Alimenta el correo y la traza, nunca la identidad. */
  paymentId: number;
  /** Optional: subscription for the audit row. */
  storeSubscriptionId?: number | null;
}

interface SubscriptionPaymentRetryFailedPayload {
  invoiceId: number;
  subscriptionId: number;
  storeId?: number;
  attempt: number;
  paymentId?: number;
}

/**
 * Plan: bright-kindling-possum.md — Agent B.
 *
 * Owns the `billing-warning` BullMQ queue and the audit + notification fan-out
 * that follows a retried-out renewal charge. Lives next to
 * `email-notifications.processor.ts` so a future Agent A that needs to enqueue
 * one of these jobs imports from the same surface.
 *
 * Idempotency: `billing_warning_logs` has a UNIQUE `(store_id, type,
 * source_event_id)` key. A second invocation for the same store + warning type
 * + payment id collapses to a single row, so the bell and the email are
 * emitted exactly once per source event.
 *
 * Vendor note: this file is the ONLY allowed emitter of these job names. If a
 * future task needs to enqueue from elsewhere, it should `@InjectQueue
 * ('billing-warning')` and add the producer there — not push directly to
 * `email-notifications` to avoid bypassing the audit row.
 */
@Processor('billing-warning')
export class BillingWarningProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingWarningProcessor.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
    @InjectQueue('billing-warning')
    private readonly billingWarningQueue: Queue,
  ) {
    super();
  }

  /**
   * `@OnEvent('subscription.payment.retry.failed')` is fired by
   * `subscription-payment-retry.job.ts` on each retry exhaustion at the
   * BullMQ-worker level (when `attempts` config is consumed).
   *
   * Wrapped in try/catch — a thrown handler would tear down the listener.
   */
  @OnEvent('subscription.payment.retry.failed')
  async handleRetryFailedEvent(
    payload: SubscriptionPaymentRetryFailedPayload,
  ): Promise<void> {
    try {
      if (!payload || !payload.storeId || !payload.paymentId) {
        this.logger.warn(
          `BILLING_WARNING_EVENT_SKIP reason=missing_fields payload=${JSON.stringify(payload)}`,
        );
        return;
      }

      await this.billingWarningQueue.add(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: payload.storeId,
        // La factura, no el intento: el reintento crea un `subscription_payments`
        // nuevo cada vez y con él como ancla el aviso se repetía por intento.
        invoiceId: payload.invoiceId ?? null,
        paymentId: payload.paymentId,
        storeSubscriptionId: payload.subscriptionId ?? null,
      });
    } catch (err: any) {
      this.logger.error(
        `BILLING_WARNING_EVENT_ENQUEUE_FAILED err=${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  /**
   * Drain the `billing-warning` queue.
   */
  async process(job: Job<BillingWarningRenewalFailedData>): Promise<{
    inserted: boolean;
    notificationDispatched: boolean;
    emailEnqueued: boolean;
  }> {
    switch (job.name) {
      case BILLING_WARNING_RENEWAL_FAILED:
        return await this.handleRenewalFailed(job);
      default:
        this.logger.warn(
          `BILLING_WARNING_UNKNOWN_JOB name=${job.name} jobId=${job.id} — no handler wired`,
        );
        return {
          inserted: false,
          notificationDispatched: false,
          emailEnqueued: false,
        };
    }
  }

  /**
   * The funnel for "auto-renew charge exhausted its retry budget":
   *
   *   1. Upsert a dedupe row into `billing_warning_logs` keyed by
   *      `(store_id, 'renewal_failed', source_event_id)`. The UNIQUE index
   *      makes the WHERE-clause + insert race-safe; if a parallel worker
   *      won, the catch collapses to "already delivered".
   *   2. On the FIRST insert (the dedupe row is fresh), write an audit row
   *      into `subscription_events` with `type: 'renewal_failed'`.
   *   3. Create + broadcast the in-app bell notification.
   *   4. Enqueue the customer email (`subscription.billing.renewal-failed.email`)
   *      on the `email-notifications` queue.
   */
  private async handleRenewalFailed(
    job: Job<BillingWarningRenewalFailedData>,
  ): Promise<{
    inserted: boolean;
    notificationDispatched: boolean;
    emailEnqueued: boolean;
  }> {
    const { storeId, paymentId } = job.data;

    if (!Number.isInteger(storeId) || storeId <= 0) {
      this.logger.warn(
        `BILLING_WARNING_SKIP reason=invalid_store_id storeId=${storeId}`,
      );
      return {
        inserted: false,
        notificationDispatched: false,
        emailEnqueued: false,
      };
    }

    const anchor = await this.resolveDedupeAnchor(job);

    if (anchor == null || !Number.isInteger(anchor) || anchor <= 0) {
      this.logger.warn(
        `BILLING_WARNING_SKIP reason=invalid_source_event_id sourceEventId=${anchor}`,
      );
      return {
        inserted: false,
        notificationDispatched: false,
        emailEnqueued: false,
      };
    }

    const sourceEventId: number = anchor;

    // 1) Upsert the dedupe row. P2002 collapses to "no-op".
    let isFirstInsert = false;
    try {
      await this.prisma.billing_warning_logs.create({
        data: {
          store_id: storeId,
          type: 'renewal_failed',
          source_event_id: sourceEventId,
        },
      });
      isFirstInsert = true;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(
          `BILLING_WARNING_DEDUPED storeId=${storeId} sourceEventId=${sourceEventId} — already processed`,
        );
        return {
          inserted: false,
          notificationDispatched: false,
          emailEnqueued: false,
        };
      }
      throw err;
    }

    if (!isFirstInsert) {
      return {
        inserted: false,
        notificationDispatched: false,
        emailEnqueued: false,
      };
    }

    this.logger.log(
      `BILLING_WARNING_INSERTED storeId=${storeId} type=renewal_failed sourceEventId=${sourceEventId} paymentId=${paymentId}`,
    );

    // 2) Audit row in subscription_events. Best-effort.
    const storeSubscriptionId = await this.resolveSubscriptionId(job);
    if (storeSubscriptionId != null) {
      try {
        const monotonicId = Date.now();
        await this.prisma.subscription_events.create({
          data: {
            store_subscription_id: storeSubscriptionId,
            type: 'renewal_failed',
            payload: {
              event_id: monotonicId,
              // `source_event_id` es la FACTURA desde el defecto 8; se deja
              // explícito `invoice_id` para que ningún lector futuro tenga que
              // adivinar a qué se ancló el aviso.
              source_event_id: sourceEventId,
              invoice_id: sourceEventId,
              payment_id: paymentId,
              store_subscription_id: storeSubscriptionId,
              source: 'auto_renewal_failed',
            } as Prisma.InputJsonValue,
            triggered_by_job: 'billing-warning',
          },
        });
      } catch (err: any) {
        this.logger.error(
          `BILLING_WARNING_AUDIT_FAILED storeId=${storeId} err=${err?.message ?? err}`,
          err?.stack,
        );
      }
    }

    // 3) In-app bell notification.
    const notificationDispatched = await this.dispatchNotification(storeId);

    // 4) Customer email.
    const emailEnqueued = await this.enqueueEmail(storeId, storeSubscriptionId);

    return {
      inserted: true,
      notificationDispatched,
      emailEnqueued,
    };
  }

  /**
   * DEFECTO 8 — resuelve el `source_event_id` con el que se deduplica el aviso.
   *
   * Orden, de más estricto a menos:
   *   1. `invoiceId` del job (los emisores nuevos siempre lo mandan).
   *   2. La factura del `paymentId`, leída de la base. Cubre los jobs que ya
   *      estaban en Redis cuando se desplegó este cambio y venían anclados al
   *      intento: se re-ancla al ciclo, que es más estricto.
   *   3. `sourceEventId` legado. Último recurso; se registra como advertencia
   *      porque en ese modo el aviso puede repetirse por intento, que es
   *      exactamente el defecto.
   *
   * Nunca devuelve un ancla MÁS LAXA que la del job: si hay factura, gana.
   */
  private async resolveDedupeAnchor(
    job: Job<BillingWarningRenewalFailedData>,
  ): Promise<number | null> {
    const { invoiceId, paymentId, sourceEventId } = job.data;

    if (invoiceId && Number.isInteger(invoiceId) && invoiceId > 0) {
      return invoiceId;
    }

    if (paymentId && Number.isInteger(paymentId) && paymentId > 0) {
      try {
        const payment = await this.prisma.subscription_payments.findFirst({
          where: { id: paymentId },
          select: { invoice_id: true },
        });
        if (payment?.invoice_id) {
          this.logger.log(
            `BILLING_WARNING_ANCHOR_RESOLVED jobId=${job.id} paymentId=${paymentId} ` +
              `invoiceId=${payment.invoice_id} — job legado re-anclado al ciclo`,
          );
          return payment.invoice_id;
        }
      } catch (err: any) {
        this.logger.warn(
          `BILLING_WARNING_ANCHOR_LOOKUP_FAILED paymentId=${paymentId} err=${err?.message ?? err}`,
        );
      }
    }

    if (sourceEventId && Number.isInteger(sourceEventId) && sourceEventId > 0) {
      this.logger.warn(
        `BILLING_WARNING_ANCHOR_LEGACY jobId=${job.id} sourceEventId=${sourceEventId} ` +
          `— sin factura resoluble; el aviso puede repetirse por intento`,
      );
      return sourceEventId;
    }

    return null;
  }

  private async resolveSubscriptionId(
    job: Job<BillingWarningRenewalFailedData>,
  ): Promise<number | null> {
    const explicit = job.data.storeSubscriptionId;
    if (explicit && Number.isInteger(explicit) && explicit > 0) {
      return explicit;
    }
    const sub = await this.prisma.store_subscriptions.findFirst({
      where: { store_id: job.data.storeId },
      select: { id: true },
    });
    return sub?.id ?? null;
  }

  private async dispatchNotification(storeId: number): Promise<boolean> {
    try {
      const result = await this.notificationsService.createAndBroadcast(
        storeId,
        'auto_renew_charge_failed',
        'Tu renovación automática falló',
        'El cobro automático de tu suscripción no pudo completarse. Actualiza tu método de pago para evitar la interrupción del servicio.',
        { route: '/admin/subscription/payment' },
      );
      if (result) {
        this.logger.log(
          `BILLING_WARNING_NOTIFICATION_SENT storeId=${storeId}`,
        );
        return true;
      }
      this.logger.warn(
        `BILLING_WARNING_NOTIFICATION_NOOP storeId=${storeId} — service returned null`,
      );
      return false;
    } catch (err: any) {
      this.logger.error(
        `BILLING_WARNING_NOTIFICATION_FAILED storeId=${storeId} err=${err?.message ?? err}`,
        err?.stack,
      );
      return false;
    }
  }

  private async enqueueEmail(
    storeId: number,
    storeSubscriptionId: number | null,
  ): Promise<boolean> {
    try {
      await this.emailQueue.add(
        'subscription.billing.renewal-failed.email',
        {
          storeId,
          subscriptionId: storeSubscriptionId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
      this.logger.log(
        `BILLING_WARNING_EMAIL_ENQUEUED storeId=${storeId}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(
        `BILLING_WARNING_EMAIL_ENQUEUE_FAILED storeId=${storeId} err=${err?.message ?? err}`,
        err?.stack,
      );
      return false;
    }
  }
}
