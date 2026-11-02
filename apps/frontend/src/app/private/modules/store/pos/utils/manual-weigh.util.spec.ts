import {
  convertWeighAmount,
  defaultWeighUnit,
  formatWeighAmount,
  ManualWeighUnit,
  parseWeighAmount,
  principalWeighAmount,
  stockUnitsForWeighAmount,
  weighTotal,
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
