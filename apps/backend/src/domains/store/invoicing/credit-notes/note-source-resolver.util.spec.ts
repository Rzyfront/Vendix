import { Prisma } from '@prisma/client';
import { VendixHttpException } from 'src/common/errors';
import {
  buildTrustedNoteSnapshot,
  resolveNoteSourceLines,
} from './note-source-resolver.util';
import type { NoteSourceInvoiceSnapshot } from './note-source-resolver.util';
import type { CreateInvoiceNoteItemDto } from './dto/create-invoice-note-item.dto';

function sourceInvoice(
  overrides: Partial<NoteSourceInvoiceSnapshot> = {},
): NoteSourceInvoiceSnapshot {
  return {
    id: 50,
    organization_id: 4,
    store_id: 8,
    accounting_entity_id: 12,
    invoice_items: [
      {
        id: 501,
        invoice_id: 50,
        product_id: 10,
        product_variant_id: 11,
        description: 'Caja x12',
        quantity: new Prisma.Decimal(2),
        unit_price: new Prisma.Decimal(22500),
        discount_amount: new Prisma.Decimal(0),
        tax_amount: new Prisma.Decimal(0),
        total_amount: new Prisma.Decimal(45000),
        is_inclusive: false,
        price_unit_quantity: 1,
        unit_code: 'NIU',
        account_code: '413595',
        stock_units_consumed: 24,
        serial_numbers_snapshot: 'SER-1,SER-2',
        aiu_component: null,
        financial_source_line_id: 22,
      },
    ],
    invoice_taxes: [],
    subtotal_amount: new Prisma.Decimal(45000),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(0),
    total_amount: new Prisma.Decimal(45000),
    ...overrides,
  };
}

function noteItem(
  source_invoice_item_id: number,
  overrides: Partial<{
    quantity: number;
    unit_price: number;
    discount_amount: number;
    unit_code: string;
  }> = {},
) {
  return {
    source_invoice_item_id,
    quantity: overrides.quantity ?? 1,
    unit_price: overrides.unit_price ?? 22500,
    ...(overrides.discount_amount === undefined
      ? {}
      : { discount_amount: overrides.discount_amount }),
    ...(overrides.unit_code === undefined ? {} : { unit_code: overrides.unit_code }),
  };
}

describe('note-source-resolver.util', () => {
  it('rejects missing/foreign source ids and duplicate source selections as SOURCE', () => {
    const source = sourceInvoice();
    expect(() => resolveNoteSourceLines(source, [noteItem(999)])).toThrow(
      VendixHttpException,
    );
    expect(() =>
      resolveNoteSourceLines(source, [noteItem(501), noteItem(501)]),
    ).toThrow(VendixHttpException);
    expect(() => resolveNoteSourceLines(source, [])).toThrow(VendixHttpException);

    const foreignItem = { ...source.invoice_items[0], invoice_id: 99 };
    expect(() =>
      resolveNoteSourceLines({ ...source, invoice_items: [foreignItem] }),
    ).toThrow(VendixHttpException);
  });

  it('allocates a header allowance deterministically and preserves pack/source snapshots', () => {
    const base = sourceInvoice();
    const first = {
      ...base.invoice_items[0],
      quantity: new Prisma.Decimal(1),
      total_amount: new Prisma.Decimal(22500),
    };
    const second = { ...first, id: 502, description: 'Otra caja' };
    const source = sourceInvoice({
      invoice_items: [first, second],
      subtotal_amount: new Prisma.Decimal(40000),
      discount_amount: new Prisma.Decimal(5000),
      total_amount: new Prisma.Decimal(40000),
    });

    const total = resolveNoteSourceLines(source);
    expect(total[0].item.discount_amount.toString()).toBe('0');
    expect(total[0].original_base.toString()).toBe('22500');
    expect(total[0].requires_trusted_snapshot).toBe(true);

    const result = resolveNoteSourceLines(source, [
      noteItem(501, { quantity: 1 }),
      noteItem(502, { quantity: 1 }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((line) => line.original_base.toString())).toEqual([
      '20000',
      '20000',
    ]);
    expect(result.map((line) => line.item.discount_amount.toString())).toEqual([
      '2500',
      '2500',
    ]);
    expect(result[0].item.price_unit_quantity).toBe(1);
    expect(result[0].item.unit_code).toBe('NIU');
    expect(result[0].item.account_code).toBe('413595');
    expect(result[0].item.stock_units_consumed).toBe(24);
    expect(result[0].item.financial_source_line_id).toBe(22);
    expect(result[0].calculator_input.quantity).toEqual(new Prisma.Decimal(1));
  });

  it('preserves a frozen pack divisor instead of reading a live catalog value', () => {
    const pack = {
      ...sourceInvoice().invoice_items[0],
      quantity: new Prisma.Decimal(12),
      unit_price: new Prisma.Decimal(22500),
      total_amount: new Prisma.Decimal(22500),
      price_unit_quantity: 12,
    };
    const source = sourceInvoice({
      invoice_items: [pack],
      subtotal_amount: new Prisma.Decimal(22500),
      total_amount: new Prisma.Decimal(22500),
    });

    const result = resolveNoteSourceLines(source);

    expect(result[0].item.price_unit_quantity).toBe(12);
    expect(result[0].calculator_input.price_unit_quantity).toBe(12);
    expect(result[0].original_base.toString()).toBe('22500');
  });

  it('defaults a partial quantity proportionally and an explicit discount replaces the source discount', () => {
    const item = {
      ...sourceInvoice().invoice_items[0],
      discount_amount: new Prisma.Decimal(1000),
      total_amount: new Prisma.Decimal(44000),
    };
    const source = sourceInvoice({
      invoice_items: [item],
      subtotal_amount: new Prisma.Decimal(44000),
      discount_amount: new Prisma.Decimal(0),
      total_amount: new Prisma.Decimal(44000),
    });

    const proportional = resolveNoteSourceLines(source, [noteItem(501)]);
    const replaced = resolveNoteSourceLines(source, [noteItem(501, { discount_amount: 25 })]);

    expect(proportional[0].item.discount_amount.toString()).toBe('500');
    expect(replaced[0].item.discount_amount.toString()).toBe('25');
    expect(proportional[0].original_quantity.toString()).toBe('2');
  });

  it('converts an inclusive document-base allowance into the captured discount domain', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          quantity: new Prisma.Decimal(2),
          unit_price: new Prisma.Decimal(26775),
          discount_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(7600),
          total_amount: new Prisma.Decimal(52600),
          is_inclusive: true,
        },
      ],
      invoice_taxes: [
        {
          invoice_item_id: null,
          tax_name: 'IVA 19%',
          tax_type: 'iva',
          tax_rate: 19,
          taxable_amount: 40000,
          tax_amount: 7600,
          is_inclusive: true,
        },
      ],
      subtotal_amount: new Prisma.Decimal(40000),
      discount_amount: new Prisma.Decimal(5000),
      tax_amount: new Prisma.Decimal(7600),
      total_amount: new Prisma.Decimal(47600),
    });

    const [line] = resolveNoteSourceLines(source, [
      noteItem(501, { quantity: 1, unit_price: 26775 }),
    ]);

    expect(line.original_base.toString()).toBe('40000');
    expect(line.original_total.toString()).toBe('47600');
    // $5,000 document allowance is a base reduction; inclusive capture needs
    // $5,950 gross discount, split over two units.
    expect(line.item.discount_amount.toString()).toBe('2975');
  });

  it('uses linked tax rows for multiple taxes on one line and resolves untyped rows by persisted name', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          tax_amount: new Prisma.Decimal(12465),
          total_amount: new Prisma.Decimal(57465),
        },
      ],
      tax_amount: new Prisma.Decimal(12465),
      total_amount: new Prisma.Decimal(57465),
      invoice_taxes: [
        {
          invoice_item_id: 501,
          tax_name: 'IVA',
          tax_type: null,
          tax_rate: '0.19',
          taxable_amount: 45000,
          tax_amount: 8550,
          is_inclusive: false,
        },
        {
          invoice_item_id: 501,
          tax_rate_id: 8,
          tax_name: 'INC',
          tax_type: 'inc',
          tax_rate: 8,
          taxable_amount: 45000,
          tax_amount: 3600,
          is_inclusive: false,
        },
        {
          invoice_item_id: 501,
          tax_name: 'ICA 7x1000',
          tax_type: 'ica',
          tax_rate: 7,
          taxable_amount: 45000,
          tax_amount: 315,
          is_inclusive: false,
        },
      ],
    });

    const result = resolveNoteSourceLines(source);

    expect(result[0].calculator_input.taxes?.map((tax) => tax.tax_type)).toEqual([
      'iva',
      'inc',
      'ica',
    ]);
    expect(result[0].calculator_input.taxes?.map((tax) => String(tax.tax_rate))).toEqual([
      '19',
      '8',
      '7',
    ]);
    expect(result[0].calculator_input.taxes?.map((tax) => tax.rate_basis)).toEqual([
      'percent',
      'percent',
      'per_mil',
    ]);
  });

  it('infers missing inclusivity only when captured price proves base or total, never by default', () => {
    const baseItem = sourceInvoice().invoice_items[0];
    const source = sourceInvoice({
      invoice_items: [
        {
          ...baseItem,
          quantity: new Prisma.Decimal(1),
          unit_price: new Prisma.Decimal(119),
          tax_amount: new Prisma.Decimal(19),
          total_amount: new Prisma.Decimal(119),
          is_inclusive: null,
        },
      ],
      invoice_taxes: [
        {
          invoice_item_id: 501,
          tax_name: 'IVA',
          tax_type: 'iva',
          tax_rate: 19,
          taxable_amount: 100,
          tax_amount: 19,
          is_inclusive: null,
        },
      ],
      subtotal_amount: new Prisma.Decimal(100),
      tax_amount: new Prisma.Decimal(19),
      total_amount: new Prisma.Decimal(119),
    });

    const resolved = resolveNoteSourceLines(source, [noteItem(501, { quantity: 1, unit_price: 119 })]);
    expect(resolved[0].item.is_inclusive).toBe(true);

    const unprovable = {
      ...source,
      invoice_items: [
        {
          ...source.invoice_items[0],
          unit_price: new Prisma.Decimal(110),
        },
      ],
    };
    expect(() => resolveNoteSourceLines(unprovable, [noteItem(501, { quantity: 1, unit_price: 110 })])).toThrow(
      VendixHttpException,
    );
  });

  it('does not inherit a single aggregated tax for an exempt line', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          tax_amount: new Prisma.Decimal(19),
          total_amount: new Prisma.Decimal(45019),
        },
        {
          ...sourceInvoice().invoice_items[0],
          id: 502,
          description: 'Exento',
          quantity: new Prisma.Decimal(1),
          tax_amount: new Prisma.Decimal(0),
          total_amount: new Prisma.Decimal(22500),
        },
      ],
      invoice_taxes: [
        {
          invoice_item_id: null,
          tax_name: 'IVA',
          tax_type: 'iva',
          tax_rate: 19,
          taxable_amount: 45000,
          tax_amount: 19,
        },
      ],
      subtotal_amount: new Prisma.Decimal(67500),
      tax_amount: new Prisma.Decimal(19),
      total_amount: new Prisma.Decimal(67519),
    });

    const lines = resolveNoteSourceLines(source, [
      noteItem(501, { quantity: 2 }),
      noteItem(502, { quantity: 1 }),
    ]);
    expect(lines[0].calculator_input.taxes).toHaveLength(1);
    expect(lines[1].calculator_input.taxes).toEqual([]);
  });

  it('rejects an unlinked multi-scheme header because a source line cannot be identified', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          tax_amount: new Prisma.Decimal(12150),
          total_amount: new Prisma.Decimal(57150),
        },
      ],
      subtotal_amount: new Prisma.Decimal(45000),
      tax_amount: new Prisma.Decimal(12150),
      total_amount: new Prisma.Decimal(57150),
      invoice_taxes: [
        {
          invoice_item_id: null,
          tax_name: 'IVA 19%',
          tax_type: 'iva',
          tax_rate: 19,
          taxable_amount: 45000,
          tax_amount: 8550,
        },
        {
          invoice_item_id: null,
          tax_name: 'INC 8%',
          tax_type: 'inc',
          tax_rate: 8,
          taxable_amount: 45000,
          tax_amount: 3600,
        },
      ],
    });

    expect(() =>
      resolveNoteSourceLines(source, [noteItem(501, { quantity: 2 })]),
    ).toThrow(VendixHttpException);

    const total = resolveNoteSourceLines(source);
    const trusted = buildTrustedNoteSnapshot(source, total);
    expect(total[0].requires_trusted_snapshot).toBe(true);
    expect(trusted.taxes).toHaveLength(2);
    expect(trusted.taxes.map((tax) => String(tax.tax_amount))).toEqual([
      '8550',
      '3600',
    ]);
  });

  it('rejects an invalid source unit unless a valid emitted unit is supplied', () => {
    const source = sourceInvoice({
      invoice_items: [{ ...sourceInvoice().invoice_items[0], unit_code: 'NOT-UNIT' }],
    });
    expect(() => resolveNoteSourceLines(source)).toThrow(VendixHttpException);
    expect(
      resolveNoteSourceLines(source, undefined, {
        emitted_unit_codes: new Map([[501, 'NIU']]),
      })[0].item.unit_code,
    ).toBe('NIU');
    expect(resolveNoteSourceLines(source, [noteItem(501, { unit_code: 'KGM' })])[0].item.unit_code).toBe('KGM');
    expect(() =>
      resolveNoteSourceLines(source, [noteItem(501, { unit_code: 'BOGUS' })]),
    ).toThrow(VendixHttpException);
    expect(() =>
      resolveNoteSourceLines(source, [
        { ...noteItem(501), unit_code: null } as unknown as CreateInvoiceNoteItemDto,
      ]),
    ).toThrow(VendixHttpException);
    expect(() =>
      resolveNoteSourceLines(source, [
        { ...noteItem(501), discount_amount: null } as unknown as CreateInvoiceNoteItemDto,
      ]),
    ).toThrow(VendixHttpException);
  });

  it('uses frozen source values only and does not infer a tax type from live catalogs', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          tax_amount: new Prisma.Decimal(19),
          total_amount: new Prisma.Decimal(45019),
        },
      ],
      invoice_taxes: [
        {
          invoice_item_id: 501,
          tax_name: 'Tasa desconocida',
          tax_type: null,
          tax_rate: 5,
          taxable_amount: 100,
          tax_amount: 5,
        },
      ],
    });
    expect(() => resolveNoteSourceLines(source)).toThrow(VendixHttpException);
  });

  it('builds a trusted snapshot from exact source rows and rejects a partial selection', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          tax_amount: new Prisma.Decimal(19),
          total_amount: new Prisma.Decimal(45019),
        },
      ],
      invoice_taxes: [
        {
          invoice_item_id: null,
          tax_name: 'IVA',
          tax_type: 'iva',
          tax_rate: 19,
          taxable_amount: 45000,
          tax_amount: 19,
          is_inclusive: false,
        },
      ],
      tax_amount: new Prisma.Decimal(19),
      total_amount: new Prisma.Decimal(45019),
    });
    const resolved = resolveNoteSourceLines(source);
    const trusted = buildTrustedNoteSnapshot(source, resolved);

    expect(trusted.lines[0].quantity).toEqual(new Prisma.Decimal(2));
    expect(trusted.lines[0].total_amount).toEqual(new Prisma.Decimal(45019));
    expect(trusted.subtotal_amount).toEqual(new Prisma.Decimal(45000));
    expect(trusted.taxes[0].taxable_amount).toEqual(new Prisma.Decimal(45000));
    expect(() => buildTrustedNoteSnapshot(source, resolved.slice(0, 0))).toThrow(
      VendixHttpException,
    );
  });

  it('preserves a one-cent historical inclusive quota in total trusted-copy mode', () => {
    const source = sourceInvoice({
      invoice_items: [
        {
          ...sourceInvoice().invoice_items[0],
          quantity: new Prisma.Decimal(1),
          unit_price: new Prisma.Decimal(119),
          tax_amount: new Prisma.Decimal('19.01'),
          total_amount: new Prisma.Decimal(119),
          is_inclusive: true,
        },
      ],
      invoice_taxes: [
        {
          invoice_item_id: 501,
          tax_name: 'IVA 19%',
          tax_type: 'iva',
          tax_rate: 19,
          taxable_amount: new Prisma.Decimal('99.99'),
          tax_amount: new Prisma.Decimal('19.01'),
          is_inclusive: true,
        },
      ],
      subtotal_amount: new Prisma.Decimal('99.99'),
      tax_amount: new Prisma.Decimal('19.01'),
      total_amount: new Prisma.Decimal(119),
    });

    const resolved = resolveNoteSourceLines(source);
    const trusted = buildTrustedNoteSnapshot(source, resolved);

    expect(resolved[0].item.is_inclusive).toBe(true);
    expect(trusted.lines[0].tax_amount).toEqual(new Prisma.Decimal('19.01'));
    expect(trusted.taxes[0].tax_amount).toEqual(new Prisma.Decimal('19.01'));
  });

  it('fails closed when an AIU source lacks frozen header metadata', () => {
    const source = sourceInvoice({ operation_type: '09' });
    expect(() => resolveNoteSourceLines(source)).toThrow(VendixHttpException);
  });
});
