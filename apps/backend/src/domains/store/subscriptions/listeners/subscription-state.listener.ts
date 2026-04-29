import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import { PromotionalApplyService } from '../services/promotional-apply.service';
import { Prisma } from '@prisma/client';

/**
 * Payload emitted by:
 *  - SubscriptionPaymentService.handleChargeSuccess (sync charge + webhook
 *    flow) — carries subscriptionId + storeId resolved from the invoice.
 *  - SubscriptionWebhookService.handleWompiEvent — observability hook with
 *    the same shape (subscriptionId + storeId may be present).
 *
 * `storeId` is required for SubscriptionStateService.transition() (which
 * locks `store_subscriptions` by `store_id`). When missing we resolve it
 * from the invoice as a fallback.
 */
interface PaymentSucceededEventPayload {
  invoiceId: number;
  paymentId: number;
  subscriptionId?: number;
  storeId?: number;
  source?: string;
}

/**
 * Auto-promotes a subscription to `active` the moment its payment is
 * confirmed.
 *
 * Triggered by `subscription.payment.succeeded`, which fires from:
 *  - `SubscriptionPaymentService.handleChargeSuccess` (post-commit) for
 *    both the synchronous `charge()` path and the webhook-driven
 *    `markPaymentSucceededFromWebhook` path.
 *  - `SubscriptionWebhookService.handleWompiEvent` as an observability hook
 *    (same event name, idempotent on listener side).
 *
 * Promotable source states (G12 — full state engine event-driven recovery):
 *  - `pending_payment` — fresh purchase awaiting first Wompi confirmation.
 *  - `grace_soft`, `grace_hard` — recovered after a missed renewal.
 *  - `suspended` — recovered after dunning suspended the subscription.
 *  - `blocked` — recovered after dunning blocked the subscription.
 *
 * Idempotency: the underlying `transition()` already runs inside a
 * Serializable tx with `SELECT ... FOR UPDATE` on the subscription row and
 * is a no-op when source === target. Duplicate webhooks are safe — both
 * land in the same critical section and the second one short-circuits.
 * We do NOT add a separate advisory lock here: the row-level lock taken by
 * `transition()` already prevents the cron + webhook race for the same
 * subscription.
 *
 * Errors are caught and logged. Webhook responses MUST NOT fail because of
 * a state-promotion hiccup — the daily 03:00 dunning cron remains the
 * canonical safety net and will reconcile any subscription this listener
 * failed to promote.
 *
 * Rollout plan for `SUBSCRIPTION_EVENT_DRIVEN_STATE`:
 *  1. Deploy with flag `=false` (default). Listener runs in log-only mode
 *     and emits `STATE_ENGINE_OBSERVATION` rows whenever it WOULD have
 *     promoted. The cron remains the source of truth.
 *  2. Observe logs for ~7 days. Verify each `STATE_ENGINE_OBSERVATION`
 *     matches a corresponding cron decision the next 03:00 UTC run.
 *  3. Flip flag to `=true` in staging. Observe `STATE_ENGINE_EVENT_RECOVERY`
 *     log volume + verify customers regain access immediately after paying.
 *     Run for ~3 days.
 *  4. Flip flag to `=true` in prod. Cron stays as a redundant safety net
 *     (idempotent — re-evaluating an already-active sub is a no-op).
 */
@Injectable()
export class SubscriptionStateListener {
  private readonly logger = new Logger(SubscriptionStateListener.name);

  // States from which a successful payment SHOULD promote the subscription
  // back to `active`. Excludes terminal states (cancelled/expired) and
  // already-active/trial states (which are no-ops anyway).
  //
  // Split in two tiers (G12):
  //  - PROMOTABLE_PENDING — first-payment activation, always-on (G3 baseline).
  //  - PROMOTABLE_RECOVERY — recovery from dunning, gated by
  //    `SUBSCRIPTION_EVENT_DRIVEN_STATE` for staged rollout. The daily 03:00
  //    cron is the canonical fallback while the flag is off.
  private static readonly PROMOTABLE_PENDING: readonly string[] = [
    'pending_payment',
  ];
  private static readonly PROMOTABLE_RECOVERY: readonly string[] = [
    'grace_soft',
    'grace_hard',
    'suspended',
    'blocked',
  ];

  /**
   * Read the `SUBSCRIPTION_EVENT_DRIVEN_STATE` env flag at handler time
   * (not at module load) so tests + staged rollouts can flip without
   * a process restart.
   *
   *  - `'true'`  → enforce: the listener calls `transition()` to promote
   *    recovery states (grace_soft, grace_hard, suspended, blocked → active).
   *  - anything else (default) → log-only: emits `STATE_ENGINE_OBSERVATION`
   *    so we can compare what the listener WOULD do vs what the cron
   *    actually does. The cron is the source of truth in this mode.
   *
   * The first-payment path (`pending_payment → active`) is always enforced
   * — it predates G12 and there is no cron fallback for it.
   */
  private isEventDrivenStateEnabled(): boolean {
    return process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE === 'true';
  }

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly accessService: SubscriptionAccessService,
    private readonly promotional: PromotionalApplyService,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  /**
   * S2.1 — Best-effort coupon application after a `pending_payment → active`
   * transition. Reads `pending_coupon_code` from store_subscriptions.metadata
   * (set by the checkout commit) and applies it. Clears the metadata key on
   * success so re-runs are no-ops.
   */
  private async applyPendingCoupon(
    subscriptionId: number,
    storeId: number,
  ): Promise<void> {
    try {
      const sub = await this.prisma
        .withoutScope()
        .store_subscriptions.findUnique({
          where: { id: subscriptionId },
          select: { id: true, metadata: true },
        });
      const metadata =
        sub?.metadata && typeof sub.metadata === 'object'
          ? (sub.metadata as Record<string, unknown>)
          : null;
      const code =
        metadata && typeof metadata.pending_coupon_code === 'string'
          ? (metadata.pending_coupon_code as string)
          : null;
      if (!code) return;

      await this.promotional.applyCoupon(storeId, code, null);

      // Clear the pending key so the listener doesn't re-apply on subsequent
      // promotions of the same subscription.
      const next = { ...metadata };
      delete next.pending_coupon_code;
      await this.prisma.withoutScope().store_subscriptions.update({
        where: { id: subscriptionId },
        data: {
          metadata: (Object.keys(next).length
            ? next
            : Prisma.DbNull) as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `applyPendingCoupon failed (sub=${subscriptionId}): ${err?.message ?? err}`,
      );
    }
  }

  @OnEvent('subscription.payment.succeeded')
  async onPaymentSucceeded(
    payload: PaymentSucceededEventPayload,
  ): Promise<void> {
    try {
      // Resolve subscriptionId + storeId. They may be missing on the
      // observability emit from SubscriptionWebhookService when the upstream
      // emitter wasn't updated. Fall back to invoice lookup.
      let subscriptionId = payload?.subscriptionId;
      let storeId = payload?.storeId;

      if (!subscriptionId || !storeId) {
        if (!Number.isInteger(payload?.invoiceId) || payload?.invoiceId <= 0) {
          this.logger.warn(
            'subscription.payment.succeeded: invalid payload, no invoiceId to resolve from',
          );
          return;
        }

        // withoutScope: webhook/event flow has no tenant context.
        const invoice = await this.prisma
          .withoutScope()
          .subscription_invoices.findUnique({
            where: { id: payload.invoiceId },
            select: { store_subscription_id: true, store_id: true },
          });

        if (!invoice) {
          this.logger.warn(
            `subscription.payment.succeeded: invoice ${payload.invoiceId} not found`,
          );
          return;
        }

        subscriptionId = subscriptionId ?? invoice.store_subscription_id;
        storeId = storeId ?? invoice.store_id;
      }

      if (!subscriptionId || !storeId) {
        this.logger.warn(
          `subscription.payment.succeeded: could not resolve subscriptionId/storeId (invoice=${payload?.invoiceId})`,
        );
        return;
      }

      const sub = await this.prisma
        .withoutScope()
        .store_subscriptions.findUnique({
          where: { id: subscriptionId },
          select: { id: true, state: true, store_id: true },
        });

      if (!sub) {
        this.logger.warn(
          `subscription.payment.succeeded: subscription ${subscriptionId} not found`,
        );
        return;
      }

      // If the webhook already promoted the subscription synchronously
      // (handleChargeSuccess now does the transition in-tx), the sub is
      // already 'active' by the time we get here. Skip the call to
      // transition() (which would no-op anyway) and proceed straight to
      // side effects: coupon apply, confirmation email, commission outbox.
      // This prevents misleading "illegal transition" log noise and avoids
      // a redundant DB roundtrip for the SELECT FOR UPDATE.
      if (sub.state === 'active') {
        this.logger.log({
          msg: 'STATE_ENGINE_ALREADY_ACTIVE',
          subscriptionId: sub.id,
          storeId: sub.store_id,
          source: payload?.source ?? 'unknown',
          invoiceId: payload.invoiceId,
          paymentId: payload.paymentId,
          note: 'subscription already active, skipping state transition (likely promoted synchronously by webhook)',
        });

        // Still run the post-activation side effects: a coupon registered
        // at checkout might not yet be applied if the synchronous webhook
        // path beat us here, and the confirmation email must be sent.
        await this.applyPendingCoupon(sub.id, sub.store_id);

        try {
          await this.emailQueue.add(
            'payment.confirmed.email',
            {
              invoiceId: payload.invoiceId,
              paymentId: payload.paymentId,
              storeId: sub.store_id,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: { count: 50 },
              removeOnFail: { count: 50 },
            },
          );
        } catch (enqueueErr: any) {
          this.logger.warn(
            `Failed to enqueue payment confirmation email for invoice ${payload.invoiceId}: ${enqueueErr?.message ?? enqueueErr}`,
          );
        }

        return;
      }

      const isPending =
        SubscriptionStateListener.PROMOTABLE_PENDING.includes(
          sub.state as string,
        );
      const isRecovery =
        SubscriptionStateListener.PROMOTABLE_RECOVERY.includes(
          sub.state as string,
        );

      if (!isPending && !isRecovery) {
        this.logger.debug({
          msg: 'STATE_ENGINE_NO_CHANGE',
          subscriptionId: sub.id,
          state: sub.state,
          reason: 'not_in_promotable_set',
          source: payload?.source ?? 'unknown',
          invoiceId: payload.invoiceId,
          paymentId: payload.paymentId,
        });
        return;
      }

      // Recovery transitions (grace_*/suspended/blocked → active) are gated
      // by SUBSCRIPTION_EVENT_DRIVEN_STATE for staged rollout. The first-
      // payment path (pending_payment → active) is always enforced.
      const enforce = isPending || this.isEventDrivenStateEnabled();

      if (!enforce) {
        // Log-only mode for recovery transitions (default during rollout).
        // The daily 03:00 cron remains the source of truth and will
        // reconcile this subscription on its next run. We emit a structured
        // marker so ops can compare listener intent vs cron decision over
        // the 7-day observation window.
        this.logger.log({
          msg: 'STATE_ENGINE_OBSERVATION',
          subscriptionId: sub.id,
          storeId: sub.store_id,
          fromState: sub.state,
          wouldTransitionTo: 'active',
          source: payload?.source ?? 'unknown',
          invoiceId: payload.invoiceId,
          paymentId: payload.paymentId,
          flag: 'SUBSCRIPTION_EVENT_DRIVEN_STATE=false',
        });
        return;
      }

      // Enforce mode (pending always, recovery only when flag is on).
      // `transition()` is Serializable + SELECT FOR UPDATE on the row, so
      // duplicate webhooks and the cron race safely — the second writer
      // no-ops on the same-state guard inside transition().
      await this.stateService.transition(sub.store_id, 'active', {
        reason: 'payment_succeeded_webhook',
        triggeredByJob: 'subscription-state-listener',
        payload: {
          invoice_id: payload.invoiceId,
          payment_id: payload.paymentId,
          source: payload.source ?? 'unknown',
          previous_state: sub.state,
        },
      });

      this.logger.log({
        msg: isRecovery
          ? 'STATE_ENGINE_EVENT_RECOVERY'
          : 'STATE_ENGINE_EVENT_ACTIVATION',
        subscriptionId: sub.id,
        storeId: sub.store_id,
        fromState: sub.state,
        toState: 'active',
        source: payload?.source ?? 'unknown',
        invoiceId: payload.invoiceId,
        paymentId: payload.paymentId,
      });

      // S2.1 — After a pending_payment → active transition, apply any
      // coupon that was registered at checkout time but couldn't be applied
      // until the subscription was active.
      if (isPending) {
        await this.applyPendingCoupon(sub.id, sub.store_id);
      }

      // Enqueue payment confirmation email asynchronously.
      try {
        await this.emailQueue.add(
          'payment.confirmed.email',
          {
            invoiceId: payload.invoiceId,
            paymentId: payload.paymentId,
            storeId,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );
      } catch (enqueueErr: any) {
        this.logger.warn(
          `Failed to enqueue payment confirmation email for invoice ${payload.invoiceId}: ${enqueueErr?.message ?? enqueueErr}`,
        );
      }
    } catch (e: any) {
      // Best-effort: never re-throw. The daily dunning cron will reconcile
      // any subscription this listener failed to promote.
      this.logger.error(
        `subscription.payment.succeeded handler failed (invoice=${payload?.invoiceId}, payment=${payload?.paymentId}): ${e?.message ?? e}`,
        e?.stack,
      );
    }
  }

  /**
   * React to every state transition emitted by SubscriptionStateService:
   *  - Always invalidate the access cache (defensive: transition() also does
   *    this post-commit, but a race with a parallel resolve in another
   *    process could rehydrate stale data).
   *  - Welcome email on first activation from draft/trial.
   *  - Cancellation email (with no-refund notice) on transition to cancelled.
   *  - Reactivation email when a sub recovers from a non-active state.
   *
   * Payload shape mirrors what `SubscriptionStateService.transition` (and
   * `scheduleCancel`) emit:
   *   { storeId, fromState, toState, reason?, triggeredByUserId?,
   *     triggeredByJob? }
   *
   * Note: `subscriptionId` is NOT in the original emit payload — we resolve
   * it on demand from `storeId` so downstream email templates can reference
   * the canonical subscription row.
   */
  @OnEvent('subscription.state.changed')
  async onStateChanged(payload: {
    storeId: number;
    fromState: string;
    toState: string;
    reason?: string;
    triggeredByUserId?: number;
    triggeredByJob?: string;
  }): Promise<void> {
    try {
      if (!Number.isInteger(payload?.storeId) || payload.storeId <= 0) {
        this.logger.warn(
          'subscription.state.changed: invalid payload, missing storeId',
        );
        return;
      }

      // Always invalidate cache — defensive even though transition() already
      // does this post-commit. Cheap, idempotent.
      try {
        await this.accessService.invalidateCache(payload.storeId);
      } catch (cacheErr: any) {
        this.logger.warn(
          `subscription.state.changed: cache invalidation failed for store ${payload.storeId}: ${cacheErr?.message ?? cacheErr}`,
        );
      }

      const { fromState, toState } = payload;

      // Welcome — first activation from draft or trial.
      if ((fromState === 'draft' || fromState === 'trial') && toState === 'active') {
        const subscriptionId = await this.resolveSubscriptionId(payload.storeId);
        await this.enqueueEmail('subscription.welcome.email', {
          subscriptionId,
          storeId: payload.storeId,
          fromState,
          toState,
        });
        return;
      }

      // Cancellation — must include the no-refund disclaimer flag for G10.
      if (toState === 'cancelled') {
        const subscriptionId = await this.resolveSubscriptionId(payload.storeId);
        await this.enqueueEmail('subscription.cancellation.email', {
          subscriptionId,
          storeId: payload.storeId,
          fromState,
          toState,
          reason: payload.reason,
          includeNoRefundNotice: true,
        });
        return;
      }

      // Reactivation — recovered to active from a blocking state.
      if (
        toState === 'active' &&
        ['cancelled', 'expired', 'suspended', 'blocked'].includes(fromState)
      ) {
        const subscriptionId = await this.resolveSubscriptionId(payload.storeId);
        await this.enqueueEmail('subscription.reactivation.email', {
          subscriptionId,
          storeId: payload.storeId,
          fromState,
          toState,
        });
        return;
      }
    } catch (e: any) {
      // Best-effort: never re-throw. Other listeners must keep firing.
      this.logger.error(
        `subscription.state.changed handler failed (store=${payload?.storeId}, ${payload?.fromState}->${payload?.toState}): ${e?.message ?? e}`,
        e?.stack,
      );
    }
  }

  private async resolveSubscriptionId(storeId: number): Promise<number | null> {
    try {
      const sub = await this.prisma
        .withoutScope()
        .store_subscriptions.findFirst({
          where: { store_id: storeId },
          select: { id: true },
        });
      return sub?.id ?? null;
    } catch (err: any) {
      this.logger.warn(
        `Could not resolve subscriptionId for store ${storeId}: ${err?.message ?? err}`,
      );
      return null;
    }
  }

  private async enqueueEmail(
    jobName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.emailQueue.add(jobName, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to enqueue ${jobName}: ${err?.message ?? err}`,
      );
    }
  }
}
