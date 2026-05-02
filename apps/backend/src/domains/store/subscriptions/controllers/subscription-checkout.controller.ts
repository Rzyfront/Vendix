import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionProrationService } from '../services/subscription-proration.service';
import { SubscriptionBillingService } from '../services/subscription-billing.service';
import { SubscriptionPaymentService } from '../services/subscription-payment.service';
import { SubscriptionResolverService } from '../services/subscription-resolver.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import { PromotionalApplyService } from '../services/promotional-apply.service';
import { PlatformGatewayService } from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { UseGuards } from '@nestjs/common';
import { CheckoutPreviewDto } from '../dto/checkout-preview.dto';
import { CheckoutCommitDto } from '../dto/checkout-commit.dto';
import { RetryPaymentDto } from '../dto/retry-payment.dto';
import { ValidateCouponDto } from '../dto/validate-coupon.dto';
import { Prisma } from '@prisma/client';
import {
  InvoicePreview,
  CheckoutPreviewResult,
  CouponPreviewInfo,
} from '../types/billing.types';
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
    private readonly stateService: SubscriptionStateService,
    private readonly promotional: PromotionalApplyService,
    private readonly platformGw: PlatformGatewayService,
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * S2.1 — Validate a redemption code for the current store. Returns a
   * discriminated result so the frontend can show the precise reason
   * (not_found / expired / already_used / not_eligible) without leaking
   * internal eligibility codes.
   *
   * Reachable in any subscription state (decorated with @SkipSubscriptionGate
   * at the controller level) so users in draft/pending_payment can still
   * preview a coupon before committing.
   */
  @Permissions('subscriptions:read')
  @Post('validate-coupon')
  async validateCoupon(@Body() dto: ValidateCouponDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const result = await this.promotional.validateCoupon(storeId, dto.code);
    return this.responseService.success(result, 'Coupon validation result');
  }

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
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Plan not found',
      );
    }
    if (targetPlan.archived_at || targetPlan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.PLAN_001,
        'Plan no disponible para suscripción',
      );
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true, partner_override_id: true },
    });

    const partnerOverrideId = sub?.partner_override_id ?? null;
    const targetPricing = await this.resolveTargetPricing(
      targetPlan,
      partnerOverrideId,
    );

    // S2.1 — Re-validate the coupon server-side on every preview. The frontend
    // may have stored a previously valid result; this is the authoritative
    // pass.
    const couponPreview = await this.buildCouponPreview(
      storeId,
      dto.coupon_code,
    );

    // Free/no-charge preview: use the resolved effective target price so legacy
    // or promotional rows that cost 0 are handled like the commit path, while
    // partner surcharges still make the plan paid.
    if (targetPricing.effective_price.lessThanOrEqualTo(DECIMAL_ZERO)) {
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
          },
        },
        coupon: couponPreview,
      };
      return this.responseService.success(
        result,
        'Free plan ready to activate',
      );
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
        coupon: couponPreview,
      };
      return this.responseService.success(result, 'Checkout preview retrieved');
    }

    const prorationPreview = await this.proration.preview(sub.id, dto.planId);

    let invoicePreview: InvoicePreview | null = null;
    if (prorationPreview.invoice_to_issue) {
      invoicePreview = prorationPreview.invoice_to_issue;
    } else if (prorationPreview.kind === 're_subscribe') {
      // Re-subscribe path: synthesize the invoice preview from the TARGET
      // plan's pricing (not the stored snapshot, which is stale for
      // cancelled/expired subs).
      const now = new Date();
      const cycleMs = this.billingCycleMs(targetPlan.billing_cycle);
      const periodEnd = new Date(now.getTime() + cycleMs);
      invoicePreview = {
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
              prorated: false,
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
      coupon: couponPreview,
    };
    return this.responseService.success(result, 'Checkout preview retrieved');
  }

  /**
   * S2.1 — Re-validate a coupon code server-side and shape the preview
   * payload. Returns null when no code was provided. Never throws — invalid
   * codes surface as `{ valid: false, reason }`.
   */
  private async buildCouponPreview(
    storeId: number,
    code: string | undefined,
  ): Promise<CouponPreviewInfo | null> {
    if (!code || !code.trim()) return null;
    const validation = await this.promotional.validateCoupon(storeId, code);
    return {
      valid: validation.valid,
      reason: validation.reason,
      reasons_blocked: validation.reasons_blocked,
      code: code.trim(),
      plan: validation.plan
        ? {
            id: validation.plan.id,
            code: validation.plan.code,
            name: validation.plan.name,
            plan_type: validation.plan.plan_type,
          }
        : undefined,
      overlay_features: validation.overlay_features,
      duration_days: validation.duration_days,
      starts_at: validation.starts_at,
      expires_at: validation.expires_at,
    };
  }

  private async resolveTargetPricing(
    plan: {
      id: number;
      base_price: Prisma.Decimal;
      max_partner_margin_pct: Prisma.Decimal | null;
    },
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

  /**
   * Void a pending plan change invoice and clear all pending_* fields on the
   * subscription. Idempotent: safe to call when there's nothing pending.
   */
  private async voidPendingChange(
    sub: { id: number; pending_change_invoice_id: number | null },
    tx?: any,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    if (sub.pending_change_invoice_id) {
      await client.subscription_invoices.update({
        where: { id: sub.pending_change_invoice_id },
        data: { state: 'void' },
      });
      await client.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          pending_plan_id: null,
          pending_change_invoice_id: null,
          pending_change_kind: null,
          pending_change_started_at: null,
          pending_revert_state: null,
        },
      });
    }
  }

  /**
   * Derive the change kind (initial / resubscribe / trial_conversion /
   * upgrade / downgrade) by comparing the current plan price to the new one.
   */
  private async deriveChangeKind(
    sub: { state: string; plan_id: number | null; paid_plan_id: number | null },
    newPlanId: number,
  ): Promise<string> {
    if (!sub.plan_id && !sub.paid_plan_id) return 'initial';
    if (sub.state === 'cancelled' || sub.state === 'expired')
      return 'resubscribe';
    if (sub.state === 'trial') return 'trial_conversion';

    // Compare normalized monthly-equivalent prices to determine upgrade vs
    // downgrade. Comparing raw `base_price` across cycles is wrong: a yearly
    // plan's raw price is ~12× a monthly plan's, so a switch from monthly to
    // yearly of the SAME tier would always classify as upgrade (and vice
    // versa for yearly→monthly). Normalizing by cycle-months gives the true
    // tier comparison the policy actually means.
    const [currentPlan, newPlan] = await Promise.all([
      sub.paid_plan_id
        ? this.prisma.subscription_plans.findUnique({
            where: { id: sub.paid_plan_id },
            select: { base_price: true, billing_cycle: true },
          })
        : null,
      this.prisma.subscription_plans.findUnique({
        where: { id: newPlanId },
        select: { base_price: true, billing_cycle: true },
      }),
    ]);

    if (!currentPlan || !newPlan) return 'upgrade';

    const cycleMonths = (cycle: string | null | undefined): number =>
      cycle === 'yearly' ? 12 : 1;
    const currentMonthly = new Prisma.Decimal(currentPlan.base_price).dividedBy(
      cycleMonths(currentPlan.billing_cycle),
    );
    const newMonthly = new Prisma.Decimal(newPlan.base_price).dividedBy(
      cycleMonths(newPlan.billing_cycle),
    );
    return newMonthly.greaterThan(currentMonthly) ? 'upgrade' : 'downgrade';
  }

  @Permissions('subscriptions:write')
  @Post('commit')
  async commit(@Body() dto: CheckoutCommitDto) {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // `sub` is `let` (not `const`) because Bug 1 (free-plan swap while
    // pending_payment) cancels the existing row and we re-read after.
    let sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });

    // Free/no-charge detection: use the target plan's live effective price
    // (including partner override) instead of only the `is_free` flag. This
    // preserves paid-plan protection while allowing legacy/promotional rows
    // whose effective target charge is actually 0.
    const targetPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.planId },
      select: {
        id: true,
        base_price: true,
        max_partner_margin_pct: true,
        is_free: true,
      },
    });
    const targetPricing = targetPlan
      ? await this.resolveTargetPricing(
          {
            id: targetPlan.id,
            base_price: targetPlan.base_price,
            max_partner_margin_pct: targetPlan.max_partner_margin_pct,
          },
          (sub as any)?.partner_override_id ?? null,
        )
      : null;
    const isFreePlan = !!(
      targetPlan &&
      targetPricing &&
      targetPricing.effective_price.lessThanOrEqualTo(DECIMAL_ZERO)
    );

    // S3.4 — A trial-state plan swap is a free deferred change ONLY when the
    // target is also free. Trial → paid is now handled as an immediate
    // re-subscribe (RNC-15 anti-arrastre) and DOES emit a charge, so it must
    // require the no-refund acknowledgement like any other paid commit.
    const isTrialSwap = !!(
      sub &&
      sub.state === 'trial' &&
      sub.trial_ends_at &&
      sub.trial_ends_at.getTime() > Date.now() &&
      isFreePlan
    );

    // G8 — política de no-reembolso. Bloqueo duro: el cliente debe aceptar
    // explícitamente. Sin esto no se procesa ningún cargo. Se exenta para
    // flujos que no emiten cargo (trial swap, free plan).
    if (!isTrialSwap && !isFreePlan && dto.no_refund_acknowledged !== true) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_VALIDATION,
        'Debes aceptar la política de no-reembolso',
      );
    }

    const acknowledgmentMetadata: Record<string, unknown> = {
      no_refund_acknowledged: dto.no_refund_acknowledged === true,
      no_refund_acknowledged_at:
        dto.no_refund_acknowledged_at ?? new Date().toISOString(),
      acknowledged_user_id: context?.user_id ?? null,
    };

    // S2.1 — Coupon pre-validation. Re-check server-side; reject the commit
    // up-front if the code is invalid so the user sees the error before the
    // Wompi widget opens.
    let couponCode: string | null = null;
    if (dto.coupon_code && dto.coupon_code.trim()) {
      const validation = await this.promotional.validateCoupon(
        storeId,
        dto.coupon_code,
      );
      if (!validation.valid) {
        throw new VendixHttpException(
          ErrorCodes.PROMO_NOT_ELIGIBLE,
          `Cupón inválido: ${validation.reason ?? 'unknown'}`,
        );
      }
      couponCode = dto.coupon_code.trim();
    }

    // Idempotency probe: if the store already has a pending change for the
    // SAME plan and an `issued` invoice, reuse the existing widget instead
    // of creating a duplicate. Prevents double-billing on retried commits.
    const subWithPending = sub as any;
    if (
      sub &&
      subWithPending.pending_plan_id === dto.planId &&
      subWithPending.pending_change_invoice_id
    ) {
      const existingInvoice =
        await this.prisma.subscription_invoices.findUnique({
          where: { id: subWithPending.pending_change_invoice_id as number },
          select: { id: true, state: true, total: true, currency: true },
        });
      if (existingInvoice?.state === 'issued') {
        const customerEmail = await this.resolveCustomerEmail(
          context?.user_id ?? null,
        );
        const { widget } = await this.payment.prepareWidgetCharge(
          existingInvoice.id,
          {
            customerEmail,
            redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
          },
        );
        return this.responseService.success(
          { widget, invoiceId: existingInvoice.id, reused: true },
          'Plan change already in progress — existing widget returned',
        );
      }
    }

    // If a DIFFERENT plan is pending, void it first so we don't accumulate
    // stale pending invoices.
    if (
      sub &&
      subWithPending.pending_plan_id != null &&
      subWithPending.pending_plan_id !== dto.planId &&
      subWithPending.pending_change_invoice_id
    ) {
      await this.voidPendingChange(subWithPending);
    }

    // S3.8b — Bug 1 fix: Free-plan switch while a previous subscription is
    // stuck in `pending_payment`. The legacy path-E branch below assumed the
    // target was paid and emitted a new invoice, leaving the user trapped in
    // pending_payment. For a free plan there's no charge to wait for, so we:
    //   1. Void the stranded pending invoice + cancel its pending payments.
    //   2. Cancel the dead subscription (legal transition pending_payment →
    //      cancelled per TRANSITIONS map).
    //   3. Fall through to the existing cancelled/expired re-subscribe path
    //      below, which already handles the free-plan zero-invoice case
    //      (issueInvoice() returns null → straight transition to `active`).
    if (sub && sub.state === 'pending_payment' && isFreePlan) {
      await this.cancelStrandedPendingSubscription(
        sub.id,
        storeId,
        context?.user_id ?? null,
        'free_plan_replacement',
      );
      // Re-fetch so downstream branches (cancelled re-subscribe) pick up the
      // new state. The cancelled row will flow through path D below.
      sub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: storeId },
      });
    }

    // Fresh purchase: store has no subscription yet → create one, issue
    // first invoice, build a Wompi WidgetCheckout config so the frontend can
    // open the embedded widget (same UX as eCommerce checkout). Trial is NOT
    // granted here — checkout is an explicit purchase; trial bootstrapping
    // happens at onboarding only.
    if (!sub) {
      const created = await this.createFreshSubscription(
        storeId,
        dto.planId,
        context?.user_id ?? null,
        couponCode,
      );
      await this.resolver.invalidate(storeId);

      const totalDecimal = new Prisma.Decimal(created.effective_price);
      if (totalDecimal.lessThanOrEqualTo(DECIMAL_ZERO)) {
        // Free plan: subscription is already `active` → apply coupon
        // synchronously so the overlay lands before the response returns.
        if (couponCode) {
          await this.safeApplyCoupon(
            storeId,
            couponCode,
            context?.user_id ?? null,
          );
        }
        return this.responseService.success(
          { subscription: created, widget: null },
          'Free plan activated',
        );
      }

      const invoice = await this.billing.issueInvoice(created.id, {
        fromPlanId: null,
        toPlanId: dto.planId,
        changeKind: 'initial',
      });
      if (!invoice) {
        return this.responseService.success(
          { subscription: created, widget: null },
          'Checkout committed (no invoice issued)',
        );
      }

      // Stamp pending_* fields so confirmPendingChange can mutate plan after gateway confirms.
      await this.prisma.store_subscriptions.update({
        where: { id: created.id },
        data: {
          pending_plan_id: dto.planId,
          pending_change_invoice_id: invoice.id,
          pending_change_kind: 'initial',
          pending_change_started_at: new Date(),
          pending_revert_state: 'no_plan' as any,
        },
      });

      // G8 — persistir aceptación de no-reembolso en metadata de la factura.
      await this.mergeInvoiceAckMetadata(invoice.id, acknowledgmentMetadata);

      const customerEmail = await this.resolveCustomerEmail(
        context?.user_id ?? null,
      );
      const { widget } = await this.payment.prepareWidgetCharge(invoice.id, {
        customerEmail,
        redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
      });

      return this.responseService.success(
        { subscription: created, widget, invoiceId: invoice.id },
        'Checkout committed',
      );
    }

    // Path D — Re-subscribe from a terminal state (`cancelled` / `expired`)
    // OR adopt a plan from `no_plan` (sibling store under the same org has
    // already consumed the org-level trial). All three states share the same
    // pipeline: transition → pending_payment, reset the billing window via
    // applyResubscribe(), issue a fresh invoice for the new plan's full
    // price, and prepare the Wompi widget so the frontend can open the
    // payment modal. The pending_payment → active promotion happens via the
    // existing SubscriptionStateListener once Wompi reports APPROVED.
    //
    // BUGFIX (no_plan → paid): previously this branch only matched
    // cancelled/expired, so `no_plan` sub rows fell through to the final
    // proration.apply() call which assumes an existing plan_id and a stored
    // payment method — leaving the widget unopened and the plan assigned in
    // BD without a charge. We now route no_plan through the same fresh-charge
    // pipeline. For free targets we short-circuit to `active` straight away
    // (no invoice, no widget) just like the cancelled-free path.
    if (
      sub.state === 'cancelled' ||
      sub.state === 'expired' ||
      sub.state === 'no_plan'
    ) {
      // 1. Transition cancelled/expired → pending_payment (legal edge added
      //    in TRANSITIONS map). Audit row + cache invalidation handled by
      //    SubscriptionStateService.transition().
      await this.stateService.transition(storeId, 'pending_payment', {
        reason: 're_subscribe_checkout',
        triggeredByUserId: context?.user_id ?? undefined,
        payload: {
          from_plan_id: (sub as any).paid_plan_id ?? sub.plan_id,
          to_plan_id: dto.planId,
          previous_state: sub.state,
        },
      });

      // 2. Reset plan + period + dunning crumbs. Stamps a `reactivated`
      //    subscription_event with mode='re_subscribe'.
      const reactivated = await this.proration.applyResubscribe(
        sub.id,
        dto.planId,
      );

      // 3. Persist coupon for application after the listener promotes the
      //    sub to `active` (same pattern as fresh-purchase path).
      if (couponCode) {
        const reactMeta = {
          ...(reactivated.metadata && typeof reactivated.metadata === 'object'
            ? (reactivated.metadata as Record<string, unknown>)
            : {}),
          pending_coupon_code: couponCode,
        };
        await this.prisma.store_subscriptions.update({
          where: { id: reactivated.id },
          data: { metadata: reactMeta as Prisma.InputJsonValue },
        });
      }

      // 4. Issue fresh invoice — pricing snapshot already updated by
      //    applyResubscribe so issueInvoice picks up the new plan amount.
      const invoice = await this.billing.issueInvoice(reactivated.id, {
        fromPlanId: (sub as any).paid_plan_id ?? sub.plan_id,
        toPlanId: dto.planId,
        changeKind: 'resubscribe',
      });
      if (!invoice) {
        // Free plan re-subscribe (rare). Promote straight to active because
        // there is no charge to wait for.
        await this.prisma.store_subscriptions.update({
          where: { id: reactivated.id },
          data: { paid_plan_id: dto.planId },
        });
        await this.stateService.transition(storeId, 'active', {
          reason: 're_subscribe_free_plan',
          triggeredByUserId: context?.user_id ?? undefined,
        });
        await this.resolver.invalidate(storeId);
        if (couponCode) {
          await this.safeApplyCoupon(
            storeId,
            couponCode,
            context?.user_id ?? null,
          );
        }
        return this.responseService.success(
          { subscription: reactivated, widget: null, mode: 're_subscribe' },
          'Re-subscription activated (free plan)',
        );
      }

      // 5. Stamp pending_* fields so confirmPendingChange can mutate plan after gateway confirms.
      await this.prisma.store_subscriptions.update({
        where: { id: reactivated.id },
        data: {
          pending_plan_id: dto.planId,
          pending_change_invoice_id: invoice.id,
          pending_change_kind: 'resubscribe',
          pending_change_started_at: new Date(),
          pending_revert_state: sub.state as any,
        },
      });

      // 6. Persist no-refund acknowledgement and prepare Wompi widget.
      await this.mergeInvoiceAckMetadata(invoice.id, acknowledgmentMetadata);
      const customerEmail = await this.resolveCustomerEmail(
        context?.user_id ?? null,
      );
      const { widget } = await this.payment.prepareWidgetCharge(invoice.id, {
        customerEmail,
        redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
      });

      await this.resolver.invalidate(storeId);

      return this.responseService.success(
        {
          subscription: reactivated,
          widget,
          invoiceId: invoice.id,
          mode: 're_subscribe',
        },
        'Re-subscription committed',
      );
    }

    // S3.8 — Path E: subscription stuck in `pending_payment`. The user
    // signed up but never completed the first cycle's payment (widget closed,
    // bank rejection, etc.). Re-route through the re-subscribe pipeline so
    // we issue/reuse a fresh invoice and emit the Wompi widget; the regular
    // proration path emits no widget and assumes a stored card, which is
    // never present in this state.
    //
    // Bug 2 fix: when the plan changes while pending we must void the old
    // invoice + payments to avoid double-charge risk. issueInvoice() now
    // does this automatically (auto-void on plan change, idempotent reuse on
    // same plan). We just need to refresh pricing via applyResubscribe before
    // calling it so the new plan's price is reflected.
    if (sub.state === 'pending_payment' && !isFreePlan) {
      // Source of truth for "what plan was the user trying to buy" during
      // pending_payment is `pending_plan_id`, not `plan_id`. For mid-cycle
      // changes `plan_id` still holds the old paid plan; for fresh purchases
      // it's null. Comparing against `pending_plan_id` correctly distinguishes
      // a retry of the same selection from an actual selection change.
      const subPending = sub as any;
      const previousPendingPlanId: number | null =
        subPending.pending_plan_id ?? null;
      const planChangedWhilePending =
        previousPendingPlanId != null && previousPendingPlanId !== dto.planId;

      if (planChangedWhilePending) {
        // Plan changed while pending — refresh pricing/period so the next
        // invoice reflects the latest selection. issueInvoice() will detect
        // the plan mismatch on the existing pending row and void it.
        await this.proration.applyResubscribe(sub.id, dto.planId);
      }

      // issueInvoice handles both reuse (same plan, idempotent retries) and
      // void+create (plan changed). Always non-null for a paid plan.
      const invoice = await this.billing.issueInvoice(sub.id, {
        fromPlanId: subPending.paid_plan_id ?? sub.plan_id,
        toPlanId: dto.planId,
        changeKind: planChangedWhilePending ? 'resubscribe' : undefined,
      });

      if (!invoice) {
        // Defensive: a paid plan must always produce an invoice.
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
          'Could not issue invoice for pending_payment subscription',
        );
      }

      // Stamp pending_* fields for confirmPendingChange to act upon after gateway confirms.
      // Pending kind: if there was no previous pending selection or paid plan,
      // this is a fresh `initial`. Otherwise it's a resubscribe-style switch.
      const isFreshInitial =
        previousPendingPlanId == null && !subPending.paid_plan_id;
      await this.prisma.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          pending_plan_id: dto.planId,
          pending_change_invoice_id: invoice.id,
          pending_change_kind: (isFreshInitial
            ? 'initial'
            : 'resubscribe') as any,
          pending_change_started_at: new Date(),
          pending_revert_state: 'cancelled' as any,
        },
      });

      await this.mergeInvoiceAckMetadata(invoice.id, acknowledgmentMetadata);
      const customerEmail = await this.resolveCustomerEmail(
        context?.user_id ?? null,
      );
      const { widget } = await this.payment.prepareWidgetCharge(invoice.id, {
        customerEmail,
        redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
      });

      await this.resolver.invalidate(storeId);

      return this.responseService.success(
        {
          subscription: await this.prisma.store_subscriptions.findUnique({
            where: { id: sub.id },
          }),
          widget,
          invoiceId: invoice.id,
          mode: 'pending_payment_resume',
        },
        'Pending payment resumed',
      );
    }

    // RNC-15 — Trial → paid plan. Anti-arrastre: charge the FULL destination
    // plan price immediately. Mirrors the cancelled/expired re-subscribe path:
    // transition trial → pending_payment, reset the billing window via
    // applyResubscribe(), issue a fresh invoice for the new plan's full price,
    // and prepare the Wompi widget. The promotion to `active` happens via the
    // SubscriptionStateListener once Wompi reports APPROVED — never before.
    const isTrialToPaid = !!(
      sub &&
      sub.state === 'trial' &&
      sub.trial_ends_at &&
      sub.trial_ends_at.getTime() > Date.now() &&
      !isFreePlan
    );
    if (isTrialToPaid) {
      // Validate platform Wompi credentials BEFORE mutating state, so a
      // misconfigured environment surfaces a clean error and the trial is
      // left untouched.
      const wompiCreds = await this.platformGw.getActiveCredentials('wompi');
      if (!wompiCreds) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_GATEWAY_003,
          'Credenciales de pasarela de plataforma no configuradas',
        );
      }

      // 1. trial → pending_payment (legal transition added in TRANSITIONS).
      await this.stateService.transition(storeId, 'pending_payment', {
        reason: 'trial_to_paid_checkout',
        triggeredByUserId: context?.user_id ?? undefined,
        payload: {
          from_plan_id: sub.plan_id,
          to_plan_id: dto.planId,
          previous_state: sub.state,
          trial_ends_at: sub.trial_ends_at?.toISOString() ?? null,
        },
      });

      // 2. Reset plan + period (anti-arrastre: no carry-over of trial days).
      const reactivated = await this.proration.applyResubscribe(
        sub.id,
        dto.planId,
      );

      // 3. Persist coupon for application after listener flips to `active`.
      if (couponCode) {
        const reactMeta = {
          ...(reactivated.metadata && typeof reactivated.metadata === 'object'
            ? (reactivated.metadata as Record<string, unknown>)
            : {}),
          pending_coupon_code: couponCode,
        };
        await this.prisma.store_subscriptions.update({
          where: { id: reactivated.id },
          data: { metadata: reactMeta as Prisma.InputJsonValue },
        });
      }

      // 4. Issue invoice for the new plan's full price.
      const invoice = await this.billing.issueInvoice(reactivated.id, {
        fromPlanId: null,
        toPlanId: dto.planId,
        changeKind: 'trial_conversion',
      });
      if (!invoice) {
        // Defensive: a paid plan must always produce an invoice.
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
          'Could not issue invoice for trial-to-paid checkout',
        );
      }

      // 5. Stamp pending_* fields so confirmPendingChange can mutate plan after gateway confirms.
      await this.prisma.store_subscriptions.update({
        where: { id: reactivated.id },
        data: {
          pending_plan_id: dto.planId,
          pending_change_invoice_id: invoice.id,
          pending_change_kind: 'trial_conversion',
          pending_change_started_at: new Date(),
          pending_revert_state: 'trial' as any,
        },
      });

      // 6. Persist no-refund acknowledgement and prepare Wompi widget.
      await this.mergeInvoiceAckMetadata(invoice.id, acknowledgmentMetadata);
      const customerEmail = await this.resolveCustomerEmail(
        context?.user_id ?? null,
      );
      const { widget } = await this.payment.prepareWidgetCharge(invoice.id, {
        customerEmail,
        redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
      });

      await this.resolver.invalidate(storeId);

      return this.responseService.success(
        {
          subscription: reactivated,
          widget,
          invoiceId: invoice.id,
          mode: 'trial_to_paid',
        },
        'Trial upgraded to paid plan (awaiting payment)',
      );
    }

    // S3.4 — Re-evaluate proration server-side BEFORE applying so we can
    // branch on `trial_plan_swap` and skip the no-refund-bound invoice/charge
    // pipeline. Trial → free is immediate: no invoice/widget, and the old
    // trial window is closed so the destination free cycle starts now.
    const previewResult = await this.proration.preview(sub.id, dto.planId);
    if (previewResult.kind === 'trial_plan_swap') {
      const updated = await this.proration.apply(sub.id, dto.planId);
      await this.resolver.invalidate(storeId);
      // Coupons can still be applied during a trial swap — the overlay
      // attaches to the destination plan and surfaces at the next billing.
      if (couponCode) {
        await this.safeApplyCoupon(
          storeId,
          couponCode,
          context?.user_id ?? null,
        );
      }
      return this.responseService.success(
        {
          subscription: updated,
          mode: 'trial_plan_swap',
          trial_ends_at: null,
        },
        'Checkout committed (trial to free plan)',
      );
    }

    // S3.6 — Free-plan downgrade: activate synchronously (no charge, no widget).
    // proration.apply() for paid → free produces a credit; no invoice is emitted.
    if (isFreePlan) {
      const updated = await this.proration.apply(sub.id, dto.planId);
      // Clear any stale pending fields when moving to free.
      await this.prisma.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          paid_plan_id: dto.planId,
          pending_plan_id: null,
          pending_change_invoice_id: null,
          pending_change_kind: null,
          pending_change_started_at: null,
          pending_revert_state: null,
        },
      });
      if (couponCode) {
        await this.safeApplyCoupon(
          storeId,
          couponCode,
          context?.user_id ?? null,
        );
      }
      await this.resolver.invalidate(storeId);
      return this.responseService.success(
        { subscription: updated, widget: null, mode: 'free_plan_activated' },
        'Checkout committed (free plan)',
      );
    }

    // S3.6 — Mid-cycle plan change for paid plans (upgrade or downgrade to paid).
    // Instead of apply() + charge() synchronously (which has a rollback race),
    // we issue the invoice, stamp pending_* fields, transition to pending_payment,
    // and return the Wompi widget. confirmPendingChange() completes the mutation
    // once the gateway confirms.
    //
    // Downgrade to paid plan: still goes through the widget flow (proration
    // credit may apply, but any balance owed triggers a charge).
    // Scheduled downgrades (end-of-cycle) are handled separately by the billing
    // scheduler and do NOT pass through this path.
    const wompiCreds = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiCreds) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    const changeKind = await this.deriveChangeKind(
      {
        state: sub.state,
        plan_id: sub.plan_id,
        paid_plan_id: (sub as any).paid_plan_id ?? null,
      },
      dto.planId,
    );

    // Preview proration to get the prorated amount for the invoice opts.
    const proratedAmount = previewResult.proration_amount
      ? new Prisma.Decimal(previewResult.proration_amount)
      : DECIMAL_ZERO;

    const midCycleInvoice = await this.billing.issueInvoice(sub.id, {
      prorated: proratedAmount.greaterThan(DECIMAL_ZERO),
      proratedAmount: proratedAmount.greaterThan(DECIMAL_ZERO)
        ? proratedAmount
        : undefined,
      fromPlanId: (sub as any).paid_plan_id ?? sub.plan_id,
      toPlanId: dto.planId,
      changeKind: changeKind as any,
    });

    if (!midCycleInvoice) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Could not issue proration invoice for mid-cycle plan change',
      );
    }

    // Stamp pending_* fields and transition to pending_payment within a tx.
    await this.prisma.$transaction(async (tx) => {
      await tx.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          pending_plan_id: dto.planId,
          pending_change_invoice_id: midCycleInvoice.id,
          pending_change_kind: changeKind as any,
          pending_change_started_at: new Date(),
          pending_revert_state: sub.state as any,
        },
      });
      await this.stateService.transitionInTx(tx, storeId, 'pending_payment', {
        reason: `checkout_commit_${changeKind}_${dto.planId}`,
        triggeredByUserId: context?.user_id ?? undefined,
        payload: {
          from_plan_id: (sub as any).paid_plan_id ?? sub.plan_id,
          to_plan_id: dto.planId,
          invoice_id: midCycleInvoice.id,
          change_kind: changeKind,
        },
      });
    });

    // Persist coupon for application after listener flips to `active`.
    if (couponCode) {
      const currentMeta = await this.prisma.store_subscriptions.findUnique({
        where: { id: sub.id },
        select: { metadata: true },
      });
      const existingMeta =
        currentMeta?.metadata && typeof currentMeta.metadata === 'object'
          ? (currentMeta.metadata as Record<string, unknown>)
          : {};
      await this.prisma.store_subscriptions.update({
        where: { id: sub.id },
        data: {
          metadata: {
            ...existingMeta,
            pending_coupon_code: couponCode,
          } as Prisma.InputJsonValue,
        },
      });
    }

    // G8 — persistir aceptación de no-reembolso.
    await this.mergeInvoiceAckMetadata(
      midCycleInvoice.id,
      acknowledgmentMetadata,
    );

    // prepareWidgetCharge MUST be called OUTSIDE the Prisma transaction.
    const customerEmailMid = await this.resolveCustomerEmail(
      context?.user_id ?? null,
    );
    const { widget: midCycleWidget } = await this.payment.prepareWidgetCharge(
      midCycleInvoice.id,
      {
        customerEmail: customerEmailMid,
        redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
      },
    );

    await this.resolver.invalidate(storeId);

    return this.responseService.success(
      {
        widget: midCycleWidget,
        invoiceId: midCycleInvoice.id,
        mode: changeKind,
        subscription: await this.prisma.store_subscriptions.findUnique({
          where: { id: sub.id },
        }),
      },
      'Plan change pending payment',
    );
  }

  /**
   * Bug 1 / 2 helper — Cancel a subscription stuck in `pending_payment` and
   * void its in-flight invoice + payments so the store can switch onto a
   * different (free or paid) plan without leaving stale billing artifacts
   * behind. Idempotent: safe to call when the row is already cancelled or
   * when there's nothing pending to void.
   */
  private async cancelStrandedPendingSubscription(
    subscriptionId: number,
    storeId: number,
    userId: number | null,
    reason: 'free_plan_replacement' | 'plan_change_replacement',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      // Void any pending invoices for this subscription.
      const pendingInvoices = await tx.subscription_invoices.findMany({
        where: { store_subscription_id: subscriptionId, state: 'issued' },
        select: { id: true, metadata: true },
      });
      for (const inv of pendingInvoices) {
        const meta =
          inv.metadata && typeof inv.metadata === 'object'
            ? (inv.metadata as Record<string, unknown>)
            : {};
        await tx.subscription_invoices.update({
          where: { id: inv.id },
          data: {
            state: 'void',
            metadata: {
              ...meta,
              void_reason: reason,
              voided_at: new Date().toISOString(),
            } as Prisma.InputJsonValue,
            updated_at: new Date(),
          },
        });

        // Cancel pending payments tied to the voided invoice. The enum has no
        // explicit `cancelled`, so we mark them `failed` with reason metadata.
        const pendingPayments = await tx.subscription_payments.findMany({
          where: { invoice_id: inv.id, state: 'pending' },
          select: { id: true, metadata: true },
        });
        for (const pp of pendingPayments) {
          const ppMeta =
            pp.metadata && typeof pp.metadata === 'object'
              ? (pp.metadata as Record<string, unknown>)
              : {};
          await tx.subscription_payments.update({
            where: { id: pp.id },
            data: {
              state: 'failed',
              metadata: {
                ...ppMeta,
                cancellation_reason: reason,
                cancelled_at: new Date().toISOString(),
              } as Prisma.InputJsonValue,
              updated_at: new Date(),
            },
          });
        }

        // Reverse the partner commission row for this voided invoice so the
        // monthly payout batch ignores it (terminal state in enum).
        await tx.partner_commissions.updateMany({
          where: { invoice_id: inv.id, state: 'accrued' },
          data: { state: 'reversed' },
        });
      }

      // Transition pending_payment → cancelled within the same tx so the
      // void of invoices and the row state-change commit together.
      await this.stateService.transitionInTx(tx, storeId, 'cancelled', {
        reason,
        triggeredByUserId: userId ?? undefined,
        payload: {
          subscription_id: subscriptionId,
          voided_invoice_count: pendingInvoices.length,
        },
      });
    });

    // Post-commit side effects (cache invalidation only — events emitted by
    // the next state transition into `pending_payment` / `active`).
    await this.resolver.invalidate(storeId);
  }

  /**
   * Bug 3 — Retry payment endpoint. Allows a user stuck in `pending_payment`
   * to re-open the Wompi widget for the existing pending invoice WITHOUT
   * going through the full checkout/commit flow (which would create a new
   * invoice, void the old one, etc.). Idempotent: calling it twice returns
   * the same widget config bound to the same invoice.
   *
   * - Authentication: handled by JwtAuthGuard at the global guard layer.
   * - Subscription gating: bypassed via class-level @SkipSubscriptionGate so
   *   a blocked/pending-payment store can still pay its bill.
   * - Permission: subscriptions:write — same as commit.
   */
  @Permissions('subscriptions:write')
  @Post('retry-payment')
  async retryPayment(@Body() dto: RetryPaymentDto) {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!sub) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'No subscription to retry',
      );
    }
    if (sub.state !== 'pending_payment') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        `Cannot retry payment in state ${sub.state}`,
      );
    }

    // Find the most recent pending invoice for this subscription. We do NOT
    // create a new one here — the caller wants to complete the existing
    // payment, not start a new billing cycle.
    const invoice = await this.prisma.subscription_invoices.findFirst({
      where: { store_subscription_id: sub.id, state: 'issued' },
      orderBy: { created_at: 'desc' },
    });
    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.DUNNING_001,
        'No payable invoice available for retry',
      );
    }

    const customerEmail = await this.resolveCustomerEmail(
      context?.user_id ?? null,
    );
    const { widget } = await this.payment.prepareWidgetCharge(invoice.id, {
      customerEmail,
      redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
    });

    return this.responseService.success(
      {
        widget,
        invoice: {
          id: invoice.id,
          total: invoice.total.toString(),
          currency: invoice.currency,
        },
      },
      'Retry payment widget prepared',
    );
  }

  /**
   * Cancel a pending plan change. Voids the pending invoice and reverts the
   * subscription to the state it was in before the change was initiated
   * (stored in `pending_revert_state`). Only valid when the sub is in
   * `pending_payment` with a `pending_plan_id` set.
   */
  @Permissions('subscriptions:write')
  @Delete('pending-change')
  async cancelPendingChange() {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: {
        id: true,
        state: true,
        pending_plan_id: true,
        pending_change_invoice_id: true,
        pending_revert_state: true,
      },
    });

    const subAny = sub as any;
    if (!sub || sub.state !== 'pending_payment' || !subAny.pending_plan_id) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'No pending plan change to cancel',
      );
    }

    const revertState: string = subAny.pending_revert_state ?? 'cancelled';

    await this.prisma.$transaction(async (tx) => {
      await this.voidPendingChange(subAny, tx);
      await this.stateService.transitionInTx(tx, storeId, revertState as any, {
        reason: 'user_cancelled_pending_change',
        triggeredByUserId: context?.user_id ?? undefined,
        payload: { cancelled_pending_plan_id: subAny.pending_plan_id },
      });
    });

    this.resolver.invalidate(storeId).catch((err) =>
      // eslint-disable-next-line no-console
      console.warn(
        `[SubscriptionCheckout] Failed to invalidate resolver cache: ${(err as Error).message}`,
      ),
    );

    return this.responseService.success(
      { success: true, reverted_to_state: revertState },
      'Pending plan change cancelled',
    );
  }

  /**
   * Pull-fallback sync — Webhook safety net. The frontend polling layer
   * calls this on every cycle while a checkout invoice is in `pending_payment`
   * so localhost/NAT-restricted environments still close the loop with Wompi.
   *
   * Backend hits Wompi `GET /v1/transactions?reference=...` with platform
   * credentials and reuses the webhook success/failure handlers.
   * Idempotency is guaranteed via `webhook_event_dedup` (processor='wompi_sync').
   *
   * Returns a discriminated result so the frontend can decide whether to
   * stop polling (paid/failed) or continue (pending).
   */
  @Permissions('subscriptions:write')
  @Post('invoices/:invoiceId/sync-from-gateway')
  async syncInvoiceFromGateway(
    @Param('invoiceId', ParseIntPipe) invoiceId: number,
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Defensive scoping — the invoice must belong to the caller's store so
    // a tenant cannot poke another tenant's invoice id.
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
      select: { id: true, store_id: true },
    });
    if (!invoice || invoice.store_id !== storeId) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const result = await this.payment.syncInvoiceFromGateway(invoiceId);

    if (result.status === 'pending') {
      return this.responseService.success(result, 'Pago aún pendiente');
    }
    if (result.status === 'no_transaction') {
      return this.responseService.success(result, 'Sin transacción asociada');
    }
    if (result.status === 'failed') {
      return this.responseService.success(result, 'Pago rechazado');
    }
    return this.responseService.success(result, 'Pago confirmado');
  }

  /**
   * S2.1 — Best-effort coupon application. Wraps `applyCoupon()` in a
   * try/catch so a coupon-only failure does not roll back the checkout
   * (the subscription/charge are the load-bearing artifacts). The
   * subscription_state listener can re-attempt later for the
   * pending_payment → active path via `pending_coupon_code` metadata.
   */
  private async safeApplyCoupon(
    storeId: number,
    code: string,
    userId: number | null,
  ): Promise<void> {
    try {
      await this.promotional.applyCoupon(storeId, code, userId);
    } catch (err) {
      // Surface as a non-fatal warning. The frontend already validated the
      // coupon; failures here are edge races (e.g. promo expired between
      // preview and commit). Operator can re-apply manually.
      // eslint-disable-next-line no-console
      console.warn(
        `[SubscriptionCheckout] applyCoupon failed for store ${storeId} (${code}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * G8 — Mergea el bloque de aceptación de no-reembolso en
   * subscription_invoices.metadata sin sobrescribir las claves existentes
   * (prorated, credit_applied, etc.).
   */
  private async mergeInvoiceAckMetadata(
    invoiceId: number,
    ack: Record<string, unknown>,
  ): Promise<void> {
    const current = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
      select: { metadata: true },
    });
    const existing =
      current?.metadata && typeof current.metadata === 'object'
        ? (current.metadata as Record<string, unknown>)
        : {};
    const merged = { ...existing, ...ack } as Prisma.InputJsonValue;
    await this.prisma.subscription_invoices.update({
      where: { id: invoiceId },
      data: { metadata: merged },
    });
  }

  private async createFreshSubscription(
    storeId: number,
    planId: number,
    userId: number | null,
    couponCode: string | null = null,
  ) {
    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Plan not found',
      );
    }
    if (plan.archived_at || plan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.PLAN_001,
        'Plan no disponible para suscripción',
      );
    }

    const pricing = this.billing.computePricing({ plan });
    const now = new Date();
    const cycleMs = this.billingCycleMs(plan.billing_cycle);
    const periodEnd = new Date(now.getTime() + cycleMs);

    // Paid plans MUST land in `pending_payment` until the Wompi webhook (or
    // POS confirm) reports the charge as APPROVED. Only the SubscriptionState
    // Listener (subscription.payment.succeeded) is allowed to promote them
    // to `active`. No-charge plans skip the invoice/charge cycle and go
    // straight to `active`. The resolved effective price already includes
    // partner surcharges/margins, so base-free plans with a surcharge still
    // remain in the paid pipeline.
    const isFreePlan = pricing.effective_price.lessThanOrEqualTo(DECIMAL_ZERO);
    const initialState = isFreePlan ? 'active' : 'pending_payment';

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

      // S2.1 — Persist the coupon code in metadata so the
      // SubscriptionStateListener can apply it on transition to `active`
      // (pending_payment → active path after the Wompi webhook).
      const subMetadata: Record<string, unknown> | null = couponCode
        ? { pending_coupon_code: couponCode }
        : null;

      const created = await tx.store_subscriptions.create({
        data: {
          store_id: storeId,
          plan_id: isFreePlan ? plan.id : null,
          paid_plan_id: isFreePlan ? plan.id : null,
          partner_override_id: null,
          state: initialState,
          effective_price: pricing.effective_price,
          vendix_base_price: pricing.base_price,
          partner_margin_amount: pricing.margin_amount,
          currency: 'COP',
          resolved_features: {},
          trial_ends_at: null,
          current_period_start: now,
          current_period_end: periodEnd,
          next_billing_at: periodEnd,
          metadata: subMetadata as Prisma.InputJsonValue,
        },
        include: { plan: true },
      });

      await tx.subscription_events.create({
        data: {
          store_subscription_id: created.id,
          type: 'state_transition',
          from_state: 'draft',
          to_state: initialState,
          payload: {
            reason: isFreePlan
              ? 'checkout_fresh_purchase_free_plan'
              : 'checkout_fresh_purchase_awaiting_payment',
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

  private async resolveCustomerEmail(
    userId: number | null,
  ): Promise<string | undefined> {
    if (!userId) return undefined;
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? undefined;
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
}
