import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { Prisma, store_subscriptions } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionStateService } from './subscription-state.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  ProrationPreview,
  ProrationKind,
  ComputedPricing,
  InvoicePreview,
  TrialPlanSwapInfo,
} from '../types/billing.types';

const DECIMAL_ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionProrationService {
  private readonly logger = new Logger(SubscriptionProrationService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly billing: SubscriptionBillingService,
    private readonly stateService: SubscriptionStateService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Calculate a pure proration amount between two plans.
   * Returns the amount and direction (charge = customer pays more,
   * credit = customer receives credit for next cycle).
   */
  calculateProration(
    oldPlan: { effective_price: Prisma.Decimal },
    newPlan: { effective_price: Prisma.Decimal },
    remainingDays: number,
    cycleDays: number,
  ): { prorationAmount: Prisma.Decimal; direction: 'charge' | 'credit' } {
    if (cycleDays <= 0) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_PRORATION_001,
        'cycleDays must be > 0',
      );
    }

    const priceDiff = newPlan.effective_price.minus(oldPlan.effective_price);
    const prorationAmount = this.round2(
      priceDiff
        .times(new Prisma.Decimal(remainingDays))
        .dividedBy(new Prisma.Decimal(cycleDays)),
    );

    const direction: 'charge' | 'credit' = prorationAmount.greaterThan(
      DECIMAL_ZERO,
    )
      ? 'charge'
      : 'credit';

    return { prorationAmount, direction };
  }

  /**
   * Read-only preview of an upgrade/downgrade without persisting anything.
   */
  async previewUpgrade(
    subscriptionId: number,
    newPlanId: number,
  ): Promise<ProrationPreview> {
    return this.preview(subscriptionId, newPlanId);
  }

  /**
   * Transactional plan change: update plan, emit adjustment invoice or credit,
   * and log the event.
   */
  async executeChange(
    subscriptionId: number,
    newPlanId: number,
  ): Promise<store_subscriptions> {
    return this.apply(subscriptionId, newPlanId);
  }

  async preview(
    subscriptionId: number,
    newPlanId: number,
  ): Promise<ProrationPreview> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const newPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: newPlanId },
    });

    if (!newPlan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Target plan not found',
      );
    }

    // RNC-39 — no_plan path: the store has no current plan. Treat as a fresh
    // subscription (no proration math, no credit). Done BEFORE computePricing
    // because computePricing requires sub.plan to be present.
    //
    // BUGFIX: previously returned `invoice_to_issue=null` and
    // `proration_amount=0` for both free and paid targets, which made the
    // checkout controller assume "no widget needed" and the frontend navigate
    // to "success" without a Wompi charge — leaving the store on a paid plan
    // it never paid for. Now we check `newPlan.is_free` (explicit flag, not
    // `base_price <= 0` heuristic) and synthesize an invoice + non-zero
    // proration_amount for paid targets, surfacing `target_plan_is_free`
    // so the controller and frontend can branch on the same authoritative
    // signal.
    if (sub.state === 'no_plan' || !sub.plan_id || !sub.plan) {
      const now = new Date();
      const cycleDays = this.billingCycleDays(newPlan.billing_cycle ?? 'monthly');
      const targetIsFree = newPlan.is_free === true;
      const invoiceToIssue: InvoicePreview | null = targetIsFree
        ? null
        : {
            total: newPlan.base_price.toFixed(2),
            period_start: now.toISOString(),
            period_end: new Date(
              now.getTime() + cycleDays * DAY_MS,
            ).toISOString(),
            line_items: [
              {
                description: `Plan ${newPlan.code} (${newPlan.billing_cycle})`,
                quantity: 1,
                unit_price: newPlan.base_price.toFixed(2),
                total: newPlan.base_price.toFixed(2),
                meta: {
                  plan_id: newPlan.id,
                  plan_code: newPlan.code,
                  billing_cycle: newPlan.billing_cycle,
                  fresh_purchase: true,
                },
              },
            ],
            split_breakdown: {
              vendix_share: newPlan.base_price.toFixed(2),
              partner_share: '0.00',
              margin_pct_used: '0.00',
              partner_org_id: null,
            },
          };
      return {
        kind: 're_subscribe',
        mode: 're_subscribe',
        days_remaining: 0,
        cycle_days: cycleDays,
        old_effective_price: '0.00',
        new_effective_price: newPlan.base_price.toFixed(2),
        proration_amount: targetIsFree
          ? DECIMAL_ZERO.toFixed(2)
          : newPlan.base_price.toFixed(2),
        applies_immediately: true,
        invoice_to_issue: invoiceToIssue,
        credit_to_apply_next_cycle: DECIMAL_ZERO.toFixed(2),
        effective_at: now.toISOString(),
        target_plan_is_free: targetIsFree,
      };
    }

    const currentPricing = this.billing.computePricing(sub);

    // Re-subscribe path: cancelled/expired subscriptions admit a single legal
    // exit to `pending_payment` via the checkout commit. There is no live
    // period to prorate against (current_period_end is stale), so return a
    // dedicated kind with proration_amount=0 and the new plan's full price.
    // The frontend renders a "fresh subscription" variant of the checkout
    // card and the commit issues a regular invoice + Wompi widget.
    if (sub.state === 'cancelled' || sub.state === 'expired') {
      const now = new Date();
      const newPlanForResub = await this.prisma.subscription_plans.findUnique({
        where: { id: newPlanId },
      });
      const cycleDays = this.billingCycleDays(
        newPlanForResub?.billing_cycle ?? 'monthly',
      );
      const targetIsFree = newPlan.is_free === true;
      return {
        kind: 're_subscribe',
        mode: 're_subscribe',
        days_remaining: 0,
        cycle_days: cycleDays,
        old_effective_price: '0.00',
        new_effective_price: newPlan.base_price.toFixed(2),
        proration_amount: targetIsFree
          ? DECIMAL_ZERO.toFixed(2)
          : newPlan.base_price.toFixed(2),
        applies_immediately: true,
        invoice_to_issue: null,
        credit_to_apply_next_cycle: DECIMAL_ZERO.toFixed(2),
        effective_at: now.toISOString(),
        target_plan_is_free: targetIsFree,
      };
    }

    const newSub = {
      plan: {
        id: newPlan.id,
        base_price: newPlan.base_price,
        max_partner_margin_pct: newPlan.max_partner_margin_pct,
      },
      partner_override: sub.partner_override
        ? {
            organization_id: sub.partner_override.organization_id,
            margin_pct: sub.partner_override.margin_pct,
            fixed_surcharge: sub.partner_override.fixed_surcharge,
            is_active: sub.partner_override.is_active,
            base_plan: sub.partner_override.base_plan,
          }
        : null,
    };
    const newPricing = this.billing.computePricing(newSub);

    // S3.4 / RNC-15 — Trial plan-swap path. Only kept for trial → free / promo
    // changes (target plan also has effective_price = 0). For trial → paid
    // plans the anti-arrastre rule (RNC-15) requires an immediate full-price
    // charge: there is no scheduled change, no carry-over of remaining trial
    // days, the user pays the full destination plan price NOW. That branch
    // falls through to the re_subscribe-style return below.
    const now = new Date();
    // Target is free per explicit flag (not heuristic). When the partner
    // override produces a non-zero margin on a base-free plan we still treat
    // it as paid because there IS a charge to collect.
    const targetIsFree =
      newPlan.is_free === true &&
      newPricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO);
    if (
      sub.state === 'trial' &&
      sub.trial_ends_at &&
      sub.trial_ends_at.getTime() > now.getTime() &&
      targetIsFree
    ) {
      const trialSwap: TrialPlanSwapInfo = {
        old_plan: {
          id: sub.plan.id,
          code: sub.plan.code,
          name: sub.plan.name,
          base_price: sub.plan.base_price.toFixed(2),
        },
        new_plan: {
          id: newPlan.id,
          code: newPlan.code,
          name: newPlan.name,
          base_price: newPlan.base_price.toFixed(2),
        },
        trial_ends_at: sub.trial_ends_at.toISOString(),
        message:
          'Cambio de plan durante trial. Sin cobro hasta fin del trial.',
      };

      const trialCycleDays = Math.max(
        1,
        Math.ceil(
          ((sub.current_period_end ?? sub.trial_ends_at).getTime() -
            (sub.current_period_start ?? now).getTime()) /
            DAY_MS,
        ),
      );
      const trialDaysRemaining = Math.max(
        0,
        Math.ceil(
          (sub.trial_ends_at.getTime() - now.getTime()) / DAY_MS,
        ),
      );

      return {
        kind: 'trial_plan_swap',
        mode: 'trial_plan_swap',
        days_remaining: trialDaysRemaining,
        cycle_days: trialCycleDays,
        old_effective_price: currentPricing.effective_price.toFixed(2),
        new_effective_price: newPricing.effective_price.toFixed(2),
        proration_amount: DECIMAL_ZERO.toFixed(2),
        applies_immediately: false,
        invoice_to_issue: null,
        credit_to_apply_next_cycle: DECIMAL_ZERO.toFixed(2),
        trial_swap: trialSwap,
        effective_at: sub.trial_ends_at.toISOString(),
        target_plan_is_free: true,
      };
    }

    // RNC-15 — Trial → paid plan. Anti-arrastre: no credit for remaining
    // trial days, no proration delta. The user pays the FULL destination
    // plan price RIGHT NOW. Return a `re_subscribe`-shaped preview so the
    // frontend renders the fresh-cycle card and the checkout commit emits a
    // regular invoice + Wompi widget. Trial state stays until the charge
    // confirms; the controller transitions trial → pending_payment.
    if (
      sub.state === 'trial' &&
      sub.trial_ends_at &&
      sub.trial_ends_at.getTime() > now.getTime() &&
      !targetIsFree
    ) {
      const cycleDays = this.billingCycleDays(newPlan.billing_cycle ?? 'monthly');
      return {
        kind: 're_subscribe',
        mode: 're_subscribe',
        days_remaining: 0,
        cycle_days: cycleDays,
        old_effective_price: '0.00',
        new_effective_price: newPricing.effective_price.toFixed(2),
        proration_amount: newPricing.effective_price.toFixed(2),
        applies_immediately: true,
        invoice_to_issue: null,
        credit_to_apply_next_cycle: DECIMAL_ZERO.toFixed(2),
        effective_at: now.toISOString(),
        target_plan_is_free: false,
      };
    }

    // RNC-15 — Anti-arrastre: if source plan is free/promotional (is_free=true),
    // NO credit or proration is calculated. Upgrade charges full remaining delta.
    // Uses the explicit `is_free` flag (replaces heuristic `base_price <= 0`).
    const isFreeOrigin =
      sub.plan.is_free === true ||
      sub.plan.plan_type === 'promotional' ||
      sub.plan.is_promotional;

    const kind = this.determineKind(
      currentPricing.effective_price,
      newPricing.effective_price,
    );

    const periodEnd = sub.current_period_end ?? new Date();
    const daysRemaining = isFreeOrigin
      ? 0
      : Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS));
    const cycleDays = isFreeOrigin
      ? 1
      : Math.max(
          1,
          Math.ceil(
            ((sub.current_period_end ?? now).getTime() -
              (sub.current_period_start ?? now).getTime()) /
              DAY_MS,
          ),
        );

    const priceDiff = newPricing.effective_price.minus(
      currentPricing.effective_price,
    );
    // When free origin, proration = full price (no credit for remaining days)
    const prorationAmount = this.round2(
      isFreeOrigin
        ? newPricing.effective_price
        : priceDiff
            .times(new Prisma.Decimal(daysRemaining))
            .dividedBy(new Prisma.Decimal(cycleDays)),
    );

    let creditToApply = DECIMAL_ZERO;
    if (prorationAmount.lessThan(DECIMAL_ZERO)) {
      creditToApply = prorationAmount.abs();
    }

    let invoicePreview: InvoicePreview | null = null;
    if (prorationAmount.greaterThan(DECIMAL_ZERO)) {
      invoicePreview = {
        total: this.round2(prorationAmount).toFixed(2),
        period_start: now.toISOString(),
        period_end: periodEnd.toISOString(),
        line_items: [
          {
            description: `Proration upgrade — plan ${newPlan.code}`,
            quantity: 1,
            unit_price: prorationAmount.toFixed(2),
            total: prorationAmount.toFixed(2),
            meta: {
              plan_id: newPlan.id,
              plan_code: newPlan.code,
              billing_cycle: newPlan.billing_cycle,
              prorated: true,
            },
          },
        ],
        split_breakdown: {
          vendix_share: this.round2(newPricing.base_price).toFixed(2),
          partner_share: this.round2(newPricing.margin_amount).toFixed(2),
          margin_pct_used: newPricing.margin_pct.toFixed(2),
          partner_org_id: newPricing.partner_org_id,
        },
      };
    }

    // S3.5 — Surface scheduled-cancel side-effect so the frontend can render
    // a notice and the user understands their pending cancellation will be
    // voided by this commit.
    const voidsScheduledCancel =
      sub.scheduled_cancel_at != null
        ? {
            active: true,
            scheduled_at: sub.scheduled_cancel_at.toISOString(),
          }
        : undefined;

    return {
      kind,
      mode: kind,
      days_remaining: daysRemaining,
      cycle_days: cycleDays,
      old_effective_price: currentPricing.effective_price.toFixed(2),
      new_effective_price: newPricing.effective_price.toFixed(2),
      proration_amount: prorationAmount.toFixed(2),
      applies_immediately: true,
      invoice_to_issue: invoicePreview,
      credit_to_apply_next_cycle: creditToApply.toFixed(2),
      effective_at: now.toISOString(),
      voids_scheduled_cancel: voidsScheduledCancel,
      target_plan_is_free:
        newPlan.is_free === true &&
        newPricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO),
    };
  }

  async apply(
    subscriptionId: number,
    newPlanId: number,
  ): Promise<store_subscriptions> {
    const preview = await this.preview(subscriptionId, newPlanId);

    const newPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: newPlanId },
    });
    if (!newPlan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Target plan not found',
      );
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const newPricingInput = {
      plan: {
        id: newPlan.id,
        base_price: newPlan.base_price,
        max_partner_margin_pct: newPlan.max_partner_margin_pct,
      },
      partner_override: sub.partner_override
        ? {
            organization_id: sub.partner_override.organization_id,
            margin_pct: sub.partner_override.margin_pct,
            fixed_surcharge: sub.partner_override.fixed_surcharge,
            is_active: sub.partner_override.is_active,
            base_plan: sub.partner_override.base_plan,
          }
        : null,
    };
    const newPricing = this.billing.computePricing(newPricingInput);
    const oldPlanId = sub.plan_id;

    const prorationAmount = new Prisma.Decimal(preview.proration_amount);
    const creditAmount = new Prisma.Decimal(preview.credit_to_apply_next_cycle);

    // S3.4 — Trial plan-swap path. Re-validate from preview (server-side
    // authoritative). Inside a Serializable + FOR UPDATE transaction:
    //   - Update plan_id + pricing fields (effective_price, vendix_base_price,
    //     partner_margin_amount).
    //   - Do NOT transition state — subscription stays in `trial`.
    //   - Do NOT emit any invoice; the next charge happens at trial_ends_at
    //     via the regular trial-end pipeline.
    //   - Emit `plan_changed` with mode='trial_plan_swap' and the trial
    //     remaining days for audit / observability.
    if (preview.kind === 'trial_plan_swap') {
      const trialRemainingDays = preview.days_remaining;
      const result = await this.prisma.$transaction(
        async (tx: any) => {
          const locked = (await tx.$queryRaw(
            Prisma.sql`SELECT id FROM store_subscriptions WHERE id = ${subscriptionId} FOR UPDATE`,
          )) as Array<{ id: number }>;
          if (!locked.length) {
            throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
          }

          const updated = await tx.store_subscriptions.update({
            where: { id: subscriptionId },
            data: {
              plan_id: newPlanId,
              effective_price: newPricing.effective_price,
              vendix_base_price: newPricing.base_price,
              partner_margin_amount: newPricing.margin_amount,
              resolved_at: new Date(),
              updated_at: new Date(),
            },
          });

          await tx.subscription_events.create({
            data: {
              store_subscription_id: subscriptionId,
              type: 'plan_changed',
              payload: {
                from_plan_id: oldPlanId,
                to_plan_id: newPlanId,
                mode: 'trial_plan_swap',
                trial_remaining_days: trialRemainingDays,
                trial_ends_at: sub.trial_ends_at?.toISOString() ?? null,
                effective_at:
                  sub.trial_ends_at?.toISOString() ?? new Date().toISOString(),
                proration_amount: '0.00',
                kind: 'trial_plan_swap',
              } as Prisma.InputJsonValue,
            },
          });

          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      this.invalidateRedisCache(sub.store_id);

      this.eventEmitter.emit('subscription.plan.changed', {
        subscriptionId,
        storeId: sub.store_id,
        fromPlanId: oldPlanId,
        toPlanId: newPlanId,
        prorationAmount: '0.00',
        kind: 'trial_plan_swap',
        mode: 'trial_plan_swap',
        trialRemainingDays,
      });

      return result;
    }

    // RNC-16 / RNC-17 — Downgrade end-of-period (deferred plan change).
    //
    // For `kind='downgrade'` we DO NOT swap plan_id immediately. The customer
    // keeps the higher-tier features + quotas until `current_period_end` and
    // is billed the cheaper plan only on next renewal. We persist the intent
    // on the row via two columns added in 20260429120000_add_scheduled_plan_change:
    //
    //   scheduled_plan_change_at = current_period_end (when the swap happens)
    //   scheduled_plan_id        = newPlanId          (target plan)
    //
    // Multiple downgrades in the same period overwrite the previous
    // scheduled change (RNC-17). The renewal cron picks up the row when
    // `scheduled_plan_change_at <= now`, applies the swap atomically, and
    // emits the new-plan invoice.
    //
    // Cancel path: DELETE /api/store/subscriptions/scheduled-change clears
    // both columns while `period_end` is still in the future (handled at the
    // controller layer; out of scope for this method).
    if (preview.kind === 'downgrade' && sub.current_period_end) {
      const now = new Date();
      const scheduledAt = sub.current_period_end;

      // Defensive guard: if period already passed, fall through to the
      // immediate-apply path below — nothing to schedule against.
      if (scheduledAt.getTime() > now.getTime()) {
        const result = await this.prisma.$transaction(
          async (tx: any) => {
            const locked = (await tx.$queryRaw(
              Prisma.sql`SELECT id FROM store_subscriptions WHERE id = ${subscriptionId} FOR UPDATE`,
            )) as Array<{ id: number }>;
            if (!locked.length) {
              throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
            }

            const updated = await tx.store_subscriptions.update({
              where: { id: subscriptionId },
              data: {
                // NOTE: plan_id, effective_price, vendix_base_price,
                // partner_margin_amount intentionally untouched — customer
                // keeps current plan + features until period_end.
                scheduled_plan_change_at: scheduledAt,
                scheduled_plan_id: newPlanId,
                updated_at: now,
              },
            });

            await tx.subscription_events.create({
              data: {
                store_subscription_id: subscriptionId,
                type: 'plan_changed',
                payload: {
                  from_plan_id: oldPlanId,
                  to_plan_id: newPlanId,
                  mode: 'downgrade_scheduled',
                  kind: 'downgrade',
                  scheduled_plan_change_at: scheduledAt.toISOString(),
                  current_period_end: scheduledAt.toISOString(),
                  proration_amount: '0.00',
                  applies_immediately: false,
                  effective_at: scheduledAt.toISOString(),
                } as Prisma.InputJsonValue,
              },
            });

            return updated;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        this.invalidateRedisCache(sub.store_id);

        this.eventEmitter.emit('subscription.plan_change_scheduled', {
          subscriptionId,
          storeId: sub.store_id,
          fromPlanId: oldPlanId,
          toPlanId: newPlanId,
          scheduledAt: scheduledAt.toISOString(),
        });

        // Also emit the standard plan-changed event so existing listeners
        // (state, audit, panel cache busts) observe the intent without
        // having to subscribe to a new topic. Listeners decide whether to
        // act on `applies_immediately=false`.
        this.eventEmitter.emit('subscription.plan.changed', {
          subscriptionId,
          storeId: sub.store_id,
          fromPlanId: oldPlanId,
          toPlanId: newPlanId,
          prorationAmount: '0.00',
          kind: 'downgrade',
          mode: 'downgrade_scheduled',
          scheduledAt: scheduledAt.toISOString(),
          appliesImmediately: false,
        });

        return result;
      }
    }

    const result = await this.prisma.$transaction(
      async (tx: any) => {
        const locked = (await tx.$queryRaw(
          Prisma.sql`SELECT id FROM store_subscriptions WHERE id = ${subscriptionId} FOR UPDATE`,
        )) as Array<{ id: number }>;
        if (!locked.length) {
          throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
        }

        const metadata = {
          ...(sub.metadata && typeof sub.metadata === 'object'
            ? (sub.metadata as Record<string, unknown>)
            : {}),
        } as Record<string, unknown>;

        // RNC-15: Anti-arrastre — no credit carry-over from free/promo plans
        // RNC-39: no_plan also has no credit carry-over (no origin pricing).
        if (creditAmount.greaterThan(DECIMAL_ZERO)) {
          const isFreeOrigin =
            !sub.plan ||
            sub.plan.is_free === true ||
            sub.plan.plan_type === 'promotional' ||
            sub.plan.is_promotional;
          // Skip credit accumulation when origin is free/promo
          if (!isFreeOrigin) {
            const existingCredit =
              typeof metadata['pending_credit'] === 'string'
                ? new Prisma.Decimal(metadata['pending_credit'])
                : DECIMAL_ZERO;
            metadata['pending_credit'] = Prisma.Decimal.min(
              existingCredit.plus(creditAmount),
              newPricing.effective_price,
            ).toFixed(2);
          }
        }

        // S3.5 — When the sub had a scheduled cancellation, this checkout
        // commit voids it: clear `scheduled_cancel_at` + restore
        // `auto_renew=true`. Audit info is folded into the `plan_changed`
        // event payload below (the `subscription_event_type_enum` does not
        // have a dedicated `scheduled_cancel_voided` value, so we keep the
        // semantics in the existing event without requiring a migration).
        const hadScheduledCancel = sub.scheduled_cancel_at != null;
        const voidedScheduledCancelAt = hadScheduledCancel
          ? sub.scheduled_cancel_at!.toISOString()
          : null;

        // Upgrade / same-tier path: apply immediately AND clear any prior
        // scheduled downgrade so the user does not get an unintended swap
        // at period_end after upgrading.
        const updated = await tx.store_subscriptions.update({
          where: { id: subscriptionId },
          data: {
            plan_id: newPlanId,
            effective_price: newPricing.effective_price,
            vendix_base_price: newPricing.base_price,
            partner_margin_amount: newPricing.margin_amount,
            metadata: metadata as Prisma.InputJsonValue,
            scheduled_plan_change_at: null,
            scheduled_plan_id: null,
            ...(hadScheduledCancel
              ? { scheduled_cancel_at: null, auto_renew: true }
              : {}),
            updated_at: new Date(),
          },
        });

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'plan_changed',
            payload: {
              from_plan_id: oldPlanId,
              to_plan_id: newPlanId,
              proration_amount: preview.proration_amount,
              effective_at: new Date().toISOString(),
              kind: preview.kind,
              ...(hadScheduledCancel
                ? {
                    voided_scheduled_cancel_at: voidedScheduledCancelAt,
                    voided_scheduled_cancel_via: 'checkout_commit',
                  }
                : {}),
            } as Prisma.InputJsonValue,
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (prorationAmount.greaterThan(DECIMAL_ZERO)) {
      try {
        await this.billing.issueInvoice(subscriptionId, {
          prorated: true,
          proratedAmount: prorationAmount,
        });
      } catch (err) {
        this.logger.error(
          `Failed to issue proration invoice for sub ${subscriptionId}: ${(err as Error).message}`,
        );
      }
    }

    this.invalidateRedisCache(sub.store_id);

    this.eventEmitter.emit('subscription.plan.changed', {
      subscriptionId,
      storeId: sub.store_id,
      fromPlanId: oldPlanId,
      toPlanId: newPlanId,
      prorationAmount: preview.proration_amount,
      kind: preview.kind,
    });

    return result;
  }

  /**
   * RNC-16 / RNC-17 — Cancel a scheduled downgrade.
   *
   * Allowed while `current_period_end` is still in the future. After it
   * passes the renewal cron has already (or will imminently) apply the swap,
   * and the operation is no longer reversible from the customer side.
   *
   * Returns the updated subscription with both scheduled_* columns cleared.
   * Throws SUBSCRIPTION_001 when the subscription is unknown and a 4xx
   * error code (SUBSCRIPTION_010) when the period has already passed.
   */
  async cancelScheduledChange(
    subscriptionId: number,
  ): Promise<store_subscriptions> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        store_id: true,
        plan_id: true,
        scheduled_plan_change_at: true,
        scheduled_plan_id: true,
        current_period_end: true,
      },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (!sub.scheduled_plan_change_at || !sub.scheduled_plan_id) {
      // Idempotent: nothing scheduled. Return the row as-is.
      return (await this.prisma.store_subscriptions.findUniqueOrThrow({
        where: { id: subscriptionId },
      })) as store_subscriptions;
    }

    const now = new Date();
    if (sub.scheduled_plan_change_at.getTime() <= now.getTime()) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'El cambio de plan ya entró en vigor; no se puede cancelar.',
      );
    }

    const previouslyScheduledPlanId = sub.scheduled_plan_id;

    const updated = await this.prisma.$transaction(
      async (tx: any) => {
        const result = await tx.store_subscriptions.update({
          where: { id: subscriptionId },
          data: {
            scheduled_plan_change_at: null,
            scheduled_plan_id: null,
            updated_at: now,
          },
        });

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'plan_changed',
            payload: {
              mode: 'downgrade_scheduled_cancelled',
              kind: 'downgrade',
              cancelled_scheduled_plan_id: previouslyScheduledPlanId,
              cancelled_scheduled_at:
                sub.scheduled_plan_change_at?.toISOString() ?? null,
              effective_at: now.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.invalidateRedisCache(sub.store_id);

    this.eventEmitter.emit('subscription.plan_change_scheduled.cancelled', {
      subscriptionId,
      storeId: sub.store_id,
      cancelledScheduledPlanId: previouslyScheduledPlanId,
    });

    return updated;
  }

  /**
   * Re-subscribe path: reactivate a `cancelled` or `expired` subscription
   * onto a new plan. Treats the change as a FRESH purchase (not proration):
   *
   *  - Updates plan_id and pricing snapshot fields.
   *  - Resets the billing window to [now, now + cycle].
   *  - Clears all dunning/cancellation timestamps so the row is "clean".
   *  - Resets pending_credit (no carry-over from the previous lifecycle).
   *  - Does NOT change `state` — the caller (checkout commit) is responsible
   *    for transitioning cancelled/expired → pending_payment via
   *    SubscriptionStateService.transition() before invoking this.
   */
  async applyResubscribe(
    subscriptionId: number,
    newPlanId: number,
  ): Promise<store_subscriptions> {
    const newPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: newPlanId },
    });
    if (!newPlan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Target plan not found',
      );
    }
    if (newPlan.archived_at || newPlan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.PLAN_001,
        'Plan no disponible para suscripción',
      );
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const newPricingInput = {
      plan: {
        id: newPlan.id,
        base_price: newPlan.base_price,
        max_partner_margin_pct: newPlan.max_partner_margin_pct,
      },
      partner_override: sub.partner_override
        ? {
            organization_id: sub.partner_override.organization_id,
            margin_pct: sub.partner_override.margin_pct,
            fixed_surcharge: sub.partner_override.fixed_surcharge,
            is_active: sub.partner_override.is_active,
            base_plan: sub.partner_override.base_plan,
          }
        : null,
    };
    const newPricing = this.billing.computePricing(newPricingInput);
    const oldPlanId = sub.plan_id;

    const now = new Date();
    const cycleMs = this.billingCycleMs(newPlan.billing_cycle);
    const periodEnd = new Date(now.getTime() + cycleMs);

    const updated = await this.prisma.$transaction(
      async (tx: any) => {
        const locked = (await tx.$queryRaw(
          Prisma.sql`SELECT id FROM store_subscriptions WHERE id = ${subscriptionId} FOR UPDATE`,
        )) as Array<{ id: number }>;
        if (!locked.length) {
          throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
        }

        // Strip any pending_credit / dunning crumbs from metadata.
        const existingMeta =
          sub.metadata && typeof sub.metadata === 'object'
            ? { ...(sub.metadata as Record<string, unknown>) }
            : ({} as Record<string, unknown>);
        delete existingMeta['pending_credit'];

        const result = await tx.store_subscriptions.update({
          where: { id: subscriptionId },
          data: {
            plan_id: newPlanId,
            effective_price: newPricing.effective_price,
            vendix_base_price: newPricing.base_price,
            partner_margin_amount: newPricing.margin_amount,
            current_period_start: now,
            current_period_end: periodEnd,
            next_billing_at: periodEnd,
            cancelled_at: null,
            cancel_at: null,
            scheduled_cancel_at: null,
            grace_soft_until: null,
            grace_hard_until: null,
            suspend_at: null,
            auto_renew: true,
            resolved_features: {},
            resolved_at: now,
            metadata: existingMeta as Prisma.InputJsonValue,
            updated_at: now,
          },
        });

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'reactivated',
            payload: {
              from_plan_id: oldPlanId,
              to_plan_id: newPlanId,
              mode: 're_subscribe',
              previous_state: sub.state,
              effective_at: now.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.invalidateRedisCache(sub.store_id);

    this.eventEmitter.emit('subscription.plan.changed', {
      subscriptionId,
      storeId: sub.store_id,
      fromPlanId: oldPlanId,
      toPlanId: newPlanId,
      prorationAmount: '0.00',
      kind: 're_subscribe',
      mode: 're_subscribe',
    });

    return updated;
  }

  private billingCycleMs(cycle: string): number {
    switch (cycle) {
      case 'monthly':
        return 30 * DAY_MS;
      case 'quarterly':
        return 90 * DAY_MS;
      case 'semiannual':
        return 180 * DAY_MS;
      case 'annual':
        return 365 * DAY_MS;
      case 'lifetime':
        return 100 * 365 * DAY_MS;
      default:
        return 30 * DAY_MS;
    }
  }

  private billingCycleDays(cycle: string): number {
    return Math.ceil(this.billingCycleMs(cycle) / DAY_MS);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private determineKind(
    oldPrice: Prisma.Decimal,
    newPrice: Prisma.Decimal,
  ): ProrationKind {
    const cmp = newPrice.comparedTo(oldPrice);
    if (cmp > 0) return 'upgrade';
    if (cmp < 0) return 'downgrade';
    return 'same-tier';
  }

  private round2(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(2, 6);
  }

  private async invalidateRedisCache(storeId: number): Promise<void> {
    try {
      await this.redis.del(`sub:features:${storeId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate Redis cache for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }
}
