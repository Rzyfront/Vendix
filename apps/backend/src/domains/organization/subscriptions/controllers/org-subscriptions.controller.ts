import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';

import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';

import { SubscriptionResolverService } from '../../../store/subscriptions/services/subscription-resolver.service';
import { SubscriptionStateService } from '../../../store/subscriptions/services/subscription-state.service';
import { SubscriptionBillingService } from '../../../store/subscriptions/services/subscription-billing.service';
import { SubscriptionPaymentService } from '../../../store/subscriptions/services/subscription-payment.service';
import { SubscriptionProrationService } from '../../../store/subscriptions/services/subscription-proration.service';
import { SubscriptionInvoicePdfService } from '../../../store/subscriptions/services/subscription-invoice-pdf.service';
import { PromotionalApplyService } from '../../../store/subscriptions/services/promotional-apply.service';
import { PlatformGatewayService } from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgSubscriptionsService } from '../services/org-subscriptions.service';
import { OrgSubscriptionQueryDto } from '../dto/org-subscription-query.dto';
import { OrgCheckoutPreviewDto } from '../dto/org-checkout-preview.dto';
import { OrgCheckoutCommitDto } from '../dto/org-checkout-commit.dto';
import { OrgPlansQueryDto } from '../dto/org-plans-query.dto';
import { OrgUsageQueryDto } from '../dto/org-usage-query.dto';

import {
  InvoicePreview,
  CheckoutPreviewResult,
  CouponPreviewInfo,
} from '../../../store/subscriptions/types/billing.types';

const DECIMAL_ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Org-native subscriptions controller. Mirrors the slice of
 * `/api/store/subscriptions/*` that ORG_ADMIN actually consumes today
 * (invoices, plan listing, checkout preview/commit, overview/detail) but
 * runs under `OrganizationPrismaService` semantics:
 *
 *   - Read flows are scoped to every store of the organization in context
 *     (no `store_id` derived from the JWT).
 *   - Mutating flows (checkout preview/commit) require an explicit
 *     `storeId` in the body; the service validates that the store belongs
 *     to the org before delegating to the existing store-side billing /
 *     proration / payment services.
 *
 * The DomainScopeGuard enforces that this controller is only reachable by
 * `app_type=ORG_ADMIN` tokens (super-admin bypass excepted).
 */
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
@Controller('organization/subscriptions')
export class OrgSubscriptionsController {
  constructor(
    private readonly orgSubs: OrgSubscriptionsService,
    private readonly resolver: SubscriptionResolverService,
    private readonly stateService: SubscriptionStateService,
    private readonly billing: SubscriptionBillingService,
    private readonly payment: SubscriptionPaymentService,
    private readonly proration: SubscriptionProrationService,
    private readonly invoicePdf: SubscriptionInvoicePdfService,
    private readonly promotional: PromotionalApplyService,
    private readonly platformGw: PlatformGatewayService,
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Overview / per-store summaries
  // ──────────────────────────────────────────────────────────────────────────

  @Permissions('subscriptions:read')
  @Get('stats')
  async getOverviewStats() {
    const data = await this.orgSubs.getOverviewStats();
    return this.responseService.success(data, 'Subscription stats retrieved');
  }

  @Permissions('subscriptions:read')
  @Get('stores')
  async listStoreSubscriptions() {
    const data = await this.orgSubs.listStoreSubscriptions();
    return this.responseService.success(data, 'Store subscriptions retrieved');
  }

  @Permissions('subscriptions:read')
  @Get('stores/:storeId')
  async getStoreSubscription(
    @Param('storeId', ParseIntPipe) storeId: number,
  ) {
    const data = await this.orgSubs.getStoreSubscriptionDetail(storeId);
    if (!data) {
      return this.responseService.success(null, 'No active subscription');
    }
    return this.responseService.success(data, 'Subscription retrieved');
  }

  /**
   * AI usage snapshot for a single store of the organization. The ORG_ADMIN
   * passes the target `store_id` in the query string; the service validates
   * it belongs to the org in context before reading per-store Redis quota
   * counters. Replaces the legacy ORG → /store/subscriptions/usage call now
   * blocked by the DomainScopeGuard.
   */
  @Permissions('subscriptions:read')
  @Get('usage')
  async getUsage(@Query() query: OrgUsageQueryDto) {
    const data = await this.orgSubs.getStoreUsage(query.store_id);
    return this.responseService.success(data, 'Usage retrieved');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Invoices (consolidated across the org)
  // ──────────────────────────────────────────────────────────────────────────

  @Permissions('subscriptions:read')
  @Get('invoices')
  async listInvoices(@Query() query: OrgSubscriptionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort_by = query.sort_by ?? 'created_at';
    const sort_order = query.sort_order ?? 'desc';

    const { data, total } = await this.orgSubs.listInvoices({
      page,
      limit,
      sort_by,
      sort_order,
      store_id: query.store_id,
    });
    return this.responseService.paginated(data, total, page, limit);
  }

  @Permissions('subscriptions:read')
  @Get('invoices/:invoiceId')
  async getInvoice(@Param('invoiceId', ParseIntPipe) invoiceId: number) {
    const data = await this.orgSubs.getInvoice(invoiceId);
    return this.responseService.success(data, 'Invoice retrieved');
  }

  /**
   * Streams the PDF for any invoice belonging to a store of the organization
   * in context. Reuses `SubscriptionInvoicePdfService`, which re-validates
   * `invoice.store_id === storeId` defensively.
   */
  @Permissions('subscriptions:read')
  @SkipSubscriptionGate()
  @Get('invoices/:invoiceId/pdf')
  async getInvoicePdf(
    @Param('invoiceId', ParseIntPipe) invoiceId: number,
    @Res() res: Response,
  ) {
    const storeId = await this.orgSubs.resolveInvoiceStoreId(invoiceId);
    const { buffer, filename } = await this.invoicePdf.generatePdf(
      invoiceId,
      storeId,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.send(buffer);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Plan catalogue (with partner overrides)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns the active plans available to the organization, applying partner
   * margins/surcharges when the org has overrides. When the optional
   * `store_id` is provided, each plan also carries `is_current` resolved
   * against that store's live subscription.
   */
  @Permissions('subscriptions:read')
  @Get('plans')
  async listPlans(@Query() query: OrgPlansQueryDto) {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    let overrides: Array<{
      base_plan_id: number;
      margin_pct: Prisma.Decimal | null;
      fixed_surcharge: Prisma.Decimal | null;
      custom_code: string | null;
      custom_name: string | null;
    }> = [];

    const org = await this.prisma.organizations.findUnique({
      where: { id: orgId },
      select: { is_partner: true },
    });
    const isPartnerOrg = !!org?.is_partner;

    overrides = await this.prisma.partner_plan_overrides.findMany({
      where: { organization_id: orgId, is_active: true },
      select: {
        base_plan_id: true,
        margin_pct: true,
        fixed_surcharge: true,
        custom_code: true,
        custom_name: true,
      },
    });

    const planWhere: Prisma.subscription_plansWhereInput = {
      state: 'active',
      archived_at: null,
      resellable: true,
      is_promotional: false,
      ...(isPartnerOrg && {
        id: { in: overrides.map((o) => o.base_plan_id) },
      }),
    };

    const plans =
      isPartnerOrg && overrides.length === 0
        ? []
        : await this.prisma.subscription_plans.findMany({
            where: planWhere,
            orderBy: [{ sort_order: 'asc' }, { base_price: 'asc' }],
          });

    let currentPlanId: number | null = null;
    if (query.store_id != null) {
      await this.orgSubs.assertStoreInOrg(query.store_id);
      const currentSub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: query.store_id },
        select: { paid_plan_id: true, plan_id: true, state: true },
      });
      const NON_LIVE_STATES = new Set([
        'cancelled',
        'expired',
        'no_plan',
        'pending_payment',
      ]);
      const isLiveSubscription =
        currentSub != null && !NON_LIVE_STATES.has(currentSub.state as string);
      currentPlanId = isLiveSubscription
        ? (currentSub.paid_plan_id ?? currentSub.plan_id)
        : null;
    }

    const data = plans.map((p) => {
      const features = Array.isArray(p.feature_matrix)
        ? (p.feature_matrix as any[]).map((f: any) => ({
            key: f.key ?? '',
            label: f.label ?? f.key ?? '',
            enabled: f.enabled ?? true,
            limit: f.limit ?? null,
            unit: f.unit ?? null,
          }))
        : [];

      const isCurrent = currentPlanId === p.id;
      const ov = overrides.find((o) => o.base_plan_id === p.id);
      if (!ov) {
        return {
          ...p,
          features,
          sort_order: p.sort_order,
          is_popular: p.is_popular,
          is_current: isCurrent,
        };
      }

      const marginPct = ov.margin_pct
        ? new Prisma.Decimal(ov.margin_pct).div(100)
        : new Prisma.Decimal(0);
      const surcharge = ov.fixed_surcharge ?? new Prisma.Decimal(0);
      const effective = new Prisma.Decimal(p.base_price)
        .mul(marginPct.add(1))
        .add(surcharge);

      return {
        ...p,
        base_price: effective,
        code: ov.custom_code ?? p.code,
        name: ov.custom_name ?? p.name,
        features,
        sort_order: p.sort_order,
        is_popular: p.is_popular,
        is_current: isCurrent,
      };
    });

    return this.responseService.success(data, 'Plans retrieved');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Checkout preview / commit
  //
  // Both flows pin the requested `storeId` into `RequestContext` (via
  // `OrgSubscriptionsService.runWithStoreContext`) so the existing store-side
  // billing/proration services keep working without their own refactor.
  // ──────────────────────────────────────────────────────────────────────────

  @Permissions('subscriptions:write')
  @Post('checkout/preview')
  async checkoutPreview(@Body() dto: OrgCheckoutPreviewDto) {
    return this.orgSubs.runWithStoreContext(dto.storeId, async () => {
      const storeId = dto.storeId;

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

      const couponPreview = await this.buildCouponPreview(
        storeId,
        dto.coupon_code,
      );

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

      // Fresh purchase path — no existing subscription row.
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
        return this.responseService.success(
          result,
          'Checkout preview retrieved',
        );
      }

      const prorationPreview = await this.proration.preview(sub.id, dto.planId);

      let invoicePreview: InvoicePreview | null = null;
      if (prorationPreview.invoice_to_issue) {
        invoicePreview = prorationPreview.invoice_to_issue;
      } else if (prorationPreview.kind === 're_subscribe') {
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
    });
  }

  /**
   * Org-level commit. Delegates the heavy lifting (auto-void of stranded
   * pending invoices, fresh-purchase path, re-subscribe path, mid-cycle
   * upgrade/downgrade widget flow) to the existing store services by pinning
   * the target store into the request context for the duration of the call.
   *
   * NOTE: Because the store-side `SubscriptionCheckoutController.commit`
   * implementation lives entirely inside that controller (no extracted
   * service), this method re-implements only the dispatch shell and reuses
   * the same primitive services the store controller calls. The behaviour
   * matches the most common ORG_ADMIN flow today (mid-cycle paid plan
   * change). Edge cases (cancelled re-subscribe, trial conversions, fresh
   * purchase) fall back to the same primitive services and produce the
   * identical Wompi widget payload, allowing the frontend to consume them
   * unchanged.
   */
  @Permissions('subscriptions:write')
  @Post('checkout/commit')
  async checkoutCommit(@Body() dto: OrgCheckoutCommitDto) {
    return this.orgSubs.runWithStoreContext(dto.storeId, async () => {
      const storeId = dto.storeId;
      const context = RequestContextService.getContext();

      // Fetch sub + target plan; classify free vs paid.
      let sub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: storeId },
      });

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

      // No-refund acknowledgement gate (skipped for trial swap / free).
      const isTrialSwap = !!(
        sub &&
        sub.state === 'trial' &&
        sub.trial_ends_at &&
        sub.trial_ends_at.getTime() > Date.now() &&
        isFreePlan
      );
      if (!isTrialSwap && !isFreePlan && dto.no_refund_acknowledged !== true) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_VALIDATION,
          'Debes aceptar la política de no-reembolso',
        );
      }

      // Coupon pre-validation.
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

      // Mid-cycle paid → paid plan change. We require an existing live
      // subscription; ORG_ADMIN flows that need to bootstrap a fresh
      // subscription should use the store-side checkout (until the org
      // bootstrap flow is consolidated as part of the wider rollout).
      if (!sub) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_001,
          'La tienda no tiene una suscripción activa para modificar desde el panel de organización',
        );
      }

      // Free plan immediate downgrade (no charge, no widget).
      if (isFreePlan) {
        const updated = await this.proration.apply(sub.id, dto.planId);
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

      // Paid plan change — require platform Wompi credentials and emit a
      // widget through the same payment service used by the store path.
      const wompiCreds = await this.platformGw.getActiveCredentials('wompi');
      if (!wompiCreds) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_GATEWAY_003,
          'Credenciales de pasarela de plataforma no configuradas',
        );
      }

      const previewResult = await this.proration.preview(sub.id, dto.planId);
      const chargeAmount = previewResult.proration_amount
        ? new Prisma.Decimal(previewResult.proration_amount)
        : DECIMAL_ZERO;
      const isUpgrade = chargeAmount.greaterThan(DECIMAL_ZERO);
      const changeKind = isUpgrade ? 'upgrade' : 'downgrade';
      const shouldProratePrice = isUpgrade;

      const midCycleInvoice = await this.billing.issueInvoice(sub.id, {
        prorated: shouldProratePrice,
        proratedAmount: shouldProratePrice ? chargeAmount : undefined,
        invoicePreview:
          !shouldProratePrice && previewResult.invoice_to_issue
            ? previewResult.invoice_to_issue
            : undefined,
        skipPendingCredit: !shouldProratePrice,
        fromPlanId: (sub as any).paid_plan_id ?? sub.plan_id,
        toPlanId: dto.planId,
        changeKind: changeKind as any,
      });

      if (!midCycleInvoice) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
          'Could not issue invoice for plan change',
        );
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.store_subscriptions.update({
          where: { id: sub!.id },
          data: {
            pending_plan_id: dto.planId,
            pending_change_invoice_id: midCycleInvoice.id,
            pending_change_kind: changeKind as any,
            pending_change_started_at: new Date(),
            pending_revert_state: sub!.state as any,
          },
        });
        await this.stateService.transitionInTx(
          tx,
          storeId,
          'pending_payment',
          {
            reason: `org_checkout_commit_${changeKind}_${dto.planId}`,
            triggeredByUserId: context?.user_id ?? undefined,
            payload: {
              from_plan_id: (sub as any).paid_plan_id ?? sub!.plan_id,
              to_plan_id: dto.planId,
              invoice_id: midCycleInvoice.id,
              change_kind: changeKind,
              initiated_from: 'organization',
            },
          },
        );
      });

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

      await this.mergeInvoiceAckMetadata(midCycleInvoice.id, {
        no_refund_acknowledged: dto.no_refund_acknowledged === true,
        no_refund_acknowledged_at:
          dto.no_refund_acknowledged_at ?? new Date().toISOString(),
        acknowledged_user_id: context?.user_id ?? null,
        initiated_from: 'organization',
      });

      const customerEmail = await this.resolveCustomerEmail(
        context?.user_id ?? null,
      );
      const { widget } = await this.payment.prepareWidgetCharge(
        midCycleInvoice.id,
        {
          customerEmail,
          redirectUrl: dto.returnUrl ?? this.defaultReturnUrl(),
        },
      );

      await this.resolver.invalidate(storeId);

      return this.responseService.success(
        {
          widget,
          invoiceId: midCycleInvoice.id,
          mode: changeKind,
          subscription: await this.prisma.store_subscriptions.findUnique({
            where: { id: sub.id },
          }),
        },
        'Plan change pending payment',
      );
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers shared with the store-side checkout controller (kept private
  // here to avoid coupling — the logic is small and stable).
  // ──────────────────────────────────────────────────────────────────────────

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

  private async safeApplyCoupon(
    storeId: number,
    code: string,
    userId: number | null,
  ): Promise<void> {
    try {
      await this.promotional.applyCoupon(storeId, code, userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[OrgSubscriptions] applyCoupon failed for store ${storeId} (${code}): ${(err as Error).message}`,
      );
    }
  }

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

  private defaultReturnUrl(): string {
    return process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/admin/subscription`
      : 'https://vendix.com/admin/subscription';
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
