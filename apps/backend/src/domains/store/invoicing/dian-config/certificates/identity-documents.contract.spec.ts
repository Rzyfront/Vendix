import {
  DIAN_IDENTITY_DOCUMENT_LABELS,
  DIAN_IDENTITY_DOCUMENT_TYPES,
  allowedIdentityDocuments,
  missingIdentityDocuments,
  normalizePersonType,
  requiredIdentityDocuments,
} from './identity-documents.contract';

/**
 * 3-scheme para la regla de documentos de identidad (QUI-657).
 *
 * Es una REGLA pura, no un procedimiento: se prueba sin base de datos, sin S3
 * y sin contexto de tenant. El comportamiento que queda fuera (HTTP, carga,
 * cola de superadmin) lo prueba `dian-config.service.spec.ts`.
 */

describe('identity-documents.contract — QUI-657', () => {
  describe('HAPPY: persona jurídica entrega los 3 documentos', () => {
    it('exige exactamente RUT, id y certificado de existencia', () => {
      expect(requiredIdentityDocuments('juridica')).toEqual([
        'rut',
        'id',
        'certificate_of_existence',
      ]);
    });

    it('admite exactamente el mismo juego que exige', () => {
      expect(allowedIdentityDocuments('juridica')).toEqual(
        requiredIdentityDocuments('juridica'),
      );
    });

    it('no falta nada cuando los tres están subidos', () => {
      expect(
        missingIdentityDocuments('juridica', [
          'rut',
          'id',
          'certificate_of_existence',
        ]),
      ).toEqual([]);
    });

    it('normaliza mayúsculas y espacios', () => {
      expect(normalizePersonType('  JURIDICA ')).toBe('juridica');
    });
  });

  describe('SAD: persona natural — el certificado de existencia es INEXISTENTE', () => {
    it('solo exige RUT e id', () => {
      expect(requiredIdentityDocuments('natural')).toEqual(['rut', 'id']);
    });

    it('el certificado de existencia NO está en el juego admitido', () => {
      // Una persona natural no tiene representación legal; pedirle ese doc
      // es un 400 garantizado. La forma correcta de detectarlo en backend
      // es a través de allowedIdentityDocuments, no de required.
      expect(allowedIdentityDocuments('natural')).not.toContain(
        'certificate_of_existence',
      );
    });

    it('faltar el id se reporta, no el certificado de existencia', () => {
      const missing = missingIdentityDocuments('natural', ['rut']);
      expect(missing).toEqual(['id']);
      expect(missing).not.toContain('certificate_of_existence');
    });
  });

  describe('SAD: person_type desconocido / null se trata como jurídica', () => {
    it('null cae al juego más exigente (jurídica)', () => {
      expect(requiredIdentityDocuments(null)).toEqual([
        'rut',
        'id',
        'certificate_of_existence',
      ]);
    });

    it('undefined cae igual al juego más exigente', () => {
      expect(requiredIdentityDocuments(undefined)).toEqual([
        'rut',
        'id',
        'certificate_of_existence',
      ]);
    });

    it('texto desconocido se trata como jurídica (defensivo)', () => {
      expect(requiredIdentityDocuments('sociedad-anonima')).toEqual([
        'rut',
        'id',
        'certificate_of_existence',
      ]);
    });

    it('"persona_natural" se normaliza a natural', () => {
      expect(normalizePersonType('persona_natural')).toBe('natural');
    });
  });

  describe('BRUTE: detección de faltantes con duplicados y tipos basura', () => {
    it('documentos duplicados del mismo tipo se ignoran (Set)', () => {
      const missing = missingIdentityDocuments('juridica', [
        'rut',
        'rut',
        'id',
        'id',
        'id',
      ]);
      expect(missing).toEqual(['certificate_of_existence']);
    });

    it('documentos de tipo desconocido no cuentan como subido', () => {
      const missing = missingIdentityDocuments('juridica', [
        'rut',
        'id',
        'visa',
        'pasaporte',
      ]);
      expect(missing).toEqual(['certificate_of_existence']);
    });

    it('constantes exportadas: etiquetas y tipos no cambian de nombre sin querer', () => {
      // Si renombramos un valor del enum del backend, este test rompe antes
      // de que la UI se entere de que está desfasada. Es la red de seguridad
      // barata del contrato entre cliente y servidor.
      expect(DIAN_IDENTITY_DOCUMENT_TYPES).toEqual([
        'rut',
        'id',
        'certificate_of_existence',
      ]);
      expect(DIAN_IDENTITY_DOCUMENT_LABELS.rut).toBe('RUT');
      expect(DIAN_IDENTITY_DOCUMENT_LABELS.id).toBe('Documento de identidad');
      expect(DIAN_IDENTITY_DOCUMENT_LABELS.certificate_of_existence).toBe(
        'Certificado de existencia y representación legal',
      );
    });
  });
});
