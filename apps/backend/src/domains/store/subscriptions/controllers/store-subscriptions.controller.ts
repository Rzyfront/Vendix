import { Body, Controller, Get, Post, Query, Param } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionResolverService } from '../services/subscription-resolver.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import { SubscriptionBillingService } from '../services/subscription-billing.service';
import { SubscriptionPaymentService } from '../services/subscription-payment.service';
import { SubscriptionProrationService } from '../services/subscription-proration.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { UseGuards } from '@nestjs/common';
import { SubscribeDto } from '../dto/subscribe.dto';
import { CancelDto } from '../dto/cancel.dto';
import { SubscriptionQueryDto } from '../dto/subscription-query.dto';
import { Prisma } from '@prisma/client';
import { SkipSubscriptionGate } from '../decorators/skip-subscription-gate.decorator';

@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
@Controller('store/subscriptions')
export class StoreSubscriptionsController {
  constructor(
    private readonly resolver: SubscriptionResolverService,
    private readonly stateService: SubscriptionStateService,
    private readonly billing: SubscriptionBillingService,
    private readonly payment: SubscriptionPaymentService,
    private readonly proration: SubscriptionProrationService,
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('plans')
  @SkipSubscriptionGate()
  async listPlans() {
    const plans = await this.prisma.subscription_plans.findMany({
      where: {
        state: 'active',
        archived_at: null,
        resellable: true,
        is_promotional: false,
      },
      orderBy: { base_price: 'asc' },
    });

    const orgId = RequestContextService.getOrganizationId();
    let overrides: Array<{
      base_plan_id: number;
      margin_pct: Prisma.Decimal | null;
      fixed_surcharge: Prisma.Decimal | null;
      custom_code: string | null;
      custom_name: string | null;
    }> = [];
    if (orgId) {
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
    }

    const data = plans.map((p) => {
      const ov = overrides.find((o) => o.base_plan_id === p.id);
      if (!ov) return p;

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
      };
    });

    return this.responseService.success(data, 'Plans retrieved');
  }

  @Permissions('subscriptions:read')
  @Get('current')
  async getCurrent() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    return this.responseService.success(sub, 'Subscription retrieved');
  }

  @Permissions('subscriptions:write')
  @Post('subscribe')
  async subscribe(@Body() dto: SubscribeDto) {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const existing = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (existing) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Store already has a subscription',
      );
    }

    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Plan not found',
      );
    }
    if (plan.archived_at) {
      throw new VendixHttpException(ErrorCodes.PLAN_001);
    }
    if (plan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.PLAN_001,
        'Plan is not active for subscriptions',
      );
    }

    const now = new Date();
    const cycleMs = this.billingCycleMs(plan.billing_cycle);
    const periodEnd = new Date(now.getTime() + cycleMs);

    let effectivePrice = plan.base_price;
    let vendixBasePrice = plan.base_price;
    let partnerMarginAmount = new Prisma.Decimal(0);
    let partnerOverrideId: number | null = null;

    if (dto.partnerOverrideId) {
      const override = await this.prisma.partner_plan_overrides.findUnique({
        where: { id: dto.partnerOverrideId },
        include: { base_plan: true },
      });
      if (!override || !override.is_active) {
        throw new VendixHttpException(
          ErrorCodes.PARTNER_001,
          'Partner override not found or inactive',
        );
      }
      partnerOverrideId = override.id;
      const subInput = {
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
      };
      const pricing = this.billing.computePricing(subInput);
      effectivePrice = pricing.effective_price;
      vendixBasePrice = pricing.base_price;
      partnerMarginAmount = pricing.margin_amount;
    }

    const trialDays = plan.trial_days ?? 0;
    const initialState =
      trialDays > 0 ? ('trial' as const) : ('active' as const);
    const trialEndsAt =
      trialDays > 0
        ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
        : null;

    const subscription = await this.prisma.$transaction(async (tx) => {
      const created = await tx.store_subscriptions.create({
        data: {
          store_id: storeId,
          plan_id: plan.id,
          partner_override_id: partnerOverrideId,
          state: initialState,
          effective_price: effectivePrice,
          vendix_base_price: vendixBasePrice,
          partner_margin_amount: partnerMarginAmount,
          currency: 'COP',
          resolved_features: {},
          trial_ends_at: trialEndsAt,
          current_period_start: now,
          current_period_end: periodEnd,
          next_billing_at: trialDays > 0 ? trialEndsAt : periodEnd,
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
            reason: 'subscription_created',
            plan_id: plan.id,
            plan_code: plan.code,
            ...(dto.partnerOverrideId
              ? { partner_override_id: dto.partnerOverrideId }
              : {}),
          } as Prisma.InputJsonValue,
          triggered_by_user_id: context?.user_id ?? null,
        },
      });

      return created;
    });

    await this.resolver.invalidate(storeId);

    return this.responseService.created(subscription, 'Subscription created');
  }

  @Permissions('subscriptions:write')
  @Post('cancel')
  async cancel(@Body() dto: CancelDto) {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const result = await this.stateService.transition(storeId, 'cancelled', {
      reason: dto.reason ?? 'user_initiated_cancel',
      triggeredByUserId: context?.user_id,
    });

    return this.responseService.success(result, 'Subscription cancelled');
  }

  @Permissions('subscriptions:read')
  @Get('current/invoices')
  async getInvoices(@Query() query: SubscriptionQueryDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const orderBy = {
      [query.sort_by ?? 'created_at']: query.sort_order ?? 'desc',
    };

    const [data, total] = await Promise.all([
      this.prisma.subscription_invoices.findMany({
        where: { store_subscription_id: sub.id },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.subscription_invoices.count({
        where: { store_subscription_id: sub.id },
      }),
    ]);

    return this.responseService.paginated(data, total, page, limit);
  }

  @Permissions('subscriptions:read')
  @Get('current/invoices/:invoiceId')
  async getInvoice(
    @Param('invoiceId') invoiceId: string,
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const invoice_id_num = parseInt(invoiceId);
    if (!invoice_id_num || isNaN(invoice_id_num)) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR, 'Invalid invoice ID');
    }

    const invoice = await this.prisma.subscription_invoices.findFirst({
      where: {
        id: invoice_id_num,
        store_subscription: { store_id: storeId },
      },
      include: {
        store_subscription: {
          include: {
            plan: true,
            store: { include: { organizations: true } },
          },
        },
        commission: true,
      },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Invoice not found');
    }

    return this.responseService.success(invoice, 'Invoice retrieved');
  }

  @Permissions('subscriptions:read')
  @Get('current/events')
  async getEvents(@Query() query: SubscriptionQueryDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const orderBy = {
      [query.sort_by ?? 'created_at']: query.sort_order ?? 'desc',
    };

    const [data, total] = await Promise.all([
      this.prisma.subscription_events.findMany({
        where: { store_subscription_id: sub.id },
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.subscription_events.count({
        where: { store_subscription_id: sub.id },
      }),
    ]);

    return this.responseService.paginated(data, total, page, limit);
  }

  private billingCycleMs(cycle: string): number {
    const DAY = 24 * 60 * 60 * 1000;
    switch (cycle) {
      case 'monthly':
        return 30 * DAY;
      case 'quarterly':
        return 90 * DAY;
      case 'semiannual':
        return 180 * DAY;
      case 'annual':
        return 365 * DAY;
      case 'lifetime':
        return 100 * 365 * DAY;
      default:
        return 30 * DAY;
    }
  }
}
