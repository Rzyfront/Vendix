import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import type { CreateInvoiceNoteItemDto } from './dto/create-invoice-note-item.dto';
import {
  buildCreditNoteCandidate,
  type CreditNoteCandidate,
} from './credit-note-balance.service';
import {
  buildTrustedNoteSnapshot,
  resolveNoteSourceLines,
  type NoteSourceInvoiceSnapshot,
  type ResolveNoteSourceOptions,
  type ResolvedNoteSourceLine,
} from './note-source-resolver.util';
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
  const resolved_lines = resolveNoteSourceLines(source, items, options);
  const trusted_reversal = items === undefined;
  const calculated = calculator.calculate(
    trusted_reversal
      ? {
          items: resolved_lines.map((line) => line.calculator_input),
          mode: 'trusted_snapshot_reversal',
          trusted_snapshot: buildTrustedNoteSnapshot(source, resolved_lines),
        }
      : { items: resolved_lines.map((line) => line.calculator_input), mode: 'computed' },
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
  };
}
