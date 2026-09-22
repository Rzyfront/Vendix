import { Prisma, tax_type_enum } from '@prisma/client';
import { orderTaxFractionToInvoiceRate } from './invoice-tax-rate.util';

interface FinancialTax {
  tax_rate_id: number | null;
  tax_name: string;
  tax_rate: Prisma.Decimal | string;
  tax_type: tax_type_enum | null;
  tax_amount: Prisma.Decimal | string;
  is_inclusive: boolean;
  is_compound: boolean;
}
interface FinancialLine {
  id: number;
  kind: string;
  source_order_item_id: number | null;
  description: string;
  source_snapshot: unknown;
  subtotal_amount: Prisma.Decimal | string;
  discount_amount: Prisma.Decimal | string;
  tax_amount: Prisma.Decimal | string;
  total_amount: Prisma.Decimal | string;
  taxes: FinancialTax[];
}
interface FinancialAccountProjection {
  id: number;
  label: string;
  grand_total: Prisma.Decimal | string;
  subtotal_amount: Prisma.Decimal | string;
  discount_amount: Prisma.Decimal | string;
  tax_amount: Prisma.Decimal | string;
  shipping_cost: Prisma.Decimal | string;
  tip_amount: Prisma.Decimal | string;
  lines: FinancialLine[];
}
const dec = (value: Prisma.Decimal | string) => new Prisma.Decimal(value);

/** One unit is a financial participation, NEVER a fractional stock/catalog unit.
 * All source lines, cents and tax types are immutable ledger snapshots. Taxes
 * remain line-bound (also for a single tax) so inclusive/compound bases cannot
 * be reconstructed incorrectly from the original physical quantity.
 */
export function projectFinancialAccountInvoice(account: FinancialAccountProjection, orderNumber: string) {
  const items = account.lines.map((line) => {
    const base = dec(line.subtotal_amount);
    const discount = dec(line.discount_amount);
    const tax = dec(line.tax_amount);
    const total = dec(line.total_amount);
    if (!base.minus(discount).plus(tax).equals(total)) throw new Error('Financial line snapshot does not balance');
    const taxSum = line.taxes.reduce((sum, row) => sum.plus(row.tax_amount), new Prisma.Decimal(0));
    if (!taxSum.equals(tax)) throw new Error('Financial line tax snapshot does not balance');
    const snapshot = (line.source_snapshot ?? {}) as { quantity?: number; product_name?: string };
    const provenance = line.kind === 'item'
      ? ` · origen #${line.source_order_item_id}${snapshot.quantity ? ` (${snapshot.quantity} unidades originales)` : ''}`
      : '';
    return {
      data: {
        financial_source_line_id: line.id,
        product_id: null,
        product_variant_id: null,
        description: `Participación ${account.label} · orden ${orderNumber} · ${line.description}${provenance}`.slice(0, 500),
        quantity: new Prisma.Decimal(1),
        unit_price: base,
        discount_amount: discount,
        tax_amount: tax,
        total_amount: total,
        is_inclusive: false,
        unit_code: 'EA',
        // No stock quantity/serial claims: those belong to the original sale.
        stock_units_consumed: null,
      },
      taxes: line.taxes.map((row) => ({
        tax_rate_id: row.tax_rate_id,
        tax_name: row.tax_name,
        tax_rate: new Prisma.Decimal(orderTaxFractionToInvoiceRate(Number(row.tax_rate), row.tax_type)),
        tax_type: row.tax_type,
        taxable_amount: base.minus(discount).plus(row.is_compound ? line.taxes.slice(0, line.taxes.indexOf(row)).reduce((sum, prior) => sum.plus(prior.tax_amount), new Prisma.Decimal(0)) : 0),
        tax_amount: dec(row.tax_amount),
        // The participation is expressed as a net base; source inclusiveness
        // is still auditable on the immutable financial tax snapshot.
        is_inclusive: false,
      })),
    };
  });
  const sum = (field: 'unit_price' | 'discount_amount' | 'tax_amount' | 'total_amount') =>
    items.reduce((n, item) => n.plus(item.data[field]), new Prisma.Decimal(0));
  const subtotal = sum('unit_price');
  const discount = sum('discount_amount');
  const tax = sum('tax_amount');
  const total = sum('total_amount');
  if (!total.equals(account.grand_total) || !discount.equals(account.discount_amount) || !tax.equals(account.tax_amount) ||
      !subtotal.equals(dec(account.subtotal_amount).plus(account.shipping_cost).plus(account.tip_amount))) {
    throw new Error('Financial account snapshot does not balance');
  }
  return { items, subtotal, discount, tax, total };
}
