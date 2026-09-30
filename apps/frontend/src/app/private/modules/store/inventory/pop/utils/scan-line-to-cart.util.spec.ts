import {
  buildScanAttachment,
  mapScanTaxesToPopLineTaxes,
  popLineTaxesToScanTaxes,
  scanLineHasVat,
  scanLineToCartFields,
} from './scan-line-to-cart.util';
import { cartToPurchaseOrderRequest } from '../interfaces/pop-order.interface';
import type {
  ExtractedLineItem,
  ScanLineTax,
} from '../interfaces/invoice-scanner.interface';
import type { PopCartState } from '../interfaces/pop-cart.interface';

const iva19: ScanLineTax = {
  tax_type: 'iva',
  tax_rate: 19,
  calc_mode: 'percent',
  fixed_amount_per_unit: null,
  amount_override: null,
  is_inclusive: true,
};
const inc8: ScanLineTax = {
  tax_type: 'inc',
  tax_rate: 8,
  calc_mode: 'percent',
  fixed_amount_per_unit: null,
  amount_override: null,
  is_inclusive: true,
};

function line(over: Partial<ExtractedLineItem> = {}): ExtractedLineItem {
  return {
    description: 'Producto',
    quantity: 2,
    unit_price: 1000,
    total: 2000,
    ...over,
  };
}

describe('scanLineToCartFields — QUI-855', () => {
  it('multi-impuesto IVA19+INC8 incluidos, bruto 1270: unit_cost bruto, 2 filas, INC sin forzar iva', () => {
    const f = scanLineToCartFields(
      line({
        unit_price: 1000,
        unit_price_gross: 1270,
        tax_rate: 0.19,
        taxes: [iva19, inc8],
        discount_percentage: 10,
        discount_amount_printed: 0,
      }),
      true,
    );

    expect(f.unit_cost).toBe(1270);
    expect(f.prices_include_tax).toBe(true);
    expect(f.taxes?.length).toBe(2);
    expect(f.taxes![0].tax_type).toBe('iva');
    expect(f.taxes![1].tax_type).toBe('inc');
    expect(f.taxes![1].tax_rate).toBe(8);
    expect(f.taxes![1].is_inclusive).toBe(true);
    expect(f.taxes![1].add_to_cost).toBe(true);
    expect(f.taxes![0].add_to_cost).toBe(false);
    // Sin `tax_type` fijo en la línea: las filas mandan.
    expect(f.tax_type).toBeUndefined();
    expect(f.tax_rate).toBe(19);
    expect(f.discount).toBe(10);
    expect(f.discount_amount).toBeUndefined();
  });

  it('descuento impreso en dinero gana y deja el % en 0', () => {
    const f = scanLineToCartFields(
      line({
        unit_price_gross: 1270,
        taxes: [iva19],
        discount_amount_printed: 254,
        discount_percentage: 10,
      }),
      false,
    );
    expect(f.discount_amount).toBe(254);
    expect(f.discount).toBe(0);
    expect(f.prices_include_tax).toBe(false);
  });

  it('el modo propio de la línea (fijado por el modal) pisa el de la factura', () => {
    const f = scanLineToCartFields(
      line({ taxes: [iva19], prices_include_tax: false, unit_price_gross: 1000 }),
      true,
    );
    expect(f.prices_include_tax).toBe(false);
  });

  it('IBUA: monto fijo por unidad, sin tasa', () => {
    const rows = mapScanTaxesToPopLineTaxes([
      {
        tax_type: 'ibua',
        tax_rate: null,
        calc_mode: 'fixed_per_unit',
        fixed_amount_per_unit: 68,
        amount_override: 500,
        is_inclusive: false,
      },
    ]);
    expect(rows[0].calc_mode).toBe('fixed_per_unit');
    expect(rows[0].tax_rate).toBeNull();
    expect(rows[0].fixed_amount_per_unit).toBe(68);
    expect(rows[0].amount_override).toBe(500);
    expect(rows[0].add_to_cost).toBe(true);
  });

  it('línea legacy sin taxes: mismo resultado que el mapeo previo', () => {
    const f = scanLineToCartFields(
      line({ unit_price: 840.34, tax_rate: 0.19, discount_percentage: 12.6 }),
      true,
    );
    expect(f).toEqual({
      unit_cost: 840.34,
      discount: 13,
      tax_rate: 19,
      tax_type: 'iva',
      prices_include_tax: false,
    });
  });

  it('legacy sin tasa detectada: tax_rate undefined y descuento 0', () => {
    const f = scanLineToCartFields(line({ tax_rate: null }), false);
    expect(f.tax_rate).toBeUndefined();
    expect(f.discount).toBe(0);
    expect(f.taxes).toBeUndefined();
  });

  it('scanLineHasVat: taxes o tasa > 0', () => {
    expect(scanLineHasVat(line({ taxes: [inc8] }))).toBe(true);
    expect(scanLineHasVat(line({ tax_rate: 0.05 }))).toBe(true);
    expect(scanLineHasVat(line({ tax_rate: 0 }))).toBe(false);
  });

  it('popLineTaxesToScanTaxes ida y vuelta conserva base_mode y add_to_cost', () => {
    const scan = popLineTaxesToScanTaxes([
      { tax_type: 'iva', tax_rate: 19, calc_mode: 'percent', add_to_cost: true },
      {
        tax_type: 'inc',
        tax_rate: 8,
        calc_mode: 'percent',
        base_mode: 'net_plus_prior',
      },
    ]);
    const back = mapScanTaxesToPopLineTaxes(scan);
    expect(back[0].add_to_cost).toBe(true);
    expect(back[1].base_mode).toBe('net_plus_prior');
    expect(back[1].add_to_cost).toBe(true);
  });
});

describe('buildScanAttachment + payload de creación — QUI-855', () => {
  const att = {
    key: 'store-1/purchase-orders/scan/f.pdf',
    file_name: 'f.pdf',
    file_type: 'application/pdf',
    file_size: 1234,
  };

  it('arma el adjunto con los datos de cabecera revisados', () => {
    const out = buildScanAttachment({
      scanResult: { scan_attachment: att, total: 5000 },
      invoiceNumber: 'FV-9',
      invoiceDate: '2026-09-20',
    });
    expect(out).toEqual({
      ...att,
      supplier_invoice_number: 'FV-9',
      supplier_invoice_date: '2026-09-20',
      supplier_invoice_amount: 5000,
    });
  });

  it('sin scan_attachment devuelve null (no se inventa llave)', () => {
    expect(
      buildScanAttachment({ scanResult: { scan_attachment: null, total: 1 } }),
    ).toBeNull();
    expect(buildScanAttachment({ scanResult: null })).toBeNull();
  });

  function state(scan_attachment?: PopCartState['scan_attachment']): PopCartState {
    return {
      items: [],
      summary: { subtotal: 0, tax_amount: 0, total: 0 },
      prices_include_tax: false,
      has_vat: false,
      supplierId: 1,
      locationId: 2,
      orderDate: new Date('2026-09-20T00:00:00Z'),
      shippingCost: 0,
      discountAmount: 0,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
      scan_attachment,
    } as unknown as PopCartState;
  }

  it('scan_attachment pasa al payload de create', () => {
    const req = cartToPurchaseOrderRequest(
      state({ ...att, supplier_invoice_number: 'FV-9' }),
      7,
    );
    expect(req.scan_attachment).toEqual({
      ...att,
      supplier_invoice_number: 'FV-9',
    });
  });

  it('sin adjunto el payload no trae la clave', () => {
    const req = cartToPurchaseOrderRequest(state(null), 7);
    expect('scan_attachment' in req).toBe(false);
  });
});

describe('scanLineToCartFields - cuadre v2', () => {
  const base: ExtractedLineItem = {
    description: 'x',
    quantity: 1,
    unit_price: 100,
    total: 100,
    tax_rate: 0.19,
  };

  it('reconcile ok=false marca tax_needs_review (legacy y multi-impuesto)', () => {
    const rec = { expected: 100, printed: 120, ok: false };
    expect(scanLineToCartFields({ ...base, reconcile: rec }, false).tax_needs_review).toBeTrue();
    expect(
      scanLineToCartFields({ ...base, taxes: [iva19], reconcile: rec }, false).tax_needs_review,
    ).toBeTrue();
  });

  it('reconcile ok=true o ausente no agrega la marca', () => {
    const ok = scanLineToCartFields({ ...base, reconcile: { expected: 1, printed: 1, ok: true } }, false);
    expect('tax_needs_review' in ok).toBeFalse();
    expect('tax_needs_review' in scanLineToCartFields(base, false)).toBeFalse();
  });
});
