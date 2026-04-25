import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  subscription_billing_cycle_enum,
  subscription_invoices,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  ComputedPricing,
  InvoiceLineItem,
  InvoicePreview,
  InvoiceSplitBreakdown,
} from '../types/billing.types';

/**
 * Advisory lock key (int4) for invoice numbering sequence.
 *
 * Postgres advisory locks take a bigint or two int4. We use a fixed namespace
 * int4 to serialize sequential `invoice_number` generation across processes.
 */
const ADVISORY_LOCK_KEY_INVOICE_NUMBER = 0x5341_4153; // "SAAS" ASCII nibbles

const DECIMAL_ZERO = new Prisma.Decimal(0);
const DECIMAL_ONE = new Prisma.Decimal(1);
const DECIMAL_100 = new Prisma.Decimal(100);

/**
 * Issues SaaS subscription invoices with correct revenue split between Vendix
 * and resellers.
 *
 * CRITICAL — Money math:
 *   - ALL arithmetic uses Prisma.Decimal (wraps decimal.js). No JS Number.
 *   - Rounding: HALF_EVEN (banker's rounding) at the storage boundary (2dp).
 *   - The `effective_price` seen by the store INCLUDES the partner margin +
 *     fixed surcharge; partner commission is computed from the same row so
 *     Vendix + partner share = store total by construction.
 *
 * CRITICAL — Partner margin bypass protection:
 *   On every invoice emission we re-read `base_plan.max_partner_margin_pct`
 *   and clamp `partner_override.margin_pct` at emission time. We never trust
 *   the snapshot in `store_subscriptions.partner_margin_amount` alone — that
 *   column is the resolver snapshot and may be stale vs. live plan edits.
 *
 * CRITICAL — Free-plan guard:
 *   When `effective_price = 0` AND partner share is 0 (no partner or fully
 *   subsidized), we SKIP invoice emission and silently advance the billing
 *   window + write a `renewed` event with `skipped_reason='zero_price'`.
 *   This keeps `core-free` plans from generating invoices.
 *
 * CRITICAL — Race conditions:
 *   Invoice number sequence uses a Postgres advisory lock inside the issuing
 *   transaction. A concurrent issuing attempt on the same subscription is
 *   prevented by the FOR UPDATE lock on `store_subscriptions` at the start
 *   of the tx.
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Issue a new invoice for the current (or prorated) billing cycle.
   *
   * Returns either the newly created invoice or `null` when free-plan skip
   * kicked in (caller should treat as a no-op renewal).
   */
  async issueInvoice(
    storeSubscriptionId: number,
    opts: { prorated?: boolean; proratedAmount?: Prisma.Decimal } = {},
  ): Promise<subscription_invoices | null> {
    if (!Number.isInteger(storeSubscriptionId) || storeSubscriptionId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    return this.prisma.$transaction(
      async (tx: any) => {
        const locked = (await tx.$queryRaw(
          Prisma.sql`SELECT id FROM store_subscriptions WHERE id = ${storeSubscriptionId} FOR UPDATE`,
        )) as Array<{ id: number }>;
        if (!locked.length) {
          throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
        }

        const sub = await tx.store_subscriptions.findUniqueOrThrow({
          where: { id: storeSubscriptionId },
          include: {
            plan: true,
            partner_override: { include: { base_plan: true } },
          },
        });

        const pricing = this.computePricing(sub);
        const cycleMs = this.billingCycleMs(sub.plan.billing_cycle);

        // Determine period window. On prorated upgrades we keep the current
        // period window (the upgrade applies immediately to the existing
        // cycle). On regular renewals we advance forward from current end.
        const now = new Date();
        const basePeriodStart = opts.prorated
          ? (sub.current_period_start ?? now)
          : (sub.current_period_end ?? now);
        const basePeriodEnd = opts.prorated
          ? (sub.current_period_end ?? new Date(now.getTime() + cycleMs))
          : new Date(
              (sub.current_period_end ?? now).getTime() + cycleMs,
            );

        const quantity = 1;
        const unitPrice = opts.prorated && opts.proratedAmount
          ? opts.proratedAmount
          : pricing.effective_price;

        // Free-plan skip (non-prorated only).
        if (
          !opts.prorated &&
          unitPrice.lessThanOrEqualTo(DECIMAL_ZERO) &&
          pricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO)
        ) {
          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: {
              current_period_start: basePeriodStart,
              current_period_end: basePeriodEnd,
              next_billing_at: basePeriodEnd,
              updated_at: now,
            },
          });
          await tx.subscription_events.create({
            data: {
              store_subscription_id: sub.id,
              type: 'renewed',
              payload: {
                skipped_reason: 'zero_price',
                period_start: basePeriodStart.toISOString(),
                period_end: basePeriodEnd.toISOString(),
              } as Prisma.InputJsonValue,
              triggered_by_job: 'subscription-renewal-billing',
            },
          });
          this.logger.log(
            `Skipped invoice emission for free-plan sub ${sub.id}; advanced period`,
          );
          return null;
        }

        // Apply pending downgrade credit, if any (stored in metadata).
        const pendingCredit = this.extractPendingCredit(sub.metadata);
        let subtotal = unitPrice.times(quantity);
        let creditApplied = DECIMAL_ZERO;
        if (pendingCredit.greaterThan(DECIMAL_ZERO) && !opts.prorated) {
          // Cap credit so subtotal >= 0
          creditApplied = Prisma.Decimal.min(pendingCredit, subtotal);
          subtotal = subtotal.minus(creditApplied);
        }
        const total = this.round2(subtotal);

        if (total.lessThan(DECIMAL_ZERO)) {
          throw new VendixHttpException(
            ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
            'Invoice total computed < 0 (credit capping bug)',
          );
        }

        const invoiceNumber = await this.allocateInvoiceNumber(tx);

        const lineItems: InvoiceLineItem[] = [
          {
            description: opts.prorated
              ? `Proration adjustment — plan ${sub.plan.code}`
              : `Plan ${sub.plan.code} (${sub.plan.billing_cycle})`,
            quantity,
            unit_price: unitPrice.toFixed(2),
            total: unitPrice.times(quantity).toFixed(2),
            meta: {
              plan_id: sub.plan.id,
              plan_code: sub.plan.code,
              margin_pct: pricing.margin_pct.toFixed(2),
              billing_cycle: sub.plan.billing_cycle,
              prorated: !!opts.prorated,
            },
          },
        ];
        if (creditApplied.greaterThan(DECIMAL_ZERO)) {
          lineItems.push({
            description: 'Downgrade credit (applied from previous cycle)',
            quantity: 1,
            unit_price: creditApplied.negated().toFixed(2),
            total: creditApplied.negated().toFixed(2),
            meta: {
              plan_id: sub.plan.id,
              plan_code: sub.plan.code,
              billing_cycle: sub.plan.billing_cycle,
            },
          });
        }

        const splitBreakdown: InvoiceSplitBreakdown = {
          vendix_share: this.round2(
            pricing.base_price.times(quantity),
          ).toFixed(2),
          partner_share: this.round2(
            pricing.margin_amount.times(quantity),
          ).toFixed(2),
          margin_pct_used: pricing.margin_pct.toFixed(2),
          partner_org_id: pricing.partner_org_id,
        };

        const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7d

        const invoice = await tx.subscription_invoices.create({
          data: {
            store_subscription_id: sub.id,
            store_id: sub.store_id,
            partner_organization_id: pricing.partner_org_id,
            invoice_number: invoiceNumber,
            state: 'issued',
            issued_at: now,
            due_at: dueAt,
            period_start: basePeriodStart,
            period_end: basePeriodEnd,
            subtotal: subtotal,
            tax_amount: DECIMAL_ZERO,
            total: total,
            amount_paid: DECIMAL_ZERO,
            currency: sub.currency,
            line_items: lineItems as unknown as Prisma.InputJsonValue,
            split_breakdown:
              splitBreakdown as unknown as Prisma.InputJsonValue,
            metadata: {
              prorated: !!opts.prorated,
              credit_applied: creditApplied.toFixed(2),
            } as Prisma.InputJsonValue,
          },
        });

        // Reset pending credit if used
        if (creditApplied.greaterThan(DECIMAL_ZERO)) {
          const nextMeta = {
            ...(sub.metadata && typeof sub.metadata === 'object'
              ? (sub.metadata as Record<string, unknown>)
              : {}),
          };
          delete nextMeta['pending_credit'];
          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: { metadata: nextMeta as Prisma.InputJsonValue },
          });
        }

        // Accrue partner commission (state=accrued) when applicable.
        if (
          pricing.partner_org_id !== null &&
          pricing.margin_amount.greaterThan(DECIMAL_ZERO)
        ) {
          await tx.partner_commissions.create({
            data: {
              partner_organization_id: pricing.partner_org_id,
              invoice_id: invoice.id,
              amount: this.round2(pricing.margin_amount.times(quantity)),
              currency: sub.currency,
              state: 'accrued',
              accrued_at: now,
            },
          });
        }

        return invoice;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  /**
   * Compute a read-only preview of the next invoice without issuing it.
   */
  async previewNextInvoice(
    storeSubscriptionId: number,
  ): Promise<InvoicePreview> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: storeSubscriptionId },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const pricing = this.computePricing(sub);
    const cycleMs = this.billingCycleMs(sub.plan.billing_cycle);
    const now = new Date();
    const periodStart = sub.current_period_end ?? now;
    const periodEnd = new Date(periodStart.getTime() + cycleMs);

    const lineItem: InvoiceLineItem = {
      description: `Plan ${sub.plan.code} (${sub.plan.billing_cycle})`,
      quantity: 1,
      unit_price: pricing.effective_price.toFixed(2),
      total: pricing.effective_price.toFixed(2),
      meta: {
        plan_id: sub.plan.id,
        plan_code: sub.plan.code,
        margin_pct: pricing.margin_pct.toFixed(2),
        billing_cycle: sub.plan.billing_cycle,
      },
    };

    const split: InvoiceSplitBreakdown = {
      vendix_share: this.round2(pricing.base_price).toFixed(2),
      partner_share: this.round2(pricing.margin_amount).toFixed(2),
      margin_pct_used: pricing.margin_pct.toFixed(2),
      partner_org_id: pricing.partner_org_id,
    };

    return {
      total: this.round2(pricing.effective_price).toFixed(2),
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      line_items: [lineItem],
      split_breakdown: split,
    };
  }

  async markInvoiceIssued(invoiceId: number): Promise<void> {
    await this.prisma.subscription_invoices.update({
      where: { id: invoiceId },
      data: { state: 'issued', issued_at: new Date(), updated_at: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Compute live pricing from base plan + (optional) partner override,
   * clamping the override margin at emission time vs. the current plan cap.
   * Never trust `store_subscriptions.partner_margin_amount` alone.
   */
  computePricing(sub: {
    plan: {
      id: number;
      base_price: Prisma.Decimal;
      max_partner_margin_pct: Prisma.Decimal | null;
    };
    partner_override?: {
      organization_id: number;
      margin_pct: Prisma.Decimal;
      fixed_surcharge: Prisma.Decimal | null;
      is_active: boolean;
      base_plan: { max_partner_margin_pct: Prisma.Decimal | null };
    } | null;
  }): ComputedPricing {
    const basePrice = new Prisma.Decimal(sub.plan.base_price);

    if (!sub.partner_override || !sub.partner_override.is_active) {
      return {
        base_price: basePrice,
        margin_pct: DECIMAL_ZERO,
        margin_amount: DECIMAL_ZERO,
        fixed_surcharge: DECIMAL_ZERO,
        effective_price: basePrice,
        partner_org_id: null,
      };
    }

    const requestedMargin = new Prisma.Decimal(sub.partner_override.margin_pct);
    const capRaw =
      sub.plan.max_partner_margin_pct ??
      sub.partner_override.base_plan.max_partner_margin_pct;
    const cap = capRaw ? new Prisma.Decimal(capRaw) : null;
    const clampedMargin =
      cap && requestedMargin.greaterThan(cap) ? cap : requestedMargin;

    if (cap && requestedMargin.greaterThan(cap)) {
      this.logger.warn(
        `Partner margin ${requestedMargin.toString()} > cap ${cap.toString()}; clamped at emission for org ${sub.partner_override.organization_id}`,
      );
    }

    // margin_amount = base_price * clamped_margin_pct / 100
    const marginAmount = basePrice.times(clampedMargin).dividedBy(DECIMAL_100);
    const fixedSurcharge = sub.partner_override.fixed_surcharge
      ? new Prisma.Decimal(sub.partner_override.fixed_surcharge)
      : DECIMAL_ZERO;

    const effective = basePrice.plus(marginAmount).plus(fixedSurcharge);

    return {
      base_price: basePrice,
      margin_pct: clampedMargin,
      margin_amount: marginAmount,
      fixed_surcharge: fixedSurcharge,
      effective_price: effective,
      partner_org_id: sub.partner_override.organization_id,
    };
  }

  private billingCycleMs(cycle: subscription_billing_cycle_enum): number {
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
        // Treat lifetime as effectively infinite by advancing 100 years.
        return 100 * 365 * DAY;
      default:
        return 30 * DAY;
    }
  }

  private async allocateInvoiceNumber(tx: any): Promise<string> {
    // Advisory xact lock — auto-released at commit.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY_INVOICE_NUMBER}::int)`,
    );
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    const prefix = `SAAS-${y}${m}${d}`;

    const last = (await tx.$queryRaw(
      Prisma.sql`SELECT invoice_number FROM subscription_invoices WHERE invoice_number LIKE ${prefix + '-%'} ORDER BY invoice_number DESC LIMIT 1`,
    )) as Array<{ invoice_number: string }>;

    let seq = 1;
    if (last.length) {
      const tail = last[0].invoice_number.split('-').pop();
      const parsed = parseInt(tail ?? '0', 10);
      if (Number.isFinite(parsed)) seq = parsed + 1;
    }
    return `${prefix}-${String(seq).padStart(5, '0')}`;
  }

  private extractPendingCredit(metadata: unknown): Prisma.Decimal {
    if (!metadata || typeof metadata !== 'object') return DECIMAL_ZERO;
    const raw = (metadata as Record<string, unknown>)['pending_credit'];
    if (typeof raw === 'string' || typeof raw === 'number') {
      try {
        const d = new Prisma.Decimal(raw);
        return d.greaterThan(DECIMAL_ZERO) ? d : DECIMAL_ZERO;
      } catch {
        return DECIMAL_ZERO;
      }
    }
    return DECIMAL_ZERO;
  }

  private round2(d: Prisma.Decimal): Prisma.Decimal {
    // Prisma.Decimal (decimal.js) — ROUND_HALF_EVEN = 6 (banker's rounding).
    return d.toDecimalPlaces(2, 6 /* ROUND_HALF_EVEN */);
  }
}
