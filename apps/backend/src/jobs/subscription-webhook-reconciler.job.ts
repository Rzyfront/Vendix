import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { WompiProcessor } from '../domains/store/payments/processors/wompi/wompi.processor';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from '../domains/superadmin/subscriptions/gateway/platform-gateway.service';
import { SubscriptionWebhookService } from '../domains/store/subscriptions/services/subscription-webhook.service';
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import { PlatformGatewayEnvironmentEnum } from '../domains/superadmin/subscriptions/gateway/dto/upsert-gateway.dto';
import {
  WompiConfig,
  WompiEnvironment,
} from '../domains/store/payments/processors/wompi/wompi.types';

/**
 * Threshold above which a single reconciler run is considered systemically
 * abnormal (Wompi delivery outage, firewall blocking webhook, dedup table
 * misconfigured). Triggers a WARN-level structured log so on-call alerting
 * can react.
 */
const HIGH_VOLUME_RECOVERY_THRESHOLD = 5;

interface ReconcileSummary {
  scanned: number;
  recovered: number;
  noop: number;
  errors: number;
  duration_ms: number;
}

/**
 * Reconciles SaaS subscription invoices whose Wompi webhook may have been
 * lost or never delivered. Polls Wompi's REST API for transactions associated
 * with `issued` **and `void`** invoices that still have a `pending` payment
 * row, and synthesizes a webhook event into `SubscriptionWebhookService` so
 * the rest of the pipeline (commission accrual, state promotion, emails) runs
 * as if the webhook had arrived normally.
 *
 * Por qué `void` también entra al barrido (incidente 17/08/2026, Multimarcas
 * Ever): `ReconcileStuckPendingJob` corre CADA 5 MINUTOS y anula toda factura
 * `issued` con más de 60 min sin webhook; este reparador corre CADA 30. En una
 * ventana de media hora el destructor siempre gana: en cuanto la factura pasa
 * a `void` desaparecía de este `where` y el pago aprobado quedaba
 * irrecuperable por cron — hubo que reparar la base a mano. Mirar sólo
 * `issued` no era un filtro conservador, era una carrera perdida de antemano.
 *
 * Idempotency: `SubscriptionWebhookService.handleWompiEvent` is idempotent
 * via the `webhook_event_dedup` table (UNIQUE(processor, event_id) +
 * ON CONFLICT DO NOTHING), so calling it twice for the same Wompi
 * transaction id is a safe no-op.
 *
 * Observability: every action emits a structured JSON log line with a
 * batch-scoped `run_id` so a single reconciler pass can be traced end to
 * end. A summary log fires at the end of every run; a WARN-level
 * `WEBHOOK_RECONCILE_HIGH_VOLUME` log fires when recoveries exceed
 * `HIGH_VOLUME_RECOVERY_THRESHOLD` to flag systemic webhook delivery loss.
 *
 * Dry-run: respects `SUBSCRIPTION_CRON_DRY_RUN=true` by skipping the actual
 * webhook synthesis but still emitting structured logs of what would have
 * been done. Safe in production for verification.
 *
 * NOTE: this job runs every 30 minutes.
 */
@Injectable()
export class SubscriptionWebhookReconcilerJob {
  private readonly logger = new Logger(SubscriptionWebhookReconcilerJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly wompiProcessor: WompiProcessor,
    private readonly platformGw: PlatformGatewayService,
    private readonly webhookService: SubscriptionWebhookService,
    // Sólo se usa para la vía de reapertura de facturas `void`. Es el seam que
    // sabe reabrir una anulada y restaurar los `pending_*` que el cron
    // destructivo puso en NULL; internamente reutiliza
    // `markPaymentSucceededFromWebhook`, así que no duplica lógica de éxito.
    private readonly paymentService: SubscriptionPaymentService,
    private readonly gateConfig: SubscriptionGateConfig,
  ) {}

  @Cron('*/30 * * * *')
  async handleReconciliation(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        JSON.stringify({
          event: 'WEBHOOK_RECONCILE_SKIPPED',
          reason: 'already_running',
        }),
      );
      return;
    }
    this.isRunning = true;

    try {
      await this.runOnce();
    } catch (err: any) {
      // runOnce already logs per-invoice and summary; this catches
      // catastrophic failures (DB down, unhandled in setup phase).
      this.logger.error(
        JSON.stringify({
          event: 'WEBHOOK_RECONCILE_BATCH_FAILED',
          error_message: err?.message ?? String(err),
        }),
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Visible for testing — single batch processing pass. Returns the count
   * of invoices that had their state advanced via a synthesized webhook.
   */
  async runOnce(): Promise<number> {
    const runId = randomUUID();
    const startedAt = Date.now();
    const dryRun = this.gateConfig.isCronDryRun();
    const oneDayAgo = new Date(startedAt - 24 * 60 * 60 * 1000);

    // withoutScope: cron has no tenant context. Schema reference:
    // subscription_invoices.state in {draft,issued,paid,partially_paid,
    // overdue,void,refunded}.
    //
    // `void` entra al barrido a propósito: es el estado al que
    // `ReconcileStuckPendingJob` empuja la factura a los 60 min sin webhook, y
    // ese cron NO toca la fila de pago — la deja en `pending`, así que el
    // filtro `payments.some.state = 'pending'` sigue casando. Sin `void` en
    // este `in`, un pago APPROVED cuya factura ya fue anulada no tenía ninguna
    // vía automática de recuperación.
    //
    // El filtro temporal se conserva tal cual: `issued_at` sobrevive a la
    // anulación (el destructor sólo escribe `state` y `updated_at`), así que
    // sigue acotando la ventana a 24h también para las anuladas.
    const candidates = await this.prisma
      .withoutScope()
      .subscription_invoices.findMany({
        where: {
          state: { in: ['issued', 'void'] },
          issued_at: { gte: oneDayAgo },
          payments: { some: { state: 'pending' } },
        },
        select: {
          id: true,
          state: true,
          store_subscription_id: true,
          store_id: true,
          payments: {
            where: { state: 'pending' },
            select: { id: true, gateway_reference: true, metadata: true },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
        take: 50,
      });

    const summary: ReconcileSummary = {
      scanned: candidates.length,
      recovered: 0,
      noop: 0,
      errors: 0,
      duration_ms: 0,
    };

    if (candidates.length === 0) {
      summary.duration_ms = Date.now() - startedAt;
      this.logSummary(runId, summary, dryRun);
      return 0;
    }

    // Resolve platform Wompi creds ONCE per batch; if missing, abort early.
    const platformCreds = await this.platformGw.getActiveCredentials('wompi');
    if (!platformCreds) {
      this.logger.warn(
        JSON.stringify({
          event: 'WEBHOOK_RECONCILE',
          run_id: runId,
          action: 'wompi_lookup_failed',
          outcome: 'error',
          error_message: 'no_active_platform_wompi_credentials',
        }),
      );
      summary.errors = candidates.length;
      summary.duration_ms = Date.now() - startedAt;
      this.logSummary(runId, summary, dryRun);
      return 0;
    }
    const config = this.toWompiConfig(platformCreds);

    for (const inv of candidates) {
      const baseLog = {
        event: 'WEBHOOK_RECONCILE',
        run_id: runId,
        invoice_id: inv.id,
        invoice_state: inv.state,
        subscription_id: inv.store_subscription_id,
      };
      const wasVoided = inv.state === 'void';
      try {
        const payment = inv.payments?.[0];
        if (!payment) {
          summary.noop++;
          this.logger.debug(
            JSON.stringify({
              ...baseLog,
              action: 'no_action',
              outcome: 'noop',
              error_message: 'no_pending_payment_row',
            }),
          );
          continue;
        }

        // Pull the reference: prefer gateway_reference, then metadata.reference.
        const reference =
          payment.gateway_reference ??
          this.extractMetadataReference(payment.metadata);

        if (!reference) {
          summary.noop++;
          this.logger.debug(
            JSON.stringify({
              ...baseLog,
              action: 'no_action',
              outcome: 'noop',
              error_message: 'no_gateway_reference',
            }),
          );
          continue;
        }

        const txn =
          await this.wompiProcessor.getTransactionByReferenceWithConfig(
            reference,
            config,
          );

        if (!txn) {
          summary.noop++;
          this.logger.debug(
            JSON.stringify({
              ...baseLog,
              action: 'no_action',
              outcome: 'noop',
              wompi_status: 'NOT_FOUND',
            }),
          );
          continue;
        }

        const status = (txn.status ?? '').toString().toUpperCase();

        // PENDING and unknown statuses: nothing to do.
        if (status === 'PENDING' || status === '') {
          summary.noop++;
          this.logger.debug(
            JSON.stringify({
              ...baseLog,
              action: 'no_action',
              outcome: 'noop',
              wompi_status: status || 'UNKNOWN',
            }),
          );
          continue;
        }

        // Una factura ya anulada sólo se toca si la pasarela dice APPROVED.
        // Con DECLINED/ERROR/VOIDED no hay nada que recuperar: el `void` ya es
        // el desenlace correcto y el cron destructivo ya revirtió la
        // suscripción. Sintetizar el webhook igualmente quemaría la clave de
        // dedup (`wompi_platform`, txn.id) sin cambiar ningún estado, y dejaría
        // ciego un webhook real posterior sobre esa misma transacción.
        if (wasVoided && status !== 'APPROVED') {
          summary.noop++;
          this.logger.debug(
            JSON.stringify({
              ...baseLog,
              action: 'no_action',
              outcome: 'noop',
              wompi_status: status,
              error_message: 'void_invoice_non_approved',
            }),
          );
          continue;
        }

        if (
          status === 'APPROVED' ||
          status === 'DECLINED' ||
          status === 'ERROR' ||
          status === 'VOIDED'
        ) {
          if (dryRun) {
            // Dry-run: log what would have been recovered without mutating.
            summary.recovered++;
            this.logger.log(
              JSON.stringify({
                ...baseLog,
                action: wasVoided
                  ? 'reopened_void_invoice'
                  : 'recovered_payment',
                outcome: 'success',
                wompi_status: status,
                dry_run: true,
              }),
            );
            continue;
          }

          if (wasVoided) {
            // Reapertura de anulada. NO se sintetiza el webhook por
            // `handleWompiEvent`: ese camino promueve la suscripción pero no
            // sabe que el cron destructivo dejó los `pending_*` en NULL, y el
            // cambio de plan pagado se perdería. `syncInvoiceFromGateway` es
            // el seam que reabre la factura y restaura esos campos, y por
            // dentro reutiliza `markPaymentSucceededFromWebhook` — la MISMA
            // lógica de éxito del webhook, sin duplicarla acá.
            //
            // Ojo con la clave de búsqueda: ese servicio releo la transacción
            // por su cuenta usando `metadata.reference`, mientras este job la
            // resolvió con `gateway_reference ?? metadata.reference`. Si un
            // pago tiene la referencia sólo en `gateway_reference`, el sync
            // devolverá `pending` y la factura seguirá anulada; queda contado
            // como noop y visible en el log, no silenciado.
            const syncResult = await this.paymentService.syncInvoiceFromGateway(
              inv.id,
            );

            if (syncResult.status !== 'paid') {
              summary.noop++;
              this.logger.warn(
                JSON.stringify({
                  ...baseLog,
                  action: 'reopen_void_invoice_failed',
                  outcome: 'noop',
                  wompi_status: status,
                  wompi_txn_id: txn.id ?? null,
                  sync_status: syncResult.status,
                }),
              );
              continue;
            }

            summary.recovered++;
            // WARN a propósito y con evento greppeable: reabrir una factura
            // anulada nunca es rutina — significa que el cron destructivo se
            // adelantó a un pago real y que un cliente estuvo sin servicio.
            this.logger.warn(
              JSON.stringify({
                event: 'RECONCILER_REOPENED_VOID_INVOICE',
                run_id: runId,
                invoice_id: inv.id,
                subscription_id: inv.store_subscription_id,
                store_id: inv.store_id,
                transaction_id: txn.id ?? null,
                wompi_status: status,
              }),
            );
            continue;
          }

          // SubscriptionWebhookService is idempotent via webhook_event_dedup.
          await this.webhookService.handleWompiEvent({
            subscriptionId: inv.store_subscription_id,
            invoiceId: inv.id,
            body: { data: { transaction: txn } },
          });
          summary.recovered++;
          this.logger.log(
            JSON.stringify({
              ...baseLog,
              action: 'recovered_payment',
              outcome: 'success',
              wompi_status: status,
              wompi_txn_id: txn.id ?? null,
            }),
          );
        } else {
          summary.noop++;
          this.logger.debug(
            JSON.stringify({
              ...baseLog,
              action: 'no_action',
              outcome: 'noop',
              wompi_status: status,
              error_message: 'unhandled_status',
            }),
          );
        }
      } catch (perInvErr: any) {
        // Per-invoice failures must NOT abort the batch.
        summary.errors++;
        this.logger.error(
          JSON.stringify({
            ...baseLog,
            action: 'wompi_lookup_failed',
            outcome: 'error',
            error_message: perInvErr?.message ?? String(perInvErr),
          }),
          perInvErr?.stack,
        );
      }
    }

    summary.duration_ms = Date.now() - startedAt;
    this.logSummary(runId, summary, dryRun);

    if (summary.recovered > HIGH_VOLUME_RECOVERY_THRESHOLD) {
      this.logger.warn(
        JSON.stringify({
          event: 'WEBHOOK_RECONCILE_HIGH_VOLUME',
          run_id: runId,
          recovered: summary.recovered,
          scanned: summary.scanned,
          threshold: HIGH_VOLUME_RECOVERY_THRESHOLD,
          hint: 'wompi_delivery_outage_or_dedup_misconfigured',
        }),
      );
    }

    return summary.recovered;
  }

  private logSummary(
    runId: string,
    summary: ReconcileSummary,
    dryRun: boolean,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'WEBHOOK_RECONCILE_SUMMARY',
        run_id: runId,
        dry_run: dryRun,
        ...summary,
      }),
    );
  }

  private extractMetadataReference(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const ref = (metadata as Record<string, unknown>).reference;
    return typeof ref === 'string' && ref.length > 0 ? ref : null;
  }

  /**
   * Mirror of SubscriptionPaymentService.toProcessorWompiConfig — keep the
   * platform→processor environment mapping in one shape only. Two different
   * enums describe the same thing for historical reasons.
   */
  private toWompiConfig(creds: DecryptedCreds): WompiConfig {
    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret,
      integrity_secret: creds.integrity_secret,
      environment:
        creds.environment === PlatformGatewayEnvironmentEnum.PRODUCTION
          ? WompiEnvironment.PRODUCTION
          : WompiEnvironment.SANDBOX,
    };
  }
}
