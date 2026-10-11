import { resolveAccountingModel } from '../invoicing/profiles/invoice-profile-config.contract';

export interface ContractQuotationTaxPresentation {
  dian_tax_code: string;
  tax_name: string;
  tax_type: string;
  tax_rate: number;
  taxable_amount: number;
  tax_amount: number;
  tax_rate_formatted: string;
  taxable_amount_formatted: string;
  tax_amount_formatted: string;
}

export interface ContractQuotationLinePresentation {
  description: string;
  bucket: string;
  aiu_component?: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  net_base: number;
  total_amount: number;
  unit_price_formatted: string;
  discount_amount_formatted: string;
  net_base_formatted: string;
  total_amount_formatted: string;
  taxes: ContractQuotationTaxPresentation[];
}

export interface ContractQuotationCostDetail {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  net_base: number;
  unit_price_formatted: string;
  discount_amount_formatted: string;
  net_base_formatted: string;
}

export interface ContractQuotationPresentation {
  accounting_model: 'sumada' | 'no_sumada';
  contract_object: string;
  invoice_profile_name: string;
  invoice_profile_version: number;
  due_date: string | null;
  due_date_formatted: string | null;
  agreed_notes: string | null;
  terms_and_conditions: string | null;
  lines: ContractQuotationLinePresentation[];
  source_cost_details: ContractQuotationCostDetail[];
  tax_summary: ContractQuotationTaxPresentation[];
  gross_subtotal: number;
  discount_total: number;
  net_subtotal: number;
  tax_total: number;
  grand_total: number;
  gross_subtotal_formatted: string;
  discount_total_formatted: string;
  net_subtotal_formatted: string;
  tax_total_formatted: string;
  grand_total_formatted: string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(field: string): never {
  throw new Error(`Snapshot económico contractual inválido: ${field}.`);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') return fail(field);
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(field);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  const decimalString =
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toString?: unknown }).toString === 'function' &&
    (value as { toString(): string }).toString !== Object.prototype.toString
      ? (value as { toString(): string }).toString()
      : value;
  if (
    (typeof decimalString !== 'number' && typeof decimalString !== 'string') ||
    (typeof decimalString === 'string' && decimalString.trim() === '')
  ) {
    return fail(field);
  }
  const parsed = Number(decimalString);
  if (!Number.isFinite(parsed)) return fail(field);
  return parsed;
}

function optionalNumber(value: unknown, field: string): number {
  return value === undefined ? 0 : requiredNumber(value, field);
}

function formatCop(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRate(value: number): string {
  return `${new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)}%`;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function dateOnly(value: unknown): { iso: string; formatted: string } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail('invoice_profile.due_date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return fail('invoice_profile.due_date');
  }
  return {
    iso: value,
    formatted: new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC' }).format(parsed),
  };
}

function mapTax(tax: unknown, field: string): ContractQuotationTaxPresentation {
  if (!isRecord(tax)) return fail(field);
  const dian_tax_code = requiredText(tax.dian_tax_code, `${field}.dian_tax_code`);
  const tax_name = requiredText(tax.tax_name, `${field}.tax_name`);
  const tax_type = requiredText(tax.tax_type, `${field}.tax_type`);
  const tax_rate = requiredNumber(tax.tax_rate, `${field}.tax_rate`);
  const taxable_amount = requiredNumber(tax.taxable_amount, `${field}.taxable_amount`);
  const tax_amount = requiredNumber(tax.tax_amount, `${field}.tax_amount`);
  return {
    dian_tax_code,
    tax_name,
    tax_type,
    tax_rate,
    taxable_amount,
    tax_amount,
    tax_rate_formatted: formatRate(tax_rate),
    taxable_amount_formatted: formatCop(taxable_amount),
    tax_amount_formatted: formatCop(tax_amount),
  };
}

function mapSourceCosts(items: unknown): ContractQuotationCostDetail[] {
  if (!Array.isArray(items)) return fail('quotation_items');
  return items.map((item, index) => {
    if (!isRecord(item)) return fail(`quotation_items[${index}]`);
    const description = requiredText(
      item.product_name,
      `quotation_items[${index}].product_name`,
    );
    const quantity = requiredNumber(item.quantity, `quotation_items[${index}].quantity`);
    const unit_price = requiredNumber(item.unit_price, `quotation_items[${index}].unit_price`);
    const discount_amount = optionalNumber(
      item.discount_amount,
      `quotation_items[${index}].discount_amount`,
    );
    const net_base = requiredNumber(item.total_price, `quotation_items[${index}].total_price`);
    return {
      description,
      quantity,
      unit_price,
      discount_amount,
      net_base,
      unit_price_formatted: formatCop(unit_price),
      discount_amount_formatted: formatCop(discount_amount),
      net_base_formatted: formatCop(net_base),
    };
  });
}

/**
 * Pure adapter for accepted contract-quotation presentation. It never
 * calculates, loads a profile, or consults store settings; the calculator's
 * frozen per-line result and header tax rows are the only fiscal source.
 * Returns null only for pre-snapshot legacy quotes, which callers must render
 * through their existing representation with an explicit warning.
 */
export function buildQuotationContractPresentation(
  economicSnapshot: unknown,
  quotationText: {
    notes?: string | null;
    terms_and_conditions?: string | null;
    quotation_items?: unknown;
  } = {},
): ContractQuotationPresentation | null {
  if (economicSnapshot === undefined || economicSnapshot === null) return null;
  if (!isRecord(economicSnapshot)) return fail('root');
  if (economicSnapshot.schema_version !== 1) return fail('schema_version');

  const profile = economicSnapshot.invoice_profile;
  if (!isRecord(profile) || !Number.isInteger(profile.profile_id) || !Number.isInteger(profile.version)) {
    return fail('invoice_profile');
  }
  const profileName = requiredText(profile.name, 'invoice_profile.name');
  if (!isRecord(profile.config) || !isRecord(profile.config.aiu)) {
    return fail('invoice_profile.config.aiu');
  }
  const accounting_model = resolveAccountingModel(profile.config.aiu);

  const contract_object = requiredText(economicSnapshot.contract_object, 'contract_object');
  const invoice_lines = economicSnapshot.invoice_lines;
  const calculation = economicSnapshot.calculation;
  if (!Array.isArray(invoice_lines) || invoice_lines.length === 0) return fail('invoice_lines');
  if (!isRecord(calculation) || !Array.isArray(calculation.lines) || !isRecord(calculation.totals)) {
    return fail('calculation');
  }
  if (calculation.lines.length !== invoice_lines.length) return fail('calculation.lines');
  if (!Array.isArray(calculation.header_taxes)) return fail('calculation.header_taxes');

  const lines = invoice_lines.map((line, index) => {
    if (!isRecord(line) || !isRecord(calculation.lines[index])) return fail(`invoice_lines[${index}]`);
    const calculated = calculation.lines[index];
    const description = requiredText(line.description, `invoice_lines[${index}].description`);
    const bucket = requiredText(line.bucket, `invoice_lines[${index}].bucket`);
    const quantity = requiredNumber(line.quantity, `invoice_lines[${index}].quantity`);
    const unit_price = requiredNumber(line.unit_price, `invoice_lines[${index}].unit_price`);
    const discount_amount = optionalNumber(line.discount_amount, `invoice_lines[${index}].discount_amount`);
    if (quantity <= 0 || unit_price < 0 || discount_amount < 0) return fail(`invoice_lines[${index}].amounts`);
    if (!['costo', 'administracion', 'imprevistos', 'utilidad', 'contrato'].includes(bucket)) {
      return fail(`invoice_lines[${index}].bucket`);
    }
    if (
      line.aiu_component !== undefined &&
      line.aiu_component !== null &&
      !['administracion', 'imprevistos', 'utilidad', 'contrato'].includes(line.aiu_component)
    ) return fail(`invoice_lines[${index}].aiu_component`);
    const net_base = requiredNumber(calculated.line_extension_amount, `calculation.lines[${index}].line_extension_amount`);
    const total_amount = requiredNumber(calculated.total_amount, `calculation.lines[${index}].total_amount`);
    if (
      calculated.description !== description ||
      (calculated.aiu_component ?? null) !== (line.aiu_component ?? null) ||
      cents(requiredNumber(calculated.discount_amount, `calculation.lines[${index}].discount_amount`)) !== cents(discount_amount)
    ) return fail(`calculation.lines[${index}] disagrees with invoice_lines`);
    if (!Array.isArray(calculated.taxes)) return fail(`calculation.lines[${index}].taxes`);
    const declared_taxes = line.taxes ?? [];
    if (!Array.isArray(declared_taxes) || declared_taxes.length !== calculated.taxes.length) {
      return fail(`invoice_lines[${index}].taxes`);
    }
    const taxes = calculated.taxes.map((tax: unknown, taxIndex: number) => {
      const mapped = mapTax(tax, `calculation.lines[${index}].taxes[${taxIndex}]`);
      const declared = declared_taxes[taxIndex];
      if (!isRecord(declared)) return fail(`invoice_lines[${index}].taxes[${taxIndex}]`);
      if (
        declared.tax_name !== mapped.tax_name ||
        requiredNumber(declared.tax_rate, `invoice_lines[${index}].taxes[${taxIndex}].tax_rate`) !== mapped.tax_rate ||
        (declared.tax_type ?? mapped.tax_type) !== mapped.tax_type
      ) {
        return fail(`invoice_lines[${index}].taxes[${taxIndex}] disagrees with calculation`);
      }
      return mapped;
    });
    return {
      description,
      bucket,
      aiu_component: line.aiu_component ?? null,
      quantity,
      unit_price,
      discount_amount,
      net_base,
      total_amount,
      unit_price_formatted: formatCop(unit_price),
      discount_amount_formatted: formatCop(discount_amount),
      net_base_formatted: formatCop(net_base),
      total_amount_formatted: formatCop(total_amount),
      taxes,
    };
  });

  const tax_summary = calculation.header_taxes.map((tax: unknown, index: number) =>
    mapTax(tax, `calculation.header_taxes[${index}]`),
  );
  const totals = calculation.totals;
  const gross_subtotal = requiredNumber(totals.gross_subtotal, 'calculation.totals.gross_subtotal');
  const discount_total = requiredNumber(totals.discount_amount, 'calculation.totals.discount_amount');
  const net_subtotal = requiredNumber(totals.total_before_tax, 'calculation.totals.total_before_tax');
  const tax_total = requiredNumber(totals.tax_amount, 'calculation.totals.tax_amount');
  const grand_total = requiredNumber(totals.total_amount, 'calculation.totals.total_amount');
  const lineTotals = lines.map((line, index) => calculation.lines[index]);
  if (
    cents(lineTotals.reduce((sum: number, line: any) => sum + requiredNumber(line.gross_amount, 'calculation.lines.gross_amount'), 0)) !== cents(gross_subtotal) ||
    cents(lineTotals.reduce((sum: number, line: any) => sum + requiredNumber(line.discount_amount, 'calculation.lines.discount_amount'), 0)) !== cents(discount_total) ||
    cents(lineTotals.reduce((sum: number, line: any) => sum + requiredNumber(line.line_extension_amount, 'calculation.lines.line_extension_amount'), 0)) !== cents(net_subtotal) ||
    cents(tax_summary.reduce((sum, tax) => sum + tax.tax_amount, 0)) !== cents(tax_total)
  ) return fail('calculation.totals reconciliation');
  const due = dateOnly(economicSnapshot.due_date);
  const source_cost_details = accounting_model === 'no_sumada'
    ? mapSourceCosts(quotationText.quotation_items)
    : [];

  return {
    accounting_model,
    contract_object,
    invoice_profile_name: profileName,
    invoice_profile_version: profile.version,
    due_date: due?.iso ?? null,
    due_date_formatted: due?.formatted ?? null,
    agreed_notes: optionalText(quotationText.notes, 'quotation.notes'),
    terms_and_conditions: optionalText(
      quotationText.terms_and_conditions,
      'quotation.terms_and_conditions',
    ),
    lines,
    source_cost_details,
    tax_summary,
    gross_subtotal,
    discount_total,
    net_subtotal,
    tax_total,
    grand_total,
    gross_subtotal_formatted: formatCop(gross_subtotal),
    discount_total_formatted: formatCop(discount_total),
    net_subtotal_formatted: formatCop(net_subtotal),
    tax_total_formatted: formatCop(tax_total),
    grand_total_formatted: formatCop(grand_total),
  };
}
