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
 * with `issued` invoices that still have a `pending` payment row, and
 * synthesizes a webhook event into `SubscriptionWebhookService` so the rest
 * of the pipeline (commission accrual, state promotion, emails) runs as if
 * the webhook had arrived normally.
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
    // overdue,void,refunded}; we look at `issued` only.
    const candidates = await this.prisma
      .withoutScope()
      .subscription_invoices.findMany({
        where: {
          state: 'issued',
          issued_at: { gte: oneDayAgo },
          payments: { some: { state: 'pending' } },
        },
        select: {
          id: true,
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
        subscription_id: inv.store_subscription_id,
      };
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
                action: 'recovered_payment',
                outcome: 'success',
                wompi_status: status,
                dry_run: true,
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
