import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionBillingService } from '../../../store/subscriptions/services/subscription-billing.service';
import { SubscriptionManualPaymentService } from '../../../store/subscriptions/services/subscription-manual-payment.service';
import { SubscriptionStateService } from '../../../store/subscriptions/services/subscription-state.service';
import { SubscriptionResolverService } from '../../../store/subscriptions/services/subscription-resolver.service';
import { ActivateStorePlanDto } from '../dto/activate-store-plan.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActivateStorePlanResult {
  store_id: number;
  subscription_id: number;
  plan_id: number;
  plan_name: string;
  state: string;
  invoice_id: number | null;
  invoice_number: string | null;
  payment_id: number | null;
  amount_paid: string | null;
}

type ChangeKind = 'initial' | 'trial_conversion' | 'resubscribe';

/**
 * El superadmin activa un plan SaaS a una tienda que pagó por consignación.
 * Sin bloqueantes: solo tienda y plan (`state='active'`) son obligatorios, y
 * se activa desde cualquier estado de suscripción (o sin fila).
 */
@Injectable()
export class StorePlanActivationService {
  private readonly logger = new Logger(StorePlanActivationService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly billing: SubscriptionBillingService,
    private readonly manualPaymentService: SubscriptionManualPaymentService,
    private readonly stateService: SubscriptionStateService,
    private readonly resolver: SubscriptionResolverService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async activatePlan(
    storeId: number,
    dto: ActivateStorePlanDto,
    actorUserId: number,
  ): Promise<ActivateStorePlanResult> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    }

    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.plan_id },
    });
    if (!plan) {
      throw new VendixHttpException(ErrorCodes.PLAN_001, 'Plan not found');
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
    const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, 6);

    // ---- Tx 1: prepare the subscription row -------------------------------
    const prepared = await this.prisma.$transaction(async (tx: any) => {
      const locked = (await tx.$queryRaw(
        Prisma.sql`SELECT id FROM store_subscriptions WHERE store_id = ${storeId} FOR UPDATE`,
      )) as Array<{ id: number }>;

      if (!locked.length) {
        const pricing = this.billing.computePricing({
          plan: {
            id: plan.id,
            base_price: plan.base_price,
            max_partner_margin_pct: plan.max_partner_margin_pct,
          },
        });
        const created = await tx.store_subscriptions.create({
          data: {
            store_id: storeId,
            plan_id: plan.id,
            paid_plan_id: plan.id,
            state: 'pending_payment',
            effective_price: round2(pricing.effective_price),
            vendix_base_price: round2(pricing.base_price),
            partner_margin_amount: round2(pricing.margin_amount),
            currency: plan.currency,
            resolved_features:
              (plan.ai_feature_flags as Prisma.InputJsonValue) ??
              Prisma.JsonNull,
            current_period_start: now,
            current_period_end: periodEnd,
            next_billing_at: periodEnd,
          },
        });
        await this.createPlanChangedEvent(tx, created.id, actorUserId, dto, {
          from: null,
          to: plan.id,
        });
        return {
          subscriptionId: created.id as number,
          oldPlanId: null as number | null,
          oldState: null as string | null,
        };
      }

      const sub = await tx.store_subscriptions.findUniqueOrThrow({
        where: { id: locked[0].id },
        include: { partner_override: { include: { base_plan: true } } },
      });

      // Void open invoices (and their pending payments) of this subscription.
      const openInvoices = await tx.subscription_invoices.findMany({
        where: { store_subscription_id: sub.id, state: 'issued' },
      });
      for (const inv of openInvoices) {
        const invMeta =
          inv.metadata && typeof inv.metadata === 'object'
            ? (inv.metadata as Record<string, unknown>)
            : {};
        await tx.subscription_invoices.update({
          where: { id: inv.id },
          data: {
            state: 'void',
            metadata: {
              ...invMeta,
              void_reason: 'superadmin_plan_activation',
              voided_at: now.toISOString(),
            } as Prisma.InputJsonValue,
            updated_at: now,
          },
        });
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
                cancellation_reason: 'invoice_voided_superadmin_activation',
                cancelled_at: now.toISOString(),
              } as Prisma.InputJsonValue,
              updated_at: now,
            },
          });
        }
        await tx.partner_commissions.updateMany({
          where: { invoice_id: inv.id, state: 'accrued' },
          data: { state: 'reversed' },
        });
      }

      const pricing = this.billing.computePricing({
        plan: {
          id: plan.id,
          base_price: plan.base_price,
          max_partner_margin_pct: plan.max_partner_margin_pct,
        },
        partner_override: sub.partner_override as any,
      });

      const updateData: Prisma.store_subscriptionsUncheckedUpdateInput = {
        plan_id: plan.id,
        paid_plan_id: plan.id,
        effective_price: round2(pricing.effective_price),
        vendix_base_price: round2(pricing.base_price),
        partner_margin_amount: round2(pricing.margin_amount),
        resolved_features: (plan.ai_feature_flags ??
          {}) as Prisma.InputJsonValue,
        resolved_at: now,
        pending_plan_id: null,
        pending_change_invoice_id: null,
        pending_change_kind: null,
        pending_change_started_at: null,
        pending_revert_state: null,
        scheduled_plan_id: null,
        scheduled_plan_change_at: null,
        current_period_start: now,
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        updated_at: now,
      };
      if (sub.state === 'trial') {
        updateData.trial_ends_at = null;
      }
      await tx.store_subscriptions.update({
        where: { id: sub.id },
        data: updateData,
      });

      await this.createPlanChangedEvent(tx, sub.id, actorUserId, dto, {
        from: sub.plan_id ?? null,
        to: plan.id,
      });

      return {
        subscriptionId: sub.id as number,
        oldPlanId: (sub.plan_id ?? null) as number | null,
        oldState: sub.state as string,
      };
    });

    const { subscriptionId, oldPlanId, oldState } = prepared;
    const changeKind: ChangeKind =
      oldPlanId == null
        ? 'initial'
        : oldState === 'trial'
          ? 'trial_conversion'
          : 'resubscribe';

    // ---- Invoice + payment / free activation ------------------------------
    const invoice = await this.billing.issueInvoice(subscriptionId, {
      fromPlanId: oldPlanId,
      toPlanId: plan.id,
      changeKind,
    });

    const extraMetadata = {
      source: 'superadmin_activation',
      payment_method: dto.payment_method ?? null,
      notes: dto.notes ?? null,
    };

    if (invoice) {
      await this.manualPaymentService.recordManualPayment(invoice.id, {
        bankReference: dto.reference?.trim() || `SA-${storeId}-${Date.now()}`,
        paidAt: dto.paid_at ? new Date(dto.paid_at) : new Date(),
        amount:
          dto.amount != null
            ? new Prisma.Decimal(dto.amount)
            : new Prisma.Decimal(invoice.total),
        recordedByUserId: actorUserId,
        periodEnd: invoice.period_end,
        planId: plan.id,
        extraMetadata,
      });
    } else {
      await this.stateService.ensureOperational(storeId, {
        reason: 'superadmin_plan_activation',
        triggeredByUserId: actorUserId,
        periodEnd,
        planId: plan.id,
        payload: { ...extraMetadata, reference: dto.reference ?? null },
      });
    }

    // ---- Post-commit side effects -----------------------------------------
    try {
      await this.resolver.invalidate(storeId);
    } catch (e: any) {
      this.logger.warn(
        `resolver.invalidate failed for store ${storeId}: ${e?.message ?? e}`,
      );
    }
    try {
      this.eventEmitter.emit('subscription.plan.changed', {
        storeId,
        subscriptionId,
        fromPlanId: oldPlanId,
        toPlanId: plan.id,
        kind: changeKind,
        mode: 'committed',
        invoiceId: invoice?.id ?? null,
        source: 'superadmin_activation',
      });
    } catch (e: any) {
      this.logger.warn(
        `subscription.plan.changed emit failed for store ${storeId}: ${e?.message ?? e}`,
      );
    }

    // ---- Response -----------------------------------------------------------
    const finalSub = await this.prisma.store_subscriptions.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    let payment: { id: number; amount: Prisma.Decimal } | null = null;
    let finalInvoice: {
      id: number;
      invoice_number: string;
      amount_paid: Prisma.Decimal | null;
    } | null = null;
    if (invoice) {
      finalInvoice = await this.prisma.subscription_invoices.findUnique({
        where: { id: invoice.id },
        select: { id: true, invoice_number: true, amount_paid: true },
      });
      payment = await this.prisma.subscription_payments.findFirst({
        where: { invoice_id: invoice.id, state: 'succeeded' },
        orderBy: { id: 'desc' },
        select: { id: true, amount: true },
      });
    }

    return {
      store_id: storeId,
      subscription_id: subscriptionId,
      plan_id: plan.id,
      plan_name: plan.name,
      state: finalSub.state,
      invoice_id: invoice?.id ?? null,
      invoice_number:
        finalInvoice?.invoice_number ?? invoice?.invoice_number ?? null,
      payment_id: payment?.id ?? null,
      amount_paid: payment
        ? new Prisma.Decimal(payment.amount).toFixed(2)
        : null,
    };
  }

  private async createPlanChangedEvent(
    tx: any,
    subscriptionId: number,
    actorUserId: number,
    dto: ActivateStorePlanDto,
    plans: { from: number | null; to: number },
  ): Promise<void> {
    await tx.subscription_events.create({
      data: {
        store_subscription_id: subscriptionId,
        type: 'plan_changed',
        payload: {
          source: 'superadmin_activation',
          from_plan_id: plans.from,
          to_plan_id: plans.to,
          payment_method: dto.payment_method ?? null,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
        } as Prisma.InputJsonValue,
        triggered_by_user_id: actorUserId || null,
      },
    });
  }

  /** Mirrors `SubscriptionBillingService.billingCycleMs` (private there). */
  private billingCycleMs(cycle: string): number {
    switch (cycle) {
      case 'quarterly':
        return 90 * DAY_MS;
      case 'semiannual':
        return 180 * DAY_MS;
      case 'annual':
        return 365 * DAY_MS;
      case 'lifetime':
        return 100 * 365 * DAY_MS;
      case 'monthly':
      default:
        return 30 * DAY_MS;
    }
  }
}
