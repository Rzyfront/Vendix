import type {
  ExtractedLineItem,
  InvoiceScanResult,
  MatchedLineItem,
} from '../interfaces/invoice-scanner.interface';
import {
  buildRevalidateConsolidated,
  mergeRevalidatedLines,
} from './revalidate-merge.util';

const scan = (over: Partial<InvoiceScanResult> = {}): InvoiceScanResult => ({
  supplier: { name: 'Proveedor SAS', tax_id: '900-1' },
  invoice_number: 'FV-1',
  invoice_date: '2026-09-20',
  payment_terms: '30 dias',
  prices_include_tax: true,
  line_items: [],
  scan_attachment: {
    key: 'k/a.pdf',
    file_name: 'a.pdf',
    file_type: 'application/pdf',
    file_size: 10,
  },
  subtotal: 100,
  tax_amount: 19,
  discount_amount: 5,
  discount_amount_printed: 5.95,
  early_payment_discount: 2,
  total: 119,
  confidence: 0.9,
  ...over,
});

const legacyItem = (over: Partial<MatchedLineItem> = {}): MatchedLineItem => ({
  description: 'Arroz',
  quantity: 2,
  unit_price: 1000,
  total: 2380,
  tax_rate: 0.19,
  discount_percentage: 10,
  match_status: 'matched',
  selected_product_id: 7,
  candidates: [{ id: 7, name: 'Arroz 500g', sku: 'A1', confidence: 90 }],
  purchase_uom_id: 3,
  stock_uom_id: 4,
  ...over,
});

const grossItem = (over: Partial<MatchedLineItem> = {}): MatchedLineItem => ({
  description: 'Licor',
  quantity: 3,
  unit_price: 100,
  unit_price_gross: 150,
  total: 450,
  tax_rate: 0.19,
  discount_percentage: 0,
  discount_amount_printed: 30,
  prices_include_tax: true,
  taxes: [
    {
      tax_type: 'iva',
      tax_rate: 19,
      calc_mode: 'percent',
      fixed_amount_per_unit: null,
      amount_override: null,
    },
    {
      tax_type: 'ibua',
      tax_rate: null,
      calc_mode: 'fixed_per_unit',
      fixed_amount_per_unit: 68,
      amount_override: null,
    },
  ],
  match_status: 'partial',
  selected_product_id: 9,
  candidates: [],
  ...over,
});

describe('buildRevalidateConsolidated', () => {
  it('arma la cabecera desde lo EDITADO y omite scan_attachment', () => {
    const out = buildRevalidateConsolidated({
      scan: scan(),
      items: [legacyItem()],
      invoiceNumber: 'FV-EDIT',
      invoiceDate: '2026-09-21',
      headerDiscount: 8,
      totals: { subtotal: 90, tax_amount: 17, total: 107 },
      lineTotals: [107],
    });
    expect((out as any).scan_attachment).toBeUndefined();
    expect(out.invoice_number).toBe('FV-EDIT');
    expect(out.invoice_date).toBe('2026-09-21');
    expect(out.discount_amount).toBe(8);
    // El descuento de pie cambió: el impreso original ya no aplica.
    expect(out.discount_amount_printed).toBeNull();
    expect(out.subtotal).toBe(90);
    expect(out.tax_amount).toBe(17);
    expect(out.total).toBe(107);
    expect(out.line_items[0].total).toBe(107);
    expect(out.supplier.name).toBe('Proveedor SAS');
    expect(out.payment_terms).toBe('30 dias');
  });

  it('conserva el descuento impreso de pie si no se editó', () => {
    const out = buildRevalidateConsolidated({
      scan: scan(),
      items: [],
      headerDiscount: 5,
    });
    expect(out.discount_amount_printed).toBe(5.95);
    expect(out.subtotal).toBe(100);
  });

  it('línea multi-impuesto: filas, bruto y descuento impreso', () => {
    const out = buildRevalidateConsolidated({
      scan: scan(),
      items: [grossItem()],
      headerDiscount: 0,
    });
    const l = out.line_items[0];
    expect(l.taxes?.length).toBe(2);
    expect(l.taxes![0]).toEqual(
      jasmine.objectContaining({ tax_type: 'iva', tax_rate: 19, add_to_cost: false }),
    );
    expect(l.taxes![1]).toEqual(
      jasmine.objectContaining({
        tax_type: 'ibua',
        calc_mode: 'fixed_per_unit',
        fixed_amount_per_unit: 68,
        tax_rate: null,
      }),
    );
    expect(l.unit_price_gross).toBe(150);
    expect(l.unit_price).toBe(150);
    expect(l.discount_amount_printed).toBe(30);
    expect(l.prices_include_tax).toBe(true);
    expect(l.tax_rate).toBeCloseTo(0.19);
  });

  it('línea legacy: neto, tasa fracción y descuento derivado del %', () => {
    const out = buildRevalidateConsolidated({
      scan: scan(),
      items: [legacyItem()],
      headerDiscount: 0,
    });
    const l = out.line_items[0];
    expect(l.taxes).toBeUndefined();
    expect(l.unit_price).toBe(1000);
    expect(l.tax_rate).toBe(0.19);
    expect(l.discount_percentage).toBe(10);
    expect(l.discount_amount).toBe(200);
    expect(l.discount_amount_printed).toBeNull();
  });
});

describe('mergeRevalidatedLines', () => {
  const rev = (over: Partial<ExtractedLineItem> = {}): ExtractedLineItem => ({
    description: 'DESC IA (no debe pisar)',
    quantity: 5,
    unit_price: 900,
    total: 4500,
    tax_rate: 0.05,
    discount_percentage: 0,
    ...over,
  });

  it('conserva el match de producto y la descripción; sobrescribe lo numérico', () => {
    const { items, changed } = mergeRevalidatedLines([legacyItem()], [rev()]);
    const m = items[0];
    expect(changed).toBe(1);
    expect(m.selected_product_id).toBe(7);
    expect(m.candidates.length).toBe(1);
    expect(m.purchase_uom_id).toBe(3);
    expect(m.stock_uom_id).toBe(4);
    expect(m.match_status).toBe('matched');
    expect(m.description).toBe('Arroz');
    expect(m.quantity).toBe(5);
    expect(m.unit_price).toBe(900);
    expect(m.total).toBe(4500);
    expect(m.tax_rate).toBe(0.05);
    expect(m.discount_percentage).toBe(0);
    expect(m.revalidation).toBe('changed');
  });

  it('no marca changed si la revalidación no cambió nada', () => {
    const cur = legacyItem();
    const same = rev({
      quantity: 2,
      unit_price: 1000,
      total: 2380,
      tax_rate: 0.19,
      discount_percentage: 10,
    });
    const { items, changed } = mergeRevalidatedLines([cur], [same]);
    expect(changed).toBe(0);
    expect(items[0].revalidation).toBeUndefined();
  });

  it('línea multi-impuesto revalidada reemplaza filas y descuento impreso', () => {
    const r = rev({
      unit_price: 140,
      unit_price_gross: 160,
      quantity: 3,
      taxes: [
        {
          tax_type: 'iva',
          tax_rate: 5,
          calc_mode: 'percent',
          fixed_amount_per_unit: null,
          amount_override: null,
        },
      ],
      discount_amount_printed: 20,
      prices_include_tax: false,
    });
    const { items } = mergeRevalidatedLines([grossItem()], [r], true);
    const m = items[0];
    expect(m.taxes?.length).toBe(1);
    expect(m.unit_price_gross).toBe(160);
    expect(m.discount_amount_printed).toBe(20);
    expect(m.prices_include_tax).toBe(false);
    expect(m.selected_product_id).toBe(9);
  });

  it('líneas extra se agregan al final sin producto y marcadas new', () => {
    const { items, added } = mergeRevalidatedLines(
      [legacyItem()],
      [rev(), rev({ description: 'Extra', quantity: 1 })],
    );
    expect(added).toBe(1);
    expect(items.length).toBe(2);
    expect(items[1].description).toBe('Extra');
    expect(items[1].candidates).toEqual([]);
    expect(items[1].selected_product_id).toBeUndefined();
    expect(items[1].match_status).toBe('new');
    expect(items[1].revalidation).toBe('new');
  });

  it('si la revalidada trae menos líneas NO borra: marca missing', () => {
    const { items, missing } = mergeRevalidatedLines(
      [legacyItem(), legacyItem({ description: 'Sal' })],
      [rev()],
    );
    expect(missing).toBe(1);
    expect(items.length).toBe(2);
    expect(items[1].description).toBe('Sal');
    expect(items[1].revalidation).toBe('missing');
    expect(items[1].quantity).toBe(2);
  });

  it('una línea antes missing que ahora aparece pierde la marca', () => {
    const { items } = mergeRevalidatedLines(
      [legacyItem({ revalidation: 'missing' })],
      [rev({ quantity: 2, unit_price: 1000, total: 2380, tax_rate: 0.19, discount_percentage: 10 })],
    );
    expect(items[0].revalidation).toBeUndefined();
  });
});
