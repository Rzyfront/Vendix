import { Prisma, tax_type_enum } from '@prisma/client';
import { normalizeInvoiceTaxRate } from './invoice-tax-rate.util';

/**
 * `aiu_component_enum` is declared in the Prisma schema but is not presently
 * exported as a top-level generated type. Keep the persisted values structural
 * here instead of requiring client regeneration.
 */
type AiuComponentValue = 'administracion' | 'imprevistos' | 'utilidad';

/** Structural invoice-line fields needed to persist a recalculated line. */
export interface InvoiceCalculationItemInput {
  product_id?: number | null;
  product_variant_id?: number | null;
  description: string;
  quantity: Prisma.Decimal.Value;
  unit_price: Prisma.Decimal.Value;
  aiu_component?: string | null;
}

/** Frozen catalog values; note DTOs can supply the same shape structurally. */
export interface InvoiceLinePricingSnapshotInput {
  price_unit_quantity?: number;
  unit_code?: string;
  account_code?: string;
}

/** Recalculated line values are kept as captured by InvoiceCalculatorService. */
export interface CalculatedLinePersistenceInput {
  discount_amount: Prisma.Decimal.Value;
  tax_amount: Prisma.Decimal.Value;
  is_inclusive: boolean;
  total_amount: Prisma.Decimal.Value;
}

export interface InvoiceTaxPersistenceInput {
  tax_rate_id?: number | null;
  tax_name: string;
  tax_rate: number | string | Prisma.Decimal;
  taxable_amount?: Prisma.Decimal.Value | null;
  tax_amount?: Prisma.Decimal.Value | null;
  tax_type: string;
  is_inclusive?: boolean;
}

export interface CalculatedLineTaxPersistenceInput {
  omit_tax_total?: boolean;
  taxable_amount: Prisma.Decimal.Value;
  line_extension_amount: Prisma.Decimal.Value;
}

/**
 * Maps an already-calculated invoice line to the Prisma create shape.
 * Catalog/source resolution belongs to the caller; this function only persists
 * the captured price/unit/account snapshot and calculated monetary values.
 */
export function buildInvoiceItemCreateInput(
  item: InvoiceCalculationItemInput,
  line: CalculatedLinePersistenceInput,
  snapshot: InvoiceLinePricingSnapshotInput,
) {
  return {
    product_id: item.product_id,
    product_variant_id: item.product_variant_id,
    description: item.description,
    quantity: new Prisma.Decimal(item.quantity),
    unit_price: new Prisma.Decimal(item.unit_price),
    discount_amount: new Prisma.Decimal(line.discount_amount),
    tax_amount: new Prisma.Decimal(line.tax_amount),
    is_inclusive: line.is_inclusive,
    total_amount: new Prisma.Decimal(line.total_amount),
    price_unit_quantity: snapshot.price_unit_quantity,
    unit_code: snapshot.unit_code,
    account_code: snapshot.account_code,
    aiu_component: item.aiu_component as AiuComponentValue | undefined,
  };
}

/**
 * Maps one resolved tax row without inventing a fiscal type. Rate
 * normalization retains the historical IVA-fraction compatibility behavior.
 */
export function buildInvoiceTaxCreateInput(tax: InvoiceTaxPersistenceInput) {
  return {
    tax_rate_id: tax.tax_rate_id ?? undefined,
    tax_name: tax.tax_name,
    tax_rate: normalizeInvoiceTaxRate(tax.tax_rate, tax.tax_type),
    taxable_amount: new Prisma.Decimal(tax.taxable_amount ?? 0),
    tax_amount: new Prisma.Decimal(tax.tax_amount ?? 0),
    tax_type: tax.tax_type as unknown as tax_type_enum,
    is_inclusive: tax.is_inclusive ?? false,
  };
}

/**
 * Selects a single persistence shape: aggregate header rows for the ordinary
 * single-tax case, or per-line rows for multiple taxes / a distinct fiscal
 * taxable base (including AIU). Never persist both forms.
 */
export function needsPersistedLineTaxes(
  header_taxes: readonly unknown[],
  lines: readonly CalculatedLineTaxPersistenceInput[],
): boolean {
  if (header_taxes.length >= 2) return true;

  return lines.some(
    (line) =>
      !line.omit_tax_total &&
      !new Prisma.Decimal(line.taxable_amount).equals(
        new Prisma.Decimal(line.line_extension_amount),
      ),
  );
}
