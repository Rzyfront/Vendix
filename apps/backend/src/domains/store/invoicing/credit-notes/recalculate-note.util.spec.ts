import { Prisma } from '@prisma/client';
import { VendixHttpException } from 'src/common/errors';
import type {
  CalculatedTax,
  InvoiceCalculatorResult,
} from '../services/invoice-calculator.service';
import { InvoiceCalculatorService } from '../services/invoice-calculator.service';
import type { NoteSourceInvoiceSnapshot } from './note-source-resolver.util';
import { recalculateNote } from './recalculate-note.util';

function sourceInvoice(overrides: Partial<NoteSourceInvoiceSnapshot> = {}): NoteSourceInvoiceSnapshot {
  return {
    id: 50,
    organization_id: 4,
    store_id: 8,
    accounting_entity_id: 12,
    invoice_items: [{
      id: 501,
      invoice_id: 50,
      product_id: 10,
      product_variant_id: 11,
      description: 'Caja x12',
      quantity: new Prisma.Decimal(2),
      unit_price: new Prisma.Decimal(270000),
      discount_amount: new Prisma.Decimal(0),
      tax_amount: new Prisma.Decimal(0),
      total_amount: new Prisma.Decimal(45000),
      is_inclusive: false,
      price_unit_quantity: 12,
      unit_code: 'NIU',
      account_code: '413595',
      stock_units_consumed: 24,
      serial_numbers_snapshot: 'S1,S2',
      aiu_component: null,
      financial_source_line_id: 22,
      applied_price_tier_name: 'Caja 12',
    }],
    invoice_taxes: [],
    subtotal_amount: new Prisma.Decimal(45000),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(0),
    total_amount: new Prisma.Decimal(45000),
    ...overrides,
  };
}

function calcResult(input: {
  quantity?: string;
  discount?: string;
  base?: string;
  tax?: string;
  total?: string;
  headerTaxes?: CalculatedTax[];
  lineTaxes?: CalculatedTax[];
  trustedRows?: Array<CalculatedTax & { line_index?: number }>;
} = {}): InvoiceCalculatorResult {
  const discount = input.discount ?? '0.00';
  const base = input.base ?? '22500.00';
  const tax = input.tax ?? '0.00';
  const total = input.total ?? '22500.00';
  const gross = input.quantity === '2' ? '45000.00' : '22500.00';
  return {
    lines: [{
      index: 0,
      description: 'Caja x12',
      gross_amount: gross,
      discount_amount: discount,
      net_entered_amount: base,
      line_extension_amount: base,
      taxes: input.lineTaxes ?? [],
      tax_amount: tax,
      total_amount: total,
      is_inclusive: false,
      aiu_component: null,
      omit_tax_total: false,
      taxable_amount: base,
    }],
    header_taxes: input.headerTaxes ?? [],
    tax_schemes: [],
    withholdings: [],
    divergences: [],
    trusted_snapshot_tax_rows: input.trustedRows,
    totals: {
      gross_subtotal: '22500.00',
      discount_amount: discount,
      total_before_tax: base,
      tax_amount: tax,
      tax_iva: tax,
      tax_inc: '0.00',
      tax_ica: '0.00',
      tax_other: '0.00',
      tax_inclusive_amount: total,
      total_amount: total,
      withholding_amount: '0.00',
      prepaid_amount: '0.00',
    },
  } as InvoiceCalculatorResult;
}

function calculatorWith(result: InvoiceCalculatorResult) {
  const calculator = { calculate: jest.fn().mockReturnValue(result) };
  return calculator as unknown as InvoiceCalculatorService & { calculate: jest.Mock };
}

const tax = (overrides: Partial<CalculatedTax> = {}): CalculatedTax => ({
  tax_rate_id: 9,
  tax_name: 'IVA 19%',
  tax_type: 'iva',
  dian_tax_code: '01',
  tax_rate: '19',
  rate_basis: 'percent',
  is_inclusive: false,
  taxable_amount: '20000.00',
  tax_amount: '3800.00',
  ...overrides,
});

describe('recalculateNote', () => {
  it('sends explicit selected commercial values through computed mode and persists calculator output', () => {
    const result = calcResult({ base: '20000.00', tax: '3800.00', total: '23800.00', headerTaxes: [tax()] });
    const calculator = calculatorWith(result);
    const output = recalculateNote(calculator, sourceInvoice(), [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 270000,
      discount_amount: 2500,
    }]);

    expect(calculator.calculate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'computed',
      items: [expect.objectContaining({ quantity: new Prisma.Decimal(1), unit_price: new Prisma.Decimal(270000), discount_amount: new Prisma.Decimal(2500) })],
    }));
    expect(output.items[0]).toMatchObject({
      source_invoice_item_id: 501,
      quantity: new Prisma.Decimal(1),
      discount_amount: new Prisma.Decimal(2500),
      tax_amount: new Prisma.Decimal(3800),
      total_amount: new Prisma.Decimal(23800),
      account_code: '413595',
      price_unit_quantity: 12,
      unit_code: 'NIU',
      serial_numbers_snapshot: 'S1,S2',
      financial_source_line_id: 22,
      applied_price_tier_name: 'Caja 12',
    });
    expect(output.taxes).toHaveLength(1);
    expect(output.candidate.lines[0]?.base_amount).toEqual(new Prisma.Decimal(20000));
    expect(output.total_amount).toEqual(new Prisma.Decimal(23800));
  });

  it('uses exact trusted reversal and consumes non-aggregated source tax rows', () => {
    const sourceTax = tax({ taxable_amount: '45000.00', tax_amount: '8550.00' });
    const source = sourceInvoice({
      invoice_items: [{
        ...sourceInvoice().invoice_items[0],
        tax_amount: new Prisma.Decimal(8550),
        total_amount: new Prisma.Decimal(53550),
      }],
      invoice_taxes: [{
        invoice_item_id: 501,
        tax_rate_id: 9,
        tax_name: 'IVA 19%',
        tax_type: 'iva',
        tax_rate: new Prisma.Decimal(19),
        taxable_amount: new Prisma.Decimal(45000),
        tax_amount: new Prisma.Decimal(8550),
        is_inclusive: true,
      }],
      subtotal_amount: new Prisma.Decimal(45000),
      tax_amount: new Prisma.Decimal(8550),
      total_amount: new Prisma.Decimal(53550),
    });
    const calculator = calculatorWith(calcResult({
      quantity: '2',
      base: '45000.00',
      tax: '8550.00',
      total: '53550.00',
      trustedRows: [{ ...sourceTax, line_index: 0 }],
    }));
    const output = recalculateNote(calculator, source);

    expect(calculator.calculate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'trusted_snapshot_reversal' }));
    expect(output.taxes).toHaveLength(1);
    expect(output.taxes[0]).toMatchObject({ line_index: 0, tax_amount: new Prisma.Decimal(8550) });
    expect(output.items[0]?.total_amount).toEqual(new Prisma.Decimal(53550));
    expect(output.discount_amount).toEqual(new Prisma.Decimal(0));
  });

  it('passes the deterministic exclusive document allowance into the calculation for selected source lines', () => {
    const base = {
      ...sourceInvoice().invoice_items[0]!,
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal(22500),
      price_unit_quantity: 1,
      total_amount: new Prisma.Decimal(22500),
    };
    const source = sourceInvoice({
      invoice_items: [base, { ...base, id: 502, description: 'Otra caja' }],
      subtotal_amount: new Prisma.Decimal(40000),
      discount_amount: new Prisma.Decimal(5000),
      total_amount: new Prisma.Decimal(40000),
    });
    const result = calcResult({ base: '20000.00', total: '20000.00' });
    const secondLine = { ...result.lines[0]!, index: 1, description: 'Otra caja' };
    result.lines = [result.lines[0]!, secondLine];
    result.totals.total_before_tax = '40000.00';
    result.totals.total_amount = '40000.00';
    result.totals.tax_inclusive_amount = '40000.00';
    result.totals.gross_subtotal = '45000.00';
    const calculator = calculatorWith(result);
    recalculateNote(calculator, source, [
      { source_invoice_item_id: 501, quantity: 1, unit_price: 22500 },
      { source_invoice_item_id: 502, quantity: 1, unit_price: 22500 },
    ]);

    expect(calculator.calculate).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({ discount_amount: new Prisma.Decimal(2500) }),
      ]),
    }));
    expect((calculator.calculate as jest.Mock).mock.calls[0][0].items.map((line: { discount_amount: Prisma.Decimal }) => line.discount_amount.toString())).toEqual(['2500', '2500']);
  });

  it('applies inclusive allowance in captured-price space before proportional partial quantity discount', () => {
    const item = {
      ...sourceInvoice().invoice_items[0]!,
      quantity: new Prisma.Decimal(2),
      unit_price: new Prisma.Decimal(26775),
      discount_amount: new Prisma.Decimal(0),
      tax_amount: new Prisma.Decimal(7600),
      total_amount: new Prisma.Decimal(52600),
      is_inclusive: true,
      price_unit_quantity: 1,
    };
    const source = sourceInvoice({
      invoice_items: [item],
      invoice_taxes: [{
        invoice_item_id: null,
        tax_name: 'IVA',
        tax_type: 'iva',
        tax_rate: new Prisma.Decimal(19),
        taxable_amount: new Prisma.Decimal(40000),
        tax_amount: new Prisma.Decimal(7600),
        is_inclusive: true,
      }],
      subtotal_amount: new Prisma.Decimal(40000),
      discount_amount: new Prisma.Decimal(5000),
      tax_amount: new Prisma.Decimal(7600),
      total_amount: new Prisma.Decimal(47600),
    });
    const result = calcResult({
      discount: '2975.00',
      base: '20000.00',
      tax: '3800.00',
      total: '23800.00',
      headerTaxes: [tax({ taxable_amount: '20000.00', tax_amount: '3800.00', is_inclusive: true })],
    });
    const calculator = calculatorWith(result);
    const output = recalculateNote(calculator, source, [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 26775,
    }]);

    expect((calculator.calculate as jest.Mock).mock.calls[0][0].items[0].discount_amount.toString()).toBe('2975');
    expect(output.items[0]?.discount_amount).toEqual(new Prisma.Decimal('2975.00'));
    expect(output.items[0]?.total_amount).toEqual(new Prisma.Decimal('23800.00'));
  });

  it('persists frozen multi-tax line rows once with the resolved line index', () => {
    const source = sourceInvoice({
      invoice_items: [{
        ...sourceInvoice().invoice_items[0]!,
        tax_amount: new Prisma.Decimal(12150),
        total_amount: new Prisma.Decimal(57150),
      }],
      invoice_taxes: [
        { invoice_item_id: 501, tax_rate_id: 1, tax_name: 'IVA', tax_type: 'iva', tax_rate: new Prisma.Decimal(19), taxable_amount: new Prisma.Decimal(45000), tax_amount: new Prisma.Decimal(8550), is_inclusive: false },
        { invoice_item_id: 501, tax_rate_id: 2, tax_name: 'INC', tax_type: 'inc', tax_rate: new Prisma.Decimal(8), taxable_amount: new Prisma.Decimal(45000), tax_amount: new Prisma.Decimal(3600), is_inclusive: false },
      ],
      subtotal_amount: new Prisma.Decimal(45000),
      tax_amount: new Prisma.Decimal(12150),
      total_amount: new Prisma.Decimal(57150),
    });
    const iva = tax({ taxable_amount: '22500.00', tax_amount: '4275.00' });
    const inc = tax({ tax_name: 'INC', tax_type: 'inc', tax_rate: '8', dian_tax_code: '04', taxable_amount: '22500.00', tax_amount: '1800.00' });
    const result = calcResult({
      base: '22500.00', tax: '6075.00', total: '28575.00',
      headerTaxes: [iva, inc], lineTaxes: [iva, inc],
    });
    const calculator = calculatorWith(result);
    const output = recalculateNote(calculator, source, [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 270000,
    }]);

    expect(output.taxes).toHaveLength(2);
    expect(output.taxes.map((row) => row.line_index)).toEqual([0, 0]);
    expect(output.taxes.reduce((sum, row) => sum.plus(row.tax_amount), new Prisma.Decimal(0))).toEqual(new Prisma.Decimal(6075));
  });

  it('rejects explicit empty and foreign source selections before calling the calculator', () => {
    const calculator = calculatorWith(calcResult());
    expect(() => recalculateNote(calculator, sourceInvoice(), [])).toThrow(VendixHttpException);
    expect(() => recalculateNote(calculator, sourceInvoice(), [{
      source_invoice_item_id: 999,
      quantity: 1,
      unit_price: 10,
    }])).toThrow(VendixHttpException);
    expect(calculator.calculate).not.toHaveBeenCalled();
  });

  it('fails closed when a calculated monetary value exceeds database precision', () => {
    const result = calcResult({ total: '10000000000.00' });
    result.totals.total_amount = '10000000000.00';
    result.totals.tax_inclusive_amount = '10000000000.00';
    const calculator = calculatorWith(result);
    expect(() => recalculateNote(calculator, sourceInvoice(), [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 22500,
    }])).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_006' }));
  });

  it('routes an unreachable inclusive calculation to the dedicated calculator error', () => {
    const result = calcResult();
    result.divergences = [{
      scope: 'unclosed_residual',
      line_index: 0,
      expected: '10.00',
      received: '9.99',
      difference: '-0.01',
    }];
    const calculator = calculatorWith(result);
    expect(() => recalculateNote(calculator, sourceInvoice(), [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 22500,
    }])).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_005' }));
  });

  it('rejects an explicit discount above captured gross when the calculator marks invalid input', () => {
    const result = calcResult();
    result.divergences = [{
      scope: 'invalid_line_input',
      line_index: 0,
      detail: 'discount:exceeds_gross',
      expected: '0.00',
      received: '99999.00',
      difference: '99999.00',
    }];
    const calculator = calculatorWith(result);
    expect(() => recalculateNote(calculator, sourceInvoice(), [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 22500,
      discount_amount: 99999,
    }])).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_006' }));
  });

  it('fails closed on an unknown blocking calculator divergence instead of persisting its corrected output', () => {
    const result = calcResult();
    result.divergences = [{
      scope: 'new_blocking_tax_scope' as InvoiceCalculatorResult['divergences'][number]['scope'],
      line_index: 0,
      expected: '0.00',
      received: '0.01',
      difference: '0.01',
    }];
    const calculator = calculatorWith(result);
    expect(() => recalculateNote(calculator, sourceInvoice(), [{
      source_invoice_item_id: 501,
      quantity: 1,
      unit_price: 22500,
    }])).toThrow(expect.objectContaining({ errorCode: 'INVOICING_CALC_006' }));
  });
});
