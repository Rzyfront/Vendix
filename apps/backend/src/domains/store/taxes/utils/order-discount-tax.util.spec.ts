import {
  projectOrderLineDiscount,
  projectOrderLineDiscountsChain,
  applyGrossDiscountRetax,
  distributeAmount,
  DiscountableLine,
  GrossDiscountableLine,
} from './order-discount-tax.util';

describe('order-discount-tax.util', () => {
  describe('projectOrderLineDiscount — percentage', () => {
    it('cupón 100% deja base 0, impuesto 0 y descuento = base total (repro bug POS Pollo Entero + 1/4 Pollo)', () => {
      const lines: DiscountableLine[] = [
        { base: 59000, taxRows: [{ rate: 0.08, tax_type: 'INC' }], eligible: true },
        { base: 18500, taxRows: [{ rate: 0.08, tax_type: 'INC' }], eligible: true },
      ];
      const result = projectOrderLineDiscount(lines, {
        mode: 'percentage',
        value: 100,
      });

      expect(result.totalBase).toBe(0);
      expect(result.totalTax).toBe(0);
      expect(result.totalBaseDiscount).toBe(77500);
      result.lines.forEach((l) => {
        expect(l.base).toBe(0);
        expect(l.taxTotal).toBe(0);
      });
    });

    it('10% sobre líneas con tarifas mixtas (IVA 19% + INC 8%) recalcula impuesto por línea sobre base descontada', () => {
      const lines: DiscountableLine[] = [
        { base: 100000, taxRows: [{ rate: 0.19, tax_type: 'IVA' }], eligible: true },
        { base: 50000, taxRows: [{ rate: 0.08, tax_type: 'INC' }], eligible: true },
      ];
      const result = projectOrderLineDiscount(lines, {
        mode: 'percentage',
        value: 10,
      });

      // Línea 1: base 100000 -> 90000, IVA 19% -> 17100
      expect(result.lines[0].base).toBe(90000);
      expect(result.lines[0].taxTotal).toBe(17100);
      // Línea 2: base 50000 -> 45000, INC 8% -> 3600
      expect(result.lines[1].base).toBe(45000);
      expect(result.lines[1].taxTotal).toBe(3600);

      expect(result.totalBaseDiscount).toBe(15000); // 10% de 150000
      expect(result.totalTax).toBe(20700); // 17100 + 3600
      expect(result.totalBase).toBe(135000);
    });

    it('excluye líneas no elegibles (cupón/promo con alcance restringido)', () => {
      const lines: DiscountableLine[] = [
        { base: 100000, taxRows: [{ rate: 0.19 }], eligible: true },
        { base: 50000, taxRows: [{ rate: 0.19 }], eligible: false },
      ];
      const result = projectOrderLineDiscount(lines, {
        mode: 'percentage',
        value: 50,
      });

      expect(result.lines[0].base).toBe(50000);
      expect(result.lines[1].base).toBe(50000); // sin tocar
      expect(result.lines[1].baseDiscount).toBe(0);
      expect(result.totalBaseDiscount).toBe(50000);
    });
  });

  describe('projectOrderLineDiscount — fixed', () => {
    it('cupón fijo $10.000 se prorratea por BASE (no por bruto) entre líneas elegibles, tope en base elegible', () => {
      const lines: DiscountableLine[] = [
        { base: 30000, taxRows: [{ rate: 0.19 }], eligible: true },
        { base: 70000, taxRows: [{ rate: 0.19 }], eligible: true },
      ];
      const result = projectOrderLineDiscount(lines, {
        mode: 'fixed',
        amount: 10000,
      });

      // proporción 30/100 y 70/100 de 10000
      expect(result.lines[0].baseDiscount).toBe(3000);
      expect(result.lines[1].baseDiscount).toBe(7000);
      expect(result.totalBaseDiscount).toBe(10000);
      expect(result.lines[0].base).toBe(27000);
      expect(result.lines[1].base).toBe(63000);
      expect(result.lines[0].taxTotal).toBe(round(27000 * 0.19));
      expect(result.lines[1].taxTotal).toBe(round(63000 * 0.19));
    });

    it('cupón fijo mayor que la base elegible se topa en la base total (nunca negativo)', () => {
      const lines: DiscountableLine[] = [
        { base: 10000, taxRows: [{ rate: 0.19 }], eligible: true },
      ];
      const result = projectOrderLineDiscount(lines, {
        mode: 'fixed',
        amount: 999999,
      });

      expect(result.totalBaseDiscount).toBe(10000);
      expect(result.totalBase).toBe(0);
      expect(result.totalTax).toBe(0);
    });
  });

  describe('línea con impuesto inclusivo (is_inclusive)', () => {
    it('recalcula igual: la base ya viene "clearada" (sin impuesto), is_inclusive es sólo metadata', () => {
      const lines: DiscountableLine[] = [
        {
          base: 40000,
          taxRows: [{ rate: 0.08, tax_type: 'INC', is_inclusive: true }],
          eligible: true,
        },
      ];
      const result = projectOrderLineDiscount(lines, {
        mode: 'percentage',
        value: 25,
      });

      expect(result.lines[0].base).toBe(30000);
      expect(result.lines[0].taxTotal).toBe(2400);
      expect((result.lines[0].taxes[0] as any).is_inclusive).toBeUndefined(); // amount recomputed, flag not echoed on the amount row (rate/type preserved instead)
      expect(result.lines[0].taxes[0].rate).toBe(0.08);
    });
  });

  describe('projectOrderLineDiscountsChain — promoción + cupón acumulados', () => {
    it('aplica cada descuento sobre la base ya reducida por el anterior y acumula discount_amount total', () => {
      const lines: DiscountableLine[] = [
        { base: 100000, taxRows: [{ rate: 0.19 }], eligible: true },
      ];
      const result = projectOrderLineDiscountsChain(lines, [
        { mode: 'percentage', value: 10 }, // promo: 100000 -> 90000
        { mode: 'fixed', amount: 20000 }, // cupón: 90000 -> 70000
      ]);

      expect(result.totalBase).toBe(70000);
      expect(result.totalBaseDiscount).toBe(30000);
      expect(result.totalTax).toBe(round(70000 * 0.19));
    });

    it('cupón 100% encadenado tras una promoción deja base y total en 0', () => {
      const lines: DiscountableLine[] = [
        { base: 59000, taxRows: [{ rate: 0.08 }], eligible: true },
        { base: 18500, taxRows: [{ rate: 0.08 }], eligible: true },
      ];
      const result = projectOrderLineDiscountsChain(lines, [
        { mode: 'percentage', value: 5 },
        { mode: 'percentage', value: 100 },
      ]);

      expect(result.totalBase).toBe(0);
      expect(result.totalTax).toBe(0);
      expect(result.totalBaseDiscount).toBe(77500);
    });
  });
});

describe('applyGrossDiscountRetax — POS (descuento por línea ya en bruto)', () => {
  it('repro exacto del bug reportado: Pollo Entero + 1/4 Pollo + cupón 100% ⇒ impuesto 0, descuento base-only 77.500, total 0', () => {
    const lines: GrossDiscountableLine[] = [
      { base: 59000, grossOriginal: 63720, taxRows: [{ rate: 0.08, tax_type: 'INC' }] },
      { base: 18500, grossOriginal: 19980, taxRows: [{ rate: 0.08, tax_type: 'INC' }] },
    ];
    // Cupón 100% capado al bruto restante (83.700), prorrateado por bruto.
    const couponShare = distributeAmount(83700, lines.map((l) => l.grossOriginal));
    const result = applyGrossDiscountRetax(lines, couponShare);

    expect(result.totalBase).toBe(0);
    expect(result.totalTax).toBe(0);
    expect(result.totalBaseDiscount).toBe(77500);

    const subtotal = 77500; // orders.subtotal_amount, sin cambios (pre-descuento)
    const grandTotal = Math.max(
      0,
      subtotal + result.totalTax - result.totalBaseDiscount,
    );
    expect(grandTotal).toBe(0);
  });

  it('10% de descuento (bruto) sobre tarifa uniforme reproduce EXACTO el 10% sobre base + retax (identidad fracción bruto ≡ fracción base)', () => {
    const lines: GrossDiscountableLine[] = [
      { base: 59000, grossOriginal: 63720, taxRows: [{ rate: 0.08 }] },
      { base: 18500, grossOriginal: 19980, taxRows: [{ rate: 0.08 }] },
    ];
    const grossDiscountByLine = distributeAmount(8370, lines.map((l) => l.grossOriginal)); // 10% de 83700
    const result = applyGrossDiscountRetax(lines, grossDiscountByLine);

    expect(result.totalBase).toBe(69750); // 90% de 77500
    expect(result.totalTax).toBe(5580); // 8% de 69750
    expect(result.totalBaseDiscount).toBe(7750); // 10% de 77500 (BASE-only)

    const subtotal = 77500;
    const grandTotal = subtotal + result.totalTax - result.totalBaseDiscount;
    expect(grandTotal).toBe(75330); // 90% de 83700 — coincide con el bruto esperado
  });

  it('descuento sólo elegible en una línea (promoción con alcance de producto) no toca la otra', () => {
    const lines: GrossDiscountableLine[] = [
      { base: 100000, grossOriginal: 119000, taxRows: [{ rate: 0.19 }] },
      { base: 50000, grossOriginal: 59500, taxRows: [{ rate: 0.19 }] },
    ];
    // Sólo la línea 0 tiene descuento (promoción con scope=product); línea 1 en 0.
    const result = applyGrossDiscountRetax(lines, [23800, 0]); // 20% del bruto de la línea 0

    expect(result.lines[0].base).toBe(80000);
    expect(result.lines[0].taxTotal).toBe(15200);
    expect(result.lines[1].base).toBe(50000); // intacta
    expect(result.lines[1].taxTotal).toBe(9500); // 19% sin tocar
  });
});

describe('applyGrossDiscountRetax — cierre a centavo contra el bruto del cliente', () => {
  const lines: GrossDiscountableLine[] = [
    { base: 49579.83, grossOriginal: 59000, taxRows: [{ rate: 0.19 }] },
    { base: 15546.22, grossOriginal: 18500, taxRows: [{ rate: 0.19 }] },
    { base: 8403.36, grossOriginal: 10000, taxRows: [{ rate: 0.19 }] },
  ];

  it('59.000 / 18.500 / 10.000 con cupón 10%: total 78.750,00 (antes 78.749,99), el residuo va al descuento de la línea mayor', () => {
    const grossDiscountByLine = distributeAmount(
      8750,
      lines.map((l) => l.grossOriginal),
    );
    const result = applyGrossDiscountRetax(lines, grossDiscountByLine);

    expect(
      Math.round((result.totalBase + result.totalTax) * 100) / 100,
    ).toBe(78750);
    // Impuesto sigue siendo base × tarifa por línea (aritmética DIAN).
    result.lines.forEach((l) =>
      expect(l.taxTotal).toBe(Math.round(l.base * 0.19 * 100) / 100),
    );
    // Las líneas menores conservan su reparto proporcional; sólo la mayor absorbe.
    expect(result.lines[1].base).toBe(13991.6);
    expect(result.lines[2].base).toBe(7563.02);
    expect(result.lines[0].base).not.toBe(44621.85);
  });
});

describe('distributeAmount', () => {
  it('cuadra exacto a centavo aunque la proporción no sea exacta', () => {
    const result = distributeAmount(100, [1, 1, 1]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('devuelve ceros cuando el monto es 0', () => {
    expect(distributeAmount(0, [10, 20])).toEqual([0, 0]);
  });
});

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
