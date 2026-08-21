// Spec para el spec del backend: apps/backend/src/common/helpers/vat-responsibility.helper.spec.ts.
// Si este spec pasa y el backend no, hay divergencia.

import { isVatResponsible } from './pos-ticket.service';

describe('isVatResponsible (mirror del helper backend)', () => {
  describe('responsabilidad explícita (RUT casilla 53)', () => {
    it('O-48 ⇒ true', () => {
      expect(isVatResponsible({ tax_responsibilities: ['O-48'] } as any)).toBe(true);
    });
    it('O-49 sin O-48 ⇒ false', () => {
      expect(isVatResponsible({ tax_responsibilities: ['O-49'] } as any)).toBe(false);
    });
    it('O-48 coexiste con O-49 ⇒ O-48 gana', () => {
      expect(isVatResponsible({ tax_responsibilities: ['O-48', 'O-49'] } as any)).toBe(true);
    });
  });
  describe('fallback por tax_regime', () => {
    it('COMUN + responsabilidades vacías ⇒ true', () => {
      expect(isVatResponsible({ tax_responsibilities: [], tax_regime: 'COMUN' } as any)).toBe(true);
    });
    it('SIMPLIFICADO + responsabilidades vacías ⇒ false', () => {
      expect(isVatResponsible({ tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' } as any)).toBe(false);
    });
  });
  describe('rama indeterminada (fail-closed post-F4)', () => {
    it('sin responsabilidades y sin régimen ⇒ false', () => {
      expect(isVatResponsible({ tax_responsibilities: [] } as any)).toBe(false);
    });
    it('fiscalData null ⇒ false', () => {
      expect(isVatResponsible(null as any)).toBe(false);
    });
    it('fiscalData undefined ⇒ false', () => {
      expect(isVatResponsible(undefined as any)).toBe(false);
    });
  });
});
