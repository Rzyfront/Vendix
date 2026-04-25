import { Prisma } from '@prisma/client';

/**
 * Billing-level shared types for subscription invoices, payments, and
 * proration calculations. Money is ALWAYS Prisma.Decimal — no JS numbers.
 */

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: string; // Decimal serialized
  total: string; // Decimal serialized
  meta: {
    plan_id: number;
    plan_code: string;
    margin_pct?: string; // Decimal serialized (null when no partner)
    billing_cycle: string;
    prorated?: boolean;
  };
}

export interface InvoiceSplitBreakdown {
  /** Vendix share = base_price * quantity (Decimal serialized). */
  vendix_share: string;
  /** Partner share = margin_amount * quantity (Decimal serialized). */
  partner_share: string;
  /** Margin pct used, echoed for audit (Decimal serialized, "0" if no partner). */
  margin_pct_used: string;
  /** Partner organization id (null when no partner). */
  partner_org_id: number | null;
}

export interface InvoicePreview {
  total: string; // Decimal serialized
  period_start: string; // ISO
  period_end: string; // ISO
  line_items: InvoiceLineItem[];
  split_breakdown: InvoiceSplitBreakdown;
}

export type ProrationKind = 'upgrade' | 'downgrade' | 'same-tier';

export interface ProrationPreview {
  kind: ProrationKind;
  days_remaining: number;
  cycle_days: number;
  old_effective_price: string; // Decimal serialized
  new_effective_price: string; // Decimal serialized
  /** Positive => charge now, negative => credit for next invoice. */
  proration_amount: string; // Decimal serialized
  applies_immediately: true;
  invoice_to_issue: InvoicePreview | null;
  credit_to_apply_next_cycle: string; // Decimal serialized
}

export interface PartnerLedger {
  accrued: string;
  pending_payout: string;
  paid: string;
  total_history: string;
}

/** Internal — not exported via DTOs. */
export interface ComputedPricing {
  base_price: Prisma.Decimal;
  margin_pct: Prisma.Decimal; // 0 when no partner
  margin_amount: Prisma.Decimal; // 0 when no partner
  fixed_surcharge: Prisma.Decimal; // 0 when no partner
  effective_price: Prisma.Decimal;
  partner_org_id: number | null;
}
