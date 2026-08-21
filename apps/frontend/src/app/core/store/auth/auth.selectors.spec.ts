// Spec para el spec del backend: apps/backend/src/common/helpers/vat-responsibility.helper.spec.ts.
// Si este spec pasa y el backend no, hay divergencia.

import { resolveIsVatResponsible } from './auth.selectors';

describe('resolveIsVatResponsible (mirror del helper backend)', () => {
  describe('responsabilidad explícita (RUT casilla 53)', () => {
    it('O-48 ⇒ true', () => {
      expect(resolveIsVatResponsible({ tax_responsibilities: ['O-48'] })).toBe(true);
    });
    it('O-49 sin O-48 ⇒ false', () => {
      expect(resolveIsVatResponsible({ tax_responsibilities: ['O-49'] })).toBe(false);
    });
    it('O-48 coexiste con O-49 ⇒ O-48 gana', () => {
      expect(resolveIsVatResponsible({ tax_responsibilities: ['O-48', 'O-49'] })).toBe(true);
    });
  });
  describe('fallback por tax_regime', () => {
    it('COMUN + responsabilidades vacías ⇒ true', () => {
      expect(resolveIsVatResponsible({ tax_responsibilities: [], tax_regime: 'COMUN' })).toBe(true);
    });
    it('SIMPLIFICADO + responsabilidades vacías ⇒ false', () => {
      expect(resolveIsVatResponsible({ tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' })).toBe(false);
    });
  });
  describe('rama indeterminada (fail-closed post-F4)', () => {
    it('sin responsabilidades y sin régimen ⇒ false', () => {
      expect(resolveIsVatResponsible({ tax_responsibilities: [] })).toBe(false);
    });
    it('fiscalData null ⇒ false', () => {
      expect(resolveIsVatResponsible(null)).toBe(false);
    });
    it('fiscalData undefined ⇒ false', () => {
      expect(resolveIsVatResponsible(undefined)).toBe(false);
    });
  });
});
