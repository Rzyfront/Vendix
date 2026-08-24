import { VendixHttpException } from '@common/errors/vendix-http.exception';
import {
  DIAN_EMAIL_SUBJECT_SEPARATOR,
  buildDianEmailSubject,
  resolveDianDocumentTypeCode,
  sanitizeDianSubjectField,
} from './dian-email-subject.util';

/** Base válida; cada caso muta solo lo que está probando. */
const TEXMALL = {
  issuer_nit: '901280137',
  issuer_legal_name: 'TEXMALL SAS',
  document_number: 'FVET2254',
  document_type_code: '01',
};

describe('buildDianEmailSubject — Anexo 1.9 §9.1 (p. 635-636)', () => {
  it('reproduce el ejemplo de referencia: 901280137;TEXMALL SAS;FVET2254;01;TEXMALL SAS', () => {
    expect(buildDianEmailSubject(TEXMALL)).toBe(
      '901280137;TEXMALL SAS;FVET2254;01;TEXMALL SAS',
    );
  });

  it('reproduce el ejemplo del propio anexo, con la línea de negocio opcional', () => {
    // El anexo lo imprime como `99998888; Facturador Ejemplo; FEV500;01;
    // Facturador Ejemplo;ContabilidadBog` — con espacio tras tres de los cinco
    // separadores y sin espacio tras los otros dos. Esa inconsistencia del
    // propio documento normativo es la prueba de que el espacio no es parte de
    // la regla; se emite la forma canónica sin espacios.
    expect(
      buildDianEmailSubject({
        issuer_nit: '99998888',
        issuer_legal_name: 'Facturador Ejemplo',
        document_number: 'FEV500',
        document_type_code: '01',
        business_line: 'ContabilidadBog',
      }),
    ).toBe('99998888;Facturador Ejemplo;FEV500;01;Facturador Ejemplo;ContabilidadBog');
  });

  describe('el campo 5 es el NOMBRE COMERCIAL DEL EMISOR, no el adquiriente', () => {
    it('cae a la razón social cuando no hay nombre comercial — de ahí la repetición del ejemplo', () => {
      const subject = buildDianEmailSubject(TEXMALL);
      const fields = subject.split(DIAN_EMAIL_SUBJECT_SEPARATOR);
      expect(fields[1]).toBe('TEXMALL SAS');
      expect(fields[4]).toBe('TEXMALL SAS');
    });

    it('usa el nombre comercial cuando existe y difiere de la razón social', () => {
      expect(
        buildDianEmailSubject({
          ...TEXMALL,
          issuer_trade_name: 'Texmall Store',
        }),
      ).toBe('901280137;TEXMALL SAS;FVET2254;01;Texmall Store');
    });

    it('el adquiriente NO aparece en el asunto', () => {
      const subject = buildDianEmailSubject({
        ...TEXMALL,
        issuer_trade_name: 'Texmall Store',
      });
      // Si el quinto campo fuera del adquiriente —el supuesto que el anexo
      // desmiente— aquí aparecería su razón social.
      expect(subject).not.toContain('COMPRADOR');
      expect(subject.split(DIAN_EMAIL_SUBJECT_SEPARATOR)).toHaveLength(5);
    });
  });

  describe('separador', () => {
    it('es exactamente «;» sin espacios alrededor', () => {
      expect(DIAN_EMAIL_SUBJECT_SEPARATOR).toBe(';');
      expect(buildDianEmailSubject(TEXMALL)).not.toMatch(/\s;|;\s/);
    });

    it('emite 5 campos sin línea de negocio y 6 con ella', () => {
      expect(
        buildDianEmailSubject(TEXMALL).split(DIAN_EMAIL_SUBJECT_SEPARATOR),
      ).toHaveLength(5);
      expect(
        buildDianEmailSubject({ ...TEXMALL, business_line: 'Retail' }).split(
          DIAN_EMAIL_SUBJECT_SEPARATOR,
        ),
      ).toHaveLength(6);
    });

    it('una línea de negocio vacía o en blanco se omite, no deja un campo vacío', () => {
      for (const business_line of ['', '   ', null]) {
        expect(
          buildDianEmailSubject({ ...TEXMALL, business_line }).split(
            DIAN_EMAIL_SUBJECT_SEPARATOR,
          ),
        ).toHaveLength(5);
      }
    });
  });

  describe('NIT: la forma de cbc:CompanyID, sin dígito de verificación', () => {
    it.each([
      ['901280137', '901280137'],
      ['901280137-1', '901280137'],
      ['901.280.137-1', '901280137'],
      ['  901 280 137 ', '901280137'],
    ])('«%s» → «%s»', (raw, expected) => {
      expect(
        buildDianEmailSubject({ ...TEXMALL, issuer_nit: raw }).split(
          DIAN_EMAIL_SUBJECT_SEPARATOR,
        )[0],
      ).toBe(expected);
    });

    it('un DV pegado al asunto lo haría discrepar del XML', () => {
      expect(buildDianEmailSubject({ ...TEXMALL, issuer_nit: '901280137-1' })).not.toContain(
        '-1',
      );
    });
  });

  describe('saneamiento de campos', () => {
    it('el «;» dentro de un nombre se neutraliza y NO fabrica un campo fantasma', () => {
      const subject = buildDianEmailSubject({
        ...TEXMALL,
        issuer_legal_name: 'TEXMALL; SAS',
      });
      expect(subject.split(DIAN_EMAIL_SUBJECT_SEPARATOR)).toHaveLength(5);
      expect(subject).toBe('901280137;TEXMALL SAS;FVET2254;01;TEXMALL SAS');
    });

    it('CR y LF se eliminan — un Subject con salto de línea es inyección de cabecera', () => {
      const subject = buildDianEmailSubject({
        ...TEXMALL,
        issuer_legal_name: 'TEXMALL SAS\r\nBcc: atacante@example.com',
      });
      expect(subject).not.toMatch(/[\r\n]/);
      expect(subject).toBe(
        '901280137;TEXMALL SAS Bcc: atacante@example.com;FVET2254;01;TEXMALL SAS Bcc: atacante@example.com',
      );
    });

    it('colapsa espacios repetidos y recorta los extremos', () => {
      expect(sanitizeDianSubjectField('  TEXMALL   SAS  ')).toBe('TEXMALL SAS');
      expect(sanitizeDianSubjectField(null)).toBe('');
      expect(sanitizeDianSubjectField(undefined)).toBe('');
    });

    it('conserva tildes y ñ — la razón social del RUT las lleva', () => {
      expect(
        buildDianEmailSubject({
          ...TEXMALL,
          issuer_legal_name: 'COMPAÑÍA DE ALIMENTACIÓN S.A.S.',
        }),
      ).toContain('COMPAÑÍA DE ALIMENTACIÓN S.A.S.');
    });

    it('no recorta la longitud: el anexo no fija tope para el asunto', () => {
      const long = 'A'.repeat(400);
      expect(
        buildDianEmailSubject({ ...TEXMALL, issuer_legal_name: long }),
      ).toContain(long);
    });
  });

  describe('campos obligatorios: falla en voz alta, nunca con un asunto a medias', () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>, string, number]> =
      [
        [
          'sin NIT del emisor',
          { issuer_nit: '' },
          'INVOICING_TENANT_FISCAL_DATA_INCOMPLETE',
          422,
        ],
        [
          'con un NIT sin dígitos',
          { issuer_nit: 'N/A' },
          'INVOICING_TENANT_FISCAL_DATA_INCOMPLETE',
          422,
        ],
        [
          'sin razón social del emisor',
          { issuer_legal_name: '   ' },
          'INVOICING_TENANT_FISCAL_DATA_INCOMPLETE',
          422,
        ],
        [
          'sin número de documento',
          { document_number: null },
          'INVOICING_VALIDATE_001',
          400,
        ],
        [
          'sin código de tipo de documento',
          { document_type_code: undefined },
          'INVOICING_VALIDATE_001',
          400,
        ],
      ];

    it.each(cases)('%s → %s (%i)', (_label, override, code, status) => {
      let thrown: unknown;
      try {
        buildDianEmailSubject({ ...TEXMALL, ...(override as any) });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(VendixHttpException);
      expect((thrown as VendixHttpException).errorCode).toBe(code);
      expect((thrown as VendixHttpException).getStatus()).toBe(status);
    });
  });
});

describe('resolveDianDocumentTypeCode — tabla 0 del anexo', () => {
  it.each([
    ['sales_invoice', '01'],
    ['export_invoice', '02'],
    ['credit_note', '91'],
    ['debit_note', '92'],
    ['support_document', '05'],
    ['support_adjustment_note', '95'],
    ['pos_equivalent_document', '20'],
  ] as const)('%s → %s', (type, code) => {
    expect(resolveDianDocumentTypeCode(type as any)).toBe(code);
  });

  it('la nota de ajuste al documento equivalente NO se puede resolver por tipo', () => {
    // '93' débito / '94' crédito (numeral 16.3): el tipo interno no distingue,
    // así que devolver un valor sería inventarlo.
    expect(resolveDianDocumentTypeCode('equivalent_adjustment_note' as any)).toBeUndefined();
  });

  it('una factura de compra no tiene código de emisión', () => {
    expect(resolveDianDocumentTypeCode('purchase_invoice' as any)).toBeUndefined();
  });

  it.each([null, undefined])('%p → undefined', (value) => {
    expect(resolveDianDocumentTypeCode(value as any)).toBeUndefined();
  });
});
