import { Body, Controller, Post } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionProrationService } from '../services/subscription-proration.service';
import { SubscriptionBillingService } from '../services/subscription-billing.service';
import { SubscriptionPaymentService } from '../services/subscription-payment.service';
import { SubscriptionResolverService } from '../services/subscription-resolver.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { UseGuards } from '@nestjs/common';
import { CheckoutPreviewDto } from '../dto/checkout-preview.dto';
import { CheckoutCommitDto } from '../dto/checkout-commit.dto';
import { Prisma } from '@prisma/client';
import { InvoicePreview, CheckoutPreviewResult } from '../types/billing.types';
import { SkipSubscriptionGate } from '../decorators/skip-subscription-gate.decorator';

const DECIMAL_ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
@Controller('store/subscriptions/checkout')
export class SubscriptionCheckoutController {
  constructor(
    private readonly proration: SubscriptionProrationService,
    private readonly billing: SubscriptionBillingService,
    private readonly payment: SubscriptionPaymentService,
    private readonly resolver: SubscriptionResolverService,
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('subscriptions:read')
  @Post('preview')
  async preview(@Body() dto: CheckoutPreviewDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const targetPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.planId },
    });
    if (!targetPlan) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Plan not found');
    }
    if (targetPlan.archived_at || targetPlan.state !== 'active') {
      throw new VendixHttpException(ErrorCodes.PLAN_001, 'Plan no disponible para suscripción');
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true, partner_override_id: true },
    });

    const partnerOverrideId = sub?.partner_override_id ?? null;
    const targetPricing = await this.resolveTargetPricing(targetPlan, partnerOverrideId);

    if (targetPricing.effective_price.lte(DECIMAL_ZERO) && targetPricing.margin_amount.lte(DECIMAL_ZERO)) {
      const result: CheckoutPreviewResult = {
        proration: null,
        invoice: null,
        free_plan: {
          plan: {
            id: targetPlan.id,
            code: targetPlan.code,
            name: targetPlan.name,
            effective_price: targetPricing.effective_price.toFixed(2),
            billing_cycle: targetPlan.billing_cycle,
            trial_days: targetPlan.trial_days ?? 0,
          },
        },
      };
      return this.responseService.success(result, 'Free plan ready to activate');
    }

    // Fresh purchase path — store has no subscription yet (e.g. trial-once
    // already consumed by a sibling store under the same org).
    if (!sub) {
      const now = new Date();
      const cycleMs = this.billingCycleMs(targetPlan.billing_cycle);
      const periodEnd = new Date(now.getTime() + cycleMs);
      const invoicePreview: InvoicePreview = {
        total: targetPricing.effective_price.toFixed(2),
        period_start: now.toISOString(),
        period_end: periodEnd.toISOString(),
        line_items: [
          {
            description: `Plan ${targetPlan.code} (${targetPlan.billing_cycle})`,
            quantity: 1,
            unit_price: targetPricing.effective_price.toFixed(2),
            total: targetPricing.effective_price.toFixed(2),
            meta: {
              plan_id: targetPlan.id,
              plan_code: targetPlan.code,
              billing_cycle: targetPlan.billing_cycle,
              fresh_purchase: true,
            },
          },
        ],
        split_breakdown: {
          vendix_share: targetPricing.base_price.toFixed(2),
          partner_share: targetPricing.margin_amount.toFixed(2),
          margin_pct_used: targetPricing.margin_pct.toFixed(2),
          partner_org_id: targetPricing.partner_org_id,
        },
      };

      const result: CheckoutPreviewResult = {
        proration: {
          kind: 'upgrade',
          days_remaining: Math.ceil(cycleMs / DAY_MS),
          cycle_days: Math.ceil(cycleMs / DAY_MS),
          old_effective_price: '0.00',
          new_effective_price: targetPricing.effective_price.toFixed(2),
          proration_amount: targetPricing.effective_price.toFixed(2),
          applies_immediately: true,
          invoice_to_issue: invoicePreview,
          credit_to_apply_next_cycle: '0.00',
        },
        invoice: invoicePreview,
        free_plan: null,
      };
      return this.responseService.success(result, 'Checkout preview retrieved');
    }

    const prorationPreview = await this.proration.preview(sub.id, dto.planId);

    let invoicePreview: InvoicePreview | null = null;
    if (prorationPreview.invoice_to_issue) {
      invoicePreview = prorationPreview.invoice_to_issue;
    } else {
      try {
        invoicePreview = await this.billing.previewNextInvoice(sub.id);
      } catch {
        invoicePreview = null;
      }
    }

    const result: CheckoutPreviewResult = {
      proration: prorationPreview,
      invoice: invoicePreview,
      free_plan: null,
    };
    return this.responseService.success(result, 'Checkout preview retrieved');
  }

  private async resolveTargetPricing(
    plan: { id: number; base_price: Prisma.Decimal; max_partner_margin_pct: Prisma.Decimal | null },
    partnerOverrideId: number | null,
  ) {
    if (!partnerOverrideId) {
      return this.billing.computePricing({ plan });
    }

    const override = await this.prisma.partner_plan_overrides.findUnique({
      where: { id: partnerOverrideId },
      include: { base_plan: true },
    });

    if (!override || !override.is_active) {
      return this.billing.computePricing({ plan });
    }

    return this.billing.computePricing({
      plan: {
        id: plan.id,
        base_price: plan.base_price,
        max_partner_margin_pct: plan.max_partner_margin_pct,
      },
      partner_override: {
        organization_id: override.organization_id,
        margin_pct: override.margin_pct,
        fixed_surcharge: override.fixed_surcharge,
        is_active: override.is_active,
        base_plan: {
          max_partner_margin_pct: override.base_plan.max_partner_margin_pct,
        },
      },
    });
  }

  @Permissions('subscriptions:write')
  @Post('commit')
  async commit(@Body() dto: CheckoutCommitDto) {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });

    // Fresh purchase: store has no subscription yet → create one, issue
    // first invoice, build a Wompi WidgetCheckout config so the frontend can
    // open the embedded widget (same UX as eCommerce checkout). Trial is NOT
    // granted here — checkout is an explicit purchase; trial bootstrapping
    // happens at onboarding only.
    if (!sub) {
      const created = await this.createFreshSubscription(storeId, dto.planId, context?.user_id ?? null);
      await this.resolver.invalidate(storeId);

      const totalDecimal = new Prisma.Decimal(created.effective_price);
      if (totalDecimal.lessThanOrEqualTo(DECIMAL_ZERO)) {
        return this.responseService.success(
          { subscription: created, widget: null },
          'Free plan activated',
        );
      }

      const invoice = await this.billing.issueInvoice(created.id);
      if (!invoice) {
        return this.responseService.success(
          { subscription: created, widget: null },
          'Checkout committed (no invoice issued)',
        );
      }

      const customerEmail = await this.resolveCustomerEmail(context?.user_id ?? null);
      const { widget } = await this.payment.prepareWidgetCharge(invoice.id, {
        customerEmail,
        redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
      });

      return this.responseService.success(
        { subscription: created, widget, invoiceId: invoice.id },
        'Checkout committed',
      );
    }

    const updated = await this.proration.apply(sub.id, dto.planId);

    const prorationAmount = await this.prisma.subscription_invoices.findFirst({
      where: { store_subscription_id: sub.id, state: 'issued' },
      orderBy: { created_at: 'desc' },
    });

    if (prorationAmount) {
      const total = new Prisma.Decimal(prorationAmount.total);
      if (total.greaterThan(DECIMAL_ZERO)) {
        await this.payment.charge(prorationAmount.id);
      }
    }

    return this.responseService.success(updated, 'Checkout committed');
  }

  private async createFreshSubscription(
    storeId: number,
    planId: number,
    userId: number | null,
  ) {
    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Plan not found');
    }
    if (plan.archived_at || plan.state !== 'active') {
      throw new VendixHttpException(ErrorCodes.PLAN_001, 'Plan no disponible para suscripción');
    }

    const pricing = this.billing.computePricing({ plan });
    const now = new Date();
    const cycleMs = this.billingCycleMs(plan.billing_cycle);
    const periodEnd = new Date(now.getTime() + cycleMs);

    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.store_subscriptions.findUnique({
        where: { store_id: storeId },
      });
      if (dup) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_010,
          'Store already has a subscription',
        );
      }

      const created = await tx.store_subscriptions.create({
        data: {
          store_id: storeId,
          plan_id: plan.id,
          partner_override_id: null,
          state: 'active',
          effective_price: pricing.effective_price,
          vendix_base_price: pricing.base_price,
          partner_margin_amount: pricing.margin_amount,
          currency: 'COP',
          resolved_features: {},
          trial_ends_at: null,
          current_period_start: now,
          current_period_end: periodEnd,
          next_billing_at: periodEnd,
        },
        include: { plan: true },
      });

      await tx.subscription_events.create({
        data: {
          store_subscription_id: created.id,
          type: 'state_transition',
          from_state: 'draft',
          to_state: 'active',
          payload: {
            reason: 'checkout_fresh_purchase',
            plan_id: plan.id,
            plan_code: plan.code,
          } as Prisma.InputJsonValue,
          triggered_by_user_id: userId,
        },
      });

      return created;
    });
  }

  private defaultReturnUrl(): string {
    return process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/admin/subscription`
      : 'https://vendix.com/admin/subscription';
  }

  private async resolveCustomerEmail(userId: number | null): Promise<string | undefined> {
    if (!userId) return undefined;
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? undefined;
  }

  private billingCycleMs(cycle: string): number {
    switch (cycle) {
      case 'monthly': return 30 * DAY_MS;
      case 'quarterly': return 90 * DAY_MS;
      case 'semiannual': return 180 * DAY_MS;
      case 'annual': return 365 * DAY_MS;
      case 'lifetime': return 100 * 365 * DAY_MS;
      default: return 30 * DAY_MS;
    }
  }
}
