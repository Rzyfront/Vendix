/**
 * Fiscal tax breakdown contract shared across accounting events.
 *
 * Accounting events (invoice.accepted, support_document.accepted,
 * payment.received, credit_sale.created, refund.completed) carry this typed
 * breakdown alongside the scalar `tax_amount` total, so that AutoEntryService
 * can post one journal line per fiscal type (IVA → 2408, INC → 2436,
 * ICA → 241205) instead of collapsing everything to 2408.
 *
 * Values mirror the Prisma `tax_type_enum` and the `TaxFiscalType` DTO enum.
 */
export type TaxFiscalTypeValue =
  | 'iva'
  | 'inc'
  | 'ica'
  | 'withholding'
  | 'reteiva'
  | 'reteica';

export interface TaxBreakdownItem {
  tax_type: TaxFiscalTypeValue;
  tax_amount: number;
}

/**
 * Collapses a list of typed tax rows (invoice_taxes / order_item_taxes) into a
 * deduplicated breakdown summing amounts per fiscal type. Rows without a
 * persisted type fall back to 'iva' (the de-facto prior behavior). Returns an
 * empty array when there are no taxes, which lets consumers fall back to the
 * legacy single-line `vat_payable` posting.
 */
export function buildTaxBreakdown(
  rows: Array<{ tax_type?: string | null; tax_amount: unknown }>,
): TaxBreakdownItem[] {
  const byType = new Map<TaxFiscalTypeValue, number>();
  for (const row of rows ?? []) {
    const type = (row.tax_type as TaxFiscalTypeValue) || 'iva';
    const amount = Number(row.tax_amount || 0);
    if (!amount) continue;
    byType.set(type, (byType.get(type) ?? 0) + amount);
  }
  return Array.from(byType.entries()).map(([tax_type, tax_amount]) => ({
    tax_type,
    tax_amount,
  }));
}

/**
 * Scales a base breakdown so its amounts sum to `targetTotal`, preserving the
 * per-type proportions. Used by refund flows that know the scalar refunded tax
 * (proportional to the partial refund) but must keep the original fiscal type
 * mix. Returns [] when there is nothing to scale.
 */
export function scaleBreakdownToTotal(
  base: TaxBreakdownItem[],
  targetTotal: number,
): TaxBreakdownItem[] {
  const sum = base.reduce((acc, b) => acc + b.tax_amount, 0);
  if (sum <= 0 || !targetTotal || targetTotal <= 0) return [];
  const factor = targetTotal / sum;
  return base.map((b) => ({
    tax_type: b.tax_type,
    tax_amount: Math.round(b.tax_amount * factor * 100) / 100,
  }));
}
