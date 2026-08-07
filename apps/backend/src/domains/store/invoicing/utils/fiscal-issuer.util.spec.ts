import {
  FiscalIssuerSource,
  resolveIssuerFiscalIdentity,
} from './fiscal-issuer.util';

/** `fiscal_data` real de la plataforma, tal como está en producción. */
const QUICKSS_FISCAL_DATA = {
  nit: '902056589',
  nit_dv: '9',
  nit_type: 'NIT',
  person_type: 'JURIDICA',
  legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
  fiscal_address: 'CALLE 14H 26 13',
  city: 'Riohacha',
  department: 'La Guajira',
  municipality_code: '44847',
  country: 'CO',
  ciiu: '6209',
  tax_regime: 'COMUN',
  tax_scheme: 'O-13',
  tax_responsibilities: ['O-13', 'O-47'],
};

function source(overrides: Partial<FiscalIssuerSource> = {}): FiscalIssuerSource {
  return {
    nit: '902056589',
    config_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    fiscal_data: QUICKSS_FISCAL_DATA,
    email: 'facturacion@quickss.co',
    ...overrides,
  };
}

describe('resolveIssuerFiscalIdentity', () => {
  it('resuelve la identidad real de la plataforma desde fiscal_data', () => {
    const issuer = resolveIssuerFiscalIdentity(source());

    expect(issuer.nit).toBe('902056589');
    expect(issuer.nit_dv).toBe('9');
    expect(issuer.legal_name).toBe(
      'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    );
    expect(issuer.address_line).toBe('CALLE 14H 26 13');
    expect(issuer.city_code).toBe('44847');
    expect(issuer.city_name).toBe('Riohacha');
    expect(issuer.department_code).toBe('44');
    expect(issuer.department_name).toBe('La Guajira');
    expect(issuer.document_type).toBe('31');
    expect(issuer.person_type).toBe('1');
  });

  it('deriva el DV y NO lee el almacenado: 900123456 es DV 8, no 7', () => {
    // El valor que producción tenía en organizations.tax_id. Leerlo habría
    // propagado un par NIT+DV que no existe.
    const issuer = resolveIssuerFiscalIdentity(
      source({ fiscal_data: { ...QUICKSS_FISCAL_DATA, nit: '900123456-7' } }),
    );

    expect(issuer.nit).toBe('900123456');
    expect(issuer.nit_dv).toBe('8');
  });

  it('emite tax_regime 48 cuando el régimen es COMUN sin O-48 ni O-49 explícitos', () => {
    // El caso real: ['O-13','O-47'] no trae ninguna de las dos señales, así que
    // isVatResponsible cae a tax_regime COMUN, que es responsable de IVA. El set
    // de pruebas hardcodeaba '49' mientras cobraba 19% de IVA.
    const issuer = resolveIssuerFiscalIdentity(source());

    expect(issuer.tax_regime).toBe('48');
  });

  it('el tax_regime derivado gana a una columna almacenada incoherente', () => {
    const issuer = resolveIssuerFiscalIdentity(
      source({
        // La columna dice lo contrario de lo que dicen las responsabilidades.
        organization: { fiscal_responsibilities: ['O-49'] },
        fiscal_data: {
          ...QUICKSS_FISCAL_DATA,
          tax_responsibilities: ['O-48'],
        },
      }),
    );

    expect(issuer.tax_regime).toBe('48');
    expect(issuer.tax_scheme).toBe('O-48');
  });

  it('emite 49 solo cuando O-49 está declarado sin O-48', () => {
    const issuer = resolveIssuerFiscalIdentity(
      source({
        fiscal_data: {
          ...QUICKSS_FISCAL_DATA,
          tax_regime: 'SIMPLIFICADO',
          tax_responsibilities: ['O-49'],
        },
      }),
    );

    expect(issuer.tax_regime).toBe('49');
  });

  it('une varias responsabilidades con punto y coma para TaxLevelCode', () => {
    const issuer = resolveIssuerFiscalIdentity(source());

    expect(issuer.tax_scheme).toBe('O-13;O-47');
  });

  it('sin responsabilidades cae a R-99-PN y nunca a O-15', () => {
    // 'O-15' es autorretenedor: afirmarlo por defecto es declararle a la DIAN una
    // responsabilidad que el emisor puede no tener. 'R-99-PN' es «no aplica».
    const issuer = resolveIssuerFiscalIdentity(
      source({
        fiscal_data: {
          nit: '902056589',
          legal_name: 'QUICKSS S.A.S.',
          municipality_code: '44847',
          department: 'La Guajira',
        },
        organization: null,
      }),
    );

    expect(issuer.tax_scheme).toBe('R-99-PN');
    expect(issuer.tax_scheme).not.toBe('O-15');
  });

  it('fiscal_data gana a config_name y a las columnas para la razón social', () => {
    const issuer = resolveIssuerFiscalIdentity(
      source({
        config_name: 'Nombre de la configuración',
        entity: { legal_name: 'Vendix Corporation S.A.S.', name: 'Consolidado' },
        organization: { legal_name: 'Vendix Corporation S.A.S.', name: 'Vendix Corp' },
      }),
    );

    expect(issuer.legal_name).toBe(
      'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    );
  });

  it('usa la fila de addresses cuando fiscal_data no trae la dirección', () => {
    const issuer = resolveIssuerFiscalIdentity(
      source({
        fiscal_data: {
          nit: '902056589',
          legal_name: 'QUICKSS S.A.S.',
          tax_responsibilities: ['O-13'],
        },
        address: {
          address_line1: 'CALLE 14H 26 13',
          city: 'Riohacha',
          state_province: 'La Guajira',
          municipality_code: '44847',
          postal_code: '440001',
        },
      }),
    );

    expect(issuer.address_line).toBe('CALLE 14H 26 13');
    expect(issuer.city_code).toBe('44847');
    expect(issuer.department_code).toBe('44');
    expect(issuer.postal_code).toBe('440001');
  });

  it('lanza cuando no hay municipio DIAN en ninguna de las dos fuentes', () => {
    // Producción tenía cero filas en addresses para la organización 1, así que la
    // ruta real ya lanzaba. Fallar aquí cuesta nada; emitir con un municipio
    // inventado cuesta un consecutivo autorizado irrecuperable.
    expect(() =>
      resolveIssuerFiscalIdentity(
        source({
          fiscal_data: { nit: '902056589', legal_name: 'QUICKSS S.A.S.' },
          address: null,
        }),
      ),
    ).toThrow(/municipio DIAN/);
  });

  it('cae al NIT de la configuración DIAN cuando fiscal_data no lo trae', () => {
    const issuer = resolveIssuerFiscalIdentity(
      source({
        nit: '902075738',
        fiscal_data: {
          legal_name: 'HIDRO INSTALACIONES J.L. S.A.S',
          municipality_code: '11001',
          department: 'Bogotá D.C.',
        },
      }),
    );

    expect(issuer.nit).toBe('902075738');
    expect(issuer.nit_dv).toBe('0');
  });
});
