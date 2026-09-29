import {
  CUSTOMER_ADAPTER_VERSION,
  formatDocument,
  fullName,
} from './customer.adapter';

/**
 * Paso 15 (T6) — contrato del adaptador `customers`.
 *
 * Pinnea (a) la versión del adaptador contra el contrato (`'1'`),
 * (b) equivalencia happy con los mappers que vivían inline en
 * `customers.tools.ts` y (c) degradación honesta: sin nombres sale `''` (el
 * llamante decide el sustituto) y sin número de documento sale `null`, nunca
 * un documento a medias inventado.
 */
describe('customer.adapter', () => {
  describe('versión', () => {
    it("implementa el contrato v1 de las tools", () => {
      expect(CUSTOMER_ADAPTER_VERSION).toBe('1');
    });
  });

  describe('fullName', () => {
    it('happy: nombres + apellidos recortados', () => {
      expect(
        fullName({ first_name: 'Ana', last_name: 'Martínez' }),
      ).toBe('Ana Martínez');
      expect(fullName({ first_name: 'Ana' })).toBe('Ana');
    });

    it('sad: sin nombres devuelve vacío, nunca un nombre inventado', () => {
      expect(fullName({})).toBe('');
    });
  });

  describe('formatDocument', () => {
    it('happy: tipo + número', () => {
      expect(
        formatDocument({ document_type: 'CC', document_number: '123' }),
      ).toBe('CC 123');
      expect(formatDocument({ document_number: '123' })).toBe('123');
    });

    it('sad: sin número devuelve null', () => {
      expect(formatDocument({ document_type: 'CC' })).toBeNull();
      expect(formatDocument({})).toBeNull();
    });
  });
});
