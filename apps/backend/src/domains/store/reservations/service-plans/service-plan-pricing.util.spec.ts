import {
  findOverlappingTiers,
  isPlanProduct,
  planReturnDate,
  resolvePlanPrice,
} from './service-plan-pricing.util';

describe('service-plan-pricing.util (QUI-1060 modo Plan)', () => {
  const tiers = [
    { min_pax: 1, max_pax: 2, price: 1_200_000 },
    { min_pax: 3, max_pax: 4, price: 2_000_000 },
    { min_pax: 5, max_pax: 8, price: 3_500_000 },
  ];

  describe('isPlanProduct', () => {
    it('solo un servicio con precio tipo paquete y días es plan', () => {
      expect(isPlanProduct({ service_pricing_type: 'package', plan_duration_days: 3 })).toBe(true);
      expect(isPlanProduct({ service_pricing_type: 'package', plan_duration_days: null })).toBe(false);
      expect(isPlanProduct({ service_pricing_type: 'per_hour', plan_duration_days: 3 })).toBe(false);
      expect(isPlanProduct({ service_pricing_type: null, plan_duration_days: null })).toBe(false);
      expect(isPlanProduct(null)).toBe(false);
    });
  });

  describe('planReturnDate', () => {
    it('regreso = salida + días - 1', () => {
      expect(planReturnDate('2026-12-10', 3)).toBe('2026-12-12');
      expect(planReturnDate('2026-12-30', 4)).toBe('2027-01-02');
    });

    it('un plan de 1 día regresa el mismo día', () => {
      expect(planReturnDate('2026-12-10', 1)).toBe('2026-12-10');
    });
  });

  describe('findOverlappingTiers', () => {
    it('tramos contiguos no se solapan', () => {
      expect(findOverlappingTiers(tiers)).toBeNull();
    });

    it('detecta el par que se solapa aunque llegue desordenado', () => {
      expect(
        findOverlappingTiers([
          { min_pax: 5, max_pax: 8, price: 1 },
          { min_pax: 1, max_pax: 5, price: 1 },
        ]),
      ).toEqual([1, 0]);
    });
  });

  describe('resolvePlanPrice', () => {
    it('cobra el tramo que contiene el total de personas', () => {
      const result = resolvePlanPrice({ tiers, totalPax: 4 });
      expect(result).toEqual({ ok: true, price: 2_000_000, source: 'tier', tier: tiers[1] });
    });

    it('el precio de la salida reemplaza al tramo', () => {
      const result = resolvePlanPrice({ tiers, totalPax: 4, departureOverride: 1_800_000 });
      expect(result).toEqual({ ok: true, price: 1_800_000, source: 'departure_override', tier: null });
    });

    it('sin tramo que aplique responde no_tier', () => {
      expect(resolvePlanPrice({ tiers, totalPax: 9 })).toEqual({ ok: false, reason: 'no_tier' });
    });

    it('respeta el mínimo y máximo del plan, también con override', () => {
      expect(resolvePlanPrice({ tiers, totalPax: 1, minPax: 2 })).toEqual({ ok: false, reason: 'below_min' });
      expect(
        resolvePlanPrice({ tiers, totalPax: 7, maxPax: 6, departureOverride: 100 }),
      ).toEqual({ ok: false, reason: 'above_max' });
    });

    it('un grupo vacío no tiene precio', () => {
      expect(resolvePlanPrice({ tiers, totalPax: 0 })).toEqual({ ok: false, reason: 'no_pax' });
    });
  });
});
