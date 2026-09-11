import { Prisma } from '@prisma/client';
import {
  INCLUSIVE_ABSORB_KERNEL_VERSION,
  INCLUSIVE_ABSORB_MAX_STEPS,
  absorbInclusiveLine,
  absorbPriceUnitDivisor,
  absorbRateToFraction,
  dianAmount,
  type AbsorbKernelLineInput,
} from './dian-money.util';

/**
 * A.2 — matriz del kernel único de absorción (CP-facturacion-impuesto-incluido-redondeo).
 *
 * El kernel vive en la hoja `dian-money.util.ts` y es el dueño único de la
 * búsqueda acotada (ADR-01): motor y espejo son llamadas delgadas. Todas las
 * cifras están calculadas A MANO en los comentarios (aritmética Decimal
 * independiente, nunca llamando al kernel). Archivo NUEVO: no toca los specs
 * de A.1.
 */
describe('absorbInclusiveLine — kernel único (A.2)', () => {
  const line = (
    gross: number,
    rates: AbsorbKernelLineInput['rates'],
    extra: Partial<AbsorbKernelLineInput> = {},
  ): AbsorbKernelLineInput => ({
    gross,
    quantity: 1,
    unit_price: gross,
    rates,
    ...extra,
  });
  const inc8 = { rate: 8, rate_basis: 'percent', tax_type: 'inc', is_inclusive: true };

  it('expone versión y cota fija', () => {
    expect(INCLUSIVE_ABSORB_KERNEL_VERSION).toBe('inclusive-absorb-v1');
    expect(INCLUSIVE_ABSORB_MAX_STEPS).toBe(16);
  });

  it('$3.000 con INC 8% dentro ⇒ base 2777.78, cuota 222.22, total 3000.00', () => {
    // B0 = trunc(3000/1.08) = 2777.77; f = 2999.99.
    // +1¢: trunc(2777.78×0.08) = trunc(222.2224) = 222.22 ⇒ 3000.00 ✓.
    const r = absorbInclusiveLine(line(3000, [inc8]));
    expect(r.closed_exactly).toBe(true);
    expect(r.unclosed_residual_cents).toBe(0);
    expect(r.residual_absorbed_cents).toBe(1);
    expect(r.steps).toBe(1);
    expect(r.invalid_inputs).toEqual([]);
    expect(dianAmount(r.base)).toBe('2777.78');
    expect(dianAmount(r.quotas[0].quota)).toBe('222.22');
    expect(dianAmount(r.closed_total)).toBe('3000.00');
  });

  it('$5.000 con INC 8% dentro ⇒ base 4629.63, cuota 370.37, total 5000.00', () => {
    // B0 = trunc(5000/1.08) = 4629.62; f = 4999.98 (−2¢ por doble truncado).
    // +1¢: trunc(4629.63×0.08) = trunc(370.3704) = 370.37 ⇒ 5000.00 ✓.
    const r = absorbInclusiveLine(line(5000, [inc8]));
    expect(r.closed_exactly).toBe(true);
    expect(dianAmount(r.base)).toBe('4629.63');
    expect(dianAmount(r.quotas[0].quota)).toBe('370.37');
    expect(dianAmount(r.closed_total)).toBe('5000.00');
    expect(r.residual_absorbed_cents).toBe(1);
  });

  it('$100 con IVA 19% dentro ⇒ base 84.04, cuota 15.96, total 100.00', () => {
    // B0 = trunc(100/1.19) = 84.03; f = 99.99.
    // +1¢: trunc(84.04×0.19) = trunc(15.9676) = 15.96 ⇒ 100.00 ✓.
    // La cuota sigue siendo trunc(base_final × r): DIAN por construcción.
    const r = absorbInclusiveLine(
      line(100, [{ rate: 19, rate_basis: 'percent', tax_type: 'iva', is_inclusive: true }]),
    );
    expect(r.closed_exactly).toBe(true);
    expect(dianAmount(r.base)).toBe('84.04');
    expect(dianAmount(r.quotas[0].quota)).toBe('15.96');
    expect(dianAmount(r.closed_total)).toBe('100.00');
  });

  it('$17 con INC 8% termina en closest-below sin sobrecobrar (F-039, prueba de terminación)', () => {
    // f(15.74) = 15.74+1.25 = 16.99; f(15.75) = 15.75+1.26 = 17.01 > 17:
    // el bruto es INALCANZABLE (1699→1701¢). Closest-below + residuo 1¢,
    // jamás overshoot. El timeout es la prueba de terminación: un loop de
    // igualdad abierto colgaría acá.
    const r = absorbInclusiveLine(line(17, [inc8]));
    expect(r.closed_exactly).toBe(false);
    expect(r.capped).toBe(false);
    expect(dianAmount(r.base)).toBe('15.74');
    expect(dianAmount(r.quotas[0].quota)).toBe('1.25');
    expect(dianAmount(r.closed_total)).toBe('16.99');
    expect(Number(dianAmount(r.closed_total))).toBeLessThanOrEqual(17);
    expect(r.unclosed_residual_cents).toBe(1);
  }, 10000);

  it('barrido $1–$200 @ 8%: siempre termina, nunca sobrecobra, pasos bajo la cota', () => {
    // Prueba de terminación por exhaustividad en el rango crítico: cada bruto
    // o cierra exacto o declara su residuo, con pasos ≤ cota fija.
    for (let gross = 1; gross <= 200; gross++) {
      const r = absorbInclusiveLine(line(gross, [inc8]));
      expect(r.steps).toBeLessThanOrEqual(INCLUSIVE_ABSORB_MAX_STEPS);
      expect(r.capped).toBe(false);
      expect(Number(dianAmount(r.closed_total))).toBeLessThanOrEqual(gross);
      const residual = Math.round((gross - Number(dianAmount(r.closed_total))) * 100);
      expect(residual).toBe(r.unclosed_residual_cents);
      if (r.closed_exactly) expect(residual).toBe(0);
    }
  });

  it('$3.000 con IVA 19% + INC 8% ⇒ closest-below 2999.99, residuo 1 (F-007)', () => {
    // B0 = trunc(3000/1.27) = 2362.20; f = 2999.98.
    // +1¢: 2362.21 + 448.81 + 188.97 = 2999.99 ✓.
    // +2¢: el IVA salta a 448.82 ⇒ 3000.01 overshoot: multi-tasa avanza 1+k.
    const r = absorbInclusiveLine(
      line(3000, [
        { rate: 19, rate_basis: 'percent', tax_type: 'iva', is_inclusive: true },
        inc8,
      ]),
    );
    expect(r.closed_exactly).toBe(false);
    expect(dianAmount(r.base)).toBe('2362.21');
    expect(dianAmount(r.quotas[0].quota)).toBe('448.81');
    expect(dianAmount(r.quotas[1].quota)).toBe('188.97');
    expect(dianAmount(r.closed_total)).toBe('2999.99');
    expect(r.unclosed_residual_cents).toBe(1);
  });

  it('$1.000 con IVA 19% + IVA 5% ⇒ base 806.46, total 1000.00', () => {
    // B0 = trunc(1000/1.24) = 806.45; f = 999.99.
    // +1¢: 153.22 + 40.32 ⇒ 1000.00 ✓.
    const r = absorbInclusiveLine(
      line(1000, [
        { rate: 19, rate_basis: 'percent', tax_type: 'iva', is_inclusive: true },
        { rate: 5, rate_basis: 'percent', tax_type: 'iva', is_inclusive: true },
      ]),
    );
    expect(r.closed_exactly).toBe(true);
    expect(dianAmount(r.base)).toBe('806.46');
    expect(dianAmount(r.quotas[0].quota)).toBe('153.22');
    expect(dianAmount(r.quotas[1].quota)).toBe('40.32');
  });

  it('$1.000.000 con ICA 9.66‰ ⇒ base 990432.43, total 1000000.00 (F-032)', () => {
    // 9.66‰ = fracción 0.00966. B0 = trunc(1000000/1.00966) = 990432.42;
    // f = 999999.99. +1¢: trunc(990432.43×0.00966) = 9567.57 ⇒ 1000000.00 ✓.
    const r = absorbInclusiveLine(
      line(1000000, [{ rate: 9.66, rate_basis: 'per_mil', tax_type: 'ica', is_inclusive: true }]),
    );
    expect(r.closed_exactly).toBe(true);
    expect(dianAmount(r.base)).toBe('990432.43');
    expect(dianAmount(r.quotas[0].quota)).toBe('9567.57');
    expect(dianAmount(r.closed_total)).toBe('1000000.00');
  });

  it('percent | per_mil | fraction son la misma fracción (F-013/F-032)', () => {
    // 9.66‰ = 0.966% = fracción 0.00966: las tres unidades cierran idéntico.
    const mk = (rate: number, rate_basis: string) =>
      absorbInclusiveLine(
        line(1000000, [{ rate, rate_basis, tax_type: 'ica', is_inclusive: true }]),
      );
    const a = mk(9.66, 'per_mil');
    const b = mk(0.966, 'percent');
    const c = mk(0.00966, 'fraction');
    for (const r of [a, b, c]) {
      expect(r.invalid_inputs).toEqual([]);
      expect(dianAmount(r.base)).toBe('990432.43');
      expect(dianAmount(r.closed_total)).toBe('1000000.00');
    }
    expect(a.quotas[0].rate_basis).toBe('per_mil');
    expect(b.quotas[0].rate_basis).toBe('percent');
    expect(c.quotas[0].rate_basis).toBe('fraction');
  });

  it('G=2990.11 ($3.000 − 9.89 dto.) con INC 8% ⇒ closest-below 2990.10 (F-006)', () => {
    // B0 = trunc(2990.11/1.08) = 2768.62; f = 2990.10.
    // +1¢ ⇒ 2990.12 overshoot: closest-below + residuo.
    const r = absorbInclusiveLine(line(2990.11, [inc8]));
    expect(r.closed_exactly).toBe(false);
    expect(dianAmount(r.base)).toBe('2768.62');
    expect(dianAmount(r.quotas[0].quota)).toBe('221.48');
    expect(dianAmount(r.closed_total)).toBe('2990.10');
    expect(r.unclosed_residual_cents).toBe(1);
  });

  it('caso exacto histórico: 127000 @ 19%+8% cierra en B0, byte-idéntico', () => {
    // 127000/1.27 = 100000.00 exacto: el kernel no mueve nada y las cadenas
    // son las del camino legacy (F-041: un dianAmount por valor terminal).
    const r = absorbInclusiveLine(
      line(127000, [
        { rate: 19, rate_basis: 'percent', tax_type: 'iva', is_inclusive: true },
        inc8,
      ]),
    );
    expect(r.closed_exactly).toBe(true);
    expect(r.residual_absorbed_cents).toBe(0);
    expect(r.steps).toBe(0);
    expect(r.searched).toBe(true);
    expect(dianAmount(r.base)).toBe('100000.00');
    expect(dianAmount(r.quotas[0].quota)).toBe('19000.00');
    expect(dianAmount(r.quotas[1].quota)).toBe('8000.00');
    // Espacio Decimal, sin round-trip por strings: base y cuotas son Decimal.
    expect(r.base).toBeInstanceOf(Prisma.Decimal);
    expect(r.quotas[0].quota).toBeInstanceOf(Prisma.Decimal);
  });

  it('exclusivo limpio: atajo sin búsqueda, base = bruto', () => {
    const r = absorbInclusiveLine(
      line(100000, [{ rate: 19, rate_basis: 'percent', tax_type: 'iva', is_inclusive: false }]),
    );
    expect(r.searched).toBe(false);
    expect(r.closed_exactly).toBe(true);
    expect(dianAmount(r.base)).toBe('100000.00');
    expect(dianAmount(r.quotas[0].quota)).toBe('19000.00');
    expect(dianAmount(r.closed_total)).toBe('119000.00');
  });

  it('exclusivo + inclusivo: f sólo usa lo inclusivo, lo exclusivo suma encima', () => {
    // Bruto 119000 con IVA dentro + ICA 7‰ encima: el cierre es contra
    // 119000 y el ICA se suma sobre la base final.
    const r = absorbInclusiveLine(
      line(119000, [
        { rate: 19, rate_basis: 'percent', tax_type: 'iva', is_inclusive: true },
        { rate: 7, rate_basis: 'per_mil', tax_type: 'ica', is_inclusive: false },
      ]),
    );
    expect(r.closed_exactly).toBe(true);
    expect(dianAmount(r.base)).toBe('100000.00');
    expect(dianAmount(r.closed_total)).toBe('119700.00');
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ["'abc'", 'abc'],
    ["locale '1.000,50'", '1.000,50'],
    ["vacío ''", ''],
  ])('bruto %s ⇒ coerción legacy (0) + reporte, sin lanzar', (_label, gross) => {
    const r = absorbInclusiveLine(line(gross as unknown as number, [inc8]));
    expect(r.invalid_inputs.length).toBeGreaterThan(0);
    expect(dianAmount(r.base)).toBe('0.00');
    expect(dianAmount(r.closed_total)).toBe('0.00');
  });

  it('neto negativo (sobre-descuento) ⇒ bruto=max(0,net) + reporte net:negative', () => {
    const r = absorbInclusiveLine(line(-300, [inc8]));
    expect(r.invalid_inputs).toContain('net:negative');
    expect(dianAmount(r.gross)).toBe('0.00');
    expect(dianAmount(r.base)).toBe('0.00');
  });

  it.each([
    ['quantity NaN', { quantity: NaN }],
    ["unit_price 'abc'", { unit_price: 'abc' }],
    ['discount NaN', { discount_amount: NaN }],
  ])('%s ⇒ reportado (totales en coerción legacy)', (_label, extra) => {
    const r = absorbInclusiveLine(line(3000, [inc8], extra as Partial<AbsorbKernelLineInput>));
    expect(r.invalid_inputs.length).toBeGreaterThan(0);
  });

  it('tasa NaN ⇒ fracción 0 legacy + reporte (no se confunde con 0% válido)', () => {
    const r = absorbInclusiveLine(line(3000, [{ rate: NaN, is_inclusive: true }]));
    expect(r.invalid_inputs.some((c) => c.includes('rate:non_finite'))).toBe(true);
    // Sin búsqueda con entradas inválidas: base = bruto, cuota 0.
    expect(dianAmount(r.base)).toBe('3000.00');
  });

  it('tasa 0% es válida (exento legítimo): sin reporte, sin búsqueda', () => {
    const r = absorbInclusiveLine(line(50000, [{ rate: 0, is_inclusive: true }]));
    expect(r.invalid_inputs).toEqual([]);
    expect(dianAmount(r.base)).toBe('50000.00');
    expect(dianAmount(r.closed_total)).toBe('50000.00');
  });

  it('tasa negativa ⇒ valor legacy conservado + reporte rate:negative', () => {
    const { fraction, invalid } = absorbRateToFraction(-5, 'percent');
    expect(fraction.toNumber()).toBeCloseTo(-0.05, 10);
    expect(invalid).toBe('rate:negative');
  });

  it('rate_basis desconocido ⇒ fallback percent legacy + reporte', () => {
    const { fraction, basis, invalid } = absorbRateToFraction(8, 'fortnight');
    expect(basis).toBe('percent');
    expect(fraction.toNumber()).toBeCloseTo(0.08, 10);
    expect(invalid).toBe('rate_basis:unknown:fortnight');
    const r = absorbInclusiveLine(line(3000, [{ rate: 8, rate_basis: 'fortnight', is_inclusive: true }]));
    expect(r.invalid_inputs.some((c) => c.includes('rate_basis:unknown'))).toBe(true);
  });

  it.each([
    ["'false' string", 'false'],
    ["'true' string", 'true'],
    ['1 numérico', 1],
    ['0 numérico', 0],
  ])('is_inclusive %s ⇒ exclusivo: sólo true booleano despeja (F-035)', (_label, flag) => {
    const r = absorbInclusiveLine(
      line(100000, [{ rate: 0.19, rate_basis: 'fraction', is_inclusive: flag as unknown as boolean }]),
    );
    expect(r.invalid_inputs).toEqual([]);
    expect(r.quotas[0].is_inclusive).toBe(false);
    expect(dianAmount(r.base)).toBe('100000.00');
    expect(dianAmount(r.quotas[0].quota)).toBe('19000.00');
    // Exclusivo suma ENCIMA del bruto (no despeja): 100000 + 19000.
    expect(dianAmount(r.closed_total)).toBe('119000.00');
  });

  it('tax_type fuera de la whitelist de 6 ⇒ normalización legacy + reporte', () => {
    const r = absorbInclusiveLine(line(3000, [{ rate: 8, tax_type: 'foobar', is_inclusive: true }]));
    expect(r.quotas[0].tax_type).toBe('foobar');
    expect(r.invalid_inputs).toContain('rates[0].tax_type:unknown:foobar');
    // Ausente ⇒ iva sin reporte; mayúsculas se normalizan sin reporte.
    const ok = absorbInclusiveLine(
      line(3000, [
        { rate: 8, tax_type: 'INC', is_inclusive: true },
        { rate: 19, is_inclusive: false },
      ]),
    );
    expect(ok.invalid_inputs).toEqual([]);
    expect(ok.quotas[0].tax_type).toBe('inc');
    expect(ok.quotas[1].tax_type).toBe('iva');
  });

  it('price_unit_quantity: entero ≥1 o ausente; el resto se reporta con coerción legacy (F-037)', () => {
    const invalid: string[] = [];
    // Compat: >1 ? n : 1.
    expect(absorbPriceUnitDivisor(2, invalid).toNumber()).toBe(2);
    expect(absorbPriceUnitDivisor(undefined, invalid).toNumber()).toBe(1);
    expect(absorbPriceUnitDivisor(null, invalid).toNumber()).toBe(1);
    expect(invalid).toEqual([]);
    expect(absorbPriceUnitDivisor(1.5, invalid).toNumber()).toBe(1.5);
    expect(absorbPriceUnitDivisor(0, invalid).toNumber()).toBe(1);
    expect(absorbPriceUnitDivisor('12abc', invalid).toNumber()).toBe(1);
    expect(invalid).toHaveLength(3);
    // Y en el kernel: la entrada basura no tumba el despeje legacy (B0 sin
    // climb: 2777.77 + 222.22 = 2999.99), pero queda el reporte y el residuo.
    const r = absorbInclusiveLine(line(3000, [inc8], { price_unit_quantity: 1.5 }));
    expect(r.closed_exactly).toBe(false);
    expect(dianAmount(r.base)).toBe('2777.77');
    expect(r.unclosed_residual_cents).toBe(1);
    expect(r.invalid_inputs.some((c) => c.startsWith('price_unit_quantity:'))).toBe(true);
  });
});
