import {
  resolvePurchaseLineTaxes,
  resolvePurchaseLineDiscount,
  PurchaseLineTaxInput,
} from './purchase-line-taxes';

const by = (r: ReturnType<typeof resolvePurchaseLineTaxes>, t: string) =>
  r.taxes.find((x) => x.tax_type === t)!;

describe('resolvePurchaseLineTaxes', () => {
  it('IVA 19 + INC 8 incluidos', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1270, quantity: 1, prices_include_tax: true,
      taxes: [{ tax_type: 'iva', rate: 19 }, { tax_type: 'inc', rate: 8 }],
    });
    expect(r.net_total).toBe(1000);
    expect(by(r, 'iva').tax_amount).toBe(190);
    expect(by(r, 'inc').tax_amount).toBe(80);
    expect(r.line_total).toBe(1270);
    expect(r.cost_total).toBe(1080);
    expect(r.iva?.tax_type).toBe('iva');
  });

  it('IVA incluido + ICUI exclusivo', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1190, quantity: 1, prices_include_tax: true,
      taxes: [{ tax_type: 'iva', rate: 19 }, { tax_type: 'icui', rate: 20, is_inclusive: false }],
    });
    expect(r.net_total).toBe(1000);
    expect(by(r, 'iva').tax_amount).toBe(190);
    expect(by(r, 'icui').tax_amount).toBe(200);
    expect(r.line_total).toBe(1390);
  });

  it('ICUI + IVA net_plus_prior exclusivos', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1000, quantity: 1, prices_include_tax: false,
      taxes: [{ tax_type: 'icui', rate: 20 }, { tax_type: 'iva', rate: 19, base_mode: 'net_plus_prior' }],
    });
    expect(by(r, 'icui').tax_amount).toBe(200);
    expect(by(r, 'iva').tax_amount).toBe(228);
    expect(r.line_total).toBe(1428);
  });

  it('IVA base net', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1000, quantity: 1, prices_include_tax: false,
      taxes: [{ tax_type: 'icui', rate: 20 }, { tax_type: 'iva', rate: 19, base_mode: 'net' }],
    });
    expect(by(r, 'iva').tax_amount).toBe(190);
  });

  it('cascada incluida', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1428, quantity: 1, prices_include_tax: true,
      taxes: [{ tax_type: 'icui', rate: 20 }, { tax_type: 'iva', rate: 19, base_mode: 'net_plus_prior' }],
    });
    expect(r.net_total).toBe(1000);
    expect(by(r, 'iva').tax_amount).toBe(228);
  });

  it('IBUA fijo por unidad', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1000, quantity: 5, prices_include_tax: false,
      taxes: [{ tax_type: 'ibua', fixed_amount_per_unit: 68 }],
    });
    expect(by(r, 'ibua').tax_amount).toBe(340);
    expect(by(r, 'ibua').add_to_cost).toBe(true);
    expect(by(r, 'ibua').calc_mode).toBe('fixed_per_unit');
  });

  it('permutaciones deep-equal', () => {
    const t: PurchaseLineTaxInput[] = [
      { tax_type: 'iva', rate: 19, base_mode: 'net_plus_prior' },
      { tax_type: 'icui', rate: 20 },
      { tax_type: 'inc', rate: 8 },
    ];
    const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
    const results = perms.map((p) =>
      resolvePurchaseLineTaxes({
        unit_price: 1500, quantity: 1, prices_include_tax: true,
        taxes: p.map((i) => t[i]),
      }),
    );
    results.forEach((r) => expect(r).toEqual(results[0]));
  });

  it('descuento', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1190, quantity: 2, discount_amount: 238, prices_include_tax: true,
      taxes: [{ tax_type: 'iva', rate: 19 }],
    });
    expect(r.gross_line).toBe(2142);
    expect(r.net_total).toBe(1800);
    expect(by(r, 'iva').tax_amount).toBe(342);
  });

  it('amount_override', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1190, quantity: 1, prices_include_tax: true,
      taxes: [{ tax_type: 'iva', rate: 19, amount_override: 191 }],
    });
    expect(by(r, 'iva').tax_amount).toBe(191);
    expect(by(r, 'iva').override_delta).toBe(1);
    expect(r.net_total).toBe(999);
  });

  it('add_to_cost forzado en INC; IVA respeta el valor', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 1000, quantity: 1, prices_include_tax: false,
      taxes: [
        { tax_type: 'inc', rate: 8, add_to_cost: false },
        { tax_type: 'iva', rate: 19 },
      ],
    });
    expect(by(r, 'inc').add_to_cost).toBe(true);
    expect(by(r, 'iva').add_to_cost).toBe(false);
    expect(r.non_capitalized_tax_total).toBe(190);
  });

  it('decimales feos: base + incluidos === bruto', () => {
    const r = resolvePurchaseLineTaxes({
      unit_price: 999.99, quantity: 1, prices_include_tax: true,
      taxes: [{ tax_type: 'iva', rate: 19 }, { tax_type: 'inc', rate: 8 }],
    });
    for (const t of r.taxes) {
      expect(Math.round(t.tax_amount * 100)).toBeCloseTo(t.tax_amount * 100, 6);
    }
    expect(Math.round((r.net_total + r.inclusive_tax_total) * 100)).toBe(99999);
    expect(r.line_total).toBe(999.99);
  });

  it('errores y lista vacía', () => {
    expect(() => resolvePurchaseLineTaxes({ unit_price: 10, quantity: 0, prices_include_tax: false, taxes: [] })).toThrow('PURCHASE_TAX_INVALID_LINE');
    expect(() => resolvePurchaseLineTaxes({ unit_price: 10, quantity: 1, prices_include_tax: false, taxes: [{ tax_type: 'iva', rate: -1 }] })).toThrow();
    expect(() => resolvePurchaseLineTaxes({ unit_price: 10, quantity: 1, discount_amount: 20, prices_include_tax: false, taxes: [] })).toThrow();
    const r = resolvePurchaseLineTaxes({ unit_price: 10, quantity: 3, prices_include_tax: true, taxes: [] });
    expect(r.net_total).toBe(30);
    expect(r.iva).toBeNull();
  });
});

describe('resolvePurchaseLineDiscount', () => {
  const net = (
    unit_price: number,
    quantity: number,
    d: Parameters<typeof resolvePurchaseLineDiscount>[0],
  ) =>
    resolvePurchaseLineTaxes({
      unit_price,
      quantity,
      discount_amount: resolvePurchaseLineDiscount(d).kernel_discount,
      prices_include_tax: false,
      taxes: [],
    }).net_total;

  it('85,71 x 7 con 50 %: descuento 299,98 y neto 299,99', () => {
    const d = { unit_price: 85.71, quantity: 7, discount_percentage: 50 };
    expect(resolvePurchaseLineDiscount(d).discount_total).toBe(299.98);
    expect(net(85.71, 7, d)).toBe(299.99);
  });

  it('1234,57 x 999 con 50 % + cabecera 17,35', () => {
    const d = {
      unit_price: 1234.57,
      quantity: 999,
      discount_percentage: 50,
      prorated_header_discount: 17.35,
    };
    const r = resolvePurchaseLineDiscount(d);
    const exact = 1234.57 * 999 * 0.5 + 17.35;
    expect(r.discount_total).toBe(Math.round(exact * 100) / 100);
    expect(r.kernel_discount).toBe(r.discount_total);
    expect(net(1234.57, 999, d)).toBe(
      Math.round((1234.57 * 999 - r.discount_total) * 100) / 100,
    );
  });

  it('999 x 0,315 con descuento 400 cubre la línea: neto 0 sin lanzar', () => {
    const d = { unit_price: 0.315, quantity: 999, discount_amount: 400 };
    const r = resolvePurchaseLineDiscount(d);
    expect(r.discount_total).toBe(314.69);
    expect(r.kernel_discount).toBe(314.685);
    expect(net(0.315, 999, d)).toBe(0);
  });

  it('el monto gana sobre el porcentaje', () => {
    const r = resolvePurchaseLineDiscount({
      unit_price: 100,
      quantity: 2,
      discount_amount: 10,
      discount_percentage: 50,
    });
    expect(r.discount_total).toBe(10);
    expect(r.kernel_discount).toBe(10);
  });

  it('piso 0: descuento negativo no suma', () => {
    const r = resolvePurchaseLineDiscount({
      unit_price: 100,
      quantity: 1,
      discount_percentage: -5,
    });
    expect(r).toEqual({ discount_total: 0, kernel_discount: 0 });
  });

  it('cantidad 0: total 0 y descuento por unidad con cantidad 1', () => {
    const r = resolvePurchaseLineDiscount({
      unit_price: 100,
      quantity: 0,
      discount_amount: 30,
    });
    expect(r.discount_total).toBe(0);
    expect(r.kernel_discount).toBe(30);
  });
});
