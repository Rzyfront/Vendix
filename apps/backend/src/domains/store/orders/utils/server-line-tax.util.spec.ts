import { resolveServerLineTax } from './server-line-tax.util';

/**
 * P0-1 / P0-4 / P1-2 (auditoría impuestos por producto) — plan fiscal de UNA
 * línea resuelto en el servidor con las tasas del catálogo. Puro: sin mocks.
 */
const IVA19_INCL = {
  id: 1,
  name: 'IVA 19%',
  rate: 0.19,
  tax_type: 'iva',
  is_inclusive: true,
};
const IVA19_EXCL = { ...IVA19_INCL, id: 2, is_inclusive: false };
const INC8_INCL = {
  id: 3,
  name: 'INC 8%',
  rate: 0.08,
  tax_type: 'inc',
  is_inclusive: true,
};

describe('resolveServerLineTax', () => {
  it('IVA 19 % INCLUIDO: bruto 11.900 ⇒ base 10.000 + impuesto 1.900', () => {
    const r = resolveServerLineTax(
      { unit_price: 10000, final_unit_price: 11900, quantity: 1 },
      [IVA19_INCL],
    );
    expect(r).toMatchObject({
      unit_price: 10000,
      tax_amount_item: 1900,
      final_unit_price: 11900,
      total_price: 10000,
      line_tax_total: 1900,
      source: 'final_unit_price',
    });
    expect(r.taxes).toEqual([
      expect.objectContaining({
        tax_rate_id: 1,
        tax_rate: 0.19,
        tax_amount: 1900,
        tax_type: 'iva',
        is_inclusive: true,
      }),
    ]);
  });

  it('P0-1: el neto con tasa incluida NO se vuelve a despejar (sin bruto ⇒ impuesto encima)', () => {
    // El editor manda unit_price=10.000 (neto). El defecto viejo despejaba
    // 19 % sobre 10.000 (8.403,36 + 1.596,64). Sin bruto ni góndola que
    // coincida, 10.000 es la base.
    const r = resolveServerLineTax(
      { unit_price: 10000, quantity: 1 },
      [IVA19_INCL],
      null,
    );
    expect(r.unit_price).toBe(10000);
    expect(r.tax_amount_item).toBe(1900);
    expect(r.final_unit_price).toBe(11900);
    expect(r.source).toBe('client_net');
  });

  it('IVA 19 % AGREGADO: base 10.000 ⇒ total 11.900', () => {
    const r = resolveServerLineTax({ unit_price: 10000, quantity: 1 }, [
      IVA19_EXCL,
    ]);
    expect(r).toMatchObject({
      unit_price: 10000,
      tax_amount_item: 1900,
      final_unit_price: 11900,
      source: 'exclusive_base',
    });
    expect(r.taxes[0]).toMatchObject({ tax_amount: 1900, is_inclusive: false });
  });

  it('INC 8 % INCLUIDO a 18.500 ⇒ 17.129,63 + 1.370,37 con tax_type inc', () => {
    const r = resolveServerLineTax(
      { unit_price: 18500, quantity: 1 },
      [INC8_INCL],
      18500,
    );
    expect(r.unit_price).toBe(17129.63);
    expect(r.tax_amount_item).toBe(1370.37);
    expect(r.final_unit_price).toBe(18500);
    expect(r.source).toBe('catalog_gross');
    expect(r.taxes[0]).toMatchObject({ tax_type: 'inc', tax_amount: 1370.37 });
  });

  it('reservas: unit_price = góndola (11.900) sin impuesto ⇒ base 10.000 + 1.900', () => {
    const r = resolveServerLineTax(
      { unit_price: 11900, total_price: 11900, quantity: 1 },
      [IVA19_INCL],
      11900,
    );
    expect(r.unit_price).toBe(10000);
    expect(r.line_tax_total).toBe(1900);
    expect(r.source).toBe('catalog_gross');
  });

  it('borrador de mostrador legacy: neto unitario + total bruto ⇒ bruto = total / unidades', () => {
    const r = resolveServerLineTax(
      { unit_price: 10000, total_price: 23800, quantity: 2 },
      [IVA19_INCL],
      12500, // góndola distinta (precio negociado)
    );
    expect(r.source).toBe('client_gross_total');
    expect(r.unit_price).toBe(10000);
    expect(r.total_price).toBe(20000);
    expect(r.line_tax_total).toBe(3800);
  });

  it('producto exento (sin tasas): sin impuesto ni filas', () => {
    const r = resolveServerLineTax(
      { unit_price: 5000, quantity: 3 },
      [],
    );
    expect(r).toMatchObject({
      unit_price: 5000,
      tax_amount_item: 0,
      final_unit_price: 5000,
      total_price: 15000,
      line_tax_total: 0,
      source: 'no_tax',
    });
    expect(r.taxes).toEqual([]);
  });

  it('cantidad y escala: impuesto de línea = por unidad × unidades de precio', () => {
    // 2.000 mm a $11.900 el metro (escala 1.000) ⇒ 2 unidades de precio.
    const r = resolveServerLineTax(
      {
        unit_price: 10000,
        final_unit_price: 11900,
        quantity: 2000,
        price_unit_quantity: 1000,
      },
      [IVA19_INCL],
    );
    expect(r.line_units).toBe(2);
    expect(r.total_price).toBe(20000);
    expect(r.line_tax_total).toBe(3800);
    expect(r.tax_amount_item).toBe(1900);
  });

  it('tax_type ausente en la fila fuente ⇒ default canónico iva', () => {
    const r = resolveServerLineTax(
      { unit_price: 100, quantity: 1 },
      [{ id: 9, name: 'Legacy', rate: 0.19, is_inclusive: false }],
    );
    expect(r.taxes[0].tax_type).toBe('iva');
  });
});
