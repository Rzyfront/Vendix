import { Prisma } from '@prisma/client';
import {
  buildTaxBreakdown,
  scaleBreakdownToTotal,
  type TaxBreakdownItem,
} from '../../../../common/interfaces/tax-breakdown.interface';
import {
  proportionalShippingTaxCents,
  prorateShippingTaxRefundCents,
} from '../../shipping/utils/shipping-tax.util';

type Money = Prisma.Decimal;

export interface ManualRefundFiscalOrder {
  grand_total: Money;
  tip_amount: Money | null;
  tax_amount: Money;
  shipping_cost: Money;
  shipping_tax_amount: Money;
  shipping_tax_type: string | null;
  order_items: { order_item_taxes: { tax_type: string | null; tax_amount: Money }[] }[];
}

export interface ManualRefundFiscalRow {
  id: number;
  amount: Money;
  subtotal_refund: Money | null;
  tax_refund: Money | null;
  shipping_refund: Money | null;
  notes: string | null;
  refund_items: {
    tax_amount: Money | null;
    order_items: { order_item_taxes: { tax_type: string | null; tax_amount: Money }[] };
  }[];
}

export class UnexplainedRefundAmountError extends Error {
  constructor(detail: string) {
    super(`REF_TAX_BREAKDOWN_MISSING_001: ${detail}`);
  }
}

const cents = (value: Money | number | null | undefined) =>
  new Prisma.Decimal(value ?? 0).times(100).toDecimalPlaces(0).toNumber();

/** Cancellation-evidence markers: legacy (`Cancelación;…`) + ADR-12 legs (`Cancelación ADR-12;…`). */
const hasCancellationMarker = (notes: string | null | undefined): boolean =>
  !!notes && (notes.startsWith('Cancelación;') || notes.startsWith('Cancelación ADR-12;'));

/** Rebuilds the fiscal meaning of a paid refund; never treats a residual fee as revenue. */
export function buildManualRefundFiscalPayload(
  order: ManualRefundFiscalOrder,
  refund: ManualRefundFiscalRow,
  prior: ManualRefundFiscalRow[],
) {
  const amount = cents(refund.amount);
  let subtotal = cents(refund.subtotal_refund);
  const productTax = cents(refund.tax_refund);
  const shipping = cents(refund.shipping_refund);
  const tipCeiling = cents(order.tip_amount);
  if (amount <= 0 || subtotal < 0 || productTax < 0 || shipping < 0) {
    throw new UnexplainedRefundAmountError('negative or empty refund component');
  }
  const tipAllocation = (row: ManualRefundFiscalRow): number => {
    const paid = cents(row.amount);
    const base = cents(row.subtotal_refund);
    const tax = cents(row.tax_refund);
    const grossShipping = cents(row.shipping_refund);
    const residual = paid - base - tax - grossShipping;
    if (residual < 0 || (residual > 0 && row.refund_items.length > 0)) {
      throw new UnexplainedRefundAmountError(`refund #${row.id} has unexplained amount`);
    }
    if (residual > 0) {
      if (!hasCancellationMarker(row.notes)) {
        throw new UnexplainedRefundAmountError(`refund #${row.id} has an unproven residual fee`);
      }
      return residual;
    }
    if (tipCeiling === 0 || row.refund_items.length > 0) return 0;
    // Legacy cancellation rows embedded tip in subtotal. Only the system's
    // payment-scoped cancellation marker PLUS matching tax/shipping proration
    // justify extracting it. Without both, a fee and a tip are indistinguishable.
    if (!hasCancellationMarker(row.notes)) {
      throw new UnexplainedRefundAmountError(`refund #${row.id} tip allocation lacks cancellation evidence`);
    }
    const ratio = paid / cents(order.grand_total);
    const expectedTax = Math.round(cents(order.tax_amount) * ratio);
    const expectedShipping = Math.round(cents(order.shipping_cost) * ratio);
    if (Math.abs(tax - expectedTax) > 1 || Math.abs(grossShipping - expectedShipping) > 1) {
      throw new UnexplainedRefundAmountError(`refund #${row.id} fiscal proration does not match sale snapshot`);
    }
    return Math.round(tipCeiling * ratio);
  };
  let priorTip = 0;
  for (const row of prior) {
    priorTip += tipAllocation(row);
  }
  const tip = tipAllocation(refund);
  if (tip < 0 || priorTip + tip > tipCeiling || subtotal < tip) {
    throw new UnexplainedRefundAmountError('amount differs from product, tax, shipping and available tip');
  }
  if (amount - subtotal - productTax - shipping === 0) subtotal -= tip;

  const productRows = refund.refund_items.length > 0
    ? refund.refund_items.flatMap((item) =>
        scaleBreakdownToTotal(
          buildTaxBreakdown(item.order_items.order_item_taxes),
          cents(item.tax_amount) / 100,
        ),
      )
    : scaleBreakdownToTotal(
        buildTaxBreakdown(order.order_items.flatMap((item) => item.order_item_taxes)),
        productTax / 100,
      );
  const taxBreakdown: TaxBreakdownItem[] = buildTaxBreakdown(productRows);
  if (Math.round(taxBreakdown.reduce((sum, row) => sum + row.tax_amount, 0) * 100) !== productTax) {
    throw new UnexplainedRefundAmountError('product tax has no typed source');
  }

  let shippingTax = 0;
  const shippingCost = cents(order.shipping_cost);
  const shippingTaxTotal = cents(order.shipping_tax_amount);
  if (shipping > 0 && shippingTaxTotal > 0) {
    if (shippingCost <= 0 || !order.shipping_tax_type) {
      throw new UnexplainedRefundAmountError('shipping tax lacks gross cost or fiscal type');
    }
    const priorShippingRefunds = prior.map((row) => cents(row.shipping_refund));
    const priorShipping = priorShippingRefunds.reduce((sum, gross) => sum + gross, 0);
    const priorShippingTax = priorShippingRefunds.reduce(
      (sum, gross) => sum + proportionalShippingTaxCents(shippingCost, shippingTaxTotal, gross),
      0,
    );
    if (priorShipping + shipping > shippingCost || priorShippingTax > shippingTaxTotal) {
      throw new UnexplainedRefundAmountError('shipping tax exceeds original snapshot');
    }
    shippingTax = prorateShippingTaxRefundCents(shippingCost, shippingTaxTotal, priorShippingRefunds, shipping);
    taxBreakdown.push({
      tax_type: order.shipping_tax_type as TaxBreakdownItem['tax_type'],
      tax_amount: shippingTax / 100,
    });
  }
  if (shipping > shippingCost && shippingCost >= 0) {
    throw new UnexplainedRefundAmountError('shipping refund exceeds original gross shipping');
  }
  const refundedTotal = prior.reduce((sum, row) => sum + cents(row.amount), 0) + amount;
  return {
    amount: amount / 100,
    subtotal: subtotal / 100,
    tax_amount: (productTax + shippingTax) / 100,
    tax_breakdown: taxBreakdown,
    shipping: shipping / 100,
    tip_amount: tip / 100,
    is_full_refund: refundedTotal >= cents(order.grand_total),
  };
}
