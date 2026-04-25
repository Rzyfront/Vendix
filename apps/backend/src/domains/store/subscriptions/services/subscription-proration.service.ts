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
      priceDiff.times(new Prisma.Decimal(remainingDays)).dividedBy(new Prisma.Decimal(cycleDays)),
    );

    const direction: 'charge' | 'credit' = prorationAmount.greaterThan(DECIMAL_ZERO)
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

  async preview(subscriptionId: number, newPlanId: number): Promise<ProrationPreview> {
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
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Target plan not found');
    }

    const currentPricing = this.billing.computePricing(sub);

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

    const kind = this.determineKind(currentPricing.effective_price, newPricing.effective_price);

    const periodEnd = sub.current_period_end ?? new Date();
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS));
    const cycleDays = Math.max(
      1,
      Math.ceil(
        ((sub.current_period_end ?? now).getTime() - (sub.current_period_start ?? now).getTime()) /
          DAY_MS,
      ),
    );

    const priceDiff = newPricing.effective_price.minus(currentPricing.effective_price);
    const prorationAmount = this.round2(
      priceDiff.times(new Prisma.Decimal(daysRemaining)).dividedBy(new Prisma.Decimal(cycleDays)),
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

    return {
      kind,
      days_remaining: daysRemaining,
      cycle_days: cycleDays,
      old_effective_price: currentPricing.effective_price.toFixed(2),
      new_effective_price: newPricing.effective_price.toFixed(2),
      proration_amount: prorationAmount.toFixed(2),
      applies_immediately: true,
      invoice_to_issue: invoicePreview,
      credit_to_apply_next_cycle: creditToApply.toFixed(2),
    };
  }

  async apply(subscriptionId: number, newPlanId: number): Promise<store_subscriptions> {
    const preview = await this.preview(subscriptionId, newPlanId);

    const newPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: newPlanId },
    });
    if (!newPlan) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Target plan not found');
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

        if (creditAmount.greaterThan(DECIMAL_ZERO)) {
          const existingCredit =
            typeof metadata['pending_credit'] === 'string'
              ? new Prisma.Decimal(metadata['pending_credit'] as string)
              : DECIMAL_ZERO;
          metadata['pending_credit'] = Prisma.Decimal.min(
            existingCredit.plus(creditAmount),
            newPricing.effective_price,
          ).toFixed(2);
        }

        const updated = await tx.store_subscriptions.update({
          where: { id: subscriptionId },
          data: {
            plan_id: newPlanId,
            effective_price: newPricing.effective_price,
            vendix_base_price: newPricing.base_price,
            partner_margin_amount: newPricing.margin_amount,
            metadata: metadata as Prisma.InputJsonValue,
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

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private determineKind(oldPrice: Prisma.Decimal, newPrice: Prisma.Decimal): ProrationKind {
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
