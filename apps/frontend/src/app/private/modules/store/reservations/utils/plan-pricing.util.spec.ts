import { computePlanReturnDate, resolvePlanPackagePrice, PlanPaxTier } from './plan-pricing.util';

describe('plan-pricing.util', () => {
  describe('computePlanReturnDate', () => {
    it('1 day returns the same date', () => {
      expect(computePlanReturnDate('2027-03-10', 1)).toBe('2027-03-10');
    });

    it('3 days returns start + 2', () => {
      expect(computePlanReturnDate('2027-03-10', 3)).toBe('2027-03-12');
    });

    it('5 days rolls over the month', () => {
      expect(computePlanReturnDate('2027-01-29', 5)).toBe('2027-02-02');
    });

    it('rolls over the year', () => {
      expect(computePlanReturnDate('2026-12-30', 4)).toBe('2027-01-02');
    });

    it('handles leap day', () => {
      expect(computePlanReturnDate('2028-02-28', 3)).toBe('2028-03-01');
    });
  });

  describe('resolvePlanPackagePrice', () => {
    const tiers: PlanPaxTier[] = [
      { min_pax: 1, max_pax: 2, price: 1000 },
      { min_pax: 3, max_pax: 5, price: 2500 },
    ];

    it('selects the tier by total pax (adults + children)', () => {
      const r = resolvePlanPackagePrice({ tiers, adults: 2, children: 1 });
      expect(r).toEqual({ ok: true, price: 2500, source: 'tier' });
    });

    it('matches tier boundaries inclusively', () => {
      expect(resolvePlanPackagePrice({ tiers, adults: 2, children: 0 })).toEqual({ ok: true, price: 1000, source: 'tier' });
      expect(resolvePlanPackagePrice({ tiers, adults: 5, children: 0 })).toEqual({ ok: true, price: 2500, source: 'tier' });
    });

    it('departure override wins over the tier', () => {
      const r = resolvePlanPackagePrice({ tiers, adults: 2, children: 0, departureOverride: 900 });
      expect(r).toEqual({ ok: true, price: 900, source: 'departure_override' });
    });

    it('returns no_tier when no tier applies', () => {
      expect(resolvePlanPackagePrice({ tiers, adults: 6, children: 0 })).toEqual({ ok: false, reason: 'no_tier' });
      expect(resolvePlanPackagePrice({ tiers: [], adults: 2, children: 0 })).toEqual({ ok: false, reason: 'no_tier' });
    });

    it('returns below_min and above_max against the plan limits', () => {
      expect(resolvePlanPackagePrice({ tiers, adults: 1, children: 0, minPax: 2 })).toEqual({ ok: false, reason: 'below_min' });
      expect(resolvePlanPackagePrice({ tiers, adults: 4, children: 2, maxPax: 5 })).toEqual({ ok: false, reason: 'above_max' });
    });

    it('returns no_pax without adults', () => {
      expect(resolvePlanPackagePrice({ tiers, adults: 0, children: 2 })).toEqual({ ok: false, reason: 'no_pax' });
    });
  });
});
