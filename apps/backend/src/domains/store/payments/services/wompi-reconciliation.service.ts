import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WompiProcessor } from '../processors/wompi/wompi.processor';
import {
  WompiConfig,
  WompiEnvironment,
  WompiTransactionData,
  WompiTransactionStatus,
} from '../processors/wompi/wompi.types';
import { PaymentEncryptionService } from './payment-encryption.service';
import { WebhookHandlerService } from './webhook-handler.service';

/**
 * Periodic reconciliation cron for Wompi payments stuck in `pending`.
 *
 * Why: webhook delivery failures, processor outages, or async flows
 * (PSE / NEQUI / BANCOLOMBIA_TRANSFER) where Wompi only emits the final
 * webhook after the user confirms in their bank app — sometimes hours
 * later, sometimes never. Without a poll-based safety net the local
 * payment row stays `pending` forever and the order is never fulfilled
 * even though Wompi has already settled it.
 *
 * Strategy:
 *  - Every 15 min, scan `payments` rows with state = pending and
 *    age in [5 min, 24 h] whose method type is `wompi`.
 *  - For each row, configure a per-tenant WompiClient using the store's
 *    decrypted custom_config and ask Wompi for the canonical status
 *    (lookup by gateway_reference first, fallback to transaction_id).
 *  - Hand the resulting txn off to `WebhookHandlerService.applyWompiTransaction`
 *    — same atomic CAS-based code path used by webhook arrivals and the
 *    frontend force-confirm flow. Idempotent by construction.
 *
 * Safety:
 *  - Uses `prisma.withoutScope()` (no tenant context in cron — webhook
 *    handler does the same).
 *  - Batched (50 per run) to stay under Wompi rate limits.
 *  - Upper-bound on age (24h) avoids resurrecting ancient garbage rows.
 *  - Per-payment try/catch + circuit breaker after 5 consecutive errors
 *    (5 min cooldown) — protects against Wompi outage cascading into the
 *    rest of the cron jobs.
 *  - Top-level try/catch so a single bad batch never crashes the
 *    scheduler.
 *  - Feature flag `WOMPI_RECONCILIATION_ENABLED` (default: enabled). Set
 *    to `false` to disable in emergencies without a redeploy.
 */
@Injectable()
export class WompiReconciliationService {
  private readonly logger = new Logger(WompiReconciliationService.name);

  // Circuit breaker state — opens after N consecutive errors and stays
  // open for COOLDOWN_MS to give the upstream time to recover.
  private circuitBreakerOpen = false;
  private circuitBreakerOpenedAt: Date | null = null;
  private consecutiveErrors = 0;

  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly BATCH_SIZE = 50;
  private static readonly MIN_AGE_MS = 5 * 60 * 1000; // 5 min
  private static readonly MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly wompiProcessor: WompiProcessor,
    private readonly paymentEncryption: PaymentEncryptionService,
    private readonly webhookHandler: WebhookHandlerService,
  ) {}

  /**
   * Every 15 minutes. Cron expression chosen to balance:
   *  - Reasonable latency for the user (worst case ~15min between Wompi
   *    final-status and order fulfilment).
   *  - Low Wompi API pressure (≤ 50 GETs every 15 min per backend instance).
   */
  @Cron('*/15 * * * *')
  async reconcilePendingWompiPayments(): Promise<void> {
    if (process.env.WOMPI_RECONCILIATION_ENABLED === 'false') {
      this.logger.debug('Wompi reconciliation disabled by env flag');
      return;
    }

    if (this.isCircuitBreakerTripped()) {
      this.logger.warn(
        'Wompi reconciliation circuit breaker open — skipping run',
      );
      return;
    }

    try {
      await this.runReconciliationBatch();
    } catch (err) {
      // Top-level safety net: never let an unexpected error crash the
      // scheduler or take down the backend on first run.
      this.logger.error(
        `Wompi reconciliation top-level error: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  private isCircuitBreakerTripped(): boolean {
    if (!this.circuitBreakerOpen) return false;

    const elapsed =
      Date.now() - (this.circuitBreakerOpenedAt?.getTime() ?? 0);

    if (elapsed >= WompiReconciliationService.CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Cooldown elapsed — reset breaker for next run.
      this.circuitBreakerOpen = false;
      this.circuitBreakerOpenedAt = null;
      this.consecutiveErrors = 0;
      this.logger.log(
        'Wompi reconciliation circuit breaker reset after cooldown',
      );
      return false;
    }

    return true;
  }

  private async runReconciliationBatch(): Promise<void> {
    const now = Date.now();
    const minAgeCutoff = new Date(
      now - WompiReconciliationService.MIN_AGE_MS,
    );
    const maxAgeCutoff = new Date(
      now - WompiReconciliationService.MAX_AGE_MS,
    );

    // Cron has no tenant context: use withoutScope() to bypass scope
    // (webhook flow does the exact same thing).
    const stalePayments = await this.prisma
      .withoutScope()
      .payments.findMany({
        where: {
          state: 'pending',
          created_at: { lt: minAgeCutoff, gt: maxAgeCutoff },
          store_payment_method: {
            system_payment_method: { type: 'wompi' },
          },
        },
        include: {
          store_payment_method: {
            include: { system_payment_method: true },
          },
        },
        orderBy: { created_at: 'asc' },
        take: WompiReconciliationService.BATCH_SIZE,
      });

    if (stalePayments.length === 0) {
      this.logger.debug('No stale Wompi payments to reconcile');
      return;
    }

    this.logger.log(
      `Reconciling ${stalePayments.length} stale Wompi payments`,
    );

    let succeeded = 0;
    let failed = 0;
    let unchanged = 0;

    for (const payment of stalePayments) {
      try {
        const result = await this.reconcileOne(payment);
        if (result === 'transitioned') succeeded++;
        else unchanged++;
        this.consecutiveErrors = 0; // reset on success
      } catch (err) {
        failed++;
        this.consecutiveErrors++;
        this.logger.warn(
          `Reconcile error for payment ${payment.id}: ${err?.message ?? err}`,
        );

        if (
          this.consecutiveErrors >=
          WompiReconciliationService.CIRCUIT_BREAKER_THRESHOLD
        ) {
          this.circuitBreakerOpen = true;
          this.circuitBreakerOpenedAt = new Date();
          this.logger.error(
            `Wompi reconciliation circuit breaker tripped after ${this.consecutiveErrors} consecutive errors — halting batch`,
          );
          break;
        }
      }
    }

    this.logger.log(
      `Reconciliation done: transitioned=${succeeded} unchanged=${unchanged} failed=${failed}`,
    );
  }

  /**
   * Returns 'transitioned' when the payment moved out of pending,
   * 'unchanged' when Wompi still reports pending or has no record yet.
   * Throws on transport / decryption errors so the outer loop can count
   * them toward the circuit breaker.
   */
  private async reconcileOne(payment: any): Promise<'transitioned' | 'unchanged'> {
    const storePaymentMethod = payment.store_payment_method;
    if (!storePaymentMethod?.custom_config) {
      this.logger.debug(
        `Payment ${payment.id}: store_payment_method has no custom_config — skipping`,
      );
      return 'unchanged';
    }

    // Decrypt per-tenant Wompi credentials. Same pattern used by
    // WompiWebhookValidatorService — webhook flow has no tenant context
    // either.
    const decrypted = this.paymentEncryption.decryptConfig(
      storePaymentMethod.custom_config as Record<string, any>,
      'wompi',
    );

    if (!decrypted.public_key || !decrypted.private_key) {
      this.logger.debug(
        `Payment ${payment.id}: incomplete Wompi credentials — skipping`,
      );
      return 'unchanged';
    }

    const wompiConfig: WompiConfig = {
      public_key: decrypted.public_key,
      private_key: decrypted.private_key,
      events_secret: decrypted.events_secret || '',
      integrity_secret: decrypted.integrity_secret || '',
      environment:
        (decrypted.environment as WompiEnvironment) ||
        WompiEnvironment.SANDBOX,
    };

    // Configure the shared WompiClient with this store's credentials.
    // (Cron is single-threaded per Node instance: each iteration
    // configures + calls + completes before the next iteration starts.)
    const client = this.wompiProcessor.getClient();
    client.configure(wompiConfig);

    // Lookup priority:
    //  1. gateway_reference  -> /v1/transactions/?reference=<ref>
    //  2. transaction_id     -> /v1/transactions/<id>     (only if it
    //                            looks like a real Wompi id, not the
    //                            legacy `wompi_*` placeholder format)
    let txn: WompiTransactionData | null = null;

    if (payment.gateway_reference) {
      txn = await this.wompiProcessor.getTransactionByReference(
        payment.gateway_reference,
      );
    }

    if (
      !txn &&
      payment.transaction_id &&
      !String(payment.transaction_id).startsWith('wompi_')
    ) {
      const status = await this.wompiProcessor.getPaymentStatus(
        payment.transaction_id,
      );
      // getPaymentStatus returns a normalised object; recover the raw
      // gateway response so we can hand it off to applyWompiTransaction.
      txn = (status?.gatewayResponse as WompiTransactionData) ?? null;
    }

    if (!txn) {
      this.logger.debug(
        `Payment ${payment.id}: Wompi has no matching transaction yet`,
      );
      return 'unchanged';
    }

    if (txn.status === WompiTransactionStatus.PENDING) {
      this.logger.debug(
        `Payment ${payment.id}: Wompi still reports PENDING`,
      );
      return 'unchanged';
    }

    // Reuse the same atomic, idempotent state machine the webhook uses.
    // applyWompiTransaction wraps lookup + CAS update + order transition
    // in a single transaction; running it twice on a final-state txn
    // is a no-op.
    const mappedStatus = await this.webhookHandler.applyWompiTransaction(
      txn,
      { transaction: txn, source: 'wompi-reconciliation-cron' },
    );

    if (mappedStatus) {
      this.logger.log(
        `Payment ${payment.id} reconciled: wompi=${txn.status} -> local=${mappedStatus}`,
      );
      return 'transitioned';
    }

    return 'unchanged';
  }
}
