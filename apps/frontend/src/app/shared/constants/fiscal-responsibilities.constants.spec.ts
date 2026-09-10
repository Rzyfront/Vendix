import {
  FISCAL_RESPONSIBILITIES,
  FISCAL_RESPONSIBILITY_LABELS,
  getFiscalResponsibilityLabel,
  isFiscalResponsibility,
  normalizeFiscalResponsibilityCode,
} from './fiscal-responsibilities.constants';

describe('fiscal-responsibilities.constants (Frontend)', () => {
  it('should include 52 total codes matching canonical set (R-99-PN + 51 O-XX codes)', () => {
    expect(FISCAL_RESPONSIBILITIES.length).toBe(52);
    expect(FISCAL_RESPONSIBILITIES).toContain('R-99-PN');
    expect(FISCAL_RESPONSIBILITIES).toContain('O-05');
    expect(FISCAL_RESPONSIBILITIES).toContain('O-48');
    expect(FISCAL_RESPONSIBILITIES).toContain('O-49');
    expect(FISCAL_RESPONSIBILITIES).toContain('O-52');
    expect(FISCAL_RESPONSIBILITIES).not.toContain('R-99-PJ' as any);
  });

  it('should provide exhaustive labels for all codes without orphans or empties', () => {
    for (const code of FISCAL_RESPONSIBILITIES) {
      const label = FISCAL_RESPONSIBILITY_LABELS[code];
      expect(label).toBeDefined();
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  describe('normalizeFiscalResponsibilityCode', () => {
    it('should normalize 2-digit raw RUT numbers to O-XX format', () => {
      expect(normalizeFiscalResponsibilityCode('05')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('5')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('48')).toBe('O-48');
      expect(normalizeFiscalResponsibilityCode('52')).toBe('O-52');
    });

    it('should keep O-XX format and uppercase them', () => {
      expect(normalizeFiscalResponsibilityCode('O-05')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('o-48')).toBe('O-48');
      expect(normalizeFiscalResponsibilityCode('O-52')).toBe('O-52');
    });

    it('should rewrite R-99-PJ to R-99-PN per ADR-04', () => {
      expect(normalizeFiscalResponsibilityCode('R-99-PJ')).toBe('R-99-PN');
      expect(normalizeFiscalResponsibilityCode('r-99-pj')).toBe('R-99-PN');
      expect(normalizeFiscalResponsibilityCode('R-99-PN')).toBe('R-99-PN');
    });

    it('should handle null, undefined and empty values safely', () => {
      expect(normalizeFiscalResponsibilityCode(null)).toBe('');
      expect(normalizeFiscalResponsibilityCode(undefined)).toBe('');
      expect(normalizeFiscalResponsibilityCode('   ')).toBe('');
    });
  });

  describe('getFiscalResponsibilityLabel', () => {
    it('should resolve labels for both raw numeric and O-prefixed codes', () => {
      expect(getFiscalResponsibilityLabel('05')).toBe(
        'Impuesto sobre la renta - Régimen ordinario',
      );
      expect(getFiscalResponsibilityLabel('O-05')).toBe(
        'Impuesto sobre la renta - Régimen ordinario',
      );
      expect(getFiscalResponsibilityLabel('48')).toBe('Responsable de IVA');
      expect(getFiscalResponsibilityLabel('O-48')).toBe('Responsable de IVA');
    });

    it('should resolve R-99-PJ to R-99-PN label', () => {
      expect(getFiscalResponsibilityLabel('R-99-PJ')).toBe(
        'No aplica - Persona natural consumidor',
      );
    });

    it('should fallback to raw code if unknown', () => {
      expect(getFiscalResponsibilityLabel('UNKNOWN-99')).toBe('UNKNOWN-99');
    });
  });

  describe('isFiscalResponsibility', () => {
    it('should return true for valid codes (raw or prefixed)', () => {
      expect(isFiscalResponsibility('O-48')).toBe(true);
      expect(isFiscalResponsibility('48')).toBe(true);
      expect(isFiscalResponsibility('05')).toBe(true);
      expect(isFiscalResponsibility('R-99-PN')).toBe(true);
      expect(isFiscalResponsibility('R-99-PJ')).toBe(true); // rewrites to R-99-PN
      expect(isFiscalResponsibility('INVALID_CODE')).toBe(false);
    });
  });
});
