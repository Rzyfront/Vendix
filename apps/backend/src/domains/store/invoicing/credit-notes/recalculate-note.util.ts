import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import type { CreateInvoiceNoteItemDto } from './dto/create-invoice-note-item.dto';
import {
  buildCreditNoteCandidate,
  type CreditNoteCandidate,
} from './credit-note-balance.service';
import {
  buildTrustedNoteSnapshot,
  resolveNoteSourceTaxType,
  resolveNoteSourceLines,
  type NoteSourceInvoiceSnapshot,
  type ResolveNoteSourceOptions,
  type ResolvedNoteSourceLine,
} from './note-source-resolver.util';
import { resolveFrozenNoteAiuInput } from './note-source-aiu.util';
import { normalizeInvoiceTaxRate } from '../utils/invoice-tax-rate.util';
import type { InvoiceCalculatorAiuInput } from '../services/invoice-calculator.service';
import {
  InvoiceCalculatorService,
  type InvoiceCalculatorResult,
} from '../services/invoice-calculator.service';
import {
  buildInvoiceItemCreateInput,
  buildInvoiceTaxCreateInput,
  needsPersistedLineTaxes,
} from '../utils/invoice-calculation-persistence.util';

export interface RecalculatedNote {
  resolved_lines: ResolvedNoteSourceLine[];
  calculated: InvoiceCalculatorResult;
  items: Prisma.invoice_itemsUncheckedCreateWithoutInvoiceInput[];
  taxes: Array<ReturnType<typeof buildInvoiceTaxCreateInput> & { line_index?: number }>;
  subtotal_amount: Prisma.Decimal;
  discount_amount: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  candidate: CreditNoteCandidate;
  aiu_taxable_matrix?: Prisma.InputJsonValue;
}

function calculationFailure(
  code: 'INVOICING_CALC_005' | 'INVOICING_CALC_006',
  details: Record<string, unknown>,
): never {
  throw new VendixHttpException(ErrorCodes[code], undefined, details);
}

function amount(value: Prisma.Decimal.Value, field: string, scale: 2 | 4): Prisma.Decimal {
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(value);
  } catch {
    return calculationFailure('INVOICING_CALC_006', {
      field,
      detail: 'non_finite_or_unparseable',
    });
  }
  const max = scale === 4 ? new Prisma.Decimal('99999999.9999') : new Prisma.Decimal('9999999999.99');
  if (
    !result.isFinite() ||
    result.isNegative() ||
    result.decimalPlaces() > scale ||
    result.greaterThan(max)
  ) {
    return calculationFailure('INVOICING_CALC_006', {
      field,
      detail: 'outside_database_precision',
      received: result.toString(),
      precision: scale === 4 ? '12,4' : '12,2',
    });
  }
  return result;
}

function assertCalculatorResult(
  calculated: InvoiceCalculatorResult,
  source: NoteSourceInvoiceSnapshot,
): void {
  const residual = calculated.divergences.find((row) => row.scope === 'unclosed_residual');
  if (residual) {
    calculationFailure('INVOICING_CALC_005', { divergence: residual });
  }
  const invalid = calculated.divergences.find((row) => row.scope === 'invalid_line_input');
  if (invalid) {
    calculationFailure('INVOICING_CALC_006', { divergence: invalid });
  }
  const aiuUnderdeclared = calculated.divergences.find((row) => row.scope === 'aiu_taxable_line_without_tax');
  if (aiuUnderdeclared) {
    throw new VendixHttpException(ErrorCodes.INVOICING_AIU_004, undefined, { divergence: aiuUnderdeclared });
  }
  const aiuBelowMinimum = calculated.divergences.find((row) => row.scope === 'aiu_base_below_minimum');
  if (aiuBelowMinimum) {
    throw new VendixHttpException(ErrorCodes.INVOICING_AIU_001, undefined, { divergence: aiuBelowMinimum });
  }
  const aiuModelConflict = calculated.divergences.find((row) => row.scope === 'aiu_contrato_mutually_exclusive');
  if (aiuModelConflict) {
    throw new VendixHttpException(ErrorCodes.INVOICING_AIU_007, undefined, { divergence: aiuModelConflict });
  }

  // This scope is deliberately advisory: the calculator corrects the row by
  // removing taxes from an AIU-untaxable line. Persist its corrected output.
  const advisory = new Set(['aiu_untaxable_line_declares_tax']);
  const blocking = calculated.divergences.find((row) => !advisory.has(row.scope));
  if (blocking) {
    const sourceCorruption = new Set([
      'line_tax',
      'untaxed_line_with_amount',
      'withholding_as_tax',
      'withholding_amount',
    ]);
    if (sourceCorruption.has(blocking.scope)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_NOTE_SOURCE_001,
        undefined,
        {
          reason: 'calculator_source_tax_divergence',
          parent_invoice_id: source.id,
          source_invoice_item_id: source.invoice_items[blocking.line_index]?.id,
          divergence: blocking,
        },
      );
    }
    calculationFailure('INVOICING_CALC_006', { divergence: blocking });
  }
}

function snapshotDecimal(
  source: NoteSourceInvoiceSnapshot,
  value: unknown,
  reason: string,
  source_item_id?: number,
): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value as Prisma.Decimal.Value);
  } catch {
    return sourceMismatch(source, reason, source_item_id);
  }
  if (!parsed.isFinite()) return sourceMismatch(source, reason, source_item_id);
  return parsed;
}

function sourceMismatch(
  source: NoteSourceInvoiceSnapshot,
  reason: string,
  source_item_id?: number,
  cause_code?: string,
): never {
  throw new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, {
    reason,
    parent_invoice_id: source.id,
    source_invoice_item_id: source_item_id,
    ...(cause_code ? { cause_code } : {}),
  });
}

type TaxAggregate = { taxable: Prisma.Decimal; tax: Prisma.Decimal };

function aggregateTaxRows(
  source: NoteSourceInvoiceSnapshot,
  rows: readonly {
    tax_type: string;
    tax_rate: Prisma.Decimal.Value;
    rate_basis: string;
    taxable_amount: Prisma.Decimal.Value;
    tax_amount: Prisma.Decimal.Value;
  }[],
): Map<string, TaxAggregate> {
  const grouped = new Map<string, TaxAggregate>();
  for (const row of rows) {
    const type = row.tax_type.trim().toLowerCase();
    const rate = normalizeInvoiceTaxRate(row.tax_rate, type);
    const rateBasis = type === 'ica' || type === 'reteica' ? 'per_mil' : 'percent';
    if (row.rate_basis !== rateBasis) {
      sourceMismatch(source, 'aiu_source_tax_rate_basis_conflict');
    }
    const key = `${type}|${rateBasis}|${rate.toFixed(2)}`;
    const aggregate = grouped.get(key) ?? {
      taxable: new Prisma.Decimal(0),
      tax: new Prisma.Decimal(0),
    };
    aggregate.taxable = aggregate.taxable.plus(
      snapshotDecimal(source, row.taxable_amount, 'aiu_source_taxable_amount_invalid'),
    );
    aggregate.tax = aggregate.tax.plus(
      snapshotDecimal(source, row.tax_amount, 'aiu_source_tax_amount_invalid'),
    );
    grouped.set(key, aggregate);
  }
  return grouped;
}

function assertOriginalAiuReproducesSource(
  source: NoteSourceInvoiceSnapshot,
  calculated: InvoiceCalculatorResult,
  resolved: readonly ResolvedNoteSourceLine[],
  aiu: InvoiceCalculatorAiuInput,
): void {
  if (calculated.lines.length !== resolved.length) {
    sourceMismatch(source, 'aiu_original_line_count_mismatch');
  }

  const sourceTaxAggregate = (rows: readonly NoteSourceInvoiceSnapshot['invoice_taxes'][number][]) =>
    aggregateTaxRows(source, rows.map((row) => {
      const tax_type = resolveNoteSourceTaxType(source, row, row.invoice_item_id ?? undefined);
      return {
        tax_type,
        tax_rate: row.tax_rate,
        rate_basis: tax_type === 'ica' || tax_type === 'reteica' ? 'per_mil' : 'percent',
        taxable_amount: row.taxable_amount,
        tax_amount: row.tax_amount,
      };
    }));

  for (let index = 0; index < resolved.length; index += 1) {
    const original = resolved[index];
    const line = calculated.lines[index];
    if (!original || !line) sourceMismatch(source, 'aiu_original_line_missing');
    const fields = [
      [line.line_extension_amount, original.original_base],
      [line.tax_amount, original.source.tax_amount],
      [line.total_amount, original.original_total],
    ] as const;
    if (fields.some(([computed, captured]) => !snapshotDecimal(source, computed, 'aiu_original_amount_invalid', original.source.id).equals(snapshotDecimal(source, captured, 'aiu_source_amount_invalid', original.source.id)))) {
      sourceMismatch(source, 'aiu_original_line_amount_mismatch', original.source.id);
    }

    const linkedRows = source.invoice_taxes.filter((row) => row.invoice_item_id === original.source.id);
    if (linkedRows.length > 0) {
      const expectedByKey = sourceTaxAggregate(linkedRows);
      const actualByKey = aggregateTaxRows(source, line.taxes);
      if (expectedByKey.size !== actualByKey.size) {
        sourceMismatch(source, 'aiu_original_linked_tax_row_count_mismatch', original.source.id);
      }
      for (const [key, expected] of expectedByKey) {
        const actual = actualByKey.get(key);
        if (!actual || !expected.taxable.equals(actual.taxable) || !expected.tax.equals(actual.tax)) {
          sourceMismatch(source, 'aiu_original_linked_tax_amount_mismatch', original.source.id);
        }
      }
    }
  }

  const header = [
    [
      calculated.totals.total_before_tax,
      snapshotDecimal(source, source.total_amount, 'aiu_source_header_total_invalid')
        .minus(snapshotDecimal(source, source.tax_amount, 'aiu_source_header_tax_invalid')),
    ],
    [calculated.totals.tax_amount, source.tax_amount],
    [calculated.totals.total_amount, source.total_amount],
  ] as const;
  if (header.some(([computed, captured]) => !snapshotDecimal(source, computed, 'aiu_original_header_invalid').equals(snapshotDecimal(source, captured, 'aiu_source_header_invalid')))) {
    sourceMismatch(source, 'aiu_original_header_amount_mismatch');
  }

  const actualTaxRows = calculated.lines.flatMap((line) => line.taxes);
  const expectedTaxByKey = sourceTaxAggregate(source.invoice_taxes);
  const actualTaxByKey = aggregateTaxRows(source, actualTaxRows);
  if (expectedTaxByKey.size !== actualTaxByKey.size) {
    sourceMismatch(source, 'aiu_original_tax_row_count_mismatch');
  }
  for (const [key, expected] of expectedTaxByKey) {
    const actual = actualTaxByKey.get(key);
    if (!actual || !expected.taxable.equals(actual.taxable) || !expected.tax.equals(actual.tax)) {
      sourceMismatch(source, 'aiu_original_tax_amount_mismatch');
    }
  }

  const sourceMatrix = source.aiu_taxable_matrix as Record<string, unknown>;
  const rebuiltMatrix = buildRecalculatedAiuMatrix(source, calculated, aiu) as Record<string, unknown>;
  const canonicalComponents = (value: unknown): string[] => {
    if (!Array.isArray(value)) sourceMismatch(source, 'aiu_matrix_components_missing');
    return value.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        sourceMismatch(source, 'aiu_matrix_component_invalid');
      }
      const component = raw as Record<string, unknown>;
      if (
        typeof component['component'] !== 'string' ||
        typeof component['taxable'] !== 'boolean' ||
        !Number.isSafeInteger(component['lines']) ||
        !Array.isArray(component['rates'])
      ) {
        sourceMismatch(source, 'aiu_matrix_component_invalid');
      }
      const rates = component['rates'].map((rateValue: unknown) => {
        if (!rateValue || typeof rateValue !== 'object' || Array.isArray(rateValue)) {
          sourceMismatch(source, 'aiu_matrix_rate_invalid');
        }
        const rate = rateValue as Record<string, unknown>;
        const taxType = rate['tax_type'];
        const dianTaxCode = rate['dian_tax_code'];
        const rateBasis = rate['rate_basis'];
        if (
          typeof taxType !== 'string' ||
          typeof dianTaxCode !== 'string' ||
          (rateBasis !== 'percent' && rateBasis !== 'per_mil')
        ) {
          sourceMismatch(source, 'aiu_matrix_rate_invalid');
        }
        const expectedRateBasis = taxType === 'ica' || taxType === 'reteica' ? 'per_mil' : 'percent';
        if (rateBasis !== expectedRateBasis || !dianTaxCode.trim()) {
          sourceMismatch(source, 'aiu_matrix_rate_invalid');
        }
        const numericRate = snapshotDecimal(source, rate['tax_rate'], 'aiu_matrix_rate_invalid');
        const normalizedRate = normalizeInvoiceTaxRate(numericRate, taxType);
        return `${taxType}|${dianTaxCode}|${rateBasis}|${normalizedRate.toFixed(2)}`;
      }).sort();
      return JSON.stringify({
        component: component['component'],
        taxable: component['taxable'],
        lines: component['lines'],
        taxable_amount: snapshotDecimal(source, component['taxable_amount'], 'aiu_matrix_base_invalid').toFixed(2),
        tax_amount: snapshotDecimal(source, component['tax_amount'], 'aiu_matrix_tax_invalid').toFixed(2),
        rates,
      });
    }).sort();
  };
  if (
    JSON.stringify(canonicalComponents(sourceMatrix['components'])) !==
    JSON.stringify(canonicalComponents(rebuiltMatrix['components']))
  ) {
    sourceMismatch(source, 'aiu_original_matrix_component_mismatch');
  }
  const sourceWithoutRate = sourceMatrix['taxable_without_rate'];
  const rebuiltWithoutRate = rebuiltMatrix['taxable_without_rate'];
  if (
    !Array.isArray(sourceWithoutRate) ||
    !Array.isArray(rebuiltWithoutRate) ||
    JSON.stringify([...sourceWithoutRate].sort()) !== JSON.stringify([...rebuiltWithoutRate].sort())
  ) {
    sourceMismatch(source, 'aiu_original_matrix_missing_rate_mismatch');
  }
}

function buildRecalculatedAiuMatrix(
  source: NoteSourceInvoiceSnapshot,
  calculated: InvoiceCalculatorResult,
  aiu: InvoiceCalculatorAiuInput,
): Prisma.InputJsonValue {
  const frozen = source.aiu_taxable_matrix;
  if (!frozen || typeof frozen !== 'object' || Array.isArray(frozen)) {
    return sourceMismatch(source, 'aiu_matrix_missing_for_recalculation');
  }
  const snapshot = frozen as Record<string, unknown>;
  const grouped = new Map<string, {
    component: string;
    taxable: boolean;
    lines: number;
    taxable_amount: Prisma.Decimal;
    tax_amount: Prisma.Decimal;
    rates: Array<{ tax_type: string; dian_tax_code: string; tax_rate: string; rate_basis: string }>;
  }>();
  for (const line of calculated.lines) {
    const component = line.aiu_component;
    if (!component) continue;
    const taxable = !line.omit_tax_total;
    const entry = grouped.get(component) ?? {
      component,
      taxable,
      lines: 0,
      taxable_amount: new Prisma.Decimal(0),
      tax_amount: new Prisma.Decimal(0),
      rates: [],
    };
    if (entry.taxable !== taxable) {
      sourceMismatch(source, 'aiu_recalculated_component_taxability_conflict');
    }
    entry.lines += 1;
    entry.taxable_amount = entry.taxable_amount.plus(line.taxable_amount);
    entry.tax_amount = entry.tax_amount.plus(line.tax_amount);
    for (const tax of line.taxes) {
      const key = `${tax.tax_type}|${tax.dian_tax_code}|${tax.tax_rate}|${tax.rate_basis}`;
      if (entry.rates.some((rate) => `${rate.tax_type}|${rate.dian_tax_code}|${rate.tax_rate}|${rate.rate_basis}` === key)) continue;
      entry.rates.push({
        tax_type: tax.tax_type,
        dian_tax_code: tax.dian_tax_code,
        tax_rate: tax.tax_rate,
        rate_basis: tax.rate_basis,
      });
    }
    grouped.set(component, entry);
  }
  const components = [...grouped.values()].map((entry) => ({
    component: entry.component,
    taxable: entry.taxable,
    lines: entry.lines,
    taxable_amount: entry.taxable_amount.toFixed(2),
    tax_amount: entry.tax_amount.toFixed(2),
    rates: entry.rates,
  }));
  return {
    ...snapshot,
    taxable_basis: aiu.taxable_basis,
    regime: snapshot['regime'],
    minimum: snapshot['minimum'],
    components,
    taxable_without_rate: components
      .filter((component) => component.taxable && component.rates.length === 0)
      .map((component) => component.component),
  } as Prisma.InputJsonValue;
}

function mapTaxRow(row: {
  tax_rate_id?: number | null;
  tax_name: string;
  tax_type: string;
  tax_rate: string;
  taxable_amount: string;
  tax_amount: string;
  is_inclusive: boolean;
}, line_index?: number): RecalculatedNote['taxes'][number] {
  const mapped = buildInvoiceTaxCreateInput({
    tax_rate_id: row.tax_rate_id,
    tax_name: row.tax_name,
    tax_type: row.tax_type,
    tax_rate: row.tax_rate,
    taxable_amount: amount(row.taxable_amount, 'tax.taxable_amount', 2),
    tax_amount: amount(row.tax_amount, 'tax.tax_amount', 2),
    is_inclusive: row.is_inclusive,
  });
  return line_index === undefined ? mapped : { ...mapped, line_index };
}

/**
 * Pure server-side note orchestration. All persistence data and balance
 * candidates are derived from the calculator result; request/source snapshots
 * are inputs only and are never copied around the calculator.
 */
export function recalculateNote(
  calculator: InvoiceCalculatorService,
  source: NoteSourceInvoiceSnapshot,
  items?: readonly CreateInvoiceNoteItemDto[],
  options: ResolveNoteSourceOptions = {},
): RecalculatedNote {
  const trusted_reversal = items === undefined;
  const frozen_aiu = trusted_reversal ? undefined : resolveFrozenNoteAiuInput(source);
  const resolverOptions: ResolveNoteSourceOptions = {
    ...options,
    ...(!trusted_reversal && frozen_aiu !== undefined ? { frozen_aiu } : {}),
  };
  const resolved_lines = resolveNoteSourceLines(source, items, resolverOptions);
  if (!trusted_reversal && frozen_aiu) {
    // Rebuild the source's complete original economics from frozen line/tax
    // snapshots before considering any edited quantity, price, or discount.
    // Header allowances are allocated by the same source resolver used for
    // the selected note lines, not guessed from the current profile/settings.
    const original_lines = resolveNoteSourceLines(
      source,
      source.invoice_items.map((line) => ({
        source_invoice_item_id: line.id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
      })),
      resolverOptions,
    );
    const original = calculator.calculate({
      items: original_lines.map((line) => line.calculator_input),
      mode: 'computed',
      aiu: frozen_aiu,
    });
    try {
      assertCalculatorResult(original, source);
    } catch (error) {
      if (!(error instanceof VendixHttpException)) throw error;
      sourceMismatch(source, 'aiu_original_calculation_divergence', undefined, error.errorCode);
    }
    assertOriginalAiuReproducesSource(source, original, original_lines, frozen_aiu);
  }
  const calculated = calculator.calculate(
    trusted_reversal
      ? {
          items: resolved_lines.map((line) => line.calculator_input),
          mode: 'trusted_snapshot_reversal',
          trusted_snapshot: buildTrustedNoteSnapshot(source, resolved_lines),
        }
      : {
          items: resolved_lines.map((line) => line.calculator_input),
          mode: 'computed',
          ...(frozen_aiu === undefined ? {} : { aiu: frozen_aiu }),
        },
  );
  assertCalculatorResult(calculated, source);

  if (calculated.lines.length !== resolved_lines.length) {
    calculationFailure('INVOICING_CALC_006', {
      detail: 'calculator_line_count_mismatch',
      expected: resolved_lines.length,
      received: calculated.lines.length,
    });
  }

  const calculatedAmounts = calculated.lines.map((line, index) => ({
    quantity: amount(resolved_lines[index]?.item.quantity ?? 0, `lines[${index}].quantity`, 4),
    unit_price: amount(resolved_lines[index]?.item.unit_price ?? 0, `lines[${index}].unit_price`, 2),
    discount_amount: amount(line.discount_amount, `lines[${index}].discount_amount`, 2),
    line_extension_amount: amount(line.line_extension_amount, `lines[${index}].line_extension_amount`, 2),
    tax_amount: amount(line.tax_amount, `lines[${index}].tax_amount`, 2),
    is_inclusive: line.is_inclusive,
    total_amount: amount(line.total_amount, `lines[${index}].total_amount`, 2),
  }));

  const persistedItems = resolved_lines.map((resolved, index) => {
    const line = calculated.lines[index];
    const figures = calculatedAmounts[index];
    if (!line || !figures) {
      calculationFailure('INVOICING_CALC_006', { detail: 'calculator_line_missing', line_index: index });
    }
    const mapped = buildInvoiceItemCreateInput(
      resolved.item,
      figures,
      {
        price_unit_quantity: resolved.item.price_unit_quantity,
        unit_code: resolved.item.unit_code,
        account_code: resolved.item.account_code ?? undefined,
      },
    );
    return {
      ...mapped,
      quantity: figures.quantity,
      unit_price: figures.unit_price,
      source_invoice_item_id: resolved.item.source_invoice_item_id,
      stock_units_consumed: resolved.item.stock_units_consumed,
      serial_numbers_snapshot: resolved.item.serial_numbers_snapshot,
      financial_source_line_id: resolved.item.financial_source_line_id,
      applied_price_tier_name: resolved.item.applied_price_tier_name ?? null,
    };
  });

  let taxes: RecalculatedNote['taxes'];
  if (trusted_reversal) {
    const exactRows = calculated.trusted_snapshot_tax_rows;
    if (!exactRows) {
      calculationFailure('INVOICING_CALC_006', { detail: 'trusted_tax_rows_missing' });
    }
    taxes = exactRows.map((row) => mapTaxRow(row, row.line_index));
  } else {
    const lineTaxInputs = calculated.lines.map((line) => ({
      omit_tax_total: line.omit_tax_total,
      taxable_amount: line.taxable_amount,
      line_extension_amount: line.line_extension_amount,
    }));
    if (needsPersistedLineTaxes(calculated.header_taxes, lineTaxInputs)) {
      taxes = calculated.lines.flatMap((line) =>
        line.taxes.map((row) => mapTaxRow(row, line.index)),
      );
    } else {
      taxes = calculated.header_taxes.map((row) => mapTaxRow(row));
    }
  }

  const subtotal_amount = amount(calculated.totals.total_before_tax, 'subtotal_amount', 2);
  const discount_amount = amount(calculated.totals.discount_amount, 'discount_amount', 2);
  const tax_amount = amount(calculated.totals.tax_amount, 'tax_amount', 2);
  const total_amount = amount(calculated.totals.total_amount, 'total_amount', 2);
  const candidate = buildCreditNoteCandidate({
    total_amount,
    tax_amount,
    invoice_items: calculated.lines.map((line, index) => ({
      source_invoice_item_id: resolved_lines[index]?.item.source_invoice_item_id ?? 0,
      quantity: calculatedAmounts[index]?.quantity ?? 0,
      tax_amount: line.tax_amount,
      total_amount: line.total_amount,
    })),
  });

  const aiu_taxable_matrix = !trusted_reversal && frozen_aiu
    ? buildRecalculatedAiuMatrix(source, calculated, frozen_aiu)
    : undefined;

  return {
    resolved_lines,
    calculated,
    items: persistedItems,
    taxes,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount,
    candidate,
    ...(aiu_taxable_matrix === undefined ? {} : { aiu_taxable_matrix }),
  };
}
