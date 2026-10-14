import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionBillingService } from '../../../store/subscriptions/services/subscription-billing.service';
import { ActivateStorePlanPreviewDto } from '../dto/activate-store-plan-preview.dto';
import {
  DAY_MS,
  computeActivationQuote,
  computeActivationWindow,
  extractPendingCredit,
  isActivationStartInRange,
} from './store-plan-activation.helpers';

const CYCLE_ORDER = ['monthly', 'quarterly', 'semiannual', 'annual', 'lifetime'];
const D0 = new Prisma.Decimal(0);

const money = (d: Prisma.Decimal.Value): string =>
  new Prisma.Decimal(d).toDecimalPlaces(2, 6).toFixed(2);
const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

export type ActivationChangeKind = 'initial' | 'trial_conversion' | 'resubscribe';

export interface ActivationWarning {
  code: string;
  message: string;
  data: Record<string, unknown>;
}

/**
 * Catálogo y preview (sin efectos) para el modal "Activar plan" del
 * superadmin. No reutiliza `PlansService.findAll`, que colapsa cada grupo a
 * una fila canónica; aquí cada ciclo es su propia fila con su `plan_id`.
 */
@Injectable()
export class StorePlanActivationCatalogService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly billing: SubscriptionBillingService,
  ) {}

  private async loadStore(storeId: number) {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    });
    if (!store) throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    return store;
  }

  private loadSubscription(storeId: number) {
    return this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      include: {
        plan: true,
        promotional_plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });
  }

  private loadOpenInvoices(subscriptionId: number) {
    return this.prisma.subscription_invoices.findMany({
      where: { store_subscription_id: subscriptionId, state: 'issued' },
      select: { id: true, invoice_number: true, total: true },
      orderBy: { id: 'asc' },
    });
  }

  async getOptions(storeId: number) {
    const store = await this.loadStore(storeId);
    const sub: any = await this.loadSubscription(storeId);
    const override =
      sub?.partner_override && sub.partner_override.is_active
        ? sub.partner_override
        : null;

    let current: any = null;
    if (sub) {
      const open = await this.loadOpenInvoices(sub.id);
      current = {
        subscription_id: sub.id,
        state: sub.state,
        plan_id: sub.plan_id ?? null,
        plan_name: sub.plan?.name ?? null,
        billing_cycle: sub.plan?.billing_cycle ?? null,
        current_period_start: iso(sub.current_period_start),
        current_period_end: iso(sub.current_period_end),
        pending_credit: money(extractPendingCredit(sub.metadata)),
        open_invoices: open.map((i: any) => ({
          id: i.id,
          invoice_number: i.invoice_number,
          total: money(i.total),
        })),
        promotional_overlay:
          sub.promotional_plan_id != null
            ? {
                plan_id: sub.promotional_plan_id,
                plan_name: sub.promotional_plan?.name ?? null,
              }
            : null,
        partner_override: override
          ? {
              organization_id: override.organization_id,
              margin_pct: money(override.margin_pct),
              fixed_surcharge: money(override.fixed_surcharge ?? 0),
            }
          : null,
      };
    }

    const plans: any[] = await this.prisma.subscription_plans.findMany({
      where: { state: { in: ['active', 'draft'] } },
    });

    const byGroup = new Map<string, any[]>();
    for (const p of plans) {
      const key = p.plan_group_code ?? p.code;
      const list = byGroup.get(key) ?? [];
      list.push(p);
      byGroup.set(key, list);
    }

    const groups = [...byGroup.entries()].map(([group_code, rows]) => {
      const canonical = rows.find(
        (r) => r.code === group_code && r.state !== 'archived',
      );
      const cheapestActive = rows
        .filter((r) => r.state === 'active')
        .sort((a, b) =>
          new Prisma.Decimal(a.base_price).comparedTo(
            new Prisma.Decimal(b.base_price),
          ),
        )[0];
      const meta = canonical ?? cheapestActive ?? rows[0];

      const cycles = [...rows]
        .sort(
          (a, b) =>
            CYCLE_ORDER.indexOf(a.billing_cycle) -
            CYCLE_ORDER.indexOf(b.billing_cycle),
        )
        .map((p) => {
          const pricing = this.billing.computePricing({
            plan: {
              id: p.id,
              base_price: p.base_price,
              max_partner_margin_pct: p.max_partner_margin_pct,
            },
            partner_override: override,
          });
          return {
            plan_id: p.id,
            code: p.code,
            billing_cycle: p.billing_cycle,
            state: p.state,
            base_price: money(pricing.base_price),
            effective_price: money(pricing.effective_price),
            margin_amount: money(pricing.margin_amount),
            fixed_surcharge: money(pricing.fixed_surcharge),
            currency: p.currency,
            is_free_effective:
              pricing.effective_price.lessThanOrEqualTo(D0) &&
              pricing.margin_amount.lessThanOrEqualTo(D0),
            is_current: sub?.plan_id === p.id,
          };
        });

      return {
        group_code,
        name: meta.name,
        description: meta.description ?? null,
        plan_type: meta.plan_type,
        is_popular: !!meta.is_popular,
        sort_order: meta.sort_order ?? 0,
        feature_matrix: meta.feature_matrix,
        ai_feature_flags: meta.ai_feature_flags,
        grace_period_soft_days: meta.grace_period_soft_days,
        grace_period_hard_days: meta.grace_period_hard_days,
        cycles,
      };
    });

    groups.sort(
      (a, b) =>
        a.sort_order - b.sort_order || String(a.name).localeCompare(b.name),
    );

    return { store: { id: store.id, name: store.name }, current, groups };
  }

  async preview(
    storeId: number,
    dto: ActivateStorePlanPreviewDto,
    now: Date = new Date(),
  ) {
    await this.loadStore(storeId);

    const plan: any = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.plan_id },
    });
    if (!plan || plan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.PLAN_001,
        'Plan is not active for subscriptions',
      );
    }
    if (dto.starts_at && !isActivationStartInRange(dto.starts_at, now)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_ACTIVATION_START_RANGE,
      );
    }

    const sub: any = await this.loadSubscription(storeId);
    const override =
      sub?.partner_override && sub.partner_override.is_active
        ? sub.partner_override
        : null;

    const pricing = this.billing.computePricing({
      plan: {
        id: plan.id,
        base_price: plan.base_price,
        max_partner_margin_pct: plan.max_partner_margin_pct,
      },
      partner_override: sub?.partner_override ?? null,
    });
    const window = computeActivationWindow(
      plan.billing_cycle,
      dto.starts_at,
      now,
    );
    const quote = computeActivationQuote({
      pricing,
      subscriptionMetadata: sub?.metadata,
      amount: dto.amount,
    });

    const changeKind: ActivationChangeKind =
      !sub || sub.plan_id == null
        ? 'initial'
        : sub.state === 'trial'
          ? 'trial_conversion'
          : 'resubscribe';

    const warnings: ActivationWarning[] = [];

    if (sub) {
      const open = await this.loadOpenInvoices(sub.id);
      if (open.length) {
        const total = open.reduce(
          (acc: Prisma.Decimal, i: any) => acc.plus(new Prisma.Decimal(i.total)),
          D0,
        );
        warnings.push({
          code: 'VOID_OPEN_INVOICES',
          message: `Se anularán ${open.length} factura(s) pendiente(s) por ${money(total)}.`,
          data: {
            count: open.length,
            total: money(total),
            invoices: open.map((i: any) => ({
              id: i.id,
              invoice_number: i.invoice_number,
              total: money(i.total),
            })),
          },
        });
      }

      const end: Date | null = sub.current_period_end ?? null;
      if (sub.state === 'active' && end && end.getTime() > now.getTime()) {
        const remaining = end.getTime() - now.getTime();
        const start: Date | null = sub.current_period_start ?? null;
        let estimated = D0;
        if (start && end.getTime() > start.getTime()) {
          estimated = new Prisma.Decimal(sub.effective_price ?? 0)
            .times(remaining)
            .dividedBy(end.getTime() - start.getTime());
        }
        const days = Math.ceil(remaining / DAY_MS);
        warnings.push({
          code: 'UNUSED_PERIOD_LOST',
          message: `El período vigente tiene ${days} día(s) sin usar que se perderán (valor estimado ${money(estimated)}).`,
          data: { days_remaining: days, estimated_value: money(estimated) },
        });
      }

      if (sub.promotional_plan_id != null) {
        warnings.push({
          code: 'PROMO_OVERLAY_KEPT',
          message:
            'El plan promocional de la tienda se mantiene y sigue sumando sus funciones.',
          data: {
            plan_id: sub.promotional_plan_id,
            plan_name: sub.promotional_plan?.name ?? null,
          },
        });
      }

      if (sub.state === 'trial') {
        warnings.push({
          code: 'TRIAL_CONVERSION',
          message: 'La tienda está en prueba: se convertirá a plan pagado.',
          data: {},
        });
      }

      if (sub.plan_id === plan.id) {
        warnings.push({
          code: 'SAME_PLAN_RENEWAL',
          message:
            'Es el mismo plan actual: se renueva el período desde la fecha de inicio.',
          data: { plan_id: plan.id },
        });
      }
    }

    if (
      override &&
      (pricing.margin_amount.greaterThan(D0) ||
        pricing.fixed_surcharge.greaterThan(D0))
    ) {
      warnings.push({
        code: 'PARTNER_PRICING',
        message:
          'La tienda pertenece a un partner: el precio incluye margen y/o recargo fijo.',
        data: {
          base_price: money(pricing.base_price),
          margin_amount: money(pricing.margin_amount),
          fixed_surcharge: money(pricing.fixed_surcharge),
          effective_price: money(pricing.effective_price),
        },
      });
    }

    if (!quote.is_free && new Prisma.Decimal(quote.shortfall).greaterThan(D0)) {
      warnings.push({
        code: 'UNDERPAYMENT',
        message: `El monto recibido es menor al total de la factura (faltan ${quote.shortfall}).`,
        data: { shortfall: quote.shortfall, invoice_total: quote.invoice_total },
      });
    }

    return {
      plan_id: plan.id,
      billing_cycle: plan.billing_cycle,
      is_free: quote.is_free,
      period_start: window.periodStart.toISOString(),
      period_end: window.periodEnd.toISOString(),
      effective_price: quote.effective_price,
      pending_credit_applied: quote.pending_credit_applied,
      invoice_total: quote.invoice_total,
      amount_received: quote.amount_received,
      excess_to_credit: quote.excess_to_credit,
      shortfall: quote.shortfall,
      change_kind: changeKind,
      warnings,
    };
  }
}
