import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  Prisma,
  store_subscription_state_enum,
  store_subscriptions,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionAccessService } from './subscription-access.service';

type State = store_subscription_state_enum;

/**
 * Payload shape for `subscription.payment.failed` (emitted by
 * SubscriptionPaymentService.handleChargeFailure).
 *
 * Note: the original emitter only carries { invoiceId, paymentId, reason }.
 * subscriptionId/storeId are resolved on the listener side from invoiceId.
 */
interface PaymentFailedEventPayload {
  invoiceId: number;
  paymentId: number;
  reason: string;
  // Present when emitted from the BullMQ retry processor
  // (`subscription.payment.retry.failed`).
  subscriptionId?: number;
  storeId?: number;
  attempt?: number;
}

/**
 * Allowed transitions between subscription states.
 *
 * `pending_payment` is the parking state for a paid plan whose first invoice
 * has been issued but not yet confirmed by the Wompi webhook. The
 * SubscriptionStateListener auto-promotes it to `active` on
 * `subscription.payment.succeeded`. If the user abandons checkout or the
 * payment is declined, the subscription moves to `cancelled` or `blocked`.
 *
 * `draft → active` is preserved for FREE plans only (effective_price = 0)
 * which skip the invoice/charge cycle entirely. Paid plans MUST flow through
 * `draft → pending_payment → active`.
 *
 * `cancelled` and `expired` admit a single legal exit to `pending_payment`
 * via the re-subscribe checkout path. The first paid invoice promotes them
 * back through the existing pending → active flow.
 */
const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ['pending_payment', 'trial', 'active', 'no_plan'],
  pending_payment: ['active', 'blocked', 'cancelled', 'expired', 'no_plan'],
  // RNC-15 anti-arrastre: trial → pending_payment is allowed when the user
  // upgrades from a trial (free) to a paid plan via checkout. The charge runs
  // and on Wompi APPROVED the listener flips pending_payment → active.
  trial: ['active', 'pending_payment', 'blocked', 'cancelled', 'expired'],
  // ADR-7: active → pending_payment allowed for mid-cycle paid plan changes.
  // plan_id only mutates in confirmPendingChange() after gateway confirmation.
  active: ['grace_soft', 'cancelled', 'expired', 'no_plan', 'pending_payment'],
  grace_soft: ['active', 'grace_hard', 'cancelled', 'no_plan'],
  grace_hard: ['active', 'suspended', 'cancelled', 'expired'],
  suspended: ['active', 'blocked', 'cancelled'],
  blocked: ['active', 'cancelled'],
  cancelled: ['pending_payment', 'no_plan'],
  expired: ['pending_payment', 'no_plan'],
  no_plan: ['pending_payment', 'active', 'cancelled'],
};

export interface TransitionOptions {
  reason: string;
  triggeredByUserId?: number;
  triggeredByJob?: string;
  payload?: Record<string, unknown>;
  lockReason?: string;
  graceSoftUntil?: Date;
  graceHardUntil?: Date;
}

/**
 * Mutates `store_subscriptions.state` with a legal transition, writes a
 * `subscription_events` audit row, invalidates access cache, and emits a
 * NestJS event. All inside a Serializable transaction with SELECT FOR UPDATE
 * to prevent TOCTOU races.
 *
 * Concurrency model
 * -----------------
 * Two writers can race on the same subscription:
 *   (a) `SubscriptionStateEngineJob` — daily cron at 03:00 UTC.
 *   (b) `SubscriptionStateListener` — webhook-driven (G12), gated by
 *       `SUBSCRIPTION_EVENT_DRIVEN_STATE`.
 *
 * Both go through `transition()`, which takes a row-level FOR UPDATE lock
 * inside a Serializable tx. The same-state guard makes a second writer's
 * call a no-op — duplicate webhooks and webhook+cron crossings are safe.
 * No additional advisory lock is needed (the row lock already serializes).
 *
 * Rollout for G12 (event-driven recovery from grace soft/hard, suspended,
 * blocked):
 *   1. Deploy with `SUBSCRIPTION_EVENT_DRIVEN_STATE=false` (default).
 *      Listener emits `STATE_ENGINE_OBSERVATION` log markers but does NOT
 *      transition. Cron stays as source of truth.
 *   2. Compare listener observations against cron decisions for ~7 days.
 *   3. Flip flag to `true` in staging; observe `STATE_ENGINE_EVENT_RECOVERY`
 *      for ~3 days.
 *   4. Flip in prod. Cron remains as a redundant safety net (idempotent).
 */
@Injectable()
export class SubscriptionStateService {
  private readonly logger = new Logger(SubscriptionStateService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly accessService: SubscriptionAccessService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async transition(
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const result = await this.prisma.$transaction(
      async (tx: any) =>
        this.transitionInTxInternal(tx, storeId, toState, opts),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Idempotent no-op: nothing to invalidate / emit. Still return the row.
    if (result.noop) {
      return result.updated;
    }

    // Post-commit side effects. Failures here must NOT roll back the
    // transition (it already committed). Log + best-effort only.
    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-transition cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: result.fromState,
      toState,
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return result.updated;
  }

  /**
   * Variant of `transition` that runs INSIDE an externally-provided
   * transaction. Does NOT emit events nor invalidate cache — those are the
   * caller's responsibility to fire AFTER the outer transaction commits, so
   * we don't run side effects on a rolled-back state change.
   *
   * Use this from webhook/payment success paths where the state promotion
   * must be atomic with the payment row update (so a partial commit can
   * never leave a payment 'succeeded' but subscription stuck in
   * 'pending_payment').
   *
   * Idempotency: same-state target is a true no-op (no log row, no update,
   * no throw). Illegal transitions still throw `SUBSCRIPTION_010`.
   */
  async transitionInTx(
    tx: Prisma.TransactionClient,
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }
    const result = await this.transitionInTxInternal(
      tx as any,
      storeId,
      toState,
      opts,
    );
    return result.updated;
  }

  /**
   * Core transition logic shared by `transition()` (opens its own
   * Serializable tx) and `transitionInTx()` (runs inside the caller's tx).
   * Returns `{ noop: true }` when the subscription is already in `toState`
   * so the public API can skip post-commit side effects.
   */
  private async transitionInTxInternal(
    tx: any,
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<{
    noop: boolean;
    fromState: State;
    updated: store_subscriptions;
  }> {
    // FOR UPDATE lock on the subscription row.
    const locked = (await tx.$queryRaw(
      Prisma.sql`SELECT id, state FROM store_subscriptions WHERE store_id = ${storeId} FOR UPDATE`,
    )) as Array<{ id: number; state: State }>;

    if (!locked.length) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const current = locked[0];
    const currentState = current.state;

    // Idempotent short-circuit: same target = true no-op. Log info, skip
    // update + audit row. This guarantees concurrent webhook + cron retries
    // for an already-active sub don't emit redundant events nor throw.
    if (currentState === toState) {
      this.logger.log(
        `transition no-op: store ${storeId} already in state '${toState}' (reason=${opts.reason})`,
      );
      const existing = await tx.store_subscriptions.findUniqueOrThrow({
        where: { id: current.id },
      });
      return { noop: true, fromState: currentState, updated: existing };
    }

    if (!this.isLegalTransition(currentState, toState)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        `Illegal transition ${currentState} -> ${toState}`,
      );
    }

    // Auto-set lock_reason for suspended/blocked transitions
    const lockReason =
      toState === 'suspended' || toState === 'blocked'
        ? (opts.lockReason ?? 'admin_manual')
        : undefined;

    const graceData: Record<string, any> = {};
    if (toState === 'grace_soft') {
      graceData.grace_soft_until = opts.graceSoftUntil ?? undefined;
    }
    if (toState === 'grace_hard') {
      graceData.grace_hard_until = opts.graceHardUntil ?? undefined;
    }
    if (toState === 'active' || toState === 'trial') {
      graceData.grace_soft_until = null;
      graceData.grace_hard_until = null;
    }

    const updatedRow = await tx.store_subscriptions.update({
      where: { id: current.id },
      data: {
        state: toState,
        lock_reason: lockReason ?? undefined,
        updated_at: new Date(),
        ...graceData,
      },
    });

    await tx.subscription_events.create({
      data: {
        store_subscription_id: current.id,
        type: 'state_transition',
        from_state: currentState,
        to_state: toState,
        payload: {
          reason: opts.reason,
          ...(opts.payload ?? {}),
        } as Prisma.InputJsonValue,
        triggered_by_user_id: opts.triggeredByUserId ?? null,
        triggered_by_job: opts.triggeredByJob ?? null,
      },
    });

    return { noop: false, fromState: currentState, updated: updatedRow };
  }

  isLegalTransition(from: State, to: State): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Schedule a subscription to be cancelled at the end of the current billing
   * period. Sets `scheduled_cancel_at` to the subscription's
   * `current_period_end` and disables auto-renew.
   */
  async scheduleCancel(
    storeId: number,
    periodEnd: Date,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const updated = await this.prisma.store_subscriptions.update({
      where: { store_id: storeId },
      data: {
        scheduled_cancel_at: periodEnd,
        auto_renew: false,
        updated_at: new Date(),
      },
    });

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: updated.id,
        type: 'scheduled_cancel',
        from_state: updated.state,
        to_state: 'cancelled',
        payload: {
          reason: opts.reason,
          kind: 'scheduled_cancel',
          scheduled_cancel_at: periodEnd.toISOString(),
        } as Prisma.InputJsonValue,
        triggered_by_user_id: opts.triggeredByUserId ?? null,
        triggered_by_job: opts.triggeredByJob ?? null,
      },
    });

    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-schedule-cancel cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: updated.state,
      toState: 'cancelled',
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return updated;
  }

  /**
   * Revert a scheduled cancellation before period_end.
   * Clears scheduled_cancel_at, restores auto_renew=true.
   * Returns the updated subscription (state stays unchanged).
   */
  async unscheduleCancel(
    storeId: number,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }
    if (!sub.scheduled_cancel_at) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'No scheduled cancellation to revert',
      );
    }

    const updated = await this.prisma.store_subscriptions.update({
      where: { store_id: storeId },
      data: {
        scheduled_cancel_at: null,
        auto_renew: true,
        updated_at: new Date(),
      },
    });

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: updated.id,
        type: 'activated',
        from_state: updated.state,
        to_state: updated.state,
        payload: {
          reason: opts.reason,
          kind: 'scheduled_cancel_voided',
          previous_scheduled_cancel_at: sub.scheduled_cancel_at.toISOString(),
        } as Prisma.InputJsonValue,
        triggered_by_user_id: opts.triggeredByUserId ?? null,
        triggered_by_job: opts.triggeredByJob ?? null,
      },
    });

    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-unschedule-cancel cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState: updated.state,
      toState: updated.state,
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return updated;
  }

  /**
   * Evaluate dunning windows for a single subscription and apply the
   * appropriate state transition if a deadline has been crossed.
   *
   * This is the per-subscription core that powers BOTH:
   *  - `SubscriptionStateEngineJob` (cron at 03:00 UTC, iterates non-terminal subs)
   *  - Event-driven listener `onPaymentFailed` (immediate evaluation when a
   *    charge or retry fails, gated by `SUBSCRIPTION_EVENT_DRIVEN_STATE=true`)
   *
   * Logic mirrors `SubscriptionStateEngineJob.processSubscription`:
   *  1. Promo expiry — if `promo_rules.ends_at` has passed, clear it.
   *  2. Trial expiry — if `trial_ends_at` has passed and currently `trial`,
   *     transition to `grace_soft` (had at least one successful payment) or
   *     `blocked` otherwise.
   *  3. Period expiry — compute soft/hard/suspension/cancellation deadlines
   *     from `current_period_end` + plan dunning offsets and transition to
   *     the deepest crossed deadline.
   *
   * Cache invalidation and event emission are handled by `transition()`.
   */
  async evaluateAndTransitionForSubscription(
    subscriptionId: number,
  ): Promise<void> {
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: {
          select: {
            grace_period_soft_days: true,
            grace_period_hard_days: true,
            suspension_day: true,
            cancellation_day: true,
          },
        },
        promotional_plan: {
          select: {
            id: true,
            promo_rules: true,
          },
        },
      },
    });

    if (!sub) {
      this.logger.warn(
        `evaluateAndTransitionForSubscription: subscription ${subscriptionId} not found`,
      );
      return;
    }

    // Skip terminal / non-evaluable states. The cron uses the same filter
    // (notIn ['cancelled','expired','draft']) to pick rows; here we
    // short-circuit when called via event.
    if (
      sub.state === 'cancelled' ||
      sub.state === 'expired' ||
      sub.state === 'draft' ||
      sub.state === 'no_plan'
    ) {
      // RNC-39: no_plan rows have no plan_id and no billing window. They are
      // not subject to dunning/promo/trial transitions until the user picks a
      // plan via the subscribe flow.
      this.logger.debug(
        `evaluateAndTransitionForSubscription: sub ${subscriptionId} in terminal/draft state ${sub.state}, skipping`,
      );
      return;
    }

    const now = new Date();
    const currentState = sub.state as State;
    const plan = sub.plan;

    // 1. Promo expiry
    if (
      sub.promotional_plan_id &&
      sub.promotional_plan &&
      sub.promotional_plan.promo_rules
    ) {
      const rules =
        typeof sub.promotional_plan.promo_rules === 'string'
          ? JSON.parse(sub.promotional_plan.promo_rules)
          : (sub.promotional_plan.promo_rules as Record<string, unknown>);
      const endsAt = (rules as { ends_at?: string })?.ends_at;
      if (endsAt && new Date(endsAt) < now) {
        await this.prisma.store_subscriptions.update({
          where: { id: sub.id },
          data: {
            promotional_plan_id: null,
            promotional_applied_at: null,
            updated_at: now,
          },
        });
      }
    }

    // 2. Trial expiry (RNC-06: auto_convert_at_end)
    if (
      sub.trial_ends_at &&
      new Date(sub.trial_ends_at) < now &&
      currentState === 'trial'
    ) {
      const metadata = sub.metadata as Record<string, unknown> | null;
      const autoConvert = metadata?.auto_convert_at_end !== false;

      if (autoConvert) {
        const hasActivePM =
          await this.prisma.subscription_payment_methods.findFirst({
            where: { store_subscription_id: sub.id, state: 'active' },
          });
        if (hasActivePM) {
          await this.transition(sub.store_id, 'active', {
            reason: 'Trial ended — auto-convert with valid PM',
            triggeredByJob: 'subscription-state-engine',
            payload: { trial_ends_at: sub.trial_ends_at, auto_converted: true },
          });
          // Re-issue invoice for the trial plan's base_price (if > 0)
          // The renewal billing cron handles this; just promote state.
          return;
        }
      }

      await this.transition(sub.store_id, 'expired', {
        reason:
          'Trial period ended without payment method or auto_convert=false',
        triggeredByJob: 'subscription-state-engine',
        payload: { trial_ends_at: sub.trial_ends_at },
      });
      return;
    }

    // 3. Period expiry — dunning windows
    if (sub.current_period_end && new Date(sub.current_period_end) < now) {
      const periodEnd = new Date(sub.current_period_end);
      // RNC-23: read dunning cadence from the plan. Defaults (5/10/14/45) are
      // applied here as a safety net for legacy rows where the plan FK is
      // somehow null/missing or where a plan predates the cadence columns.
      const softDays = plan?.grace_period_soft_days ?? 5;
      const hardDays = plan?.grace_period_hard_days ?? 10;
      const suspensionDay = plan?.suspension_day ?? 14;
      const cancellationDay = plan?.cancellation_day ?? 45;

      const softDeadline = new Date(
        periodEnd.getTime() + softDays * 24 * 60 * 60 * 1000,
      );
      const hardDeadline = new Date(
        periodEnd.getTime() + hardDays * 24 * 60 * 60 * 1000,
      );
      const suspendDeadline = new Date(
        periodEnd.getTime() + suspensionDay * 24 * 60 * 60 * 1000,
      );
      const cancelDeadline = new Date(
        periodEnd.getTime() + cancellationDay * 24 * 60 * 60 * 1000,
      );

      let targetState: State | null = null;
      let reason = '';

      if (now >= cancelDeadline) {
        targetState = 'cancelled';
        reason = 'Past cancellation day';
      } else if (now >= suspendDeadline) {
        targetState = 'suspended';
        reason = 'Past suspension day';
      } else if (now >= hardDeadline) {
        targetState = 'grace_hard';
        reason = 'Past hard grace period';
      } else if (now >= softDeadline) {
        targetState = 'grace_soft';
        reason = 'Past soft grace period';
      }

      if (targetState && targetState !== currentState) {
        await this.transition(sub.store_id, targetState, {
          reason,
          triggeredByJob: 'subscription-state-engine',
          graceSoftUntil: softDeadline,
          graceHardUntil: hardDeadline,
          payload: {
            current_period_end: sub.current_period_end,
            soft_deadline: softDeadline.toISOString(),
            hard_deadline: hardDeadline.toISOString(),
            suspend_deadline: suspendDeadline.toISOString(),
            cancel_deadline: cancelDeadline.toISOString(),
          },
        });
      }
    }

    // 4. expired → cancelled after prolonged inactivity (RNC-38)
    if (currentState === 'expired' && sub.cancelled_at === null) {
      const cancellationDay = plan?.cancellation_day ?? 45;
      const expiredSince = sub.current_period_end ?? sub.updated_at;
      if (expiredSince) {
        const cancelThreshold = new Date(
          new Date(expiredSince).getTime() +
            cancellationDay * 24 * 60 * 60 * 1000,
        );
        if (now >= cancelThreshold) {
          await this.transition(sub.store_id, 'cancelled', {
            reason: 'Expired — prolonged inactivity',
            triggeredByJob: 'subscription-state-engine',
            payload: { expired_since: expiredSince.toISOString() },
          });
        }
      }
    }
  }

  /**
   * Resolve subscriptionId from a `subscription.payment.failed` payload.
   * Original emitter only carries invoiceId; we need subscriptionId to
   * call `evaluateAndTransitionForSubscription`. Retry-job emitter carries
   * subscriptionId directly.
   */
  private async resolveSubscriptionIdFromPayload(
    payload: PaymentFailedEventPayload,
  ): Promise<number | null> {
    if (
      typeof payload.subscriptionId === 'number' &&
      Number.isInteger(payload.subscriptionId) &&
      payload.subscriptionId > 0
    ) {
      return payload.subscriptionId;
    }

    if (!Number.isInteger(payload.invoiceId) || payload.invoiceId <= 0) {
      return null;
    }

    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: payload.invoiceId },
      select: { store_subscription_id: true },
    });
    return invoice?.store_subscription_id ?? null;
  }

  /**
   * Event-driven dunning hook.
   *
   * When a SaaS charge fails (synchronous via `SubscriptionPaymentService`
   * or async via the BullMQ retry processor), evaluate the subscription's
   * dunning windows immediately instead of waiting for the daily 03:00 cron.
   *
   * Feature-flagged via `SUBSCRIPTION_EVENT_DRIVEN_STATE`:
   *  - `'true'`  -> immediate evaluation
   *  - anything else -> no-op (cron remains the canonical path)
   *
   * Failures are caught and logged — they MUST NOT propagate, because:
   *  - the originating emit() is fire-and-forget; throwing breaks unrelated listeners
   *  - the daily cron will perform the canonical evaluation if this best-effort path fails
   */
  @OnEvent('subscription.payment.failed')
  async onPaymentFailed(payload: PaymentFailedEventPayload): Promise<void> {
    return this.handlePaymentFailedEvent(
      payload,
      'subscription.payment.failed',
    );
  }

  /**
   * Same handling as `subscription.payment.failed` but for the BullMQ retry
   * processor's emission. Payload shape includes subscriptionId/storeId
   * directly, so resolution skips the invoice lookup.
   */
  @OnEvent('subscription.payment.retry.failed')
  async onPaymentRetryFailed(
    payload: PaymentFailedEventPayload,
  ): Promise<void> {
    return this.handlePaymentFailedEvent(
      payload,
      'subscription.payment.retry.failed',
    );
  }

  private async handlePaymentFailedEvent(
    payload: PaymentFailedEventPayload,
    eventName: string,
  ): Promise<void> {
    if (process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE !== 'true') {
      this.logger.debug(
        `Event-driven state disabled — skipping immediate eval for invoice ${payload?.invoiceId} (event=${eventName})`,
      );
      return;
    }

    try {
      const subscriptionId =
        await this.resolveSubscriptionIdFromPayload(payload);

      if (!subscriptionId) {
        this.logger.warn(
          `Event-driven state: could not resolve subscriptionId from payload (event=${eventName}, invoiceId=${payload?.invoiceId})`,
        );
        return;
      }

      await this.evaluateAndTransitionForSubscription(subscriptionId);

      this.logger.log(
        `Event-driven state evaluated sub ${subscriptionId} after ${eventName} (invoice ${payload?.invoiceId})`,
      );
    } catch (e: any) {
      // Best-effort path: never re-throw. The 03:00 cron is the canonical
      // source of truth for state transitions and will reconcile any sub
      // that this listener failed to advance.
      this.logger.error(
        `Event-driven state eval failed for invoice ${payload?.invoiceId} (event=${eventName}): ${e?.message ?? e}`,
      );
    }
  }
}
