import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { isDianUnitCode } from '../providers/dian-direct/constants/dian-unit-codes';
import type { CreateInvoiceNoteItemDto } from './dto/create-invoice-note-item.dto';
import {
  allocateNoteDocumentAllowance,
  type InvoiceCalculatorLineInput,
  type TrustedInvoiceReversalSnapshot,
  type TrustedInvoiceReversalTax,
} from '../services/invoice-calculator.service';
import { toDecimal } from '../utils/dian-money.util';
import { normalizeInvoiceTaxRate } from '../utils/invoice-tax-rate.util';

export type NoteSourceNumeric = Prisma.Decimal | number | string;

/** Frozen invoice-item values consumed by the pure note-source resolver. */
export interface NoteSourceItemSnapshot {
  id: number;
  invoice_id: number;
  product_id: number | null;
  product_variant_id: number | null;
  description: string;
  quantity: NoteSourceNumeric;
  unit_price: NoteSourceNumeric;
  discount_amount: NoteSourceNumeric;
  tax_amount: NoteSourceNumeric;
  total_amount: NoteSourceNumeric;
  is_inclusive: boolean | null;
  price_unit_quantity: number | null;
  unit_code: string | null;
  account_code: string | null;
  stock_units_consumed: number | null;
  serial_numbers_snapshot: string | null;
  aiu_component: string | null;
  financial_source_line_id: number | null;
}

/** Persisted tax snapshot. A NULL item id denotes a document-level row. */
export interface NoteSourceTaxSnapshot {
  invoice_item_id?: number | null;
  tax_rate_id?: number | null;
  tax_name: string;
  tax_type?: string | null;
  tax_rate: NoteSourceNumeric;
  taxable_amount: NoteSourceNumeric;
  tax_amount: NoteSourceNumeric;
  is_inclusive?: boolean | null;
}

/** Only immutable source-invoice fields; no product/tax catalog models. */
export interface NoteSourceInvoiceSnapshot {
  id: number;
  organization_id: number;
  store_id: number;
  accounting_entity_id: number;
  invoice_items: readonly NoteSourceItemSnapshot[];
  invoice_taxes: readonly NoteSourceTaxSnapshot[];
  subtotal_amount: NoteSourceNumeric;
  discount_amount: NoteSourceNumeric;
  tax_amount: NoteSourceNumeric;
  total_amount: NoteSourceNumeric;
  operation_type?: string | null;
  aiu_contract_object?: string | null;
  aiu_regime?: string | null;
  aiu_minimum_percent?: NoteSourceNumeric | null;
  aiu_taxable_matrix?: unknown;
  metadata?: unknown;
}

export interface ResolvedNoteSourceItem {
  source_invoice_item_id: number;
  product_id: number | null;
  product_variant_id: number | null;
  description: string;
  quantity: Prisma.Decimal;
  unit_price: Prisma.Decimal;
  discount_amount: Prisma.Decimal;
  unit_code: string;
  account_code: string | null;
  price_unit_quantity: number;
  is_inclusive: boolean | null;
  stock_units_consumed: number | null;
  serial_numbers_snapshot: string | null;
  aiu_component: string | null;
  financial_source_line_id: number | null;
}

export interface ResolvedNoteSourceLine {
  /** The immutable source row selected by `source_invoice_item_id`. */
  source: NoteSourceItemSnapshot;
  /** Editable commercial values plus the source's non-editable snapshots. */
  item: ResolvedNoteSourceItem;
  calculator_input: InvoiceCalculatorLineInput;
  original_quantity: Prisma.Decimal;
  original_base: Prisma.Decimal;
  original_total: Prisma.Decimal;
  /** Total notes must use `buildTrustedNoteSnapshot`, never computed mode. */
  requires_trusted_snapshot: boolean;
}

export interface ResolveNoteSourceOptions {
  /** The code actually emitted for legacy rows whose stored unit was absent. */
  emitted_unit_codes?: ReadonlyMap<number, string>;
}

const VALID_TAX_TYPES = new Set([
  'iva',
  'inc',
  'ica',
  'withholding',
  'retefuente',
  'reteiva',
  'reteica',
]);

function sourceError(
  source: NoteSourceInvoiceSnapshot,
  reason: string,
  source_item_id?: number,
): never {
  throw new VendixHttpException(
    ErrorCodes.INVOICING_NOTE_SOURCE_001,
    'La línea o los snapshots fiscales de la factura fuente no permiten resolver esta nota sin inventar datos.',
    {
      reason,
      parent_invoice_id: source.id,
      source_invoice_item_id: source_item_id,
    },
  );
}

function decimal(
  source: NoteSourceInvoiceSnapshot,
  value: NoteSourceNumeric,
  field: string,
  source_item_id?: number,
): Prisma.Decimal {
  let result: Prisma.Decimal;
  try {
    result = toDecimal(value);
  } catch {
    return sourceError(source, `invalid_${field}`, source_item_id);
  }
  if (!result.isFinite() || result.isNegative()) {
    sourceError(source, `invalid_${field}`, source_item_id);
  }
  return result;
}

function normalizeNamedTaxType(name: string): string | null {
  const normalized = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const compact = normalized.replace(/[\s_-]+/g, ' ');
  if (/^(iva(?:\s+\d+(?:[.,]\d+)?\s*%)?|impuesto al valor agregado|impuesto sobre las ventas)$/.test(compact)) {
    return 'iva';
  }
  if (/^(inc(?:\s+\d+(?:[.,]\d+)?\s*%)?|impuesto nacional al consumo|impuesto al consumo)$/.test(compact)) {
    return 'inc';
  }
  if (/^(ica(?:\s+.+)?|impuesto de industria y comercio)$/.test(compact)) return 'ica';
  if (/^(reteiva(?:\s+\d+(?:[.,]\d+)?\s*%)?|retencion de iva)$/.test(compact)) return 'reteiva';
  if (/^(reteica(?:\s+\d+(?:[.,]\d+)?\s*%)?|retencion de ica)$/.test(compact)) return 'reteica';
  if (/^(retefuente(?:\s+\d+(?:[.,]\d+)?\s*%)?|retencion en la fuente)$/.test(compact)) {
    return 'withholding';
  }
  return null;
}

function resolvedTaxType(
  source: NoteSourceInvoiceSnapshot,
  tax: NoteSourceTaxSnapshot,
  source_item_id?: number,
): string {
  const explicit = tax.tax_type?.trim().toLowerCase();
  const type = explicit || normalizeNamedTaxType(tax.tax_name);
  if (!type || !VALID_TAX_TYPES.has(type)) {
    sourceError(source, 'tax_type_unresolvable', source_item_id);
  }
  return type;
}

function invoiceTaxForCalculator(
  source: NoteSourceInvoiceSnapshot,
  tax: NoteSourceTaxSnapshot,
  source_item_id: number,
): NonNullable<InvoiceCalculatorLineInput['taxes']>[number] {
  const tax_type = resolvedTaxType(source, tax, source_item_id);
  return {
    tax_rate_id: tax.tax_rate_id ?? null,
    tax_name: tax.tax_name,
    tax_type,
    tax_rate: normalizeInvoiceTaxRate(
      decimal(source, tax.tax_rate, 'tax_rate', source_item_id),
      tax_type,
    ),
    rate_basis: tax_type === 'ica' || tax_type === 'reteica' ? 'per_mil' : 'percent',
    is_inclusive: tax.is_inclusive,
  };
}

function sourceBase(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
): Prisma.Decimal {
  const total = decimal(source, item.total_amount, 'line_total', item.id);
  const tax = decimal(source, item.tax_amount, 'line_tax_amount', item.id);
  const base = total.minus(tax);
  if (base.isNegative()) sourceError(source, 'line_tax_exceeds_total', item.id);
  return base;
}

function divisorFor(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
): number {
  const divisor = item.price_unit_quantity;
  return divisor !== null && Number.isInteger(divisor) && divisor >= 1
    ? divisor
    : 1;
}

function includedTaxRateFraction(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
  taxes: readonly NoteSourceTaxSnapshot[],
  line_candidate: boolean | null,
): Prisma.Decimal | null {
  if (taxes.length === 0) return null;
  const tax_inclusivity = taxes.map(
    (tax) => tax.is_inclusive ?? item.is_inclusive ?? line_candidate,
  );
  const all_flags_missing = tax_inclusivity.every(
    (value) => value === null || value === undefined,
  );
  if (
    !all_flags_missing &&
    tax_inclusivity.some((value) => value === null || value === undefined)
  ) {
    return null;
  }
  let fraction = new Prisma.Decimal(0);
  for (let index = 0; index < taxes.length; index += 1) {
    const tax = taxes[index];
    if (!tax) continue;
    // With no persisted flags at all, the captured line amount may still prove
    // that every frozen source scheme was included (or that none was, via the
    // base equality checked before this helper). A mixed/partial flag set is
    // ambiguous and fails closed instead of guessing per tax.
    const tax_inclusive = all_flags_missing ? true : tax_inclusivity[index] === true;
    if (!tax_inclusive) continue;
    const tax_type = resolvedTaxType(source, tax, item.id);
    const rate = normalizeInvoiceTaxRate(
      decimal(source, tax.tax_rate, 'tax_rate', item.id),
      tax_type,
    );
    const divisor = tax_type === 'ica' || tax_type === 'reteica' ? 1000 : 100;
    fraction = fraction.plus(rate.dividedBy(divisor));
  }
  return fraction;
}

/** Resolves inclusive/exclusive from frozen flags and captured line economics. */
function resolveCapturedInclusive(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
  candidate: boolean | null,
  divisor: number,
  taxes: readonly NoteSourceTaxSnapshot[],
): boolean | null {
  const quota = decimal(source, item.tax_amount, 'line_tax_amount', item.id);
  const base = sourceBase(source, item);
  const quantity = decimal(source, item.quantity, 'line_quantity', item.id);
  const price = decimal(source, item.unit_price, 'line_unit_price', item.id);
  const discount = decimal(source, item.discount_amount, 'line_discount', item.id);
  const captured = quantity.times(price).dividedBy(divisor).minus(discount);
  const round2 = (value: Prisma.Decimal) =>
    value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const captured_equals_base = round2(captured).equals(round2(base));
  if (quota.isZero()) {
    if (!captured_equals_base) sourceError(source, 'source_line_amount_incoherent', item.id);
    return candidate;
  }
  if (captured_equals_base) {
    // This also covers legacy rows marked inclusive after their unit price was
    // already normalized to the persisted base.
    return candidate === null && base.equals(item.total_amount) ? null : false;
  }

  const included_fraction = includedTaxRateFraction(source, item, taxes, candidate);
  if (candidate !== false && included_fraction !== null) {
    const captured_gross = base.times(new Prisma.Decimal(1).plus(included_fraction));
    if (round2(captured).equals(round2(captured_gross))) return true;
  }
  if (candidate === false) {
    sourceError(source, 'exclusive_snapshot_incoherent', item.id);
  }
  sourceError(source, 'inclusive_snapshot_unprovable', item.id);
}

function validateSourceRows(source: NoteSourceInvoiceSnapshot): void {
  const seen = new Set<number>();
  for (const item of source.invoice_items) {
    if (item.invoice_id !== source.id || seen.has(item.id)) {
      sourceError(source, 'source_item_parent_mismatch', item.id);
    }
    seen.add(item.id);
  }
  for (const tax of source.invoice_taxes) {
    if (tax.invoice_item_id !== null && tax.invoice_item_id !== undefined && !seen.has(tax.invoice_item_id)) {
      sourceError(source, 'tax_source_item_mismatch', tax.invoice_item_id);
    }
  }
  if (source.operation_type === '09') {
    // These are document snapshots, not values to be reconstructed from the
    // store's current invoicing settings. The minimum can be null when the
    // persisted matrix says it was deliberately disabled.
    if (
      !source.aiu_regime ||
      source.aiu_taxable_matrix === null ||
      source.aiu_taxable_matrix === undefined ||
      !source.aiu_contract_object
    ) {
      sourceError(source, 'aiu_snapshot_incomplete');
    }
  }
}

function resolveInclusiveFlag(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
  taxes: readonly NoteSourceTaxSnapshot[],
  preserve_total_snapshot = false,
): boolean | null {
  if (preserve_total_snapshot) {
    if (item.is_inclusive !== null) {
      if (
        item.is_inclusive &&
        !decimal(source, item.tax_amount, 'line_tax_amount', item.id).isZero() &&
        capturedLineEqualsBase(source, item, divisorFor(source, item))
      ) {
        return false;
      }
      return item.is_inclusive;
    }
    const frozen_flags = taxes
      .map((tax) => tax.is_inclusive)
      .filter((value): value is boolean => value !== null && value !== undefined);
    if (frozen_flags.length > 0 && frozen_flags.every((flag) => flag === frozen_flags[0])) {
      if (
        frozen_flags[0] === true &&
        capturedLineEqualsBase(source, item, divisorFor(source, item))
      ) {
        return false;
      }
      return frozen_flags[0] ?? null;
    }
    if (
      frozen_flags.length === 0 &&
      decimal(source, item.tax_amount, 'line_tax_amount', item.id).isZero()
    ) {
      return null;
    }
  }
  if (item.is_inclusive !== null) {
    return resolveCapturedInclusive(
      source,
      item,
      item.is_inclusive,
      divisorFor(source, item),
      taxes,
    );
  }
  const flags = taxes
    .map((tax) => tax.is_inclusive)
    .filter((value): value is boolean => value !== null && value !== undefined);
  if (flags.length === 0) {
    return resolveCapturedInclusive(
      source,
      item,
      null,
      divisorFor(source, item),
      taxes,
    );
  }
  const consistent = flags.every((flag) => flag === flags[0]);
  return resolveCapturedInclusive(
    source,
    item,
    consistent ? flags[0] : null,
    divisorFor(source, item),
    taxes,
  );
}

function capturedLineEqualsBase(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
  divisor: number,
): boolean {
  const quantity = decimal(source, item.quantity, 'line_quantity', item.id);
  const price = decimal(source, item.unit_price, 'line_unit_price', item.id);
  const discount = decimal(source, item.discount_amount, 'line_discount', item.id);
  const captured = quantity.times(price).dividedBy(divisor).minus(discount);
  const base = sourceBase(source, item);
  return captured.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).equals(
    base.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  );
}

function capturedAllowanceForLine(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
  allowance: Prisma.Decimal,
  taxes: readonly NoteSourceTaxSnapshot[],
  is_inclusive: boolean | null,
): Prisma.Decimal {
  if (allowance.isZero() || is_inclusive !== true) return allowance;
  if (decimal(source, item.tax_amount, 'line_tax_amount', item.id).isZero()) {
    return allowance;
  }
  const line_flag = item.is_inclusive;
  const included_rate_fraction = taxes.reduce((sum, tax) => {
    const tax_inclusive = tax.is_inclusive ?? line_flag ?? is_inclusive;
    if (!tax_inclusive) return sum;
    const tax_type = resolvedTaxType(source, tax, item.id);
    const rate = normalizeInvoiceTaxRate(
      decimal(source, tax.tax_rate, 'tax_rate', item.id),
      tax_type,
    );
    const divisor = tax_type === 'ica' || tax_type === 'reteica' ? 1000 : 100;
    return sum.plus(rate.dividedBy(divisor));
  }, new Prisma.Decimal(0));
  if (included_rate_fraction.isZero()) {
    sourceError(source, 'inclusive_allowance_rate_unprovable', item.id);
  }
  return allowance
    .times(new Prisma.Decimal(1).plus(included_rate_fraction))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
}

function exactCopyLineTaxRows(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
): NoteSourceTaxSnapshot[] {
  const linked = source.invoice_taxes.filter((tax) => tax.invoice_item_id === item.id);
  return linked;
}

function lineTaxRows(
  source: NoteSourceInvoiceSnapshot,
  item: NoteSourceItemSnapshot,
  source_bases_after_allowance: ReadonlyMap<number, Prisma.Decimal>,
): NoteSourceTaxSnapshot[] {
  const rows = source.invoice_taxes;
  const linked = rows.filter((tax) => tax.invoice_item_id === item.id);
  const header = rows.filter(
    (tax) => tax.invoice_item_id === null || tax.invoice_item_id === undefined,
  );
  const line_tax_amount = decimal(source, item.tax_amount, 'line_tax_amount', item.id);

  if (linked.length > 0) {
    if (header.length > 0) sourceError(source, 'mixed_header_and_line_taxes', item.id);
    return linked;
  }
  if (header.length === 0) {
    if (line_tax_amount.isZero()) return [];
    sourceError(source, 'tax_snapshot_missing', item.id);
  }
  if (header.length > 1) {
    sourceError(source, 'aggregated_multi_tax_ambiguous', item.id);
  }

  const aggregated = header[0];
  if (!aggregated) sourceError(source, 'header_tax_missing', item.id);
  if (line_tax_amount.greaterThan(0)) return [aggregated];
  const aggregated_tax = decimal(source, aggregated.tax_amount, 'header_tax_amount');
  if (aggregated_tax.greaterThan(0)) return [];

  // A zero-rate/exempt aggregate cannot be assigned to a subset of lines from
  // the header alone. It is safe only when the header's persisted base proves
  // it covers every source line (or this is the sole source line).
  const aggregate_base = decimal(source, aggregated.taxable_amount, 'header_taxable_amount');
  const total_source_base = [...source_bases_after_allowance.values()].reduce(
    (sum, base) => sum.plus(base),
    new Prisma.Decimal(0),
  );
  const this_base = source_bases_after_allowance.get(item.id) ?? new Prisma.Decimal(0);
  if (
    source.invoice_items.length === 1 && aggregate_base.equals(this_base)
  ) {
    return [aggregated];
  }
  if (aggregate_base.equals(total_source_base)) return [aggregated];
  sourceError(source, 'aggregated_zero_tax_scope_ambiguous', item.id);
}

function chooseUnitCode(
  source: NoteSourceInvoiceSnapshot,
  sourceItem: NoteSourceItemSnapshot,
  requested: string | null | undefined,
  options: ResolveNoteSourceOptions,
): string {
  if (requested !== undefined) {
    const code = typeof requested === 'string' ? requested.trim() : '';
    if (!code || !isDianUnitCode(code)) sourceError(source, 'requested_unit_invalid', sourceItem.id);
    return code;
  }
  const saved = sourceItem.unit_code?.trim();
  if (saved && isDianUnitCode(saved)) return saved;
  const emitted = options.emitted_unit_codes?.get(sourceItem.id)?.trim();
  if (emitted && isDianUnitCode(emitted)) return emitted;
  sourceError(source, 'source_unit_unavailable', sourceItem.id);
}

function requestedDecimal(
  source: NoteSourceInvoiceSnapshot,
  value: unknown,
  field: string,
  max_scale: number,
  source_item_id: number,
): Prisma.Decimal {
  if (value === null || value === undefined) {
    sourceError(source, `requested_${field}_missing`, source_item_id);
  }
  let result: Prisma.Decimal;
  try {
    result = toDecimal(value);
  } catch {
    return sourceError(source, `requested_${field}_invalid`, source_item_id);
  }
  if (
    !result.isFinite() ||
    result.isNegative() ||
    result.decimalPlaces() > max_scale
  ) {
    sourceError(source, `requested_${field}_invalid`, source_item_id);
  }
  return result;
}

/**
 * Resolves editable commercial values against immutable invoice snapshots.
 * No catalog, tax-rate, tenant, or product service is consulted here.
 */
export function resolveNoteSourceLines(
  source: NoteSourceInvoiceSnapshot,
  requestedItems?: readonly CreateInvoiceNoteItemDto[],
  options: ResolveNoteSourceOptions = {},
): ResolvedNoteSourceLine[] {
  validateSourceRows(source);
  const raw_requested_items: unknown = requestedItems;
  if (
    raw_requested_items !== undefined &&
    (!Array.isArray(raw_requested_items) || raw_requested_items.length === 0)
  ) {
    sourceError(source, 'explicit_empty_source_selection');
  }
  const exact_total_copy = raw_requested_items === undefined;
  if (source.invoice_items.length === 0) sourceError(source, 'source_has_no_items');

  const source_bases = new Map<number, Prisma.Decimal>();
  for (const item of source.invoice_items) source_bases.set(item.id, sourceBase(source, item));

  const bases_total = [...source_bases.values()].reduce(
    (sum, base) => sum.plus(base),
    new Prisma.Decimal(0),
  );
  const parent_total = decimal(source, source.total_amount, 'document_total');
  const parent_tax = decimal(source, source.tax_amount, 'document_tax_amount');
  const source_document_base = parent_total.minus(parent_tax);
  const allowance = bases_total.minus(source_document_base);
  let allocated_allowance: Map<number, Prisma.Decimal> | null;
  if (exact_total_copy) {
    // Exact total reversal does not redistribute header allowance into lines.
    // The trusted snapshot carries the original header values as-is.
    allocated_allowance = new Map<number, Prisma.Decimal>();
    if (source.tax_amount && !decimal(source, source.tax_amount, 'document_tax_amount').isZero() && source.invoice_taxes.length === 0) {
      sourceError(source, 'tax_snapshot_missing');
    }
    for (const item of source.invoice_items) {
      if (
        !decimal(source, item.tax_amount, 'line_tax_amount', item.id).isZero() &&
        !source.invoice_taxes.some(
          (tax) =>
            tax.invoice_item_id === item.id ||
            tax.invoice_item_id === null ||
            tax.invoice_item_id === undefined,
        )
      ) {
        sourceError(source, 'tax_snapshot_missing', item.id);
      }
    }
    for (const tax of source.invoice_taxes) resolvedTaxType(source, tax, tax.invoice_item_id ?? undefined);
  } else {
    if (allowance.isNegative()) sourceError(source, 'document_base_exceeds_source_lines');
    allocated_allowance = allocateNoteDocumentAllowance(
      allowance,
      source.invoice_items.map((item) => ({
        id: item.id,
        base_amount: source_bases.get(item.id) ?? new Prisma.Decimal(0),
      })),
    );
    if (!allocated_allowance) sourceError(source, 'document_allowance_unallocatable');
  }

  const header_rows = source.invoice_taxes.filter(
    (tax) => tax.invoice_item_id === null || tax.invoice_item_id === undefined,
  );
  const linked_rows = source.invoice_taxes.some(
    (tax) => tax.invoice_item_id !== null && tax.invoice_item_id !== undefined,
  );
  const source_bases_after_allowance = new Map<number, Prisma.Decimal>();
  for (const item of source.invoice_items) {
    source_bases_after_allowance.set(
      item.id,
      (source_bases.get(item.id) ?? new Prisma.Decimal(0)).minus(
        allocated_allowance.get(item.id) ?? new Prisma.Decimal(0),
      ),
    );
  }
  if (!exact_total_copy && header_rows.length === 1 && !linked_rows) {
    const header_row = header_rows[0];
    if (!header_row) sourceError(source, 'header_tax_missing');
    const header_tax_amount = decimal(source, header_row.tax_amount, 'header_tax_amount');
    const expected_taxable_base = source.invoice_items
      .filter((item) =>
        header_tax_amount.isZero() ||
        decimal(source, item.tax_amount, 'line_tax_amount', item.id).greaterThan(0),
      )
      .reduce(
        (sum, item) =>
          sum.plus(source_bases_after_allowance.get(item.id) ?? new Prisma.Decimal(0)),
        new Prisma.Decimal(0),
      );
    const persisted_taxable_base = decimal(source, header_row.taxable_amount, 'header_taxable_amount');
    if (!persisted_taxable_base.equals(expected_taxable_base)) {
      sourceError(source, 'special_header_tax_base_without_reproducible_rule');
    }
  }

  const requested = exact_total_copy ? undefined : requestedItems;
  const selected = requested
    ? requested.map((request) => {
        const line = source.invoice_items.find(
          (item) => item.id === request.source_invoice_item_id,
        );
        if (!line) sourceError(source, 'source_item_missing_or_foreign', request.source_invoice_item_id);
        return { source: line, request };
      })
    : source.invoice_items.map((line) => ({ source: line, request: undefined }));

  const requestedIds = new Set<number>();
  for (const { source: line } of selected) {
    if (requestedIds.has(line.id)) sourceError(source, 'source_item_repeated', line.id);
    requestedIds.add(line.id);
  }

  return selected.map(({ source: line, request }) => {
    const original_quantity = decimal(source, line.quantity, 'line_quantity', line.id);
    if (original_quantity.isZero()) sourceError(source, 'source_quantity_zero', line.id);
    const divisor = divisorFor(source, line);
    const allocated = allocated_allowance.get(line.id) ?? new Prisma.Decimal(0);
    const original_base = (source_bases.get(line.id) ?? new Prisma.Decimal(0)).minus(allocated);
    const original_total = decimal(source, line.total_amount, 'line_total', line.id).minus(allocated);
    if (original_base.isNegative() || original_total.isNegative()) {
      sourceError(source, 'allowance_exceeds_source_line', line.id);
    }

    const quantity = request
      ? requestedDecimal(source, request.quantity, 'quantity', 4, line.id)
      : original_quantity;
    const unit_price = request
      ? requestedDecimal(source, request.unit_price, 'unit_price', 2, line.id)
      : decimal(source, line.unit_price, 'line_unit_price', line.id);
    if (quantity.isZero()) sourceError(source, 'requested_quantity_zero', line.id);
    const unit_code = chooseUnitCode(source, line, request?.unit_code, options);
    const sourceTaxRows = exact_total_copy
      ? exactCopyLineTaxRows(source, line)
      : lineTaxRows(source, line, source_bases_after_allowance);
    if (!exact_total_copy) {
      for (const tax of sourceTaxRows) {
        if (tax.invoice_item_id === line.id) {
          const persisted_tax_base = decimal(source, tax.taxable_amount, 'taxable_amount', line.id);
          const source_line_base = source_bases_after_allowance.get(line.id) ?? new Prisma.Decimal(0);
          if (!persisted_tax_base.equals(source_line_base)) {
            // The frozen AIU regime/matrix is retained on `source`, but the
            // calculator input cannot carry that matrix or prove a per-line
            // ratio for contract-contained AIU. Do not treat metadata presence
            // alone as evidence for a new taxable base.
            sourceError(source, 'special_tax_base_without_reproducible_rule', line.id);
          }
        }
      }
    }
    const inclusiveEvidenceRows = exact_total_copy
      ? source.invoice_taxes.some((tax) => tax.invoice_item_id === line.id)
        ? source.invoice_taxes.filter((tax) => tax.invoice_item_id === line.id)
        : !decimal(source, line.tax_amount, 'line_tax_amount', line.id).isZero()
          ? source.invoice_taxes.filter((tax) => tax.invoice_item_id == null)
          : []
      : sourceTaxRows;
    const is_inclusive = resolveInclusiveFlag(
      source,
      line,
      inclusiveEvidenceRows,
      exact_total_copy,
    );
    const captured_allowance = capturedAllowanceForLine(
      source,
      line,
      allocated,
      sourceTaxRows,
      is_inclusive,
    );
    const original_discount = decimal(source, line.discount_amount, 'line_discount', line.id)
      .plus(captured_allowance);
    const discount_amount = request?.discount_amount !== undefined
      ? requestedDecimal(source, request.discount_amount, 'discount_amount', 2, line.id)
      : original_discount
          .times(quantity)
          .dividedBy(original_quantity)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const taxes = sourceTaxRows.map((tax) => invoiceTaxForCalculator(source, tax, line.id));

    const item: ResolvedNoteSourceItem = {
      source_invoice_item_id: line.id,
      product_id: line.product_id,
      product_variant_id: line.product_variant_id,
      description: line.description,
      quantity,
      unit_price,
      discount_amount,
      unit_code,
      account_code: line.account_code,
      price_unit_quantity: divisor,
      is_inclusive,
      stock_units_consumed: line.stock_units_consumed,
      serial_numbers_snapshot: line.serial_numbers_snapshot,
      aiu_component: line.aiu_component,
      financial_source_line_id: line.financial_source_line_id,
    };
    const calculator_input: InvoiceCalculatorLineInput = {
      description: line.description,
      aiu_component: line.aiu_component as InvoiceCalculatorLineInput['aiu_component'],
      quantity,
      unit_price,
      discount_amount,
      price_unit_quantity: divisor,
      is_inclusive,
      taxes,
    };

    return {
      source: line,
      item,
      calculator_input,
      original_quantity,
      original_base,
      original_total,
      requires_trusted_snapshot: exact_total_copy,
    };
  });
}

/** Builds exact calculator reversal data from a full source-invoice selection. */
export function buildTrustedNoteSnapshot(
  source: NoteSourceInvoiceSnapshot,
  resolvedLines: readonly ResolvedNoteSourceLine[],
): TrustedInvoiceReversalSnapshot {
  validateSourceRows(source);
  if (
    resolvedLines.length !== source.invoice_items.length ||
    resolvedLines.some((line) => !line.requires_trusted_snapshot) ||
    new Set(resolvedLines.map((line) => line.source.id)).size !== source.invoice_items.length ||
    source.invoice_items.some((item) => !resolvedLines.some((line) => line.source.id === item.id))
  ) {
    sourceError(source, 'trusted_reversal_requires_all_source_lines');
  }

  const order = new Map(source.invoice_items.map((item, index) => [item.id, index]));
  const taxes: TrustedInvoiceReversalTax[] = source.invoice_taxes.map((tax) => {
    const line_index = tax.invoice_item_id == null ? undefined : order.get(tax.invoice_item_id);
    if (tax.invoice_item_id != null && line_index === undefined) {
      sourceError(source, 'trusted_tax_line_missing', tax.invoice_item_id);
    }
    const tax_type = resolvedTaxType(source, tax, tax.invoice_item_id ?? undefined);
    return {
      tax_rate_id: tax.tax_rate_id ?? null,
      tax_name: tax.tax_name,
      tax_type,
      tax_rate: normalizeInvoiceTaxRate(
        decimal(source, tax.tax_rate, 'tax_rate', tax.invoice_item_id ?? undefined),
        tax_type,
      ),
      taxable_amount: decimal(source, tax.taxable_amount, 'taxable_amount', tax.invoice_item_id ?? undefined),
      tax_amount: decimal(source, tax.tax_amount, 'tax_amount', tax.invoice_item_id ?? undefined),
      rate_basis: tax_type === 'ica' || tax_type === 'reteica' ? 'per_mil' : 'percent',
      is_inclusive: tax.is_inclusive,
      ...(line_index === undefined ? {} : { line_index }),
    };
  });

  const lines = source.invoice_items.map((line) => {
    const divisor = divisorFor(source, line);
    const quota = decimal(source, line.tax_amount, 'line_tax_amount', line.id);
    const inclusiveEvidenceRows = source.invoice_taxes.some(
      (tax) => tax.invoice_item_id === line.id,
    )
      ? source.invoice_taxes.filter((tax) => tax.invoice_item_id === line.id)
      : !decimal(source, line.tax_amount, 'line_tax_amount', line.id).isZero()
        ? source.invoice_taxes.filter((tax) => tax.invoice_item_id == null)
        : [];
    const is_inclusive = resolveInclusiveFlag(source, line, inclusiveEvidenceRows, true);
    return {
      description: line.description,
      quantity: decimal(source, line.quantity, 'line_quantity', line.id),
      unit_price: decimal(source, line.unit_price, 'line_unit_price', line.id),
      discount_amount: decimal(source, line.discount_amount, 'line_discount', line.id),
      tax_amount: quota,
      total_amount: decimal(source, line.total_amount, 'line_total', line.id),
      line_extension_amount: sourceBase(source, line),
      price_unit_quantity: divisor,
      is_inclusive,
    };
  });

  return {
    lines,
    taxes,
    subtotal_amount: decimal(source, source.subtotal_amount, 'document_subtotal'),
    discount_amount: decimal(source, source.discount_amount, 'document_discount'),
    tax_amount: decimal(source, source.tax_amount, 'document_tax_amount'),
    total_amount: decimal(source, source.total_amount, 'document_total'),
  };
}
