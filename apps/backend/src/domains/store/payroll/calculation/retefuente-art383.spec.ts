import {
  ART_383_TABLE_2020,
  EXEMPT_MONTHLY_CAP_UVT,
  EXEMPT_RATE_ART_206,
  calculateLaborWithholding,
  getArt383Table,
} from './retefuente-art383';

describe('retefuente-art383 (art. 383 ET, procedimiento 1)', () => {
  const UVT_2026 = 52374;

  describe('getArt383Table', () => {
    it('returns the Ley 2010/2019 table for any supported year', () => {
      expect(getArt383Table(2025)).toBe(ART_383_TABLE_2020);
      expect(getArt383Table(2026)).toBe(ART_383_TABLE_2020);
    });

    it('has the 7 statutory brackets ending in an open 39% bracket', () => {
      expect(ART_383_TABLE_2020).toHaveLength(7);
      expect(ART_383_TABLE_2020[0]).toEqual({
        from_uvt: 0,
        to_uvt: 95,
        marginal_rate: 0,
        add_uvt: 0,
      });
      expect(ART_383_TABLE_2020[6]).toEqual({
        from_uvt: 2300,
        to_uvt: null,
        marginal_rate: 0.39,
        add_uvt: 770,
      });
    });
  });

  describe('constants', () => {
    it('exposes the 25% exempt rate and the 790/12 UVT monthly cap', () => {
      expect(EXEMPT_RATE_ART_206).toBe(0.25);
      expect(EXEMPT_MONTHLY_CAP_UVT).toBeCloseTo(790 / 12, 10);
    });
  });

  describe('calculateLaborWithholding', () => {
    it('computes the exact statutory retention for a high 2026 salary (hand-verified)', () => {
      // Hand calculation:
      //   subtotal      = 10.000.000 - 400.000 - 400.000        = 9.200.000
      //   exempt        = min(9.200.000 × 0.25, (790/12)×52.374)
      //                 = min(2.300.000, 3.447.955)              = 2.300.000
      //   base_depurada = 9.200.000 - 2.300.000                  = 6.900.000
      //   base_uvt      = 6.900.000 / 52.374                     = 131,74
      //   bracket >95-150 (19%): (6.900.000 - 95×52.374) × 0.19
      //                 = 1.924.470 × 0.19                       = 365.649,3
      //   round to nearest 100                                   = 365.600
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
      });

      expect(result.retention).toBe(365_600);
      expect(result.base_depurada).toBe(6_900_000);
      expect(result.base_uvt).toBe(131.74);
      expect(result.exempt_amount).toBe(2_300_000);
      expect(result.marginal_rate).toBe(0.19);
      expect(result.uvt_value).toBe(UVT_2026);
      expect(result.method).toBe('art383_proc1');
    });

    it('returns 0 retention when the depurated base is at or below 95 UVT', () => {
      // subtotal = 3.000.000 - 120.000 - 120.000 = 2.760.000
      // exempt   = 690.000 → base 2.070.000 → 39,52 UVT < 95 ⇒ 0
      const result = calculateLaborWithholding({
        taxable_earnings: 3_000_000,
        health_deduction: 120_000,
        pension_deduction: 120_000,
        uvt_value: UVT_2026,
        year: 2026,
      });

      expect(result.retention).toBe(0);
      expect(result.marginal_rate).toBe(0);
      expect(result.base_depurada).toBe(2_070_000);
    });

    it('caps the 25% exempt income at (790/12) UVT per month (hand-verified)', () => {
      // subtotal = 16.000.000 - 640.000 - 640.000 = 14.720.000
      // 25%      = 3.680.000 > cap (790/12)×52.374 = 3.447.955 ⇒ exempt = cap
      // base     = 14.720.000 - 3.447.955 = 11.272.045 → 215,22 UVT
      // bracket >150-360 (28% + 10 UVT):
      //   (11.272.045 - 150×52.374) × 0.28 + 10×52.374
      //   = 3.415.945 × 0.28 + 523.740 = 1.480.204,6 → 1.480.200
      const result = calculateLaborWithholding({
        taxable_earnings: 16_000_000,
        health_deduction: 640_000,
        pension_deduction: 640_000,
        uvt_value: UVT_2026,
        year: 2026,
      });

      expect(result.exempt_amount).toBe(3_447_955);
      expect(result.base_depurada).toBe(11_272_045);
      expect(result.retention).toBe(1_480_200);
      expect(result.marginal_rate).toBe(0.28);
    });

    it('rounds the retention to the nearest multiple of 100 (art. 802 ET)', () => {
      // Down: 365.649,3 → 365.600 (covered above, re-asserted here)
      const down = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
      });
      expect(down.retention).toBe(365_600);
      expect(down.retention % 100).toBe(0);

      // Up: subtotal 9.250.000, exempt 2.312.500, base 6.937.500
      //   (6.937.500 - 4.975.530) × 0.19 = 1.961.970 × 0.19 = 372.774,3
      //   → nearest multiple of 100 = 372.800
      const up = calculateLaborWithholding({
        taxable_earnings: 10_050_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
      });
      expect(up.retention).toBe(372_800);
      expect(up.retention % 100).toBe(0);
    });

    it('clamps negative bases to 0 instead of producing a negative retention', () => {
      const result = calculateLaborWithholding({
        taxable_earnings: 100_000,
        health_deduction: 80_000,
        pension_deduction: 80_000,
        uvt_value: UVT_2026,
        year: 2026,
      });

      expect(result.retention).toBe(0);
      expect(result.base_depurada).toBe(0);
      expect(result.exempt_amount).toBe(0);
    });

    it('throws when uvt_value is not positive (never a silent wrong result)', () => {
      expect(() =>
        calculateLaborWithholding({
          taxable_earnings: 10_000_000,
          health_deduction: 400_000,
          pension_deduction: 400_000,
          uvt_value: 0,
          year: 2026,
        }),
      ).toThrow(/uvt_value must be > 0/);
    });
  });
});
