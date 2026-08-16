import { computeNitDv } from '@common/utils/nit.util';
import {
  CustomerFiscalIdentityCode,
  CustomerFiscalIdentityInput,
  CustomerFiscalIdentityReport,
  CustomerFiscalIdentityValidator,
  DIAN_DEFAULT_TAX_RESPONSIBILITY,
  DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  DIAN_FINAL_CONSUMER_NAME,
  DIAN_FINAL_CONSUMER_TYPE_CODE,
  resolveIdentificationType,
} from './customer-fiscal-identity.validator';

/**
 * NIT de prueba y su DV DERIVADO. El DV nunca se escribe a mano en este archivo:
 * si se hardcodeara, el test pasaría a afirmar el mismo checksum que el código
 * calcula sin que nadie lo hubiera comprobado nunca.
 */
const NIT = '900123456';
const NIT_DV = computeNitDv(NIT);
/** Un DV que con certeza NO es el correcto, sea cual sea el correcto. */
const WRONG_DV = String((Number(NIT_DV) + 1) % 10);

const VALID_ADDRESS = {
  address_line: 'Calle 100 # 15 - 20',
  city_code: '05001',
  city_name: 'Medellín',
  department_code: '05',
  department_name: 'Antioquia',
  country_code: 'CO',
  postal_code: '050001',
};

/** Persona jurídica completamente sana: el caso feliz de referencia. */
function juridica(
  overrides: Partial<CustomerFiscalIdentityInput> = {},
): CustomerFiscalIdentityInput {
  return {
    identification_mode: 'nominative',
    document_type: 'NIT',
    document_number: NIT,
    verification_digit: NIT_DV,
    person_type: 'JURIDICA',
    legal_name: 'Comercializadora ABC S.A.S.',
    tax_regime: 'COMUN',
    tax_responsibilities: ['O-13'],
    email: 'facturacion@abc.com',
    phone: '3001234567',
    address: { ...VALID_ADDRESS },
    ...overrides,
  };
}

/** Persona natural completamente sana. */
function natural(
  overrides: Partial<CustomerFiscalIdentityInput> = {},
): CustomerFiscalIdentityInput {
  return {
    identification_mode: 'nominative',
    document_type: 'CC',
    document_number: '1118860776',
    person_type: 'NATURAL',
    first_name: 'Juan',
    last_name: 'Pérez',
    tax_responsibilities: ['R-99-PN'],
    email: 'juan@correo.com',
    phone: '3001234567',
    address: { ...VALID_ADDRESS },
    ...overrides,
  };
}

function codes(report: CustomerFiscalIdentityReport): CustomerFiscalIdentityCode[] {
  return report.findings.map((finding) => finding.code);
}

function blockerCodes(
  report: CustomerFiscalIdentityReport,
): CustomerFiscalIdentityCode[] {
  return report.blockers.map((finding) => finding.code);
}

describe('CustomerFiscalIdentityValidator', () => {
  let validator: CustomerFiscalIdentityValidator;

  beforeEach(() => {
    // PURA a propósito: se instancia sin módulo de Nest, sin Prisma y sin
    // contexto de request. Si algún día hiciera falta un mock aquí, el
    // componente habría dejado de ser lo que promete.
    validator = new CustomerFiscalIdentityValidator();
  });

  // ---------------------------------------------------------------------------
  // EL CORAZÓN: CONSUMIDOR FINAL EXPLÍCITO VS IMPLÍCITO
  // ---------------------------------------------------------------------------

  describe('consumidor final explícito vs implícito', () => {
    it('acepta el consumidor final EXPLÍCITO aunque no traiga ningún dato', () => {
      const report = validator.validate({
        identification_mode: 'final_consumer',
      });

      expect(report.emittable).toBe(true);
      expect(report.blockers).toEqual([]);
      expect(report.findings).toEqual([]);
      expect(report.normalized).toEqual(
        expect.objectContaining({
          mode: 'final_consumer',
          document_type_code: DIAN_FINAL_CONSUMER_TYPE_CODE,
          document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
          verification_digit: null,
          name: DIAN_FINAL_CONSUMER_NAME,
          person_type: 'NATURAL',
          tax_responsibilities: [DIAN_DEFAULT_TAX_RESPONSIBILITY],
          address: null,
        }),
      );
    });

    it('acepta el consumidor final explícito escrito con sus valores oficiales', () => {
      const report = validator.validate({
        identification_mode: 'final_consumer',
        document_type: 'CC',
        document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
      });

      expect(report.emittable).toBe(true);
      expect(report.findings).toEqual([]);
    });

    it('BLOQUEA el consumidor final IMPLÍCITO: factura nominativa sin adquiriente', () => {
      const report = validator.validate({ identification_mode: 'nominative' });

      expect(report.emittable).toBe(false);
      expect(blockerCodes(report)).toEqual(['IMPLICIT_FINAL_CONSUMER']);
      expect(report.normalized).toBeNull();
      // El mensaje tiene que nombrar lo que el XML declararía hoy, que es
      // exactamente lo que nadie ve pasar.
      expect(report.blockers[0].problem).toContain('Consumidor Final');
      expect(report.blockers[0].fix).toContain('consumidor final');
    });

    it('BLOQUEA el 222222222222 usado como relleno en una factura nominativa', () => {
      const report = validator.validate(
        natural({ document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER }),
      );

      expect(report.emittable).toBe(false);
      expect(blockerCodes(report)).toContain('IMPLICIT_FINAL_CONSUMER');
      // No se cuenta dos veces el mismo defecto con otro nombre.
      expect(codes(report)).not.toContain('DOCUMENT_NUMBER_PLACEHOLDER');
    });

    it('avisa (sin bloquear) cuando un documento a consumidor final trae un cliente identificado', () => {
      const report = validator.validate({
        identification_mode: 'final_consumer',
        document_type: 'NIT',
        document_number: NIT,
        legal_name: 'Comercializadora ABC S.A.S.',
      });

      expect(report.emittable).toBe(true);
      expect(codes(report)).toContain('FINAL_CONSUMER_IS_IDENTIFIED');
      expect(codes(report)).toContain('FINAL_CONSUMER_TYPE_MISMATCH');
      expect(report.blockers).toEqual([]);
      // Se emite con el valor oficial: el cliente identificado NO viaja.
      expect(report.normalized?.document_number).toBe(
        DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
      );
    });

    it('no exige dirección ni correo al consumidor final', () => {
      const report = validator.validate({
        identification_mode: 'final_consumer',
      });

      expect(codes(report)).not.toContain('ADDRESS_REQUIRED');
      expect(codes(report)).not.toContain('EMAIL_MISSING');
    });
  });

  // ---------------------------------------------------------------------------
  // CASOS FELICES
  // ---------------------------------------------------------------------------

  describe('caso feliz', () => {
    it('no reporta nada para una persona jurídica completa', () => {
      const report = validator.validate(juridica());

      expect(report.findings).toEqual([]);
      expect(report.emittable).toBe(true);
      expect(report.normalized).toEqual(
        expect.objectContaining({
          mode: 'nominative',
          document_type_code: '31',
          document_type_alias: 'NIT',
          document_number: NIT,
          verification_digit: NIT_DV,
          person_type: 'JURIDICA',
          name: 'Comercializadora ABC S.A.S.',
          tax_responsibilities: ['O-13'],
        }),
      );
    });

    it('no reporta nada para una persona natural completa', () => {
      const report = validator.validate(natural());

      expect(report.findings).toEqual([]);
      expect(report.normalized?.person_type).toBe('NATURAL');
      expect(report.normalized?.verification_digit).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 1. TIPO DE IDENTIFICACIÓN
  // ---------------------------------------------------------------------------

  describe('tipo de identificación', () => {
    it('acepta el código DIAN y el alias interno como el mismo tipo', () => {
      expect(resolveIdentificationType('31')?.code).toBe('31');
      expect(resolveIdentificationType('NIT')?.code).toBe('31');
      expect(resolveIdentificationType('nit')?.code).toBe('31');
      expect(resolveIdentificationType('13')?.code).toBe('13');
      expect(resolveIdentificationType('CC')?.code).toBe('13');
    });

    it('reconoce los 12 tipos del Anexo 19 por su código', () => {
      for (const code of [
        '11',
        '12',
        '13',
        '21',
        '22',
        '31',
        '41',
        '42',
        '47',
        '48',
        '50',
        '91',
      ]) {
        expect(resolveIdentificationType(code)?.code).toBe(code);
      }
    });

    it('bloquea cuando falta el tipo', () => {
      const report = validator.validate(natural({ document_type: null }));

      expect(blockerCodes(report)).toContain('DOCUMENT_TYPE_REQUIRED');
      expect(report.emittable).toBe(false);
    });

    it('bloquea un tipo fuera del catálogo DIAN', () => {
      const report = validator.validate(natural({ document_type: 'DNI' }));

      expect(blockerCodes(report)).toContain('DOCUMENT_TYPE_UNKNOWN');
      expect(
        report.blockers.find((f) => f.code === 'DOCUMENT_TYPE_UNKNOWN')?.problem,
      ).toContain('DNI');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. NÚMERO DE DOCUMENTO
  // ---------------------------------------------------------------------------

  describe('número de identificación', () => {
    it('bloquea cuando falta el número pero hay nombre y tipo', () => {
      const report = validator.validate(natural({ document_number: null }));

      expect(blockerCodes(report)).toContain('DOCUMENT_NUMBER_REQUIRED');
    });

    it('bloquea letras en un documento numérico', () => {
      const report = validator.validate(natural({ document_number: '11188A0776' }));

      expect(blockerCodes(report)).toContain('DOCUMENT_NUMBER_NOT_NUMERIC');
    });

    it('acepta letras en un pasaporte', () => {
      const report = validator.validate(
        natural({ document_type: 'PA', document_number: 'AF482913' }),
      );

      expect(codes(report)).not.toContain('DOCUMENT_NUMBER_NOT_NUMERIC');
      expect(codes(report)).not.toContain('DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH');
    });

    it('bloquea una longitud imposible para el tipo', () => {
      const report = validator.validate(natural({ document_number: '12' }));

      expect(blockerCodes(report)).toContain(
        'DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH',
      );
    });

    it('bloquea los rellenos típicos', () => {
      for (const filler of ['123456789', '1234567890']) {
        const report = validator.validate(natural({ document_number: filler }));
        expect(blockerCodes(report)).toContain('DOCUMENT_NUMBER_PLACEHOLDER');
      }
    });

    it('bloquea un número de dígitos repetidos', () => {
      const report = validator.validate(natural({ document_number: '9999999999' }));

      expect(blockerCodes(report)).toContain('DOCUMENT_NUMBER_PLACEHOLDER');
    });

    it('ignora puntos y guiones al medir el número', () => {
      const report = validator.validate(juridica({ document_number: '900.123.456' }));

      expect(codes(report)).not.toContain('DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH');
      expect(report.normalized?.document_number).toBe(NIT);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. DÍGITO DE VERIFICACIÓN (módulo 11)
  // ---------------------------------------------------------------------------

  describe('dígito de verificación', () => {
    it('acepta un NIT con el DV correcto', () => {
      const report = validator.validate(juridica({ verification_digit: NIT_DV }));

      expect(codes(report)).not.toContain('VERIFICATION_DIGIT_MISMATCH');
      expect(report.emittable).toBe(true);
    });

    it('bloquea un NIT con DV incorrecto y nombra los DOS valores', () => {
      const report = validator.validate(juridica({ verification_digit: WRONG_DV }));

      expect(blockerCodes(report)).toContain('VERIFICATION_DIGIT_MISMATCH');
      const finding = report.blockers.find(
        (f) => f.code === 'VERIFICATION_DIGIT_MISMATCH',
      )!;
      expect(finding.problem).toContain(WRONG_DV);
      expect(finding.problem).toContain(NIT_DV);
      expect(finding.details).toEqual(
        expect.objectContaining({
          provided_verification_digit: WRONG_DV,
          computed_verification_digit: NIT_DV,
        }),
      );
    });

    it('DERIVA el DV cuando no viene: el checksum no es un dato de captura', () => {
      const report = validator.validate(juridica({ verification_digit: null }));

      expect(codes(report)).not.toContain('VERIFICATION_DIGIT_MISMATCH');
      expect(report.emittable).toBe(true);
      expect(report.normalized?.verification_digit).toBe(NIT_DV);
    });

    it('SEÑALA una cédula con DV: las cédulas no llevan dígito de verificación', () => {
      const report = validator.validate(natural({ verification_digit: '3' }));

      expect(blockerCodes(report)).toContain('VERIFICATION_DIGIT_NOT_APPLICABLE');
      const finding = report.blockers.find(
        (f) => f.code === 'VERIFICATION_DIGIT_NOT_APPLICABLE',
      )!;
      // Tiene que explicar el daño concreto: la identificación emitida sería la
      // de nadie, no la de esta persona.
      expect(finding.problem).toContain('1118860776-3');
      expect(finding.fix).toContain('NIT');
    });

    it('nunca deriva DV para un tipo que no lo lleva', () => {
      const report = validator.validate(natural());

      expect(report.normalized?.verification_digit).toBeNull();
    });

    it('no deriva DV para el NIT de otro país (no tiene módulo 11 de la DIAN)', () => {
      const report = validator.validate(
        juridica({
          document_type: 'NIT_EXTRANJERIA',
          document_number: 'ES-B12345678',
          verification_digit: null,
        }),
      );

      expect(report.normalized?.verification_digit).toBeNull();
      expect(codes(report)).not.toContain('VERIFICATION_DIGIT_MISMATCH');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. NOMBRE Y TIPO DE PERSONA
  // ---------------------------------------------------------------------------

  describe('nombre y tipo de persona', () => {
    it('bloquea una persona jurídica sin razón social', () => {
      const report = validator.validate(juridica({ legal_name: null }));

      expect(blockerCodes(report)).toContain('LEGAL_NAME_REQUIRED');
    });

    it('bloquea una persona natural sin ningún nombre', () => {
      const report = validator.validate(
        natural({ first_name: null, last_name: null, legal_name: null }),
      );

      expect(blockerCodes(report)).toContain('PERSON_NAME_REQUIRED');
    });

    it('avisa cuando la persona natural tiene el nombre en un solo campo', () => {
      const report = validator.validate(
        natural({ first_name: null, last_name: null, legal_name: 'Juan Pérez' }),
      );

      expect(codes(report)).toContain('FAMILY_NAME_MISSING');
      expect(blockerCodes(report)).not.toContain('FAMILY_NAME_MISSING');
      expect(report.emittable).toBe(true);
    });

    it('bloquea nombres de relleno', () => {
      for (const filler of ['N/A', 'CLIENTE', 'sin nombre', '-', 'prueba']) {
        const report = validator.validate(juridica({ legal_name: filler }));
        expect(blockerCodes(report)).toContain('NAME_PLACEHOLDER');
      }
    });

    it('bloquea «Consumidor Final» escrito a mano en una factura nominativa', () => {
      const report = validator.validate(
        juridica({ legal_name: DIAN_FINAL_CONSUMER_NAME }),
      );

      expect(blockerCodes(report)).toContain('NAME_PLACEHOLDER');
    });

    it('deriva el tipo de persona del tipo de documento cuando no viene', () => {
      const conNit = validator.validate(juridica({ person_type: null }));
      expect(conNit.normalized?.person_type).toBe('JURIDICA');

      const conCedula = validator.validate(natural({ person_type: null }));
      expect(conCedula.normalized?.person_type).toBe('NATURAL');
    });

    it('bloquea una persona jurídica identificada con cédula', () => {
      const report = validator.validate(
        natural({ person_type: 'JURIDICA', legal_name: 'ABC S.A.S.' }),
      );

      expect(blockerCodes(report)).toContain('PERSON_TYPE_DOCUMENT_MISMATCH');
    });

    it('avisa (sin bloquear) un tipo de persona no reconocido', () => {
      const report = validator.validate(juridica({ person_type: 'EMPRESA' }));

      expect(codes(report)).toContain('PERSON_TYPE_UNKNOWN');
      expect(blockerCodes(report)).not.toContain('PERSON_TYPE_UNKNOWN');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. RÉGIMEN Y RESPONSABILIDADES
  // ---------------------------------------------------------------------------

  describe('régimen fiscal y responsabilidades', () => {
    it('acepta los regímenes del catálogo', () => {
      for (const regime of [
        'COMUN',
        'SIMPLIFICADO',
        'GRAN_CONTRIBUYENTE',
        'AUTORRETENEDOR',
        'ESPECIAL',
        'NO_APLICA',
      ]) {
        const report = validator.validate(juridica({ tax_regime: regime }));
        expect(codes(report)).not.toContain('TAX_REGIME_UNKNOWN');
      }
    });

    it('avisa un régimen fuera del catálogo', () => {
      const report = validator.validate(juridica({ tax_regime: 'REGIMEN_X' }));

      expect(codes(report)).toContain('TAX_REGIME_UNKNOWN');
      expect(report.emittable).toBe(true);
    });

    it('acepta las responsabilidades conocidas', () => {
      const report = validator.validate(
        juridica({ tax_responsibilities: ['O-13', 'O-15', 'O-23', 'O-47'] }),
      );

      expect(report.findings).toEqual([]);
    });

    it('bloquea una responsabilidad mal formada', () => {
      const report = validator.validate(
        juridica({ tax_responsibilities: ['GRAN CONTRIBUYENTE'] }),
      );

      expect(blockerCodes(report)).toContain('TAX_RESPONSIBILITY_MALFORMED');
    });

    it('avisa (sin bloquear) un código bien formado pero desconocido', () => {
      const report = validator.validate(
        juridica({ tax_responsibilities: ['O-99'] }),
      );

      expect(codes(report)).toContain('TAX_RESPONSIBILITY_UNKNOWN');
      expect(report.emittable).toBe(true);
    });

    it('avisa cuando no hay responsabilidades y normaliza a R-99-PN', () => {
      const report = validator.validate(juridica({ tax_responsibilities: [] }));

      expect(codes(report)).toContain('TAX_RESPONSIBILITIES_MISSING');
      expect(report.emittable).toBe(true);
      expect(report.normalized?.tax_responsibilities).toEqual([
        DIAN_DEFAULT_TAX_RESPONSIBILITY,
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. DIRECCIÓN
  // ---------------------------------------------------------------------------

  describe('dirección', () => {
    it('avisa (sin bloquear) la ausencia total de dirección: la cascada del emisor usa un domicilio real', () => {
      const report = validator.validate(juridica({ address: null }));

      // Bloquear aquí dejaba inalcanzable la cascada fiscal→envío→tienda: el
      // usuario veía el modal de errores aunque el respaldo funcionara. Y el
      // texto ya no puede nombrar «11001», porque el emisor no rellena Bogotá.
      expect(blockerCodes(report)).not.toContain('ADDRESS_REQUIRED');
      expect(codes(report)).toContain('ADDRESS_REQUIRED');
      expect(
        report.warnings.find((f) => f.code === 'ADDRESS_REQUIRED')?.problem,
      ).not.toContain('11001');
    });

    it('bloquea la falta de país', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, country_code: null } }),
      );

      expect(blockerCodes(report)).toContain('COUNTRY_CODE_REQUIRED');
    });

    it('bloquea un país que no es ISO 3166-1 alfa-2', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, country_code: 'COL' } }),
      );

      expect(blockerCodes(report)).toContain('COUNTRY_CODE_MALFORMED');
    });

    it('bloquea la falta de municipio', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, city_code: null } }),
      );

      expect(blockerCodes(report)).toContain('CITY_CODE_REQUIRED');
    });

    it('bloquea un municipio que no tiene forma de código DANE', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, city_code: 'MED' } }),
      );

      expect(blockerCodes(report)).toContain('CITY_CODE_MALFORMED');
    });

    it('bloquea un municipio incoherente con el departamento', () => {
      const report = validator.validate(
        juridica({
          // 05001 es Medellín (Antioquia, 05) pero se declara Bogotá D.C. (11).
          address: {
            ...VALID_ADDRESS,
            city_code: '05001',
            department_code: '11',
            department_name: 'Bogotá D.C.',
          },
        }),
      );

      expect(blockerCodes(report)).toContain('DEPARTMENT_CITY_MISMATCH');
      const finding = report.blockers.find(
        (f) => f.code === 'DEPARTMENT_CITY_MISMATCH',
      )!;
      expect(finding.details).toEqual(
        expect.objectContaining({ department_code_from_city: '05' }),
      );
    });

    it('DERIVA el departamento de los dos primeros dígitos del municipio', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, department_code: null } }),
      );

      expect(codes(report)).not.toContain('DEPARTMENT_CITY_MISMATCH');
      expect(codes(report)).not.toContain('DEPARTMENT_CODE_MALFORMED');
      expect(report.emittable).toBe(true);
      expect(report.normalized?.address?.department_code).toBe('05');
    });

    // Los dos nombres se derivan del código por catálogo DANE
    // (`resolveDianMunicipality`), así que su ausencia no puede producir un XML
    // que se contradiga: o resuelve, o la emisión falla nombrando el municipio
    // rechazado. Avisar sí; bloquear era una premisa falsa.
    it('avisa (sin bloquear) el nombre de municipio ausente: se deriva del código DANE', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, city_name: null } }),
      );

      expect(blockerCodes(report)).not.toContain('CITY_NAME_REQUIRED');
      expect(codes(report)).toContain('CITY_NAME_REQUIRED');
    });

    it('avisa (sin bloquear) el nombre de departamento ausente: sale del mismo catálogo', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, department_name: null } }),
      );

      expect(blockerCodes(report)).not.toContain('DEPARTMENT_NAME_REQUIRED');
      expect(codes(report)).toContain('DEPARTMENT_NAME_REQUIRED');
    });

    it('avisa (sin bloquear) la línea de dirección vacía: su fallback es «N/A», no una mentira', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, address_line: null } }),
      );

      expect(codes(report)).toContain('ADDRESS_LINE_MISSING');
      expect(report.emittable).toBe(true);
    });

    it('avisa el código postal ausente', () => {
      const report = validator.validate(
        juridica({ address: { ...VALID_ADDRESS, postal_code: null } }),
      );

      expect(codes(report)).toContain('POSTAL_CODE_MISSING');
      expect(report.emittable).toBe(true);
    });

    it('no exige códigos DANE a un adquiriente extranjero', () => {
      const report = validator.validate(
        juridica({
          document_type: 'NIT_EXTRANJERIA',
          document_number: 'ES-B12345678',
          verification_digit: null,
          address: {
            address_line: 'Gran Vía 1',
            city_name: 'Madrid',
            country_code: 'ES',
          },
        }),
      );

      expect(codes(report)).not.toContain('CITY_CODE_REQUIRED');
      expect(codes(report)).not.toContain('DEPARTMENT_NAME_REQUIRED');
      expect(codes(report)).not.toContain('POSTAL_CODE_MISSING');
      expect(report.emittable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. CORREO
  // ---------------------------------------------------------------------------

  describe('correo electrónico', () => {
    it('AVISA (no bloquea) cuando falta: el XML omite el elemento, no lo inventa', () => {
      const report = validator.validate(juridica({ email: null }));

      expect(codes(report)).toContain('EMAIL_MISSING');
      expect(blockerCodes(report)).not.toContain('EMAIL_MISSING');
      expect(report.emittable).toBe(true);
    });

    it('BLOQUEA un correo mal formado: sí declara un buzón, y uno imposible', () => {
      for (const bad of ['sin-arroba', 'a@b', 'a b@c.com', '@dominio.com']) {
        const report = validator.validate(juridica({ email: bad }));
        expect(blockerCodes(report)).toContain('EMAIL_MALFORMED');
      }
    });

    it('acepta un correo bien formado', () => {
      const report = validator.validate(juridica({ email: 'a.b+c@sub.dominio.co' }));

      expect(codes(report)).not.toContain('EMAIL_MALFORMED');
      expect(codes(report)).not.toContain('EMAIL_MISSING');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. INVARIANTES DEL CONTRATO DE SALIDA
  // ---------------------------------------------------------------------------

  describe('invariantes del reporte', () => {
    /** Un barrido de casos rotos que cubre TODOS los códigos bloqueantes. */
    const escenariosRotos: CustomerFiscalIdentityInput[] = [
      { identification_mode: 'nominative' },
      natural({ document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER }),
      natural({ document_type: null }),
      natural({ document_type: 'DNI' }),
      natural({ document_number: null }),
      natural({ document_number: '11188A0776' }),
      natural({ document_number: '12' }),
      natural({ document_number: '123456789' }),
      juridica({ verification_digit: WRONG_DV }),
      natural({ verification_digit: '3' }),
      juridica({ legal_name: null }),
      natural({ first_name: null, last_name: null, legal_name: null }),
      juridica({ legal_name: 'N/A' }),
      natural({ person_type: 'JURIDICA', legal_name: 'ABC S.A.S.' }),
      juridica({ tax_responsibilities: ['GRAN CONTRIBUYENTE'] }),
      juridica({ address: { ...VALID_ADDRESS, country_code: null } }),
      juridica({ address: { ...VALID_ADDRESS, country_code: 'COL' } }),
      juridica({ address: { ...VALID_ADDRESS, city_code: null } }),
      juridica({ address: { ...VALID_ADDRESS, city_code: 'MED' } }),
      juridica({ address: { ...VALID_ADDRESS, department_code: 'ANT' } }),
      juridica({ address: { ...VALID_ADDRESS, department_code: '11' } }),
      juridica({ email: 'sin-arroba' }),
    ];

    /**
     * LO QUE FALTA PERO NO IMPIDE EMITIR.
     *
     * Estos tres estaban arriba, entre los bloqueantes, y bajaron a propósito.
     * El emisor ya no inventa Bogotá: la cascada de dirección baja por los
     * domicilios REALES —fiscal, luego envío, luego el de la tienda emisora—,
     * declara cuál usó en `provider_data.acquirer_address_source`, y si no hay
     * ninguno falla ella con un error tipado antes de firmar. Los nombres de
     * municipio y departamento salen del catálogo DANE vía
     * `resolveDianMunicipality`, no del cliente.
     *
     * Mantenerlos en `blocker` dejaba la cascada inalcanzable: el usuario veía
     * el modal de errores aunque el respaldo funcionara — el atasco reportado.
     *
     * Siguen siendo hallazgos: el documento sale con el domicilio de otro, y eso
     * hay que decirlo. Lo que ya no hacen es bloquear.
     */
    const escenariosSoloAviso: CustomerFiscalIdentityInput[] = [
      juridica({ address: null }),
      juridica({ address: { ...VALID_ADDRESS, city_name: null } }),
      juridica({ address: { ...VALID_ADDRESS, department_name: null } }),
    ];

    const todosLosEscenarios = [...escenariosRotos, ...escenariosSoloAviso];

    it('ningún hallazgo bloqueante queda sin instrucción de corrección', () => {
      for (const escenario of escenariosRotos) {
        const report = validator.validate(escenario);
        expect(report.blockers.length).toBeGreaterThan(0);
        for (const blocker of report.blockers) {
          expect(blocker.fix.trim().length).toBeGreaterThan(20);
          expect(blocker.problem.trim().length).toBeGreaterThan(20);
          expect(blocker.field.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it('ningún hallazgo —bloqueante o advertencia— queda sin corrección ni campo', () => {
      for (const escenario of todosLosEscenarios) {
        for (const finding of validator.validate(escenario).findings) {
          expect(finding.fix.trim()).not.toBe('');
          expect(finding.problem.trim()).not.toBe('');
          expect(finding.field.trim()).not.toBe('');
        }
      }
    });

    it('nunca entrega identidad normalizada cuando hay bloqueantes', () => {
      for (const escenario of escenariosRotos) {
        const report = validator.validate(escenario);
        expect(report.emittable).toBe(false);
        expect(report.normalized).toBeNull();
      }
    });

    /**
     * La contracara, y el motivo por el que la degradación se hizo: una
     * identidad a la que sólo le falta el domicilio SÍ es emitible, y el
     * validador tiene que decirlo con un aviso, no callándose.
     */
    it('lo que sólo falta —no está mal— avisa sin bloquear y deja emitir', () => {
      for (const escenario of escenariosSoloAviso) {
        const report = validator.validate(escenario);
        expect(report.blockers).toHaveLength(0);
        expect(report.warnings.length).toBeGreaterThan(0);
        expect(report.emittable).toBe(true);
        expect(report.normalized).not.toBeNull();
      }
    });

    it('`findings` es exactamente la unión de bloqueantes y advertencias', () => {
      for (const escenario of todosLosEscenarios) {
        const report = validator.validate(escenario);
        expect(report.findings.length).toBe(
          report.blockers.length + report.warnings.length,
        );
        expect(report.blockers.every((f) => f.severity === 'blocker')).toBe(true);
        expect(report.warnings.every((f) => f.severity === 'warning')).toBe(true);
      }
    });

    it('el barrido cubre todos los códigos bloqueantes declarados', () => {
      const vistos = new Set<CustomerFiscalIdentityCode>();
      for (const escenario of escenariosRotos) {
        for (const blocker of validator.validate(escenario).blockers) {
          vistos.add(blocker.code);
        }
      }

      const esperados: CustomerFiscalIdentityCode[] = [
        'IMPLICIT_FINAL_CONSUMER',
        'DOCUMENT_TYPE_REQUIRED',
        'DOCUMENT_TYPE_UNKNOWN',
        'DOCUMENT_NUMBER_REQUIRED',
        'DOCUMENT_NUMBER_NOT_NUMERIC',
        'DOCUMENT_NUMBER_IMPLAUSIBLE_LENGTH',
        'DOCUMENT_NUMBER_PLACEHOLDER',
        'VERIFICATION_DIGIT_MISMATCH',
        'VERIFICATION_DIGIT_NOT_APPLICABLE',
        'LEGAL_NAME_REQUIRED',
        'PERSON_NAME_REQUIRED',
        'NAME_PLACEHOLDER',
        'PERSON_TYPE_DOCUMENT_MISMATCH',
        'TAX_RESPONSIBILITY_MALFORMED',
        // `ADDRESS_REQUIRED`, `CITY_NAME_REQUIRED` y `DEPARTMENT_NAME_REQUIRED`
        // NO están aquí a propósito: dejaron de ser bloqueantes cuando la
        // cascada de dirección los volvió resolubles (ver `escenariosSoloAviso`
        // arriba). Su cobertura la da el test de avisos, no ésta.
        'COUNTRY_CODE_REQUIRED',
        'COUNTRY_CODE_MALFORMED',
        'CITY_CODE_REQUIRED',
        'CITY_CODE_MALFORMED',
        'DEPARTMENT_CODE_MALFORMED',
        'DEPARTMENT_CITY_MISMATCH',
        'EMAIL_MALFORMED',
      ];

      for (const code of esperados) {
        expect(Array.from(vistos)).toContain(code);
      }
    });
  });
});
