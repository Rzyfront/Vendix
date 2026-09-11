import {
  resolveLineTotals,
  truncMoney,
  type ResolvedLineTotals,
  type TaxRateForResolution,
} from './tax-inclusive-math.util';
import { dianAmount } from '../../invoicing/utils/dian-money.util';

/**
 * Lee el campo F-061 (`unclosed_residual_cents`, lo expone A.2) con tolerancia
 * a su ausencia pre-fix: antes del fix el campo no existe y el corto persiste
 * en silencio; después del fix vale el residuo en centavos (0 si cierra).
 */
function residualCents(r: ResolvedLineTotals): number {
  const v = (r as unknown as { unclosed_residual_cents?: unknown })
    .unclosed_residual_cents;
  return typeof v === 'number' ? v : 0;
  // Nota: 0 también es lo que este helper devuelve pre-fix (campo ausente),
  // así que los casos que esperan residuo 1 fallan hoy por las DOS vías
  // (total corto + campo ausente) y los que esperan 0 solo prueban el total.
}

/**
 * Lee el canal F-062 (`invalid_inputs`, lo expone A.2) con tolerancia a su
 * ausencia pre-fix: hoy el saneo colapsa NaN/Infinity/locale a 0 en silencio.
 */
function invalidInputs(r: ResolvedLineTotals): unknown[] {
  const v = (r as unknown as { invalid_inputs?: unknown }).invalid_inputs;
  return Array.isArray(v) ? v : [];
}

/**
 * Matriz de regresión A.6 — despeje impuesto-incluido con truncado DIAN.
 *
 * Cubre findings F-003/F-005/F-011/F-014 y steps/A.6 (5 casos:
 * agregado/inclusivo/mixto/0%/multi-tasa).
 *
 * TODAS las cifras esperadas están calculadas A MANO (ver comentarios), no
 * derivadas de la función bajo prueba. Un spec que llama a la función para
 * producir su propio esperado solo prueba determinismo.
 *
 * Convención: las tasas entran como FRACCIÓN (0.19 = 19%), igual que
 * `tax_rates.rate` (Decimal(6,5)) y `calculateProductTaxes`.
 */
describe('tax-inclusive-math — matriz A.6 (F-005 truncado DIAN)', () => {
  describe('caso 1 — agregado puro (== ayer)', () => {
    it('100000 + IVA 19% agregado ⇒ base 100000, cuota 19000, total 119000', () => {
      // Sin inclusivo no hay despeje: B = G = 100000.
      // Cuota = trunc(100000 × 0.19) = 19000. Total = G + agregado.
      const r = resolveLineTotals(100000, [{ rate: 0.19 }]);
      expect(r.base).toBe(100000);
      expect(r.taxes).toHaveLength(1);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.19,
        is_inclusive: false,
        base: 100000,
        amount: 19000,
      });
      expect(r.total).toBe(119000);
      expect(r.total_rate).toBe(0.19);
      expect(r.total_tax_amount).toBe(19000);
      expect(r.inclusive_tax_amount).toBe(0);
      expect(r.exclusive_tax_amount).toBe(19000);
    });
  });

  describe('caso 2 — inclusivo puro (el total NO crece)', () => {
    it('119000 con IVA 19% dentro ⇒ base 100000, cuota 19000, total 119000', () => {
      // B = 119000 / 1.19 = 100000 exacto. Cuota = trunc(100000 × 0.19).
      // Total = G + 0 agregado = 119000 (F-001: el total no crece).
      const r = resolveLineTotals(119000, [
        { rate: 0.19, is_inclusive: true },
      ]);
      expect(r.base).toBe(100000);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.19,
        is_inclusive: true,
        base: 100000,
        amount: 19000,
      });
      expect(r.total).toBe(119000);
      expect(r.inclusive_tax_amount).toBe(19000);
      expect(r.exclusive_tax_amount).toBe(0);
    });
  });

  describe('caso 3 — mixto (primero se despeja, lo agregado suma encima)', () => {
    it('100000 con INC 8% dentro + IVA 19% fuera ⇒ base 92592.60, total 117592.59', () => {
      // Divisor = 1.08 (SOLO lo inclusivo). B0 = trunc(100000/1.08)
      // = trunc(92592.5925…) = 92592.59; f(B0) = 99999.99 < bruto ⇒ +1¢
      // (A.2/ADR-01): base final 92592.60.
      // INC = trunc(92592.60 × 0.08) = trunc(7407.408) = 7407.40.
      // IVA = trunc(92592.60 × 0.19) = trunc(17592.594) = 17592.59.
      // Total = 100000 + 17592.59 = 117592.59 (idéntico; solo la base +1¢).
      const r = resolveLineTotals(100000, [
        { rate: 0.08, is_inclusive: true },
        { rate: 0.19, is_inclusive: false },
      ]);
      expect(r.base).toBe(92592.6);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.08,
        is_inclusive: true,
        base: 92592.6,
        amount: 7407.4,
      });
      expect(r.taxes[1]).toMatchObject({
        rate: 0.19,
        is_inclusive: false,
        base: 92592.6,
        amount: 17592.59,
      });
      expect(r.total).toBe(117592.59);
      expect(r.total_rate).toBeCloseTo(0.27, 10);
      expect(r.total_tax_amount).toBeCloseTo(24999.99, 2);
      expect(r.inclusive_tax_amount).toBe(7407.4);
      expect(r.exclusive_tax_amount).toBe(17592.59);
    });
  });

  describe('caso 4 — 0% / sin tasas (tasa ausente ⇒ 0, sin lanzar)', () => {
    it('tasa 0 explícita ⇒ base intacta, cuota 0, total == precio', () => {
      const r = resolveLineTotals(50000, [{ rate: 0 }]);
      expect(r.base).toBe(50000);
      expect(r.taxes[0].amount).toBe(0);
      expect(r.total).toBe(50000);
      expect(r.total_tax_amount).toBe(0);
    });

    it('rates null/undefined/vacío ⇒ sin despeje ni cuotas', () => {
      const empties: Array<TaxRateForResolution[] | null | undefined> = [
        null,
        undefined,
        [],
      ];
      for (const rates of empties) {
        const r = resolveLineTotals(50000, rates);
        expect(r.base).toBe(50000);
        expect(r.taxes).toEqual([]);
        expect(r.total).toBe(50000);
        expect(r.total_tax_amount).toBe(0);
      }
    });
  });

  describe('caso 5 — multi-tasa (el divisor es la SUMA, no cascada)', () => {
    it('127000 con 19%+8% dentro ⇒ base 100000 (cascada daría 98806.16)', () => {
      // Suma: 127000/1.27 = 100000. Cascada (impuesto-sobre-impuesto):
      // 127000/1.19/1.08 = 98806.16. Los tributos gravan la misma base.
      const r = resolveLineTotals(127000, [
        { rate: 0.19, is_inclusive: true },
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(r.base).toBe(100000);
      expect(r.taxes[0].amount).toBe(19000);
      expect(r.taxes[1].amount).toBe(8000);
      expect(r.total).toBe(127000);
      expect(r.total_tax_amount).toBe(27000);
    });

    it('100000 con 19%+8% fuera ⇒ base 100000, total 127000', () => {
      const r = resolveLineTotals(100000, [
        { rate: 0.19 },
        { rate: 0.08 },
      ]);
      expect(r.base).toBe(100000);
      expect(r.total).toBe(127000);
      expect(r.total_tax_amount).toBe(27000);
    });
  });

  describe('F-005 — truncado DIAN, nunca redondeo ni residuo-a-la-mayor', () => {
    it('100 con IVA dentro: cuota 15.96 (redondear daría 15.97)', () => {
      // A.2/ADR-01: B0 = trunc(100/1.19) = 84.03, +1¢ ⇒ base final 84.04.
      // Cuota = trunc(84.04 × 0.19) = trunc(15.9676) = 15.96: el TRUNCADO
      // SIGUE INTACTO (Math.round daría 15.97: ese centavo sigue siendo el
      // defecto F-005). Solo la base absorbe el residuo: 84.04+15.96=100.00.
      const r = resolveLineTotals(100, [{ rate: 0.19, is_inclusive: true }]);
      expect(r.base).toBe(84.04);
      expect(r.taxes[0].amount).toBe(15.96);
      expect(r.total).toBe(100);
    });

    it('truncMoney trunca hacia cero a 2 decimales', () => {
      expect(truncMoney(100.005)).toBe(100);
      expect(truncMoney(15.969)).toBe(15.96);
      expect(truncMoney(-15.969)).toBe(-15.96);
    });

    it('paridad con dian-money: el medio centavo no sube (Anexo 1.9 §11.2)', () => {
      expect(dianAmount(1000.005)).toBe('1000.00');
      expect(dianAmount(15.9657)).toBe('15.96');
      expect(dianAmount(null)).toBe('0.00');
    });
  });

  describe('saneo de entrada (tasa ausente/negativa ⇒ 0, sin 500)', () => {
    it('tasa negativa/NaN ⇒ 0: no despeja ni aporta cuota', () => {
      const neg = resolveLineTotals(100000, [{ rate: -0.19 }]);
      expect(neg.base).toBe(100000);
      expect(neg.taxes[0]).toMatchObject({ rate: 0, amount: 0 });

      const nan = resolveLineTotals(100000, [{ rate: NaN }]);
      expect(nan.base).toBe(100000);
      expect(nan.taxes[0].amount).toBe(0);
    });

    it('is_inclusive ausente/null ⇒ agregado (default histórico)', () => {
      const r = resolveLineTotals(100000, [
        { rate: 0.19, is_inclusive: null },
      ]);
      expect(r.taxes[0].is_inclusive).toBe(false);
      expect(r.total).toBe(119000);
    });
  });

  /**
   * A.1 (CP-facturacion-impuesto-incluido-redondeo) — el total cobrado cierra.
   *
   * Decisión comercial del plan: el total cobrado (precio publicado) es la
   * verdad comercial; base + impuestos truncados no pueden redefinir el total
   * ni las letras. El fix (A.2, ADR-01) sube la base de a 1¢ recalculando cada
   * cuota por truncado DIAN hasta que base_final + Σcuotas == bruto, y declara
   * el residuo cuando el bruto es inalcanzable (ADR-04, jamás overshoot).
   *
   * TODAS las cifras esperadas están calculadas A MANO (ver comentarios; la
   * aritmética se verificó con una calculadora Decimal independiente, nunca
   * llamando a la función bajo prueba). Estos casos FALLAN hoy y pasan tras
   * A.2. Ningún caso vigente de arriba se tocó.
   */
  describe('A.1 — cierre exacto: el total cobrado no se pierde (falla hasta A.2)', () => {
    it('$3.000 con INC 8% dentro ⇒ base 2777.78, cuota 222.22, total 3000.00', () => {
      // B0 = trunc(3000/1.08) = trunc(2777.777…) = 2777.77;
      // f(B0) = 2777.77 + trunc(2777.77×0.08) = 2777.77+222.22 = 2999.99 (hoy).
      // +1¢: trunc(2777.78×0.08) = trunc(222.2224) = 222.22;
      // f = 3000.00 ≤ bruto ✓. +2¢ daría 3000.01 (overshoot, prohibido).
      const r = resolveLineTotals(3000, [{ rate: 0.08, is_inclusive: true }]);
      expect(r.base).toBe(2777.78);
      expect(r.taxes).toHaveLength(1);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.08,
        is_inclusive: true,
        base: 2777.78,
        amount: 222.22,
      });
      expect(r.total).toBe(3000);
      // Invariante del plan: lo cobrado == base + cuotas (a 2 decimales; la
      // suma en doubles exige toBeCloseTo — 15.74+1.25 ya lo demuestra abajo).
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(0);
    });

    it('$5.000 con INC 8% dentro ⇒ base 4629.63, cuota 370.37, total 5000.00', () => {
      // B0 = trunc(5000/1.08) = trunc(4629.6296…) = 4629.62;
      // f(B0) = 4629.62 + trunc(370.3696) = 4629.62+370.36 = 4999.98 (hoy, -2¢
      // por doble truncado).
      // +1¢: trunc(4629.63×0.08) = trunc(370.3704) = 370.37;
      // f = 5000.00 ✓. +2¢ daría 5000.01 (overshoot).
      const r = resolveLineTotals(5000, [{ rate: 0.08, is_inclusive: true }]);
      expect(r.base).toBe(4629.63);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.08,
        is_inclusive: true,
        base: 4629.63,
        amount: 370.37,
      });
      expect(r.total).toBe(5000);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(0);
    });

    it('$100 con IVA 19% dentro ⇒ base 84.04, cuota 15.96, total 100.00', () => {
      // B0 = trunc(100/1.19) = trunc(84.0336…) = 84.03;
      // f(B0) = 84.03 + trunc(15.9657) = 84.03+15.96 = 99.99 (hoy).
      // +1¢: trunc(84.04×0.19) = trunc(15.9676) = 15.96;
      // f = 100.00 ✓ (la cuota sigue siendo trunc(base_final × r), la regla
      // DIAN se cumple por construcción). +2¢ daría 100.01 (overshoot).
      const r = resolveLineTotals(100, [{ rate: 0.19, is_inclusive: true }]);
      expect(r.base).toBe(84.04);
      expect(r.taxes[0].amount).toBe(15.96);
      expect(r.total).toBe(100);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(0);
    });

    it('$17 con INC 8% dentro termina en closest-below sin sobrecobrar (F-039)', () => {
      // f(15.74) = 15.74 + trunc(15.74×0.08) = 15.74+1.25 = 16.99;
      // f(15.75) = 15.75 + 1.26 = 17.01 > 17: el bruto es INALCANZABLE
      // (en centavos f salta 1699→1701). ADR-04: se persiste closest-below,
      // jamás overshoot, y se declara el residuo (F-061). El timeout es la
      // prueba de terminación: un loop de igualdad abierto colgaría acá.
      const r = resolveLineTotals(17, [{ rate: 0.08, is_inclusive: true }]);
      expect(r.base).toBe(15.74);
      expect(r.taxes[0].amount).toBe(1.25);
      expect(r.total).toBe(16.99);
      // Nunca sobrecargar al adquiriente ni un centavo por encima del bruto.
      expect(r.total).toBeLessThanOrEqual(17);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(1);
    }, 10000);

    it('$3.000 con IVA 19% + INC 8% dentro ⇒ closest-below 2999.99 (F-007)', () => {
      // B0 = trunc(3000/1.27) = trunc(2362.2047…) = 2362.20;
      // f(B0) = 2362.20 + trunc(448.818) + trunc(188.976) = 2999.98 (hoy).
      // +1¢: 2362.21 + trunc(448.8199)=448.81 + trunc(188.9768)=188.97
      // = 2999.99 ✓. +2¢: la parte IVA salta a 448.82 → 3000.01 overshoot:
      // con multi-tasa f avanza de a 1+k y el objetivo se saltea.
      const r = resolveLineTotals(3000, [
        { rate: 0.19, is_inclusive: true },
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(r.base).toBe(2362.21);
      expect(r.taxes[0].amount).toBe(448.81);
      expect(r.taxes[1].amount).toBe(188.97);
      expect(r.total).toBe(2999.99);
      expect(r.total).toBeLessThanOrEqual(3000);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(1);
    });

    it('$1.000 con IVA 19% + IVA 5% dentro ⇒ base 806.46, total 1000.00', () => {
      // B0 = trunc(1000/1.24) = trunc(806.4516…) = 806.45;
      // f(B0) = 806.45 + trunc(153.2255) + trunc(40.3225) = 999.99 (hoy).
      // +1¢: trunc(806.46×0.19) = trunc(153.2274) = 153.22,
      // trunc(806.46×0.05) = trunc(40.323) = 40.32;
      // f = 1000.00 ✓. +2¢ daría 1000.01 (overshoot).
      const r = resolveLineTotals(1000, [
        { rate: 0.19, is_inclusive: true },
        { rate: 0.05, is_inclusive: true },
      ]);
      expect(r.base).toBe(806.46);
      expect(r.taxes[0].amount).toBe(153.22);
      expect(r.taxes[1].amount).toBe(40.32);
      expect(r.total).toBe(1000);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(0);
    });

    it('$1.000.000 con ICA 9.66‰ dentro ⇒ base 990432.43, total 1000000.00 (F-032)', () => {
      // 9.66‰ = fracción 0.00966 (la unidad rate_basis la normaliza A.2; acá
      // entra como fracción, igual que tax_rates.rate). B0 =
      // trunc(1000000/1.00966) = 990432.42;
      // f(B0) = 990432.42 + trunc(9567.5771…) = 999999.99 (hoy, -1¢).
      // +1¢: trunc(990432.43×0.00966) = trunc(9567.5772…) = 9567.57;
      // f = 1000000.00 ✓. +2¢ daría 1000000.01 (overshoot).
      const r = resolveLineTotals(1000000, [
        { rate: 0.00966, is_inclusive: true },
      ]);
      expect(r.base).toBe(990432.43);
      expect(r.taxes[0].amount).toBe(9567.57);
      expect(r.total).toBe(1000000);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(0);
    });

    it('descuento que deja G=2990.11 con INC 8% ⇒ closest-below 2990.10 (F-006)', () => {
      // $3.000 − 9.89 de descuento en moneda capturada (con impuesto dentro).
      // B0 = trunc(2990.11/1.08) = trunc(2768.6203…) = 2768.62;
      // f = 2768.62 + trunc(221.4896) = 2768.62+221.48 = 2990.10;
      // +1¢: 2768.63 + trunc(221.4904)=221.49 → 2990.12 overshoot.
      const r = resolveLineTotals(2990.11, [
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(r.base).toBe(2768.62);
      expect(r.taxes[0].amount).toBe(221.48);
      expect(r.total).toBe(2990.1);
      expect(r.total).toBeLessThanOrEqual(2990.11);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(residualCents(r)).toBe(1);
    });
  });

  describe('A.1 — inválidos se reportan, no se silencian (F-036/F-062, falla hasta A.2)', () => {
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ["'abc'", 'abc'],
      ["locale '1.000,50'", '1.000,50'],
      ['negativo', -100],
      ["vacío ''", ''],
    ])('bruto %s ⇒ coerción compatible + entrada reportada', (_label, gross) => {
      // F-062: coerción por compat (no lanza) + reporte en invalid_inputs.
      // Hoy el saneo colapsa todo a 0 en silencio y el canal no existe.
      let r: ResolvedLineTotals | undefined;
      expect(() => {
        r = resolveLineTotals(gross as unknown as number, [
          { rate: 0.08, is_inclusive: true },
        ]);
      }).not.toThrow();
      expect(invalidInputs(r as unknown as ResolvedLineTotals).length)
        .toBeGreaterThan(0);
    });

    it.each([
      ['NaN', NaN],
      ["'abc'", 'abc'],
    ])('tasa %s ⇒ reportada (el kernel no la confunde con 0% válido)', (_label, rate) => {
      const r = resolveLineTotals(3000, [
        { rate: rate as unknown as number, is_inclusive: true },
      ]);
      expect(invalidInputs(r).length).toBeGreaterThan(0);
    });
  });

  describe('A.1 — flags stringy: el espejo ya es estricto (F-035; el rojo vive en la paridad con el motor)', () => {
    it.each([
      ["'false'", 'false'],
      ["'true'", 'true'],
      ['1 numérico', 1],
    ])('is_inclusive %s ⇒ exclusivo: solo true booleano despeja (candado, pasa hoy)', (_label, flag) => {
      // El espejo compara con === true, así que cualquier string/número cae a
      // exclusivo. El motor hoy lee truthy y discrepa: esa divergencia se fija
      // en el spec del motor (paridad espejo-motor), donde SÍ está en rojo.
      const r = resolveLineTotals(100000, [
        { rate: 0.19, is_inclusive: flag as unknown as boolean },
      ]);
      expect(r.taxes[0].is_inclusive).toBe(false);
      expect(r.base).toBe(100000);
      expect(r.total).toBe(119000);
    });

    it('0 numérico ⇒ exclusivo (frontera falsy, candado, pasa hoy)', () => {
      const r = resolveLineTotals(100000, [
        { rate: 0.19, is_inclusive: 0 as unknown as boolean },
      ]);
      expect(r.taxes[0].is_inclusive).toBe(false);
      expect(r.total).toBe(119000);
    });
  });
});
