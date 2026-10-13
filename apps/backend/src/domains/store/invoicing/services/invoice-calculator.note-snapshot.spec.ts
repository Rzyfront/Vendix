import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import {
  allocateNoteDocumentAllowance,
  InvoiceCalculatorService,
} from './invoice-calculator.service';
import type {
  TrustedInvoiceReversalSnapshot,
  TrustedInvoiceReversalTax,
} from './invoice-calculator.service';

const calculator = new InvoiceCalculatorService();

const tax = (
  overrides: Partial<TrustedInvoiceReversalTax> = {},
): TrustedInvoiceReversalTax => ({
  tax_name: 'IVA',
  tax_rate: '19',
  tax_type: 'iva',
  taxable_amount: '100.00',
  tax_amount: '19.00',
  ...overrides,
});

describe('InvoiceCalculatorService trusted snapshot reversal', () => {
  it('keeps exact source header amounts and exposes the 200.00 document allowance', () => {
    const source: TrustedInvoiceReversalSnapshot = {
      lines: [
        {
          quantity: 1,
          unit_price: 1152,
          discount_amount: 0,
          tax_amount: 0,
          total_amount: 1152,
          line_extension_amount: 1152,
        },
      ],
      taxes: [],
      subtotal_amount: 952,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: 952,
    };

    const result = calculator.calculate({
      items: [],
      mode: 'trusted_snapshot_reversal',
      trusted_snapshot: source,
    });

    expect(result.lines[0].line_extension_amount).toBe('1152.00');
    expect(result.totals.total_before_tax).toBe('952.00');
    expect(result.totals.document_allowance_amount).toBe('200.00');
    expect(result.totals.discount_amount).toBe('0.00');
    expect(result.totals.total_amount).toBe('952.00');
    expect(result.divergences).toEqual([]);
  });

  it('preserves source cent amounts, fractional quantity, divisor, and inclusive price', () => {
    const source: TrustedInvoiceReversalSnapshot = {
      lines: [
        {
          quantity: '0.5',
          unit_price: '40.00',
          price_unit_quantity: 2,
          discount_amount: '1.00',
          tax_amount: '1.79',
          total_amount: '8.99',
          line_extension_amount: '7.20',
          is_inclusive: true,
          taxes: [
            tax({
              tax_rate: '25',
              taxable_amount: '7.20',
              tax_amount: '1.79',
            }),
          ],
        },
      ],
      taxes: [],
      subtotal_amount: '7.20',
      discount_amount: '1.00',
      tax_amount: '1.79',
      total_amount: '8.99',
      prepaid_amount: '0.01',
    };

    const result = calculator.calculate({
      items: [],
      mode: 'trusted_snapshot_reversal',
      trusted_snapshot: source,
    });

    expect(result.lines[0].gross_amount).toBe('10.00');
    expect(result.lines[0].is_inclusive).toBe(true);
    expect(result.lines[0].line_extension_amount).toBe('7.20');
    expect(result.lines[0].tax_amount).toBe('1.79');
    expect(result.lines[0].taxes[0].tax_amount).toBe('1.79');
    expect(result.totals.discount_amount).toBe('1.00');
    expect(result.totals.tax_amount).toBe('1.79');
    expect(result.totals.total_amount).toBe('8.99');
    expect(result.totals.prepaid_amount).toBe('0.01');
  });

  it('retains multiple frozen tax quotas on one line without recalculating them', () => {
    const result = calculator.calculate({
      items: [],
      mode: 'trusted_snapshot_reversal',
      trusted_snapshot: {
        lines: [
          {
            quantity: 1,
            unit_price: 100,
            discount_amount: 0,
            tax_amount: 27,
            total_amount: 127,
            line_extension_amount: 100,
          },
        ],
        taxes: [
          tax({ line_index: 0, tax_rate: 19, taxable_amount: 100, tax_amount: 19 }),
          tax({
            line_index: 0,
            tax_name: 'INC',
            tax_type: 'inc',
            tax_rate: 8,
            taxable_amount: 100,
            tax_amount: 8,
          }),
        ],
        subtotal_amount: 100,
        discount_amount: 0,
        tax_amount: 27,
        total_amount: 127,
      },
    });

    expect(result.lines[0].taxes.map((row) => row.tax_amount)).toEqual([
      '19.00',
      '8.00',
    ]);
    expect(result.tax_schemes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dian_tax_code: '01', tax_amount: '19.00' }),
        expect.objectContaining({ dian_tax_code: '04', tax_amount: '8.00' }),
      ]),
    );
    expect(result.totals.tax_amount).toBe('27.00');
  });

  it('reports missing trusted snapshot as a typed divergence, not an exception', () => {
    const result = calculator.calculate({
      items: [],
      mode: 'trusted_snapshot_reversal',
    });

    expect(result.divergences[0]).toEqual(
      expect.objectContaining({ scope: 'missing_trusted_snapshot' }),
    );
    expect(result.totals.total_amount).toBe('0.00');
  });

  it('keeps default computed calculation unchanged', () => {
    const result = calculator.calculate({
      items: [
        {
          quantity: 1,
          unit_price: 100,
          taxes: [{ tax_name: 'IVA', tax_type: 'iva', tax_rate: 19 }],
        },
      ],
    });

    expect(result.totals.total_before_tax).toBe('100.00');
    expect(result.totals.tax_amount).toBe('19.00');
    expect(result.totals.total_amount).toBe('119.00');
    expect(result.totals.document_allowance_amount).toBeUndefined();
  });
});

describe('allocateNoteDocumentAllowance', () => {
  it('allocates proportionally in cents with exact closure and id tie-break', () => {
    const allocation = allocateNoteDocumentAllowance('5000.00', [
      { id: 2, base_amount: '22500.00' },
      { id: 1, base_amount: '22500.00' },
    ]);

    expect(allocation?.get(1)?.equals(new Prisma.Decimal('2500.00'))).toBe(true);
    expect(allocation?.get(2)?.equals(new Prisma.Decimal('2500.00'))).toBe(true);

    const cent_allocation = allocateNoteDocumentAllowance('0.02', [
      { id: 2, base_amount: '1.00' },
      { id: 1, base_amount: '1.00' },
      { id: 3, base_amount: '1.00' },
    ]);
    expect(cent_allocation?.get(1)?.equals(new Prisma.Decimal('0.01'))).toBe(true);
    expect(cent_allocation?.get(2)?.equals(new Prisma.Decimal('0.01'))).toBe(true);
    expect(cent_allocation?.get(3)?.equals(new Prisma.Decimal('0.00'))).toBe(true);
  });

  it.each([
    ['negative allowance', '-0.01', [{ id: 1, base_amount: '10.00' }]],
    ['allowance above source bases', '10.01', [{ id: 1, base_amount: '10.00' }]],
    ['duplicate source ids', '1.00', [{ id: 1, base_amount: '2.00' }, { id: 1, base_amount: '2.00' }]],
    ['negative source base', '1.00', [{ id: 1, base_amount: '-2.00' }]],
  ])('returns null for %s', (_label, amount, lines) => {
    expect(allocateNoteDocumentAllowance(amount, lines)).toBeNull();
  });
});
