import {
  resolveLineTotals,
  truncMoney,
  type TaxRateForResolution,
} from './tax-inclusive-math.util';
import { dianAmount } from '../../invoicing/utils/dian-money.util';

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
    it('100000 con INC 8% dentro + IVA 19% fuera ⇒ base 92592.59, total 117592.59', () => {
      // Divisor = 1.08 (SOLO lo inclusivo). B = trunc(100000/1.08)
      // = trunc(92592.5925…) = 92592.59.
      // INC = trunc(92592.59 × 0.08) = trunc(7407.4072) = 7407.40.
      // IVA = trunc(92592.59 × 0.19) = trunc(17592.5921) = 17592.59.
      // Total = 100000 + 17592.59 = 117592.59.
      const r = resolveLineTotals(100000, [
        { rate: 0.08, is_inclusive: true },
        { rate: 0.19, is_inclusive: false },
      ]);
      expect(r.base).toBe(92592.59);
      expect(r.taxes[0]).toMatchObject({
        rate: 0.08,
        is_inclusive: true,
        base: 92592.59,
        amount: 7407.4,
      });
      expect(r.taxes[1]).toMatchObject({
        rate: 0.19,
        is_inclusive: false,
        base: 92592.59,
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
      // B = trunc(100/1.19) = trunc(84.0336…) = 84.03.
      // Cuota = trunc(84.03 × 0.19) = trunc(15.9657) = 15.96.
      // Math.round daría 15.97: ese centavo es el defecto F-005.
      const r = resolveLineTotals(100, [{ rate: 0.19, is_inclusive: true }]);
      expect(r.base).toBe(84.03);
      expect(r.taxes[0].amount).toBe(15.96);
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
});
