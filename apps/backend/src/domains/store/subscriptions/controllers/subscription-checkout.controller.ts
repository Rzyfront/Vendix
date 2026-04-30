import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
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

    // Use the explicit `is_free` flag (added by
    // 20260429235000_add_is_free_to_subscription_plans). Legacy heuristic was
    // `effective_price <= 0` which masked partner-override edge cases.
    if (
      targetPlan.is_free === true &&
      targetPricing.margin_amount.lte(DECIMAL_ZERO)
    ) {
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

    // Free-plan detection: when the plan is explicitly marked `is_free=true`
    // the commit emits no charge, so the no-refund acknowledgement is
    // semantically vacuous. Mirrors the frontend which hides the policy block
    // for free plans. Replaces the legacy `base_price <= 0` heuristic that
    // failed silently when the row pricing snapshot was stale.
    const targetPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.planId },
      select: { base_price: true, is_free: true },
    });
    const isFreePlan = !!targetPlan && targetPlan.is_free === true;

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

      const invoice = await this.billing.issueInvoice(created.id);
      if (!invoice) {
        return this.responseService.success(
          { subscription: created, widget: null },
          'Checkout committed (no invoice issued)',
        );
      }

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
          from_plan_id: sub.plan_id,
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
      const invoice = await this.billing.issueInvoice(reactivated.id);
      if (!invoice) {
        // Free plan re-subscribe (rare). Promote straight to active because
        // there is no charge to wait for.
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

      // 5. Persist no-refund acknowledgement and prepare Wompi widget.
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
      if (sub.plan_id !== dto.planId) {
        // Plan changed while pending — refresh pricing/period so the next
        // invoice reflects the latest selection. issueInvoice() will detect
        // the plan mismatch on the existing pending row and void it.
        await this.proration.applyResubscribe(sub.id, dto.planId);
      }

      // issueInvoice handles both reuse (same plan, idempotent retries) and
      // void+create (plan changed). Always non-null for a paid plan.
      const invoice = await this.billing.issueInvoice(sub.id);

      if (!invoice) {
        // Defensive: a paid plan must always produce an invoice.
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
          'Could not issue invoice for pending_payment subscription',
        );
      }

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
    const isTrialToPaid =
      !!(
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
      const invoice = await this.billing.issueInvoice(reactivated.id);
      if (!invoice) {
        // Defensive: a paid plan must always produce an invoice.
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
          'Could not issue invoice for trial-to-paid checkout',
        );
      }

      // 5. Persist no-refund acknowledgement and prepare Wompi widget.
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
    // pipeline. The trial swap path is free; no invoice is emitted, no
    // charge runs, and the subscription stays in `trial`.
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
          trial_ends_at: previewResult.trial_swap?.trial_ends_at ?? null,
        },
        'Checkout committed (trial plan swap)',
      );
    }

    // S3.6 — When the target plan is paid, we may need to charge a proration
    // amount post-apply. Validate the platform gateway is configured BEFORE
    // touching `proration.apply()` so the user gets a clean error and the
    // current plan is left untouched. Without this pre-check, apply() commits
    // the plan change first and only THEN charge() throws — leaving the
    // subscription on the new plan with an unpaid proration invoice.
    if (!isFreePlan) {
      const wompiCreds = await this.platformGw.getActiveCredentials('wompi');
      if (!wompiCreds) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_GATEWAY_003,
          'Credenciales de pasarela de plataforma no configuradas',
        );
      }
    }

    // S3.6 — Atomicity guard around apply + charge. If the charge throws
    // after `apply()` has committed, revert the plan change to oldPlanId so
    // the user is not stuck on a plan they did not pay for. The revert reuses
    // `proration.apply()` so the same audit trail (`plan_changed`) is emitted
    // with the original plan, making the rollback observable.
    const oldPlanId = sub.plan_id;
    const updated = await this.proration.apply(sub.id, dto.planId);

    // S3.6 — Skip the charge step entirely when downgrading to a free plan.
    // proration.apply() for paid → free produces a NEGATIVE proration_amount
    // (credit) and emits no new invoice; only `pending_credit` accumulates in
    // metadata. The legacy `findFirst({ state: 'issued' })` query below was
    // catching unrelated older invoices and trying to charge them — which is
    // both wrong semantically and triggers SUBSCRIPTION_GATEWAY_003 when the
    // platform gateway isn't configured for free flows.
    if (!isFreePlan) {
      const prorationAmount = await this.prisma.subscription_invoices.findFirst({
        where: { store_subscription_id: sub.id, state: 'issued' },
        orderBy: { created_at: 'desc' },
      });

      if (prorationAmount) {
        // G8 — persistir aceptación de no-reembolso en la factura prorrateada.
        await this.mergeInvoiceAckMetadata(
          prorationAmount.id,
          acknowledgmentMetadata,
        );

        const total = new Prisma.Decimal(prorationAmount.total);
        if (total.greaterThan(DECIMAL_ZERO)) {
          try {
            await this.payment.charge(prorationAmount.id);
          } catch (chargeErr) {
            // Revert plan change. We do NOT swallow `chargeErr` — re-throw
            // after the revert so the user sees the original failure.
            try {
              // RNC-39: oldPlanId may be null when the previous state was
              // no_plan. In that case there is nothing to revert to — leave
              // the plan change in place and rely on the void invoice + thrown
              // error to surface the failure to the user.
              if (oldPlanId !== null && oldPlanId !== dto.planId) {
                await this.proration.apply(sub.id, oldPlanId);
              }
              await this.prisma.subscription_invoices.update({
                where: { id: prorationAmount.id },
                data: { state: 'void' },
              });
            } catch {
              // Best-effort revert: if it fails the original error still
              // surfaces; an operator-visible plan_changed audit row remains.
            }
            throw chargeErr;
          }
        }
      }
    }

    // S2.1 — Existing-subscription path: subscription is already `active`
    // (proration only fires on active subs), so apply the coupon overlay
    // synchronously.
    if (couponCode) {
      await this.safeApplyCoupon(
        storeId,
        couponCode,
        context?.user_id ?? null,
      );
    }

    return this.responseService.success(updated, 'Checkout committed');
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
    // to `active`. Free plans (effective_price <= 0 and no partner margin)
    // skip the invoice/charge cycle and go straight to `active`.
    // Use explicit is_free flag rather than effective_price heuristic so that
    // partner-margin edge cases on base-free plans are still routed through
    // the paid pipeline (issueInvoice + Wompi widget).
    const isFreePlan =
      plan.is_free === true &&
      pricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO);
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
          plan_id: plan.id,
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
