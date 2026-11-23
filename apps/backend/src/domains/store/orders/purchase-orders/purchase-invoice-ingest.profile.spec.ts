import Ajv from 'ajv';
import { dropNullKeys } from '@common/ai-ingest/extraction/ai-extraction.service';
import {
  buildInvoiceInstruction,
  INVOICE_IMAGE_INSTRUCTION,
  INVOICE_REVALIDATE_SCHEMA,
  mergeInvoiceBatches,
  PAYMENT_RECEIPT_SCHEMA,
  PURCHASE_INVOICE_PROFILE,
  subtotalVsLinesWarning,
} from './purchase-invoice-ingest.profile';

const line = (description: string, quantity: number, unit_price: number, extra: Record<string, unknown> = {}) => ({
  description,
  sku_if_visible: null,
  quantity,
  unit_price,
  price_basis: null,
  discount: { kind: 'none', value: 0, basis: null },
  taxes: [{ type: 'iva', treatment: 'gravado', rate: 19, amount: null, inclusive: null }],
  is_bonus: false,
  printed_line_total: Math.round(quantity * unit_price * 1.19),
  ...extra,
});

describe('purchase_invoice profile — schema (same answers the scanner accepted)', () => {
  // Same ajv options as AiExtractionService.
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });
  const validate = ajv.compile(PURCHASE_INVOICE_PROFILE.documentSchema.schema);

  // Same order as AiExtractionService.check: null keys dropped, then ajv.
  const check = (answer: unknown) => {
    const copy = dropNullKeys(JSON.parse(JSON.stringify(answer))) as any;
    return { ok: validate(copy), copy };
  };

  it('accepts a v2 answer and leaves its numbers untouched', () => {
    const v2 = {
      schema_version: 2,
      supplier: { name: 'ACME SAS', tax_id: '900123456-7' },
      invoice_number: 'FV-1',
      line_items: [line('Lata', 2, 1000)],
      discounts: [],
      printed_total: 2380,
    };
    const { ok, copy } = check(v2);
    expect(ok).toBe(true);
    // Only the null keys are gone (the scanner reads null and absent alike);
    // ajv coerced nothing.
    expect(copy).toEqual(dropNullKeys(v2));
    expect(copy.line_items[0].taxes[0]).toEqual({ type: 'iva', treatment: 'gravado', rate: 19 });
    expect(copy.line_items[0].unit_price).toBe(1000);
    expect(copy.printed_total).toBe(2380);
  });

  it('accepts a v1 answer, numbers written as text and extra keys', () => {
    const v1 = {
      supplier: { name: 'ACME', nit: '900' },
      invoice_number: 12345,
      prices_include_tax: 'true',
      line_items: [
        { description: 'Lata', quantity: '2', unit_price: '24.990', total: 49980, tax_rate: 0.19, discount_amount: 0 },
      ],
      subtotal: '49.980',
      total: 59476,
      something_new: { a: 1 },
    };
    const { ok, copy } = check(v1);
    expect(ok).toBe(true);
    // Strings stay strings: normalizeOcrResponse keeps converting them as before.
    expect(copy.line_items[0].unit_price).toBe('24.990');
    expect(copy.subtotal).toBe('49.980');
    expect(copy.invoice_number).toBe(12345);
  });

  it('keeps a numeric 1 in a boolean field as a number (never coerced to true)', () => {
    // coerceTypes turns 1 into true inside a union that only has boolean/string,
    // and the money path compares `=== true`: `prices_include_tax: 1` flipped
    // the IVA from "por fuera" to "incluido" and `is_bonus: 1` zeroed a line.
    const v1 = {
      supplier: { name: 'ACME' },
      prices_include_tax: 1,
      line_items: [{ description: 'Lata', quantity: 2, unit_price: 1000, total: 2000, is_bonus: 1 }],
      total: 2380,
    };
    const { ok, copy } = check(v1);
    expect(ok).toBe(true);
    expect(copy.prices_include_tax).toBe(1);
    expect(copy.prices_include_tax).not.toBe(true);
    expect(copy.line_items[0].is_bonus).toBe(1);
    expect(copy.line_items[0].is_bonus).not.toBe(true);
  });

  it('accepts a batch without supplier or lines (a middle page)', () => {
    expect(validate({ line_items: [] })).toBe(true);
    expect(validate({})).toBe(true);
  });

  it('rejects a shape it cannot use (lines that are not a list)', () => {
    expect(validate({ line_items: 'Lata x2' })).toBe(false);
  });

  it('revalidation and payment schemas accept the shapes their parsers read', () => {
    const reval = ajv.compile(INVOICE_REVALIDATE_SCHEMA.schema);
    expect(
      reval({
        consolidated: { supplier: { name: 'A' }, line_items: [line('x', 1, 1)] },
        report: { summary: 's', confidence: 'high', findings: [], red_flags: [], divergences: [{ line_index: 0, field: 'quantity', consolidated_value: 2, document_value: '3', reason: 'r' }] },
      }),
    ).toBe(true);
    const pay = ajv.compile(PAYMENT_RECEIPT_SCHEMA.schema);
    expect(pay({ amount: '150000', payment_date: '2026-11-01', payment_method: 'transfer', confidence: 90 })).toBe(true);
  });

  it('limits: 10 pages, 5 per call, 15 MiB', () => {
    expect(PURCHASE_INVOICE_PROFILE.limits).toEqual({
      maxPages: 10,
      pagesPerBatch: 5,
      maxBytes: 15 * 1024 * 1024,
    });
    expect(PURCHASE_INVOICE_PROFILE.mode).toBe('document');
  });
});

describe('purchase_invoice profile — instruction', () => {
  const photo = [{ page_number: 1, mode: 'image' as const, text: '', image: 'data:image/jpeg;base64,AA' }];

  it('a single photo gets the exact request the scanner always sent', () => {
    expect(
      buildInvoiceInstruction(photo, { totalPages: 1, totalBatches: 1 }, 'CURRENCY'),
    ).toBe(`${INVOICE_IMAGE_INSTRUCTION}\n\nCURRENCY`);
  });

  it('a PDF read in one batch asks for the whole invoice, without page ranges', () => {
    const pages = [1, 2, 3].map((n) => ({ page_number: n, mode: 'text' as const, text: 'x' }));
    const text = buildInvoiceInstruction(pages, { totalPages: 3, totalBatches: 1 }, 'CURRENCY');
    expect(text).toContain('Extract all data from this purchase invoice.');
    expect(text).not.toContain('This message holds');
    expect(text.endsWith('CURRENCY')).toBe(true);
  });

  it('a batch of a longer invoice says which pages it holds', () => {
    const pages = [6, 7].map((n) => ({ page_number: n, mode: 'text' as const, text: 'x' }));
    const text = buildInvoiceInstruction(pages, { totalPages: 7, totalBatches: 2 }, 'CURRENCY');
    expect(text).toContain('pages 6-7 of a 7-page invoice');
    expect(text).toContain('Report ONLY the line items printed on these pages');
    expect(text.endsWith('CURRENCY')).toBe(true);
  });
});

describe('purchase_invoice profile — mergeInvoiceBatches', () => {
  it('one batch is returned as is (same object, no warnings)', () => {
    const data = { supplier: { name: 'A' }, line_items: [line('x', 1, 1)], printed_total: 1 };
    const out = mergeInvoiceBatches([{ pages: [1, 2, 3], data }]);
    expect(out.data).toBe(data);
    expect(out.warnings).toEqual([]);
    expect(out.repeatedLines).toBe(0);
  });

  it('header from the first batch, footer from the last, lines in page order', () => {
    const out = mergeInvoiceBatches([
      {
        pages: [1, 2, 3, 4, 5],
        data: {
          schema_version: 2,
          supplier: { name: 'ACME SAS', tax_id: null },
          invoice_number: 'FV-9',
          invoice_date: '2026-11-01',
          price_basis: 'sin_iva',
          line_items: [line('A', 1, 100), line('B', 2, 200)],
          printed_total: null,
          discounts: [],
          confidence: 90,
        },
      },
      {
        pages: [6, 7],
        data: {
          schema_version: 2,
          supplier: { name: null, tax_id: '900123456-7' },
          invoice_number: null,
          line_items: [line('C', 3, 300)],
          printed_subtotal: 1400,
          printed_iva_total: 266,
          printed_total: 1666,
          discounts: [{ kind: 'percent', value: 5, scope: 'subtotal', is_early_payment: false }],
          confidence: 70,
        },
      },
    ]);
    expect(out.data.invoice_number).toBe('FV-9');
    expect(out.data.invoice_date).toBe('2026-11-01');
    expect(out.data.price_basis).toBe('sin_iva');
    expect(out.data.supplier).toEqual({ name: 'ACME SAS', tax_id: '900123456-7' });
    expect(out.data.line_items.map((l: any) => l.description)).toEqual(['A', 'B', 'C']);
    expect(out.data.printed_total).toBe(1666);
    expect(out.data.printed_subtotal).toBe(1400);
    expect(out.data.discounts).toHaveLength(1);
    expect(out.data.confidence).toBe(70);
    expect(out.warnings).toEqual([]);
  });

  it('an identical line repeated at a batch boundary counts once, and the operator is told', () => {
    const shared = line('Aceite 900ml', 12, 9800);
    const out = mergeInvoiceBatches([
      { pages: [1, 2, 3, 4, 5], data: { supplier: { name: 'A' }, line_items: [line('A', 1, 1), shared] } },
      { pages: [6], data: { line_items: [{ ...shared, description: '  aceite  900ML ' }, line('D', 4, 40)] } },
    ]);
    expect(out.data.line_items.map((l: any) => l.description)).toEqual(['A', 'Aceite 900ml', 'D']);
    // The quantity of the shared line is NOT doubled.
    expect(out.data.line_items[1].quantity).toBe(12);
    expect(out.repeatedLines).toBe(1);
    expect(out.warnings[0]).toContain('"Aceite 900ml"');
    expect(out.warnings[0]).toContain('página 5');
    expect(out.warnings[0]).toContain('agrégala en la revisión');
  });

  it('same product with another quantity, or a repeat away from the boundary, is kept', () => {
    const out = mergeInvoiceBatches([
      { pages: [1], data: { line_items: [line('X', 1, 10), line('Y', 2, 20)] } },
      { pages: [2], data: { line_items: [line('Y', 3, 20), line('X', 1, 10)] } },
    ]);
    expect(out.data.line_items).toHaveLength(4);
    expect(out.repeatedLines).toBe(0);
    expect(out.warnings).toEqual([]);
  });

  it('two different printed totals → the last one, with a warning (never recomputed)', () => {
    const out = mergeInvoiceBatches([
      { pages: [1, 2, 3, 4, 5], data: { line_items: [line('A', 1, 1)], printed_total: 5000 } },
      { pages: [6], data: { line_items: [line('B', 1, 1)], printed_total: 7000 } },
    ]);
    expect(out.data.printed_total).toBe(7000);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('dos totales distintos');
  });

  it('a zero footer on the last batch does not hide the real total of an earlier one', () => {
    const out = mergeInvoiceBatches([
      { pages: [1], data: { line_items: [line('A', 1, 1)], printed_total: 5000 } },
      { pages: [2], data: { line_items: [line('B', 1, 1)], printed_total: 0 } },
    ]);
    expect(out.data.printed_total).toBe(5000);
  });

  it('mixed shapes: the v2 batch is converted to v1 so every line keeps its total', () => {
    const v2Batch = {
      schema_version: 2,
      line_items: [
        {
          description: 'Aceite',
          quantity: 1,
          unit_price: 10000,
          printed_line_total: 10000,
          discount: { kind: 'percent', value: 10 },
          taxes: [{ type: 'iva', treatment: 'gravado', rate: 19, amount: 1710 }],
        },
      ],
    };
    const v1Batch = {
      line_items: [{ description: 'Jabón', quantity: 2, unit_price: 5000, total: 10000, discount_amount: 0 }],
    };
    const out = mergeInvoiceBatches(
      [
        { pages: [1, 2, 3, 4, 5], data: v2Batch as any },
        { pages: [6], data: v1Batch as any },
      ],
      { decimalPlaces: 0 },
    );
    // One shape for the whole document: the legacy one.
    expect(out.data.schema_version).toBeUndefined();
    expect(out.warnings.some((w) => w.includes('otro formato'))).toBe(true);
    const lines = out.data.line_items as any[];
    expect(lines).toHaveLength(2);
    // The v2 line becomes v1 with its own money: no total 0, printed total and
    // discount kept (the v1 shape keeps the printed figure and the discount
    // apart, exactly like the legacy answer did).
    const aceite = lines.find((l) => l.description === 'Aceite');
    expect(aceite.total).toBe(10000);
    expect(aceite.printed_line_total).toBe(10000);
    expect(aceite.discount_percentage).toBe(10);
    expect(aceite.discount_kind).toBe('percent');
    expect(aceite.tax_rate).toBe(0.19);
    const jabon = lines.find((l) => l.description === 'Jabón');
    expect(jabon.total).toBe(10000);
  });

  it('more than 100 lines across batches: none is lost', () => {
    const first = Array.from({ length: 70 }, (_, i) => line(`P${i}`, 1, 100 + i));
    const second = Array.from({ length: 60 }, (_, i) => line(`Q${i}`, 1, 500 + i));
    const out = mergeInvoiceBatches([
      { pages: [1, 2, 3, 4, 5], data: { line_items: first } },
      { pages: [6, 7, 8], data: { line_items: second } },
    ]);
    expect(out.data.line_items).toHaveLength(130);
  });
});

describe('purchase_invoice profile — subtotal vs lines', () => {
  const cop = { decimal_places: 0 };
  const lines = [
    { quantity: 2, unit_price: 1000, unit_price_gross: 1000, total: 2380 },
    { quantity: 1, unit_price: 500, unit_price_gross: 500, discount_amount: 50, total: 535.5 },
  ];

  it('no warning when the subtotal is the net sum of the lines', () => {
    expect(subtotalVsLinesWarning({ subtotal: 2450, line_items: lines }, cop)).toBeNull();
  });

  it('no warning when it is the sum before discounts or the printed totals', () => {
    expect(subtotalVsLinesWarning({ subtotal: 2500, line_items: lines }, cop)).toBeNull();
    expect(subtotalVsLinesWarning({ subtotal: 2915.5, line_items: lines }, cop)).toBeNull();
  });

  it('no warning without a printed subtotal', () => {
    expect(subtotalVsLinesWarning({ subtotal: 0, line_items: lines }, cop)).toBeNull();
  });

  it('a missing line shows up as a warning and nothing is corrected', () => {
    const result = { subtotal: 9450, line_items: lines };
    const warning = subtotalVsLinesWarning(result, cop);
    expect(warning).toContain('no coincide con la suma de las 2');
    expect(warning).toContain('No se cambió ninguna cifra');
    expect(result.subtotal).toBe(9450);
  });
});
