import { readFileSync } from 'fs';
import { join } from 'path';

import {
  applyTierAdjustment,
  describeTierAdjustment,
  resolveTierAdjustment,
  validateTierAdjustment,
} from './tier-adjustment.util';

/**
 * Regla general de una tarifa (sin precio propio del producto). Spec:
 * odd/tasks/price-tier-adjustments-customers.md S1, S2, S4.
 *
 * `unitBase` es el precio que la tarifa ajusta (override de la variante o
 * `base_price`), en la misma convención de IVA del producto (S3): el IVA se
 * recalcula después sobre el resultado, fuera de este kernel.
 */
describe('applyTierAdjustment', () => {
  const tier = (over: Record<string, unknown>) => ({
    adjustment_type: 'percent_discount',
    adjustment_value: null,
    discount_percentage: 0,
    amount_scope: 'per_unit',
    ...over,
  });

  describe('percent_discount (regla histórica, S4)', () => {
    it('una tarifa existente sin tipo sigue leyendo discount_percentage', () => {
      expect(applyTierAdjustment(10000, 1, { discount_percentage: 15 })).toBe(8500);
    });

    it('aplica sobre el paquete completo igual que antes', () => {
      expect(
        applyTierAdjustment(1000, 12, tier({ discount_percentage: '10.00' })),
      ).toBe(10800);
    });

    it('acota el porcentaje a 0..100', () => {
      expect(applyTierAdjustment(1000, 1, tier({ discount_percentage: 150 }))).toBe(0);
      expect(applyTierAdjustment(1000, 1, tier({ discount_percentage: -5 }))).toBe(1000);
    });
  });

  it('percent_surcharge suma el porcentaje: 10.000 +10 % = 11.000', () => {
    expect(
      applyTierAdjustment(
        10000,
        1,
        tier({ adjustment_type: 'percent_surcharge', adjustment_value: 10 }),
      ),
    ).toBe(11000);
  });

  it('fixed_amount_surcharge suma el monto: 10.000 + 500 = 10.500', () => {
    expect(
      applyTierAdjustment(
        10000,
        1,
        tier({ adjustment_type: 'fixed_amount_surcharge', adjustment_value: 500 }),
      ),
    ).toBe(10500);
  });

  it('fixed_amount_discount resta el monto y nunca baja de 0', () => {
    const t = tier({ adjustment_type: 'fixed_amount_discount', adjustment_value: 500 });
    expect(applyTierAdjustment(10000, 1, t)).toBe(9500);
    expect(applyTierAdjustment(300, 1, t)).toBe(0);
  });

  it('fixed_price ignora el precio del producto: todos valen 10.000', () => {
    const t = tier({ adjustment_type: 'fixed_price', adjustment_value: 10000 });
    expect(applyTierAdjustment(4500, 1, t)).toBe(10000);
    expect(applyTierAdjustment(25000, 1, t)).toBe(10000);
  });

  describe('alcance del monto en una presentación (S2)', () => {
    it('por unidad: ajusta la unidad y multiplica por el empaque', () => {
      expect(
        applyTierAdjustment(
          1000,
          12,
          tier({ adjustment_type: 'fixed_amount_surcharge', adjustment_value: 100 }),
        ),
      ).toBe(13200);
      expect(
        applyTierAdjustment(
          1000,
          12,
          tier({ adjustment_type: 'fixed_price', adjustment_value: 900 }),
        ),
      ).toBe(10800);
    });

    it('por paquete: aplica el monto una sola vez al paquete', () => {
      expect(
        applyTierAdjustment(
          1000,
          12,
          tier({
            adjustment_type: 'fixed_amount_surcharge',
            adjustment_value: 100,
            amount_scope: 'per_package',
          }),
        ),
      ).toBe(12100);
      expect(
        applyTierAdjustment(
          1000,
          12,
          tier({
            adjustment_type: 'fixed_amount_discount',
            adjustment_value: 2000,
            amount_scope: 'per_package',
          }),
        ),
      ).toBe(10000);
      expect(
        applyTierAdjustment(
          1000,
          12,
          tier({
            adjustment_type: 'fixed_price',
            adjustment_value: 9000,
            amount_scope: 'per_package',
          }),
        ),
      ).toBe(9000);
    });

    it('los porcentajes no dependen del alcance', () => {
      const base = { adjustment_type: 'percent_surcharge', adjustment_value: 10 };
      expect(applyTierAdjustment(1000, 12, tier(base))).toBe(
        applyTierAdjustment(1000, 12, tier({ ...base, amount_scope: 'per_package' })),
      );
    });
  });

  it('un tipo desconocido cae a la regla histórica en vez de inventar un precio', () => {
    expect(
      resolveTierAdjustment({ adjustment_type: 'bogus', discount_percentage: 20 }),
    ).toEqual({ type: 'percent_discount', value: 20, scope: 'per_unit' });
  });

  it('describe la regla para la razón del precio', () => {
    expect(describeTierAdjustment({ discount_percentage: 15 })).toBe('15% off');
    expect(
      describeTierAdjustment({ adjustment_type: 'percent_surcharge', adjustment_value: 10 }),
    ).toBe('+10%');
    expect(
      describeTierAdjustment({
        adjustment_type: 'fixed_amount_surcharge',
        adjustment_value: 500,
        amount_scope: 'per_package',
      }),
    ).toBe('+500 per package');
    expect(
      describeTierAdjustment({ adjustment_type: 'fixed_amount_discount', adjustment_value: 500 }),
    ).toBe('-500 per unit');
    expect(
      describeTierAdjustment({ adjustment_type: 'fixed_price', adjustment_value: 10000 }),
    ).toBe('fixed 10000 per unit');
  });
});

describe('validateTierAdjustment', () => {
  it('el descuento histórico no exige adjustment_value', () => {
    expect(validateTierAdjustment({ discount_percentage: 10 })).toBeNull();
  });

  it('los tipos nuevos exigen un valor mayor que 0', () => {
    for (const adjustment_type of [
      'percent_surcharge',
      'fixed_amount_discount',
      'fixed_amount_surcharge',
      'fixed_price',
    ]) {
      expect(validateTierAdjustment({ adjustment_type })).toBe('value_required');
      expect(
        validateTierAdjustment({ adjustment_type, adjustment_value: 0 }),
      ).toBe('value_required');
      expect(
        validateTierAdjustment({ adjustment_type, adjustment_value: 50 }),
      ).toBeNull();
    }
  });

  it('el recargo porcentual no pasa de 1000 %', () => {
    expect(
      validateTierAdjustment({
        adjustment_type: 'percent_surcharge',
        adjustment_value: 1001,
      }),
    ).toBe('value_out_of_range');
  });

  it('un tipo desconocido es inválido', () => {
    expect(validateTierAdjustment({ adjustment_type: 'bogus' })).toBe(
      'unknown_type',
    );
  });
});

/**
 * No hay paquete ejecutable compartido entre Nest y Angular (`libs/shared-types`
 * solo publica declaraciones). El espejo del frontend es una copia byte a byte
 * de este kernel; si divergen, el POS muestra un precio y el backend cobra otro
 * (o rechaza el cobro como override).
 */
describe('tier-adjustment — espejo del frontend', () => {
  it('es idéntico al kernel del backend', () => {
    const backend = readFileSync(join(__dirname, 'tier-adjustment.util.ts'), 'utf8');
    const frontend = readFileSync(
      join(
        __dirname,
        '../../../../../../frontend/src/app/shared/services/pricing/tier-adjustment.util.ts',
      ),
      'utf8',
    );
    expect(frontend).toBe(backend);
  });
});
