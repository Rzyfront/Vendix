import {
  ART_383_TABLE_2020,
  EXEMPT_MONTHLY_CAP_UVT,
  EXEMPT_RATE_ART_206,
  applyArt387Caps,
  applyGlobalCapArt336,
  calculateFixedRateSemester,
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

  describe('art. 387 ET — deducciones con topes individuales', () => {
    it('dependientes: 2 → prorrateo (72 × 2)/12 UVT/mes, o 10% INCRNGO (el menor)', () => {
      // INCRNGO = 800.000, subtotal = 9.200.000
      // dependents_cap_monthly (2 deps) = 72*2/12*52.374 = 628.488
      // dependents_alt = 800.000 * 10% = 80.000  ← menor
      // 2 deps acreditados, valores muy altos → debe aplicar 80.000
      const caps = applyArt387Caps(
        800_000,
        {
          dependents_count: 2,
          housing_interest_monthly: 0,
          prepaid_medicine_monthly: 0,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
        UVT_2026,
      );
      expect(caps.dependents).toBe(80_000);
    });

    it('dependientes: 4 (máx legal) con INCRNGO alto → tope por UVT prima sobre 10%', () => {
      // INCRNGO = 2.000.000, 10% = 200.000
      // prorrateo 4 deps = 72*4/12*52.374 = 1.256.976  ← menor
      const caps = applyArt387Caps(
        2_000_000,
        {
          dependents_count: 4,
          housing_interest_monthly: 0,
          prepaid_medicine_monthly: 0,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
        UVT_2026,
      );
      // 200.000 < 1.256.976 → 200.000
      expect(caps.dependents).toBe(200_000);
    });

    it('dependientes: > 4 se trunca al máximo legal', () => {
      const caps = applyArt387Caps(
        2_000_000,
        {
          dependents_count: 7,
          housing_interest_monthly: 0,
          prepaid_medicine_monthly: 0,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
        UVT_2026,
      );
      // Se trunca a 4 → 200.000 (10% de 2M)
      expect(caps.dependents).toBe(200_000);
    });

    it('intereses vivienda: topea a 100 UVT/mes (5.237.400 en 2026)', () => {
      const caps = applyArt387Caps(
        800_000,
        {
          dependents_count: 0,
          housing_interest_monthly: 9_000_000, // mayor al tope
          prepaid_medicine_monthly: 0,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
        UVT_2026,
      );
      expect(caps.housing_interest).toBeCloseTo(100 * UVT_2026, 0);
    });

    it('medicina prepagada: topea a 16 UVT/mes (837.984 en 2026)', () => {
      const caps = applyArt387Caps(
        800_000,
        {
          dependents_count: 0,
          housing_interest_monthly: 0,
          prepaid_medicine_monthly: 1_500_000,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
        UVT_2026,
      );
      expect(caps.prepaid_medicine).toBeCloseTo(16 * UVT_2026, 0);
    });

    it('pensión voluntaria y AFC: topean a 100 UVT/mes cada una', () => {
      const caps = applyArt387Caps(
        800_000,
        {
          dependents_count: 0,
          housing_interest_monthly: 0,
          prepaid_medicine_monthly: 0,
          voluntary_pension_monthly: 9_000_000,
          afc_monthly: 9_000_000,
        },
        UVT_2026,
      );
      expect(caps.voluntary_pension).toBeCloseTo(100 * UVT_2026, 0);
      expect(caps.afc).toBeCloseTo(100 * UVT_2026, 0);
    });
  });

  describe('art. 336 ET — tope global 40% / 1.340 UVT', () => {
    it('activa el cap cuando art. 387 + exenta 25% excede el 40% del subtotal', () => {
      // subtotal = 10.000.000 → cap 40% = 4.000.000
      // exenta = min(2.5M, 3.447.955) = 2.500.000
      // total_387 = 3.000.000 (hipotético)
      // subtotal_deductions = 5.500.000 > 4.000.000 → cap = 4.000.000
      const result = applyGlobalCapArt336(
        10_000_000,
        3_000_000,
        2_500_000,
        UVT_2026,
      );
      expect(result.cap_40_pct).toBe(4_000_000);
      expect(result.cap_1340_uvt).toBe(1340 * UVT_2026);
      expect(result.capped_deductions).toBe(4_000_000);
      expect(result.global_cap_applied).toBe(1_500_000);
    });

    it('NO activa el cap cuando las deducciones caben', () => {
      // subtotal = 5.000.000 → cap 40% = 2.000.000
      // exenta = 1.250.000; total_387 = 200.000 → 1.450.000 < 2.000.000
      const result = applyGlobalCapArt336(
        5_000_000,
        200_000,
        1_250_000,
        UVT_2026,
      );
      expect(result.capped_deductions).toBe(1_450_000);
      expect(result.global_cap_applied).toBe(0);
    });
  });

  describe('art. 387 integrado en calculateLaborWithholding', () => {
    it('con dependientes + vivienda + prepagada acredita deducciones y reduce base', () => {
      // Caso sin art. 387: 10M earnings → base_depurada 6.900.000, retention 365.600
      // Caso con perfil:
      //   INCRNGO = 800.000, subtotal = 9.200.000
      //   dependents (2) = 80.000 (10% INCRNGO, menor que 628.488)
      //   housing = 5.237.400 (100 UVT)
      //   prepaid = 837.984 (16 UVT)
      //   total_387 = 6.155.384
      //   exenta = min(9.200.000 * 0.25, 3.447.955) = 2.300.000
      //   subtotal_deductions = 6.155.384 + 2.300.000 = 8.455.384
      //   cap_40% = 9.200.000 * 0.4 = 3.680.000
      //   cap_1340_uvt = 70.201.160
      //   cap = 3.680.000
      //   total_deductible = 3.680.000 (cap absorbió 4.775.384)
      //   base_depurada = 9.200.000 - 3.680.000 = 5.520.000
      //   base_uvt = 5.520.000 / 52.374 = 105.40
      //   bracket >95-150 (19%):
      //     (5.520.000 - 4.975.530) * 0.19 = 544.470 * 0.19 = 103.449,3 → 103.400
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        art_387_deductions: {
          dependents_count: 2,
          housing_interest_monthly: 9_000_000, // forzado a tope
          prepaid_medicine_monthly: 1_500_000,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
      });

      expect(result.base_depurada).toBe(5_520_000);
      expect(result.deductions_387?.total_387).toBeCloseTo(6_155_384, 0);
      expect(result.deductions_387?.global_cap_applied).toBeCloseTo(4_775_384, 0);
      expect(result.retention).toBe(103_400);
      expect(result.method).toBe('art383_proc1');
    });

    it('deducciones dentro del 40% → base depurada mayor que caso sin perfil', () => {
      // INCRNGO = 800.000, subtotal = 9.200.000
      // art. 387: dependents(2)=80.000, housing=3.000.000 (bajo tope),
      //           prepaid=400.000 (bajo tope), total_387 = 3.480.000
      // exenta = 2.300.000; subtotal_deductions = 5.780.000
      // cap_40% = 3.680.000
      // total_deductible = 3.680.000 (cap absorbió 2.100.000)
      // base_depurada = 9.200.000 - 3.680.000 = 5.520.000
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        art_387_deductions: {
          dependents_count: 2,
          housing_interest_monthly: 3_000_000,
          prepaid_medicine_monthly: 400_000,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
      });
      // El cap absorbe y la base depurada es idéntica al caso con topes plenos
      expect(result.base_depurada).toBe(5_520_000);
    });

    it('sin perfil fiscal: cálculo cae al comportamiento histórico (sin cap aplicado)', () => {
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
      });
      expect(result.base_depurada).toBe(6_900_000);
      expect(result.retention).toBe(365_600);
      expect(result.deductions_387).toBeUndefined();
    });

    it('perfil con todos los campos en 0: tratado como sin perfil', () => {
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        art_387_deductions: {
          dependents_count: 0,
          housing_interest_monthly: 0,
          prepaid_medicine_monthly: 0,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
      });
      expect(result.base_depurada).toBe(6_900_000);
      expect(result.deductions_387).toBeUndefined();
    });
  });

  describe('art. 386 ET — procedimiento 2 (porcentaje fijo semestral)', () => {
    it('aplica el porcentaje fijo del semestre sobre la base depurada', () => {
      // proc1 base 6.900.000 → retention 365.600 (19% bracket)
      // proc2 con 5% sobre la misma base (sin deducciones art. 387):
      //   retention = 6.900.000 * 0.05 = 345.000 → round a 100 → 345.000
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        procedure: 'proc2',
        fixed_retention_rate: 0.05,
      });

      expect(result.method).toBe('art386_proc2');
      expect(result.marginal_rate).toBe(0);
      expect(result.deductions_387?.fixed_rate).toBe(0.05);
      expect(result.retention).toBe(345_000);
    });

    it('proc2 sin fixed_retention_rate válido cae a proc1 con proc2_fallback=true', () => {
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        procedure: 'proc2',
        // sin fixed_retention_rate
      });

      expect(result.method).toBe('art383_proc1');
      expect(result.proc2_fallback).toBe(true);
      // Misma base que proc1 sin perfil = 6.900.000
      expect(result.base_depurada).toBe(6_900_000);
      expect(result.retention).toBe(365_600);
    });

    it('proc2 con 0 explícito también cae a proc1 (nunca retener 0 silencioso)', () => {
      const result = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        procedure: 'proc2',
        fixed_retention_rate: 0,
      });

      expect(result.method).toBe('art383_proc1');
      expect(result.proc2_fallback).toBe(true);
    });
  });

  describe('calculateFixedRateSemester — B5 cálculo semestral del porcentaje fijo (art. 386 ET)', () => {
    const flatMonths = (n: number, earnings: number, health: number, pension: number) =>
      Array.from({ length: n }, () => ({
        taxable_earnings: earnings,
        health_deduction: health,
        pension_deduction: pension,
      }));

    it('calcula la tasa efectiva (retención÷base) sobre el promedio de 12 meses, NO la tarifa marginal', () => {
      // 12 meses iguales a 10.000.000 → promedio = 10.000.000
      // Reutilizando el caso hand-verified: base_depurada 6.900.000,
      // retention proc1 365.600, marginal_rate 0.19
      // tasa efectiva = 365.600 / 6.900.000 = 0.05298550...
      const result = calculateFixedRateSemester(
        flatMonths(12, 10_000_000, 400_000, 400_000),
        UVT_2026,
        2026,
      );

      expect(result.months_used).toBe(12);
      expect(result.average_taxable_earnings).toBe(10_000_000);
      expect(result.average_base_depurada).toBe(6_900_000);
      expect(result.average_retention_proc1).toBe(365_600);
      expect(result.marginal_rate).toBe(0.19);
      // Tasa efectiva ≠ tarifa marginal (0.19) — es menor porque la tabla
      // resta un umbral exento antes de aplicar la marginal.
      expect(result.fixed_retention_rate).toBeCloseTo(365_600 / 6_900_000, 4);
      expect(result.fixed_retention_rate).not.toBe(result.marginal_rate);
    });

    it('promedia ingresos variables mes a mes (no solo el último mes)', () => {
      const months = [
        ...flatMonths(6, 8_000_000, 320_000, 320_000),
        ...flatMonths(6, 12_000_000, 480_000, 480_000),
      ];
      // promedio = (8M*6 + 12M*6)/12 = 10.000.000 → mismo resultado que el caso plano
      const result = calculateFixedRateSemester(months, UVT_2026, 2026);
      expect(result.average_taxable_earnings).toBe(10_000_000);
    });

    it('ingreso promedio bajo el umbral exento (≤95 UVT depurados) → tasa fija 0, sin división por cero', () => {
      const result = calculateFixedRateSemester(
        flatMonths(12, 3_000_000, 120_000, 120_000),
        UVT_2026,
        2026,
      );
      expect(result.average_base_depurada).toBeLessThan(95 * UVT_2026);
      expect(result.average_retention_proc1).toBe(0);
      expect(result.fixed_retention_rate).toBe(0);
    });

    it('incorpora deducciones art. 387 promediadas en la depuración', () => {
      const months: Array<{
        taxable_earnings: number;
        health_deduction: number;
        pension_deduction: number;
        art_387_deductions: {
          dependents_count: number;
          housing_interest_monthly: number;
          prepaid_medicine_monthly: number;
          voluntary_pension_monthly: number;
          afc_monthly: number;
        };
      }> = Array.from({ length: 12 }, () => ({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        art_387_deductions: {
          dependents_count: 2,
          housing_interest_monthly: 9_000_000,
          prepaid_medicine_monthly: 1_500_000,
          voluntary_pension_monthly: 0,
          afc_monthly: 0,
        },
      }));
      const result = calculateFixedRateSemester(months, UVT_2026, 2026);
      // Mismo caso que el spec de integración art. 387 → base_depurada 5.520.000
      expect(result.average_base_depurada).toBe(5_520_000);
      expect(result.average_retention_proc1).toBe(103_400);
      expect(result.fixed_retention_rate).toBeCloseTo(103_400 / 5_520_000, 4);
    });

    it('acepta menos de 12 meses (empleado con menos antigüedad) sin bloquear el cálculo', () => {
      const result = calculateFixedRateSemester(
        flatMonths(3, 10_000_000, 400_000, 400_000),
        UVT_2026,
        2026,
      );
      expect(result.months_used).toBe(3);
      expect(result.average_taxable_earnings).toBe(10_000_000);
    });

    it('lanza error si no hay ningún mes de historia (nunca calcular sobre 0 datos)', () => {
      expect(() => calculateFixedRateSemester([], UVT_2026, 2026)).toThrow(
        /at least 1 month/,
      );
    });

    it('lanza error si uvt_value no es positivo', () => {
      expect(() =>
        calculateFixedRateSemester(
          flatMonths(12, 10_000_000, 400_000, 400_000),
          0,
          2026,
        ),
      ).toThrow(/uvt_value must be > 0/);
    });

    it('el porcentaje resultante, usado luego en proc2, retiene un valor cercano al proc1 promedio (integración)', () => {
      const semesterResult = calculateFixedRateSemester(
        flatMonths(12, 10_000_000, 400_000, 400_000),
        UVT_2026,
        2026,
      );

      // Aplicar el porcentaje fijo calculado a un mes con el MISMO ingreso
      // (escenario estable) debe reproducir aproximadamente la misma
      // retención que proc1 arrojaría — la tasa efectiva está diseñada para eso.
      const proc2 = calculateLaborWithholding({
        taxable_earnings: 10_000_000,
        health_deduction: 400_000,
        pension_deduction: 400_000,
        uvt_value: UVT_2026,
        year: 2026,
        procedure: 'proc2',
        fixed_retention_rate: semesterResult.fixed_retention_rate,
      });

      expect(proc2.method).toBe('art386_proc2');
      // Redondeo a múltiplos de 100 en ambos lados; deben quedar muy cerca.
      expect(
        Math.abs(proc2.retention - semesterResult.average_retention_proc1),
      ).toBeLessThanOrEqual(100);
    });
  });
});
