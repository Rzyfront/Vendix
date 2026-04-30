import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionResolverService } from '../services/subscription-resolver.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import { SubscriptionAccessService } from '../services/subscription-access.service';
import { SubscriptionBillingService } from '../services/subscription-billing.service';
import { SubscriptionPaymentService } from '../services/subscription-payment.service';
import { SubscriptionProrationService } from '../services/subscription-proration.service';
import { SubscriptionPaymentMethodsService } from '../services/subscription-payment-methods.service';
import { SubscriptionInvoicePdfService } from '../services/subscription-invoice-pdf.service';
import { SubscriptionSupportRequestService } from '../services/subscription-support-request.service';
import { SubscriptionRedemptionService } from '../services/subscription-redemption.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { UseGuards } from '@nestjs/common';
import { SubscribeDto } from '../dto/subscribe.dto';
import { CancelDto } from '../dto/cancel.dto';
import { SubscriptionQueryDto } from '../dto/subscription-query.dto';
import { TokenizePaymentMethodDto } from '../dto/tokenize-payment-method.dto';
import { Prisma } from '@prisma/client';
import { SkipSubscriptionGate } from '../decorators/skip-subscription-gate.decorator';
import { PromotionalRulesEvaluator } from '../evaluators/promotional-rules.evaluator';
import { PromoEligibilityResult } from '../types/promo.types';

@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
@Controller('store/subscriptions')
export class StoreSubscriptionsController {
  constructor(
    private readonly resolver: SubscriptionResolverService,
    private readonly stateService: SubscriptionStateService,
    private readonly accessService: SubscriptionAccessService,
    private readonly billing: SubscriptionBillingService,
    private readonly payment: SubscriptionPaymentService,
    private readonly proration: SubscriptionProrationService,
    private readonly paymentMethods: SubscriptionPaymentMethodsService,
    private readonly invoicePdf: SubscriptionInvoicePdfService,
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
    private readonly promoEvaluator: PromotionalRulesEvaluator,
    private readonly supportService: SubscriptionSupportRequestService,
    private readonly redemptionService: SubscriptionRedemptionService,
  ) {}

  @Get('plans')
  @SkipSubscriptionGate()
  async listPlans() {
    const orgId = RequestContextService.getOrganizationId();

    let overrides: Array<{
      base_plan_id: number;
      margin_pct: Prisma.Decimal | null;
      fixed_surcharge: Prisma.Decimal | null;
      custom_code: string | null;
      custom_name: string | null;
    }> = [];
    let isPartnerOrg = false;

    if (orgId) {
      const org = await this.prisma.organizations.findUnique({
        where: { id: orgId },
        select: { is_partner: true },
      });
      isPartnerOrg = !!org?.is_partner;

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

    // Partner-org stores see ONLY plans the partner has overridden.
    // Non-partner orgs see every active resellable base plan.
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

    const storeId = RequestContextService.getStoreId();
    let currentPlanId: number | null = null;
    if (storeId) {
      const currentSub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: storeId },
        select: { paid_plan_id: true, plan_id: true, state: true },
      });
      // A subscription is "live" only when the lifecycle is in a paid/granted
      // state. Cancelled, expired, no_plan and pending_payment must NOT mark
      // any plan as current. The canonical "current plan" is `paid_plan_id`
      // (the plan the customer has actually paid for); we fall back to
      // `plan_id` only for trial subscriptions where paid_plan_id is null by
      // design.
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

  @Permissions('subscriptions:read')
  @Get('plans/redeem/:code')
  async getPlanByRedemptionCode(@Param('code') code: string) {
    const plan = await this.redemptionService.getPlanByRedemptionCode(code);
    if (!plan) {
      throw new VendixHttpException(
        ErrorCodes.PROMO_001,
        'Invalid redemption code',
      );
    }
    return this.responseService.success(plan, 'Plan found');
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
        // paid_plan / pending_plan are needed by the unified UI-state selector
        // so banners can render `fromPlanName → toPlanName` correctly. Without
        // these relations the frontend falls back to `plan.name` for both
        // sides and renders "Starter → Starter" when the user is changing
        // plans mid-cycle.
        paid_plan: true,
        pending_plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    if (!sub) {
      return this.responseService.success(null, 'No active subscription');
    }

    // RNC-39: stores in `no_plan` state have plan_id IS NULL (canonical), so
    // sub.plan naturally resolves to null via the relation. No stripping needed.
    return this.responseService.success(sub, 'Subscription retrieved');
  }

  /**
   * G6 — Dunning board state endpoint.
   *
   * Returns the dunning snapshot (state + deadlines + overdue invoices +
   * features lost/kept) used by the dunning board UI. Read-only — does not
   * mutate state.
   *
   * Active/trial subscriptions return empty deadlines + zero amounts so the
   * frontend can use this as a single source of truth without 404 branching.
   */
  @Permissions('subscriptions:read')
  @Get('current/dunning-state')
  async getDunningState() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const data =
      await this.accessService.getDunningStateForCurrentStore(storeId);
    return this.responseService.success(data, 'Dunning state retrieved');
  }

  /**
   * G6 — Retry payment of the most recent unpaid invoice for the current
   * store subscription. No body — operates on the latest invoice in
   * `state IN ('issued','overdue')` (RNC-10: `partially_paid` is not part of
   * `subscription_invoice_state_enum`; the canonical "still owes money"
   * states are `issued` / `overdue`).
   */
  @Permissions('subscriptions:write')
  @Post('retry-payment')
  async retryPayment() {
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

    const invoice = await this.prisma.subscription_invoices.findFirst({
      where: {
        store_subscription_id: sub.id,
        state: { in: ['issued', 'overdue'] },
      },
      orderBy: { issued_at: 'desc' },
      select: { id: true },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.DUNNING_001,
        'No hay invoices pendientes de pago',
      );
    }

    const result = await this.payment.charge(invoice.id);

    return this.responseService.success(
      {
        payment_id: result.id,
        invoice_id: invoice.id,
        state: result.state,
      },
      'Payment retry initiated',
    );
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

    if (dto.end_of_cycle) {
      const sub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: storeId },
        select: { current_period_end: true },
      });
      if (!sub?.current_period_end) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_001,
          'No active billing period to schedule cancellation',
        );
      }

      const result = await this.stateService.scheduleCancel(
        storeId,
        new Date(sub.current_period_end),
        {
          reason: dto.reason ?? 'user_initiated_schedule_cancel',
          triggeredByUserId: context?.user_id,
        },
      );

      return this.responseService.success(
        result,
        'Subscription scheduled for cancellation at end of cycle',
      );
    }

    const result = await this.stateService.transition(storeId, 'cancelled', {
      reason: dto.reason ?? 'user_initiated_cancel',
      triggeredByUserId: context?.user_id,
    });

    return this.responseService.success(result, 'Subscription cancelled');
  }

  @Post('uncancel')
  @SkipSubscriptionGate()
  async uncancel() {
    const storeId = RequestContextService.getStoreId();
    const context = RequestContextService.getContext();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const result = await this.stateService.unscheduleCancel(storeId, {
      reason: 'user_initiated_uncancel',
      triggeredByUserId: context?.user_id,
    });

    return this.responseService.success(
      result,
      'Scheduled cancellation reverted',
    );
  }

  /**
   * RNC-16 / RNC-17 — Cancel a scheduled downgrade (deferred plan change).
   * Allowed only while the current period has not yet rolled over. After
   * `current_period_end` the renewal cron has already applied the swap and
   * the operation returns 4xx (SUBSCRIPTION_010).
   */
  @Delete('scheduled-change')
  @SkipSubscriptionGate()
  async cancelScheduledPlanChange() {
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

    const result = await this.proration.cancelScheduledChange(sub.id);
    return this.responseService.success(
      result,
      'Cambio de plan programado cancelado',
    );
  }

  @Post('support-request')
  @SkipSubscriptionGate()
  async supportRequest(
    @Body() dto: { reason: string; message: string; contact_email?: string },
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const result = await this.supportService.createSupportRequest(storeId, {
      reason: dto.reason,
      message: dto.message,
      contactEmail: dto.contact_email,
    });

    return this.responseService.success(result, 'Support ticket created');
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
  async getInvoice(@Param('invoiceId') invoiceId: string) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const invoice_id_num = parseInt(invoiceId);
    if (!invoice_id_num || isNaN(invoice_id_num)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Invalid invoice ID',
      );
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
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Invoice not found',
      );
    }

    return this.responseService.success(invoice, 'Invoice retrieved');
  }

  /**
   * S3.1 — PDF download for a SaaS subscription invoice.
   *
   * Customer-facing — explicitly @SkipSubscriptionGate so a suspended
   * subscriber can still download historical invoices for accounting
   * purposes. Streams a `application/pdf` payload.
   */
  @Permissions('subscriptions:read')
  @SkipSubscriptionGate()
  @Get('current/invoices/:invoiceId/pdf')
  async getInvoicePdf(
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const invoice_id_num = parseInt(invoiceId);
    if (!invoice_id_num || isNaN(invoice_id_num)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Invalid invoice ID',
      );
    }

    const { buffer, filename } = await this.invoicePdf.generatePdf(
      invoice_id_num,
      storeId,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.send(buffer);
  }

  /**
   * S3.3 — Cliente timeline de eventos de subscripción.
   *
   * Cursor-based pagination (keyset por created_at + id). El payload se
   * sanitiza: NO se expone `triggered_by_user_id` (PII). En su lugar, se
   * mapea a un campo `triggered_by` con valores `'user'|'system'|'cron'`.
   *
   * Query params:
   *   - limit: default 50, max 100
   *   - cursor: opaco (base64 de `${id}|${created_at_iso}`)
   *   - type: filtro opcional por subscription_event_type_enum
   *
   * Response: `{ data: [...], next_cursor: string|null }`
   *
   * @SkipSubscriptionGate — el cliente debe poder ver el historial incluso
   * cuando la subscripción esté suspendida o bloqueada.
   */
  @Permissions('subscriptions:read')
  @SkipSubscriptionGate()
  @Get('current/events')
  async getEvents(
    @Query('limit') limitParam?: string,
    @Query('cursor') cursorParam?: string,
    @Query('type') typeParam?: string,
  ) {
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

    // Parse limit (default 50, max 100, min 1)
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 50;
    const limit = Math.min(
      Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1),
      100,
    );

    // Decode opaque cursor: base64(`${id}|${created_at_iso}`)
    let cursorCreatedAt: Date | null = null;
    let cursorId: number | null = null;
    if (cursorParam) {
      try {
        const decoded = Buffer.from(cursorParam, 'base64').toString('utf-8');
        const [idStr, createdAtIso] = decoded.split('|');
        const idNum = parseInt(idStr, 10);
        const dt = new Date(createdAtIso);
        if (Number.isFinite(idNum) && !isNaN(dt.getTime())) {
          cursorId = idNum;
          cursorCreatedAt = dt;
        }
      } catch {
        // Invalid cursor — ignore and start from the top.
        cursorCreatedAt = null;
        cursorId = null;
      }
    }

    // Validate type filter against the allowed enum values.
    type EventType =
      | 'created'
      | 'activated'
      | 'renewed'
      | 'trial_started'
      | 'trial_ended'
      | 'payment_succeeded'
      | 'payment_failed'
      | 'state_transition'
      | 'plan_changed'
      | 'cancelled'
      | 'reactivated'
      | 'promotional_applied'
      | 'partner_override_applied'
      | 'partner_commission_accrued'
      | 'partner_commission_paid'
      | 'scheduled_cancel';
    const validTypes: EventType[] = [
      'created',
      'activated',
      'renewed',
      'trial_started',
      'trial_ended',
      'payment_succeeded',
      'payment_failed',
      'state_transition',
      'plan_changed',
      'cancelled',
      'reactivated',
      'promotional_applied',
      'partner_override_applied',
      'partner_commission_accrued',
      'partner_commission_paid',
      'scheduled_cancel',
    ];
    const typeFilter: EventType | undefined =
      typeParam && validTypes.includes(typeParam as EventType)
        ? (typeParam as EventType)
        : undefined;

    // Keyset pagination: ORDER BY created_at DESC, id DESC
    // WHERE (created_at, id) < (cursor_created_at, cursor_id) when cursor is provided.
    const where: Prisma.subscription_eventsWhereInput = {
      store_subscription_id: sub.id,
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(cursorCreatedAt && cursorId !== null
        ? {
            OR: [
              { created_at: { lt: cursorCreatedAt } },
              {
                AND: [
                  { created_at: cursorCreatedAt },
                  { id: { lt: cursorId } },
                ],
              },
            ],
          }
        : {}),
    };

    // Fetch limit+1 to know whether there is a next page.
    const rows = await this.prisma.subscription_events.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const data = slice.map((e) => {
      const triggered_by: 'user' | 'system' | 'cron' = e.triggered_by_user_id
        ? 'user'
        : e.triggered_by_job
          ? 'cron'
          : 'system';
      return {
        id: e.id,
        type: e.type,
        from_state: e.from_state,
        to_state: e.to_state,
        payload: e.payload ?? null,
        triggered_by,
        created_at: e.created_at,
      };
    });

    let next_cursor: string | null = null;
    if (hasMore) {
      const last = slice[slice.length - 1];
      const raw = `${last.id}|${last.created_at.toISOString()}`;
      next_cursor = Buffer.from(raw, 'utf-8').toString('base64');
    }

    return this.responseService.success(
      { data, next_cursor },
      'Subscription events retrieved',
    );
  }

  // ── Promotional eligibility ────────────────────────────────────────

  /**
   * G9 — Public eligibility endpoint for promotional plans.
   *
   * Returns the eligibility status of every active promotional plan against
   * the current store. Read-only, no state mutation. Used by the retention
   * flow to surface eligible promos when the cancellation reason is `price`.
   */
  @SkipSubscriptionGate()
  @Get('promo/eligibility')
  async getPromoEligibility() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const promoPlans = await this.prisma.subscription_plans.findMany({
      where: {
        is_promotional: true,
        state: 'active',
        archived_at: null,
      },
      select: { id: true },
    });

    const promos: PromoEligibilityResult[] = await Promise.all(
      promoPlans.map((p) => this.promoEvaluator.evaluate(storeId, p.id)),
    );

    return this.responseService.success(
      { promos },
      'Promo eligibility retrieved',
    );
  }

  // ── Payment Methods ────────────────────────────────────────────────

  @Permissions('subscriptions:read')
  @Get('payment-methods')
  async listPaymentMethods() {
    const data = await this.paymentMethods.listForStore();
    return this.responseService.success(data, 'Payment methods retrieved');
  }

  @Permissions('subscriptions:read')
  @Get('payment-methods/widget-config')
  async getPaymentMethodWidgetConfig() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const data = await this.paymentMethods.prepareWidgetConfig({
      redirectUrl: process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/admin/subscription/payment`
        : 'https://vendix.com/admin/subscription/payment',
    });
    return this.responseService.success(data, 'Widget config retrieved');
  }

  @Permissions('subscriptions:write')
  @Post('payment-methods/tokenize')
  async tokenizePaymentMethod(@Body() dto: TokenizePaymentMethodDto) {
    const data = await this.paymentMethods.tokenize(dto);
    return this.responseService.created(data, 'Payment method tokenized');
  }

  @Permissions('subscriptions:write')
  @Put('payment-methods/:id/default')
  async setDefaultPaymentMethod(@Param('id') id: string) {
    const data = await this.paymentMethods.setDefault(id);
    return this.responseService.success(data, 'Default payment method updated');
  }

  @Permissions('subscriptions:write')
  @Delete('payment-methods/:id')
  async removePaymentMethod(@Param('id') id: string) {
    await this.paymentMethods.remove(id);
    return this.responseService.deleted('Payment method removed');
  }

  /**
   * S3.2 — Returns the last N (default 5, max 20) charges executed against
   * the given payment method. Used by the "Configurar" modal to show the
   * user a snapshot of recent billing attempts before they edit / delete
   * / replace the card.
   */
  @Permissions('subscriptions:read')
  @Get('payment-methods/:id/charges')
  async listPaymentMethodCharges(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? parseInt(limit, 10) : 5;
    const safeLimit = isNaN(parsed) ? 5 : parsed;
    const data = await this.paymentMethods.listCharges(id, safeLimit);
    return this.responseService.success(data, 'Charges retrieved');
  }

  /**
   * G11 — Replace a tokenized payment method with a freshly tokenized one
   * coming back from the Wompi widget. Soft-deletes the old method so
   * payment history stays intact, transfers the `is_default` flag, and
   * audits the replacement in `subscription_events`.
   */
  @Permissions('subscriptions:write')
  @Post('payment-methods/:id/replace')
  async replacePaymentMethod(
    @Param('id') id: string,
    @Body() dto: TokenizePaymentMethodDto,
  ) {
    const data = await this.paymentMethods.replace(id, dto);
    return this.responseService.created(data, 'Payment method replaced');
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
