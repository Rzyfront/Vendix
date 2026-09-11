import { Prisma } from '@prisma/client';
import {
  INCLUSIVE_SOLVER_MAX_STEPS,
  coerceInclusiveStrict,
  resolveInclusiveClearing,
  toFraction,
} from '../../invoicing/utils/dian-money.util';
import {
  INCLUSIVE_SOLVER_MAX_STEPS as MIRROR_BOUND,
  resolveLineTotals,
  truncMoney,
  type TaxRateForResolution,
} from './tax-inclusive-math.util';

/**
 * A.2 (CP-facturacion-impuesto-incluido-redondeo) — paridad espejo-motor.
 *
 * ARCHIVO NUEVO (no toca los specs A.1): fija el contrato POST-fix del espejo
 * con cifras calculadas A MANO, idénticas a las que la matriz A.1 del motor
 * exige. La paridad viva espejo↔motor (`invoice-calculator.service.spec.ts`
 * §A.1) la cierra el agente A al aterrizar el motor; este archivo prueba que
 * el espejo ya cumple su mitad del contrato.
 *
 * Convención: tasas en FRACCIÓN salvo `rate_basis` explícito (F-032).
 */
describe('A.2 — paridad espejo-motor (espejo)', () => {
  describe('cierre exacto: el total cobrado no se pierde', () => {
    it('$3.000 con INC 8% dentro ⇒ base 2777.78, cuota 222.22, total 3000.00', () => {
      // B0 = trunc(3000/1.08) = 2777.77 → 2999.99; +1¢ ⇒ 3000.00 ✓.
      const r = resolveLineTotals(3000, [{ rate: 0.08, is_inclusive: true }]);
      expect(r.base).toBe(2777.78);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.08,
        is_inclusive: true,
        base: 2777.78,
        amount: 222.22,
      });
      expect(r.total).toBe(3000);
      expect(r.base + r.total_tax_amount).toBeCloseTo(r.total, 2);
      expect(r.unclosed_residual_cents).toBe(0);
      expect(r.invalid_inputs).toEqual([]);
    });

    it('$5.000 con INC 8% dentro ⇒ base 4629.63, cuota 370.37, total 5000.00', () => {
      // B0 = 4629.62 → 4999.98; +1¢ ⇒ 5000.00 ✓ (+2¢ overshoot).
      const r = resolveLineTotals(5000, [{ rate: 0.08, is_inclusive: true }]);
      expect(r.base).toBe(4629.63);
      expect(r.taxes[0].amount).toBe(370.37);
      expect(r.total).toBe(5000);
      expect(r.unclosed_residual_cents).toBe(0);
    });

    it('$100 con IVA 19% dentro ⇒ base 84.04, cuota 15.96, total 100.00', () => {
      const r = resolveLineTotals(100, [{ rate: 0.19, is_inclusive: true }]);
      expect(r.base).toBe(84.04);
      expect(r.taxes[0].amount).toBe(15.96);
      expect(r.total).toBe(100);
      expect(r.unclosed_residual_cents).toBe(0);
    });

    it('mixto cerrable: 100000 con INC 8% dentro + IVA 19% fuera ⇒ base 92592.60', () => {
      // f_incl(B0=92592.59) = 99999.99; +1¢ ⇒ 100000.00 ✓. IVA sobre la base
      // final: trunc(92592.60×0.19) = 17592.59; total = 117592.59.
      const r = resolveLineTotals(100000, [
        { rate: 0.08, is_inclusive: true },
        { rate: 0.19, is_inclusive: false },
      ]);
      expect(r.base).toBe(92592.6);
      expect(r.taxes[0].amount).toBe(7407.4);
      expect(r.taxes[1].amount).toBe(17592.59);
      expect(r.total).toBe(117592.59);
      expect(r.unclosed_residual_cents).toBe(0);
    });

    it('agregado puro byte-idéntico: 100000 + 19% fuera ⇒ 100000/19000/119000', () => {
      const r = resolveLineTotals(100000, [{ rate: 0.19 }]);
      expect(r.base).toBe(100000);
      expect(r.taxes[0].amount).toBe(19000);
      expect(r.total).toBe(119000);
      expect(r.unclosed_residual_cents).toBe(0);
    });
  });

  describe('exhaust-case parity: closest-below + residuo, jamás overshoot', () => {
    it('$17 con INC 8% ⇒ 15.74/1.25/16.99, residuo 1 (F-039)', () => {
      const r = resolveLineTotals(17, [{ rate: 0.08, is_inclusive: true }]);
      expect(r.base).toBe(15.74);
      expect(r.taxes[0].amount).toBe(1.25);
      expect(r.total).toBe(16.99);
      expect(r.total).toBeLessThanOrEqual(17);
      expect(r.unclosed_residual_cents).toBe(1);
    }, 10000);

    it('$3.000 con IVA 19% + INC 8% dentro ⇒ 2999.99, residuo 1 (F-007)', () => {
      const r = resolveLineTotals(3000, [
        { rate: 0.19, is_inclusive: true },
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(r.base).toBe(2362.21);
      expect(r.taxes[0].amount).toBe(448.81);
      expect(r.taxes[1].amount).toBe(188.97);
      expect(r.total).toBe(2999.99);
      expect(r.total).toBeLessThanOrEqual(3000);
      expect(r.unclosed_residual_cents).toBe(1);
    }, 10000);

    it('G=2990.11 con INC 8% ⇒ 2990.10, residuo 1 (F-006)', () => {
      const r = resolveLineTotals(2990.11, [
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(r.base).toBe(2768.62);
      expect(r.taxes[0].amount).toBe(221.48);
      expect(r.total).toBe(2990.1);
      expect(r.total).toBeLessThanOrEqual(2990.11);
      expect(r.unclosed_residual_cents).toBe(1);
    }, 10000);

    it('barrido 1..500 con INC 8%: termina, itera ≤ cota y nunca sobrecobra', () => {
      for (let gross = 1; gross <= 500; gross += 1) {
        const solved = resolveInclusiveClearing(gross, [
          { rate: 0.08, is_inclusive: true },
        ]);
        expect(solved.iterations).toBeLessThanOrEqual(
          INCLUSIVE_SOLVER_MAX_STEPS,
        );
        expect(solved.unclosed_residual_cents).toBeGreaterThanOrEqual(0);
        expect(Number(solved.total)).toBeLessThanOrEqual(gross);
      }
    }, 30000);
  });

  describe('qty>1: granularidad por bruto de LÍNEA (F-009)', () => {
    it('3 × 1000 con INC 8% se resuelve UNA vez sobre 3000 ⇒ 2777.78/222.22', () => {
      // Contrato canónico checkout↔motor: el espejo recibe el bruto de línea
      // (qty×precio), nunca el unitario escalado en floats (que daba 2777.79).
      const r = resolveLineTotals(3 * 1000, [
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(r.base).toBe(2777.78);
      expect(r.total_tax_amount).toBe(222.22);
      expect(r.total).toBe(3000);
      expect(r.unclosed_residual_cents).toBe(0);
    });

    it('lo unitario se deriva truncando en Decimal: 2777.78/3 ⇒ 925.92', () => {
      // La misma derivación que hace el checkout (sin floats): trunc, nunca
      // round-up — lo mostrado por unidad no supera lo cobrado por línea.
      const line = resolveLineTotals(3000, [
        { rate: 0.08, is_inclusive: true },
      ]);
      const unit = Number(
        new Prisma.Decimal(line.base)
          .dividedBy(new Prisma.Decimal(3))
          .toFixed(2, Prisma.Decimal.ROUND_DOWN),
      );
      expect(unit).toBe(925.92);
    });
  });

  describe('per-mil y unidades de tarifa (F-032)', () => {
    it('$1.000.000 con ICA 9.66‰ explícito ⇒ base 990432.43, total 1000000.00', () => {
      const r = resolveLineTotals(1000000, [
        { rate: 9.66, rate_basis: 'per_mil', is_inclusive: true },
      ]);
      expect(r.base).toBe(990432.43);
      expect(r.taxes[0]).toMatchObject({ rate: 0.00966, amount: 9567.57 });
      expect(r.total).toBe(1000000);
      expect(r.unclosed_residual_cents).toBe(0);
    });

    it('per_mil explícito == fracción a mano (9.66‰ == 0.00966)', () => {
      const perMil = resolveLineTotals(1000000, [
        { rate: 9.66, rate_basis: 'per_mil', is_inclusive: true },
      ]);
      const fraction = resolveLineTotals(1000000, [
        { rate: 0.00966, is_inclusive: true },
      ]);
      expect(perMil).toEqual(fraction);
    });

    it('percent explícito == fracción a mano (8% == 0.08)', () => {
      const percent = resolveLineTotals(3000, [
        { rate: 8, rate_basis: 'percent', is_inclusive: true },
      ]);
      const fraction = resolveLineTotals(3000, [
        { rate: 0.08, is_inclusive: true },
      ]);
      expect(percent).toEqual(fraction);
      expect(percent.base).toBe(2777.78);
    });

    it('basis desconocida ⇒ inválido + fracción 0 (F-032 rechaza, no colapsa)', () => {
      const r = resolveLineTotals(3000, [
        {
          rate: 8,
          rate_basis: 'porcentaje' as unknown as TaxRateForResolution['rate_basis'],
          is_inclusive: true,
        },
      ]);
      expect(r.invalid_inputs.length).toBeGreaterThan(0);
      expect(r.taxes[0].rate).toBe(0);
      expect(r.taxes[0].amount).toBe(0);
    });
  });

  describe('fixed-base parity: la base propia resta del numerador (motor)', () => {
    it('G=1000 con 19% base-fija 200 + 5% al divisor ⇒ base 916.19, total 999.99, residuo 1', () => {
      // Cuota fija = trunc(200×0.19) = 38.00; G' = 962; divisor 1.05;
      // B0 = trunc(962/1.05) = trunc(916.190…) = 916.19;
      // f = 916.19 + 38 + trunc(916.19×0.05)=45.80 = 999.99 ✓;
      // +1¢ ⇒ 916.20 + 38 + 45.81 = 1000.01 overshoot (prohibido, ADR-04).
      // Semántica idéntica a `resolveTaxableBase` (fijas fuera del divisor).
      const solved = resolveInclusiveClearing(1000, [
        { rate: 0.19, is_inclusive: true, fixed_base: 200 },
        { rate: 0.05, is_inclusive: true },
      ]);
      expect(solved.base.toNumber()).toBe(916.19);
      expect(solved.rates[0].amount.toNumber()).toBe(38);
      expect(solved.rates[0].has_fixed_base).toBe(true);
      expect(solved.rates[1].amount.toNumber()).toBe(45.8);
      expect(solved.total.toNumber()).toBe(999.99);
      expect(solved.unclosed_residual_cents).toBe(1);
    });

    it('fijas que superan el bruto ⇒ base 0 + reporte (F-034, nunca cero silencioso)', () => {
      const solved = resolveInclusiveClearing(100, [
        { rate: 0.19, is_inclusive: true, fixed_base: 1000 },
      ]);
      expect(solved.base.toNumber()).toBe(0);
      expect(solved.invalid_inputs.length).toBeGreaterThan(0);
      expect(solved.unclosed_residual_cents).toBe(0);
    });
  });

  describe('stringy-flags parity: solo true booleano despeja (F-035)', () => {
    it.each([[`'false'`], [`'true'`], ['1 numérico'], ['0 numérico']])(
      'is_inclusive %s ⇒ exclusivo en el espejo',
      (label) => {
        const raw = label.startsWith("'")
          ? label.slice(1, -1)
          : Number(label.split(' ')[0]);
        const r = resolveLineTotals(100000, [
          { rate: 0.19, is_inclusive: raw as unknown as boolean },
        ]);
        expect(r.taxes[0].is_inclusive).toBe(false);
        expect(r.base).toBe(100000);
        expect(r.total).toBe(119000);
        expect(coerceInclusiveStrict(raw)).toBe(false);
      },
    );

    it('true booleano sí despeja (el único que abre el loop)', () => {
      expect(coerceInclusiveStrict(true)).toBe(true);
      const r = resolveLineTotals(100000, [
        { rate: 0.19, is_inclusive: true },
      ]);
      expect(r.base).toBeLessThan(100000);
    });
  });

  describe('inválidos se reportan, no se silencian (F-036/F-062)', () => {
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ["'abc'", 'abc'],
      ["locale '1.000,50'", '1.000,50'],
      ['negativo', -100],
      ["vacío ''", ''],
    ])('bruto %s ⇒ coerción compatible + entrada reportada', (_label, gross) => {
      let r: ReturnType<typeof resolveLineTotals> | undefined;
      expect(() => {
        r = resolveLineTotals(gross as unknown as number, [
          { rate: 0.08, is_inclusive: true },
        ]);
      }).not.toThrow();
      expect(r!.invalid_inputs.length).toBeGreaterThan(0);
    });

    it.each([['NaN', NaN], ["'abc'", 'abc']])(
      'tasa %s ⇒ reportada (no se confunde con 0% válido)',
      (_label, rate) => {
        const r = resolveLineTotals(3000, [
          { rate: rate as unknown as number, is_inclusive: true },
        ]);
        expect(r.invalid_inputs.length).toBeGreaterThan(0);
      },
    );

    it('tasa negativa ⇒ 0 + reporte (fail-closed con compat)', () => {
      const r = resolveLineTotals(100000, [{ rate: -0.19 }]);
      expect(r.base).toBe(100000);
      expect(r.taxes[0]).toMatchObject({ rate: 0, amount: 0 });
      expect(r.invalid_inputs.length).toBeGreaterThan(0);
    });

    it('tasa 0 explícita es VÁLIDA: sin reporte (no es basura)', () => {
      const r = resolveLineTotals(50000, [{ rate: 0 }]);
      expect(r.base).toBe(50000);
      expect(r.total).toBe(50000);
      expect(r.invalid_inputs).toEqual([]);
    });
  });

  describe('el espejo es delgado: paridad exacta con el kernel (F-001/F-008)', () => {
    const cases: Array<[number, TaxRateForResolution[]]> = [
      [3000, [{ rate: 0.08, is_inclusive: true }]],
      [100, [{ rate: 0.19, is_inclusive: true }]],
      [17, [{ rate: 0.08, is_inclusive: true }]],
      [
        3000,
        [
          { rate: 0.19, is_inclusive: true },
          { rate: 0.08, is_inclusive: true },
        ],
      ],
      [
        100000,
        [
          { rate: 0.08, is_inclusive: true },
          { rate: 0.19, is_inclusive: false },
        ],
      ],
      [1000000, [{ rate: 9.66, rate_basis: 'per_mil', is_inclusive: true }]],
    ];

    it.each(cases.map((c, i) => [i, c[0], c[1]] as const))(
      'caso %i: espejo == kernel en base/cuotas/total/residuo',
      (_i, gross, rates) => {
        const mirror = resolveLineTotals(gross, rates);
        const kernel = resolveInclusiveClearing(
          gross,
          rates.map((r) => ({
            rate: r.rate,
            is_inclusive: r.is_inclusive,
            rate_basis: r.rate_basis,
          })),
        );
        expect(mirror.base).toBe(kernel.base.toNumber());
        expect(mirror.total).toBe(kernel.total.toNumber());
        expect(mirror.taxes.map((t) => t.amount)).toEqual(
          kernel.rates.map((k) => k.amount.toNumber()),
        );
        expect(mirror.unclosed_residual_cents).toBe(
          kernel.unclosed_residual_cents,
        );
        expect(mirror.invalid_inputs).toEqual(kernel.invalid_inputs);
      },
    );
  });

  describe('cota y utilidades compartidas (F-033/F-004)', () => {
    it('la cota es 16 y visible desde el espejo sin tocar la fachada', () => {
      expect(INCLUSIVE_SOLVER_MAX_STEPS).toBe(16);
      expect(MIRROR_BOUND).toBe(INCLUSIVE_SOLVER_MAX_STEPS);
    });

    it('toFraction normaliza las tres unidades y coerciona la basura a 0', () => {
      expect(toFraction(19, 'percent').toNumber()).toBe(0.19);
      expect(toFraction(9.66, 'per_mil').toNumber()).toBe(0.00966);
      expect(toFraction('9.66', 'per-mil').toNumber()).toBe(0.00966);
      expect(toFraction(0.19).toNumber()).toBe(0.19);
      expect(toFraction(19, 'porcentaje').toNumber()).toBe(0);
      expect(toFraction(NaN, 'percent').toNumber()).toBe(0);
      expect(toFraction(-19, 'percent').toNumber()).toBe(0);
      expect(toFraction('abc').toNumber()).toBe(0);
    });

    it('truncMoney sigue truncando hacia cero a 2 decimales', () => {
      expect(truncMoney(100.005)).toBe(100);
      expect(truncMoney(15.969)).toBe(15.96);
      expect(truncMoney(-15.969)).toBe(-15.96);
    });
  });
});
