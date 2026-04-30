import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  subscription_billing_cycle_enum,
  subscription_change_kind_enum,
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
    opts: {
      prorated?: boolean;
      proratedAmount?: Prisma.Decimal;
      fromPlanId?: number | null;
      toPlanId?: number | null;
      changeKind?: subscription_change_kind_enum | null;
    } = {},
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

        // RNC-39: subscriptions in 'no_plan' have no plan_id. They MUST NOT
        // emit invoices — there is nothing to bill. Log and bail.
        if (!sub.plan_id || !sub.plan) {
          this.logger.warn(
            JSON.stringify({
              event: 'INVOICE_SKIPPED_NO_PLAN',
              subscription_id: sub.id,
              store_id: sub.store_id,
              state: sub.state,
              prorated: !!opts.prorated,
            }),
          );
          return null;
        }

        // Idempotent reuse / void of an existing pending invoice for this
        // subscription. Prevents duplicate billing rows when the user retries
        // checkout (closed widget, re-open) or changes plan while pending:
        //   - Same plan, still `issued`  → reuse the row (no new number, no
        //     duplicate partner commission). Caller treats as a no-op emission.
        //   - Different plan, still `issued` → void the old one and metadata
        //     mark it as `replaced_by_plan_change`; commission accrual on the
        //     old row gets cleaned up by the void path so there's no rev-share
        //     leak. Continue and emit a fresh invoice for the new plan.
        // Only runs for non-prorated emissions; proration emits its own
        // delta invoice and never collides with a pending full-period one.
        if (!opts.prorated) {
          const existingPending = await tx.subscription_invoices.findFirst({
            where: {
              store_subscription_id: sub.id,
              state: 'issued',
            },
            orderBy: { created_at: 'desc' },
          });
          if (existingPending) {
            // Resolve the plan_id this pending invoice was issued against so
            // we can detect a plan change. Line items carry plan_id in `meta`.
            const lineItems = Array.isArray(existingPending.line_items)
              ? (existingPending.line_items as unknown as InvoiceLineItem[])
              : [];
            const invoicePlanId = lineItems[0]?.meta?.plan_id ?? null;
            const samePlan =
              invoicePlanId === null || invoicePlanId === sub.plan_id;

            if (samePlan) {
              this.logger.log(
                JSON.stringify({
                  event: 'INVOICE_REUSED',
                  subscription_id: sub.id,
                  invoice_id: existingPending.id,
                  invoice_number: existingPending.invoice_number,
                  plan_id: sub.plan_id,
                }),
              );
              return existingPending;
            }

            // Plan changed since the previous emission. Void the old invoice
            // and any pending payments under it, then continue to emit a new
            // one for the current plan. Commission accrual: when `state` flips
            // off `issued` the partner_commissions row stays in `accrued` —
            // we mark it `voided` so the monthly batch skips it.
            const existingMeta =
              existingPending.metadata &&
              typeof existingPending.metadata === 'object'
                ? (existingPending.metadata as Record<string, unknown>)
                : {};
            await tx.subscription_invoices.update({
              where: { id: existingPending.id },
              data: {
                state: 'void',
                metadata: {
                  ...existingMeta,
                  void_reason: 'replaced_by_plan_change',
                  voided_at: new Date().toISOString(),
                  previous_plan_id: invoicePlanId,
                  new_plan_id: sub.plan_id,
                } as Prisma.InputJsonValue,
                updated_at: new Date(),
              },
            });

            // Cancel any pending payments tied to the voided invoice. There's
            // no `cancelled` state in subscription_payment_state_enum, so we
            // mark them `failed` with reason in metadata.
            const pendingPayments = await tx.subscription_payments.findMany({
              where: { invoice_id: existingPending.id, state: 'pending' },
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
                    cancellation_reason: 'invoice_voided_plan_change',
                    cancelled_at: new Date().toISOString(),
                  } as Prisma.InputJsonValue,
                  updated_at: new Date(),
                },
              });
            }

            // Reverse the partner commission row for the voided invoice so
            // the monthly payout batch ignores it. We use `reversed` (the
            // canonical terminal-failure state in partner_commission_state_enum).
            await tx.partner_commissions.updateMany({
              where: {
                invoice_id: existingPending.id,
                state: 'accrued',
              },
              data: { state: 'reversed' },
            });

            this.logger.warn(
              JSON.stringify({
                event: 'INVOICE_VOIDED_PLAN_CHANGE',
                subscription_id: sub.id,
                old_invoice_id: existingPending.id,
                old_invoice_number: existingPending.invoice_number,
                old_plan_id: invoicePlanId,
                new_plan_id: sub.plan_id,
              }),
            );
          }
        }

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
          : new Date((sub.current_period_end ?? now).getTime() + cycleMs);

        const quantity = 1;
        const unitPrice =
          opts.prorated && opts.proratedAmount
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
        // CRITICAL: if pending_credit > subtotal, cap applied at subtotal
        // and ROLL OVER the remainder to the next cycle (persist in metadata).
        // Previous bug: any credit excess over subtotal was silently lost.
        const pendingCredit = this.extractPendingCredit(sub.metadata);
        let subtotal = unitPrice.times(quantity);
        let creditApplied = DECIMAL_ZERO;
        let remainingCredit = DECIMAL_ZERO;
        if (pendingCredit.greaterThan(DECIMAL_ZERO) && !opts.prorated) {
          // Cap credit so subtotal_after >= 0
          creditApplied = Prisma.Decimal.min(pendingCredit, subtotal);
          remainingCredit = pendingCredit.minus(creditApplied);
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
          vendix_share: this.round2(pricing.base_price.times(quantity)).toFixed(
            2,
          ),
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
            split_breakdown: splitBreakdown as unknown as Prisma.InputJsonValue,
            metadata: {
              prorated: !!opts.prorated,
              credit_applied: creditApplied.toFixed(2),
            } as Prisma.InputJsonValue,
            from_plan_id: opts.fromPlanId ?? null,
            to_plan_id: opts.toPlanId ?? null,
            change_kind: opts.changeKind ?? null,
          },
        });

        // Reset / rollover pending credit if used.
        // - applied >= original pending_credit: clear key entirely.
        // - applied < pending_credit (subtotal too small): persist remainder
        //   as string Decimal under metadata.pending_credit so it rolls over
        //   to the next cycle. Operates inside the SAME tx as the invoice.
        if (creditApplied.greaterThan(DECIMAL_ZERO)) {
          const nextMeta = {
            ...(sub.metadata && typeof sub.metadata === 'object'
              ? (sub.metadata as Record<string, unknown>)
              : {}),
          };
          if (remainingCredit.greaterThan(DECIMAL_ZERO)) {
            const roundedRemaining = this.round2(remainingCredit);
            nextMeta['pending_credit'] = roundedRemaining.toFixed(2);
            this.logger.log(
              JSON.stringify({
                event: 'PENDING_CREDIT_ROLLOVER',
                subscription_id: sub.id,
                applied: this.round2(creditApplied).toFixed(2),
                remaining: roundedRemaining.toFixed(2),
                invoice_id: invoice.id,
              }),
            );
          } else {
            delete nextMeta['pending_credit'];
          }
          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: { metadata: nextMeta as Prisma.InputJsonValue },
          });
        }

        // Accrue partner commission (state=accrued) when applicable.
        // RNC-41: promotional plans NEVER accrue commission.
        const isPromotionalPlan =
          sub.plan.plan_type === 'promotional' || sub.plan.is_promotional;
        if (
          pricing.partner_org_id !== null &&
          pricing.margin_amount.greaterThan(DECIMAL_ZERO) &&
          !isPromotionalPlan
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

    // RNC-39: no_plan stores cannot have an invoice preview (nothing to bill).
    if (!sub.plan_id || !sub.plan) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_002);
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
  /**
   * Check whether a plan would result in a zero-charge invoice (free plan).
   * Used by checkout to decide if we can short-circuit the
   * pending_payment → widget flow and activate the subscription synchronously.
   */
  isFreePlan(plan: {
    id?: number;
    base_price: Prisma.Decimal;
    max_partner_margin_pct: Prisma.Decimal | null;
    is_free?: boolean;
  }): boolean {
    const pricing = this.computePricing({
      plan: { id: plan.id ?? 0, ...plan },
    });
    // Authoritative signal is the explicit `is_free` flag on the plan row
    // (added by 20260429235000_add_is_free_to_subscription_plans). The legacy
    // heuristic `effective_price <= 0` failed silently when sub.plan was null
    // and routed paid checkouts through free-plan branches without charging.
    // Margin must also be zero — when a partner override produces a non-zero
    // margin amount on a base-free plan there IS still a charge to collect.
    return (
      plan.is_free === true &&
      pricing.margin_amount.lessThanOrEqualTo(DECIMAL_ZERO)
    );
  }

  computePricing(sub: {
    plan: {
      id: number;
      base_price: Prisma.Decimal;
      max_partner_margin_pct: Prisma.Decimal | null;
    } | null;
    partner_override?: {
      organization_id: number;
      margin_pct: Prisma.Decimal;
      fixed_surcharge: Prisma.Decimal | null;
      is_active: boolean;
      base_plan: { max_partner_margin_pct: Prisma.Decimal | null };
    } | null;
  }): ComputedPricing {
    // RNC-39: no plan -> zero pricing across the board. Caller is expected to
    // short-circuit (e.g. skip invoice emission) before reaching this method;
    // we fail safe to avoid crashes on the no_plan path.
    if (!sub.plan) {
      return {
        base_price: DECIMAL_ZERO,
        margin_pct: DECIMAL_ZERO,
        margin_amount: DECIMAL_ZERO,
        fixed_surcharge: DECIMAL_ZERO,
        effective_price: DECIMAL_ZERO,
        partner_org_id: null,
      };
    }
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
