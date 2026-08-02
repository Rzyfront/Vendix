import { buildOrganizationFiscalColumns } from './organization-fiscal-columns.helper';

describe('buildOrganizationFiscalColumns', () => {
  describe('semántica PATCH', () => {
    it('no devuelve columnas cuando el patch no trae ningún campo fiscal', () => {
      expect(buildOrganizationFiscalColumns({ branding: {} }, {})).toEqual({});
    });

    it('un patch con solo legal_name no toca el NIT', () => {
      const columns = buildOrganizationFiscalColumns(
        { legal_name: 'QUICKSS S.A.S.' },
        {},
      );
      expect(columns).toEqual({ legal_name: 'QUICKSS S.A.S.' });
      expect('tax_id' in columns).toBe(false);
      expect('verification_digit' in columns).toBe(false);
    });

    it('un campo presente pero vacío se guarda como null, no se ignora', () => {
      expect(buildOrganizationFiscalColumns({ legal_name: '   ' }, {})).toEqual({
        legal_name: null,
      });
    });
  });

  describe('traducción de vocabulario', () => {
    it('mapea nit_type a su código DIAN', () => {
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'NIT' }, {}).document_type,
      ).toBe('31');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'CC' }, {}).document_type,
      ).toBe('13');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'CE' }, {}).document_type,
      ).toBe('22');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'TI' }, {}).document_type,
      ).toBe('12');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'PP' }, {}).document_type,
      ).toBe('41');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'NIT_EXTRANJERIA' }, {})
          .document_type,
      ).toBe('50');
    });

    it('un nit_type desconocido se guarda como null en vez de propagarse crudo', () => {
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'INVENTADO' }, {})
          .document_type,
      ).toBeNull();
    });

    it('mapea person_type a cbc:AdditionalAccountID', () => {
      expect(
        buildOrganizationFiscalColumns({ person_type: 'JURIDICA' }, {})
          .person_type,
      ).toBe('1');
      expect(
        buildOrganizationFiscalColumns({ person_type: 'NATURAL' }, {})
          .person_type,
      ).toBe('2');
    });

    it('nunca escribe la etiqueta del formulario en la columna', () => {
      const columns = buildOrganizationFiscalColumns(
        { person_type: 'JURIDICA', nit_type: 'NIT' },
        {},
      );
      expect(columns.person_type).not.toBe('JURIDICA');
      expect(columns.document_type).not.toBe('NIT');
    });
  });

  describe('dígito de verificación', () => {
    it('lo deriva del NIT y no lo copia del patch', () => {
      // 902056589 → 9 (módulo 11). El patch miente a propósito con un 3.
      const columns = buildOrganizationFiscalColumns(
        { nit: '902056589', nit_dv: '3' },
        {},
      );
      expect(columns.tax_id).toBe('902056589');
      expect(columns.verification_digit).toBe('9');
    });

    it('acepta el alias tax_id además de nit', () => {
      expect(
        buildOrganizationFiscalColumns({ tax_id: '900123456' }, {}).tax_id,
      ).toBe('900123456');
    });

    it('separa el DV cuando el NIT llega con el guion pegado', () => {
      // Regresión: `computeNitDv('902056589-9')` incluye el propio DV como
      // dígito del módulo 11 y devuelve '1'. Debe derivarse desde la cabecera.
      const columns = buildOrganizationFiscalColumns(
        { nit: '902056589-9' },
        {},
      );
      expect(columns.tax_id).toBe('902056589');
      expect(columns.verification_digit).toBe('9');
    });

    it('limpia puntos y guiones del NIT antes de guardarlo', () => {
      const columns = buildOrganizationFiscalColumns(
        { nit: '902.056.589-9' },
        {},
      );
      expect(columns.tax_id).toBe('902056589');
      expect(columns.verification_digit).toBe('9');
    });

    it('conserva letras en documentos extranjeros en vez de saneárselas', () => {
      const columns = buildOrganizationFiscalColumns(
        { nit_type: 'NIT_EXTRANJERIA', nit: 'ES-B12345678' },
        {},
      );
      expect(columns.tax_id).toBe('ES-B12345678');
      expect(columns.verification_digit).toBeNull();
    });

    it('no inventa DV para documentos que no son NIT', () => {
      const columns = buildOrganizationFiscalColumns(
        { nit_type: 'CC', nit: '1085123456' },
        {},
      );
      expect(columns.verification_digit).toBeNull();
    });

    it('asume NIT cuando el patch trae documento sin declarar el tipo', () => {
      const columns = buildOrganizationFiscalColumns({ nit: '902056589' }, {});
      expect(columns.verification_digit).toBe('9');
    });

    it('limpia el DV cuando se borra el NIT', () => {
      const columns = buildOrganizationFiscalColumns({ nit: '' }, {});
      expect(columns.tax_id).toBeNull();
      expect(columns.verification_digit).toBeNull();
    });
  });

  describe('responsabilidades y régimen', () => {
    it('copia las responsabilidades tal cual (mismo vocabulario O-)', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-48', 'O-13'] },
        { tax_responsibilities: ['O-48', 'O-13'] },
      );
      expect(columns.fiscal_responsibilities).toEqual(['O-48', 'O-13']);
    });

    it('descarta entradas no-string sin romper', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-48', 42, null] },
        { tax_responsibilities: ['O-48'] },
      );
      expect(columns.fiscal_responsibilities).toEqual(['O-48']);
    });

    it('deriva tax_regime 48 para responsable de IVA', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-48'] },
        { tax_responsibilities: ['O-48'] },
      );
      expect(columns.tax_regime).toBe('48');
    });

    it('deriva tax_regime 49 para no responsable de IVA', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-49'] },
        { tax_responsibilities: ['O-49'] },
      );
      expect(columns.tax_regime).toBe('49');
    });

    it('usa el fiscal_data mergeado, no solo el patch, para resolver el régimen', () => {
      // El patch solo cambia el régimen; las responsabilidades vienen de antes.
      const columns = buildOrganizationFiscalColumns(
        { tax_regime: 'SIMPLIFICADO' },
        { tax_responsibilities: ['O-48'], tax_regime: 'SIMPLIFICADO' },
      );
      expect(columns.tax_regime).toBe('48');
    });

    it('no toca tax_regime cuando el patch no habla de impuestos', () => {
      const columns = buildOrganizationFiscalColumns(
        { legal_name: 'QUICKSS S.A.S.' },
        { tax_responsibilities: ['O-48'] },
      );
      expect('tax_regime' in columns).toBe(false);
    });
  });

  it('traduce un RUT completo de una sola pasada', () => {
    const merged = {
      tax_responsibilities: ['O-48'],
      tax_regime: 'COMUN',
    };
    const columns = buildOrganizationFiscalColumns(
      {
        legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
        nit: '902056589',
        nit_type: 'NIT',
        person_type: 'JURIDICA',
        tax_responsibilities: ['O-48'],
        ciiu_code: '6201',
      },
      merged,
    );

    expect(columns).toEqual({
      legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
      tax_id: '902056589',
      verification_digit: '9',
      document_type: '31',
      person_type: '1',
      tax_regime: '48',
      fiscal_responsibilities: ['O-48'],
      ciiu_code: '6201',
    });
  });
});
