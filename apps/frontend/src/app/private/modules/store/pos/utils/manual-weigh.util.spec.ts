import {
  convertWeighAmount,
  defaultWeighUnit,
  capturesInSaleUnit,
  exceedsWeighMax,
  formatWeighAmount,
  ManualWeighUnit,
  parseWeighAmount,
  principalWeighAmount,
  scaleReadingToUnit,
  stockUnitsForWeighAmount,
  weighMaxFor,
  weighTotal,
  MAX_WEIGH_AMOUNT,
} from './manual-weigh.util';

const G: ManualWeighUnit = {
  code: 'g',
  name: 'Gramo',
  factorToBase: 1,
  isPrincipal: false,
};
const KG: ManualWeighUnit = {
  code: 'kg',
  name: 'Kilogramo',
  factorToBase: 1000,
  isPrincipal: true,
};
const LB: ManualWeighUnit = {
  code: 'lb',
  name: 'Libra',
  factorToBase: 500,
  isPrincipal: false,
};

describe('manual-weigh.util (QUI-978)', () => {
  describe('parseWeighAmount', () => {
    it('acepta punto o coma decimal', () => {
      expect(parseWeighAmount('0.3')).toBe(0.3);
      expect(parseWeighAmount('0,3')).toBe(0.3);
      expect(parseWeighAmount(' 300 ')).toBe(300);
    });

    it('rechaza vacío, cero, negativos y basura', () => {
      expect(parseWeighAmount('')).toBeNull();
      expect(parseWeighAmount(null)).toBeNull();
      expect(parseWeighAmount('0')).toBeNull();
      expect(parseWeighAmount('-2')).toBeNull();
      expect(parseWeighAmount('abc')).toBeNull();
    });
  });

  describe('conversiones', () => {
    it('300 g son 0,3 kg (la historia del líder)', () => {
      expect(principalWeighAmount(300, G, KG)).toBeCloseTo(0.3, 6);
    });

    it('1 lb son 0,5 kg', () => {
      expect(principalWeighAmount(1, LB, KG)).toBeCloseTo(0.5, 6);
    });

    it('el total usa la principal: 0,3 kg a $25.000/kg son $7.500', () => {
      expect(weighTotal(0.3, 25000)).toBeCloseTo(7500, 6);
    });

    it('el stock se merma en la mínima: 0,3 kg con stock en g son 300', () => {
      expect(stockUnitsForWeighAmount(0.3, 1000, 1)).toBe(300);
    });

    it('redondear a cero se detecta (vender aire)', () => {
      expect(stockUnitsForWeighAmount(0.0001, 1, 1)).toBe(0);
    });

    it('factores malos devuelven null, no NaN', () => {
      expect(convertWeighAmount(1, 0, 1)).toBeNull();
      expect(convertWeighAmount(1, 1, -5)).toBeNull();
      expect(convertWeighAmount(NaN, 1, 1)).toBeNull();
    });
  });

  describe('defaultWeighUnit', () => {
    it('prefiere la principal', () => {
      expect(defaultWeighUnit([G, KG, LB])).toBe(KG);
    });

    it('sin marca usa la primera', () => {
      expect(defaultWeighUnit([LB, G])).toBe(LB);
    });

    it('sin unidades devuelve null', () => {
      expect(defaultWeighUnit([])).toBeNull();
    });
  });

  describe('formatWeighAmount', () => {
    it('formatea es-CO con máximo 3 decimales', () => {
      expect(formatWeighAmount(0.3)).toBe('0,3');
      expect(formatWeighAmount(300)).toBe('300');
      expect(formatWeighAmount(2.3456)).toBe('2,346');
    });
  });
});

describe('scaleReadingToUnit (PR #1062 error 2)', () => {
  const catalog = [
    { code: 'g', dimension: 'mass', factorToBase: 1 },
    { code: 'kg', dimension: 'mass', factorToBase: 1000 },
    { code: 'lb', dimension: 'mass', factorToBase: 500 },
    { code: 'm', dimension: 'length', factorToBase: 1000 },
  ];

  it('báscula en kg y principal lb: 0,5 kg son 1 lb (500 g), no 0,5 lb', () => {
    expect(scaleReadingToUnit(0.5, 'kg', 'lb', catalog)).toBeCloseTo(1, 10);
  });

  it('báscula en g y principal kg: 300 g son 0,3 kg', () => {
    expect(scaleReadingToUnit(300, 'g', 'kg', catalog)).toBeCloseTo(0.3, 10);
  });

  it('misma unidad, desconocida o de otra dimensión: lectura intacta', () => {
    expect(scaleReadingToUnit(0.5, 'kg', 'KG', catalog)).toBe(0.5);
    expect(scaleReadingToUnit(0.5, 'kg', 'oz', catalog)).toBe(0.5);
    expect(scaleReadingToUnit(0.5, 'kg', 'm', catalog)).toBe(0.5);
    expect(scaleReadingToUnit(0.5, null, 'lb', catalog)).toBe(0.5);
  });
});

describe('exceedsWeighMax (PR #1062 ronda 4, punto 3)', () => {
  it('el tope de 999 se mide en la principal, no en el número tipeado', () => {
    // 1.500 g = 1,5 kg: dentro del tope de 999 kg.
    expect(exceedsWeighMax(1500, G, KG)).toBeFalse();
    // 999 kg exactos (999.000 g) pasan; un gramo más no.
    expect(exceedsWeighMax(999, KG, KG)).toBeFalse();
    expect(exceedsWeighMax(999000, G, KG)).toBeFalse();
    expect(exceedsWeighMax(999001, G, KG)).toBeTrue();
    expect(exceedsWeighMax(1000, KG, KG)).toBeTrue();
  });

  it('el tope es 999 de la principal: con principal g son 999 g (ronda 5, H4)', () => {
    expect(exceedsWeighMax(999, G, G)).toBeFalse();
    expect(exceedsWeighMax(1000, G, G)).toBeTrue();
    // 1 kg = 1.000 g supera los 999 g de la principal.
    expect(exceedsWeighMax(1, KG, G)).toBeTrue();
  });
});

describe('capturesInSaleUnit (PR #1062 ronda 5, H3)', () => {
  it('principal igual al stock (escala 1) con g/lb/kg declaradas abre la captura', () => {
    expect(capturesInSaleUnit(true, 1, 3)).toBeTrue();
  });

  it('unidad de venta mayor que la de stock sigue abriendo la captura', () => {
    expect(capturesInSaleUnit(true, 1000, 0)).toBeTrue();
  });

  it('una sola UoM igual al stock agrega de un toque, como siempre', () => {
    expect(capturesInSaleUnit(true, 1, 1)).toBeFalse();
    expect(capturesInSaleUnit(true, 1, 0)).toBeFalse();
  });

  it('sin unidad de stock nunca abre la captura medida', () => {
    expect(capturesInSaleUnit(false, 1, 3)).toBeFalse();
  });
});

describe('weighMaxFor (PR #1062 ronda 6, R1)', () => {
  it('en masa el tope es 999 de la principal', () => {
    expect(weighMaxFor('mass')).toBe(MAX_WEIGH_AMOUNT);
  });

  it('metros, litros o sin unidad no tienen tope: 1.200 m de cable se venden', () => {
    expect(weighMaxFor('length')).toBeNull();
    expect(weighMaxFor('volume')).toBeNull();
    expect(weighMaxFor(null)).toBeNull();
  });
});
