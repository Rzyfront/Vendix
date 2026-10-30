import { optionUnitDelta, sumOptionDeltaParts } from './option-pricing.util';

describe('optionUnitDelta (espejo de option-pricing.service del servidor)', () => {
  it('per_line de 5.000 en 3 unidades cobra +5.000,01 en la línea, no +15.000', () => {
    const unit = optionUnitDelta({ per_unit: 0, per_line: 5000 }, 3);
    expect(unit).toBe(1666.67);
    expect(Math.round(unit * 3 * 100) / 100).toBe(5000.01);
  });

  it('per_unit no depende de la cantidad y per_line exacto con cantidad 1', () => {
    expect(optionUnitDelta({ per_unit: 6000, per_line: 0 }, 4)).toBe(6000);
    expect(optionUnitDelta({ per_unit: 6000, per_line: 5000 }, 1)).toBe(11000);
  });

  it('suma partes por scope', () => {
    expect(
      sumOptionDeltaParts([
        { scope: 'per_unit', price_delta: '6000.00' },
        { scope: 'per_line', price_delta: 5000 },
        { scope: 'per_unit', price_delta: null },
      ]),
    ).toEqual({ per_unit: 6000, per_line: 5000 });
  });
});
