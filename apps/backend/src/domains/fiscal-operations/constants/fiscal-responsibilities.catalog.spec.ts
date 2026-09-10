import {
  FISCAL_RESPONSIBILITIES_CATALOG,
  FISCAL_RESPONSIBILITIES_CATALOG_VERSION,
  findFiscalResponsibility,
  purchaseEffectFor,
} from './fiscal-responsibilities.catalog';
import {
  FISCAL_RESPONSIBILITIES,
  FISCAL_RESPONSIBILITY_LABELS,
  isValidFiscalResponsibility,
  normalizeFiscalResponsibilityCode,
} from '@common/constants/fiscal-responsibilities';

describe('Fiscal Responsibilities Catalog & Canonical Normalizer (Casilla 53)', () => {
  describe('Catalog Version & Completeness', () => {
    it('debe estar en versión 3', () => {
      expect(FISCAL_RESPONSIBILITIES_CATALOG_VERSION).toBe(3);
    });

    it('debe incluir más de 40 responsabilidades en el catálogo enriquecido', () => {
      expect(FISCAL_RESPONSIBILITIES_CATALOG.length).toBeGreaterThan(40);
    });

    it('cada código canónico debe tener etiqueta en FISCAL_RESPONSIBILITY_LABELS', () => {
      for (const code of FISCAL_RESPONSIBILITIES) {
        expect(FISCAL_RESPONSIBILITY_LABELS[code]).toBeDefined();
        expect(typeof FISCAL_RESPONSIBILITY_LABELS[code]).toBe('string');
        expect(FISCAL_RESPONSIBILITY_LABELS[code].length).toBeGreaterThan(0);
      }
    });

    it('todas las entradas del catálogo deben tener code, label, description y effects', () => {
      for (const entry of FISCAL_RESPONSIBILITIES_CATALOG) {
        expect(entry.code).toMatch(/^(O-\d{2}|R-99-PN)$/);
        expect(entry.label).toBeTruthy();
        expect(entry.description).toBeTruthy();
        expect(Array.isArray(entry.effects)).toBe(true);
        expect(entry.effects.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findFiscalResponsibility', () => {
    it('encuentra definiciones por código canónico O-05, O-48, O-52 y R-99-PN', () => {
      const o05 = findFiscalResponsibility('O-05');
      expect(o05).toBeDefined();
      expect(o05?.code).toBe('O-05');
      expect(o05?.label).toContain('Régimen ordinario');
      expect(o05?.obligation_types).toContain('income_tax_precierre');

      const o48 = findFiscalResponsibility('O-48');
      expect(o48).toBeDefined();
      expect(o48?.code).toBe('O-48');
      expect(o48?.obligation_types).toContain('vat_return');
      expect(o48?.obligation_types).toContain('inc_return');

      const o52 = findFiscalResponsibility('O-52');
      expect(o52).toBeDefined();
      expect(o52?.code).toBe('O-52');
      expect(o52?.label).toContain('Facturador electrónico');
      expect(o52?.obligation_types).toContain('electronic_invoice_review');
      expect(o52?.obligation_types).toContain('support_document_review');

      const r99 = findFiscalResponsibility('R-99-PN');
      expect(r99).toBeDefined();
      expect(r99?.code).toBe('R-99-PN');
    });

    it('admite números directos sin prefijo como extrae el OCR (48, 5, 05, 52)', () => {
      expect(findFiscalResponsibility('48')?.code).toBe('O-48');
      expect(findFiscalResponsibility('05')?.code).toBe('O-05');
      expect(findFiscalResponsibility('5')?.code).toBe('O-05');
      expect(findFiscalResponsibility('52')?.code).toBe('O-52');
    });

    it('normaliza prefijo de un dígito y minúsculas igual que el normalizador canónico (O-5, o-5)', () => {
      expect(findFiscalResponsibility('O-5')?.code).toBe('O-05');
      expect(findFiscalResponsibility('o-5')?.code).toBe('O-05');
      expect(findFiscalResponsibility('o-48')?.code).toBe('O-48');
      expect(findFiscalResponsibility('  O-52  ')?.code).toBe('O-52');
    });

    it('mapea código descontinuado R-99-PJ hacia R-99-PN (ADR-04)', () => {
      const result = findFiscalResponsibility('R-99-PJ');
      expect(result).toBeDefined();
      expect(result?.code).toBe('R-99-PN');
    });

    it('devuelve undefined para códigos inexistentes', () => {
      expect(findFiscalResponsibility('O-999')).toBeUndefined();
      expect(findFiscalResponsibility('UNKNOWN')).toBeUndefined();
    });
  });

  describe('purchaseEffectFor', () => {
    it('devuelve deductible para O-48 y capitalized para O-49', () => {
      const effect48 = purchaseEffectFor('O-48');
      expect(effect48).toBeDefined();
      expect(effect48?.treatment).toBe('deductible');
      expect(effect48?.legal_basis.length).toBeGreaterThan(0);

      const effect49 = purchaseEffectFor('O-49');
      expect(effect49).toBeDefined();
      expect(effect49?.treatment).toBe('capitalized');
      expect(effect49?.legal_basis.length).toBeGreaterThan(0);
    });

    it('devuelve undefined para responsabilidades que no determinan tratamiento de IVA en compras', () => {
      expect(purchaseEffectFor('O-05')).toBeUndefined();
      expect(purchaseEffectFor('O-13')).toBeUndefined();
      expect(purchaseEffectFor('O-52')).toBeUndefined();
    });
  });

  describe('Códigos Derogados / Históricos', () => {
    const historicalCodes = ['O-35', 'O-36', 'O-37', 'O-38', 'O-39', 'O-46'];

    it.each(historicalCodes)(
      'el código %s está marcado como is_historical y cita su base legal',
      (code) => {
        const def = findFiscalResponsibility(code);
        expect(def).toBeDefined();
        expect(def?.is_historical).toBe(true);
        expect(def?.legal_basis).toBeDefined();
        expect(def?.legal_basis!.length).toBeGreaterThan(0);
      },
    );
  });

  describe('normalizeFiscalResponsibilityCode', () => {
    it('normaliza dígitos directos a formato canónico con prefijo y dos dígitos', () => {
      expect(normalizeFiscalResponsibilityCode('48')).toBe('O-48');
      expect(normalizeFiscalResponsibilityCode('5')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('05')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('52')).toBe('O-52');
      expect(normalizeFiscalResponsibilityCode('1')).toBe('O-01');
    });

    it('normaliza prefijos en minúscula y mayúscula', () => {
      expect(normalizeFiscalResponsibilityCode('o-48')).toBe('O-48');
      expect(normalizeFiscalResponsibilityCode('O-48')).toBe('O-48');
      expect(normalizeFiscalResponsibilityCode('o-5')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('O-5')).toBe('O-05');
      expect(normalizeFiscalResponsibilityCode('  O-52  ')).toBe('O-52');
    });

    it('preserva R-99-PN y normaliza R-99-PJ a R-99-PN (ADR-04)', () => {
      expect(normalizeFiscalResponsibilityCode('R-99-PN')).toBe('R-99-PN');
      expect(normalizeFiscalResponsibilityCode('r-99-pn')).toBe('R-99-PN');
      expect(normalizeFiscalResponsibilityCode('R-99-PJ')).toBe('R-99-PN');
      expect(normalizeFiscalResponsibilityCode('r-99-pj')).toBe('R-99-PN');
    });

    it('maneja valores vacíos, nulos o indefinidos de forma segura', () => {
      expect(normalizeFiscalResponsibilityCode('')).toBe('');
      expect(normalizeFiscalResponsibilityCode(null)).toBe('');
      expect(normalizeFiscalResponsibilityCode(undefined)).toBe('');
      expect(normalizeFiscalResponsibilityCode('   ')).toBe('');
    });
  });

  describe('isValidFiscalResponsibility', () => {
    it('valida positivamente los códigos canónicos', () => {
      expect(isValidFiscalResponsibility('O-05')).toBe(true);
      expect(isValidFiscalResponsibility('O-48')).toBe(true);
      expect(isValidFiscalResponsibility('O-52')).toBe(true);
      expect(isValidFiscalResponsibility('R-99-PN')).toBe(true);
    });

    it('valida negativamente códigos no canónicos o fuera del catálogo', () => {
      expect(isValidFiscalResponsibility('48')).toBe(false);
      expect(isValidFiscalResponsibility('R-99-PJ')).toBe(false);
      expect(isValidFiscalResponsibility('FAKE')).toBe(false);
      expect(isValidFiscalResponsibility(null)).toBe(false);
      expect(isValidFiscalResponsibility(123)).toBe(false);
    });
  });
});
