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
 * Allowed transitions between subscription states. Terminal states
 * (`cancelled`, `expired`) have no outgoing edges.
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
 */
const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ['pending_payment', 'trial', 'active'],
  pending_payment: ['active', 'blocked', 'cancelled', 'expired'],
  trial: ['active', 'blocked', 'cancelled', 'expired'],
  active: ['grace_soft', 'cancelled', 'expired'],
  grace_soft: ['active', 'grace_hard', 'cancelled'],
  grace_hard: ['active', 'suspended', 'cancelled'],
  suspended: ['active', 'blocked', 'cancelled'],
  blocked: ['active', 'cancelled'],
  cancelled: [],
  expired: [],
};

export interface TransitionOptions {
  reason: string;
  triggeredByUserId?: number;
  triggeredByJob?: string;
  payload?: Record<string, unknown>;
}

/**
 * Mutates `store_subscriptions.state` with a legal transition, writes a
 * `subscription_events` audit row, invalidates access cache, and emits a
 * NestJS event. All inside a Serializable transaction with SELECT FOR UPDATE
 * to prevent TOCTOU races.
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

    const { fromState, updated } = await this.prisma.$transaction(
      async (tx: any) => {
        // FOR UPDATE lock on the subscription row.
        const locked = (await tx.$queryRaw(
          Prisma.sql`SELECT id, state FROM store_subscriptions WHERE store_id = ${storeId} FOR UPDATE`,
        )) as Array<{ id: number; state: State }>;

        if (!locked.length) {
          throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
        }

        const current = locked[0];
        const currentState = current.state;

        if (currentState === toState) {
          // No-op transition — still log event for auditability but skip update.
          const existing = await tx.store_subscriptions.findUniqueOrThrow({
            where: { id: current.id },
          });
          return { fromState: currentState, updated: existing };
        }

        if (!this.isLegalTransition(currentState, toState)) {
          throw new VendixHttpException(
            ErrorCodes.SUBSCRIPTION_010,
            `Illegal transition ${currentState} -> ${toState}`,
          );
        }

        const updatedRow = await tx.store_subscriptions.update({
          where: { id: current.id },
          data: {
            state: toState,
            updated_at: new Date(),
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

        return { fromState: currentState, updated: updatedRow };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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
      fromState,
      toState,
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return updated;
  }

  isLegalTransition(from: State, to: State): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
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
      sub.state === 'draft'
    ) {
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

    // 2. Trial expiry
    if (
      sub.trial_ends_at &&
      new Date(sub.trial_ends_at) < now &&
      currentState === 'trial'
    ) {
      const hasPayment = await this.prisma.subscription_payments.findFirst({
        where: {
          invoice: { store_subscription_id: sub.id },
          state: 'succeeded',
        },
      });

      const targetState: State = hasPayment ? 'grace_soft' : 'blocked';
      await this.transition(sub.store_id, targetState, {
        reason: 'Trial period ended',
        triggeredByJob: 'subscription-state-engine',
        payload: { trial_ends_at: sub.trial_ends_at },
      });
      return;
    }

    // 3. Period expiry — dunning windows
    if (sub.current_period_end && new Date(sub.current_period_end) < now) {
      const periodEnd = new Date(sub.current_period_end);
      const softDays = plan.grace_period_soft_days;
      const hardDays = plan.grace_period_hard_days;
      const suspensionDay = plan.suspension_day;
      const cancellationDay = plan.cancellation_day;

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

    if (
      !Number.isInteger(payload.invoiceId) ||
      payload.invoiceId <= 0
    ) {
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
      const subscriptionId = await this.resolveSubscriptionIdFromPayload(
        payload,
      );

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
