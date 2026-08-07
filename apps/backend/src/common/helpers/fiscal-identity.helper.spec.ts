import {
  FiscalIdentitySource,
  resolveTenantFiscalIdentity,
} from './fiscal-identity.helper';

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

function source(overrides: Partial<FiscalIdentitySource> = {}): FiscalIdentitySource {
  return {
    nit: '902056589',
    config_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    fiscal_data: QUICKSS_FISCAL_DATA,
    email: 'facturacion@quickss.co',
    ...overrides,
  };
}

describe('resolveTenantFiscalIdentity', () => {
  it('resuelve la identidad real de la plataforma desde fiscal_data', () => {
    const identity = resolveTenantFiscalIdentity(source());

    expect(identity.nit).toBe('902056589');
    expect(identity.nit_dv).toBe('9');
    expect(identity.legal_name).toBe(
      'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    );
    expect(identity.fiscal_address).toBe('CALLE 14H 26 13');
    expect(identity.municipality_code).toBe('44847');
    expect(identity.city).toBe('Riohacha');
    expect(identity.department).toBe('La Guajira');
    expect(identity.nit_type).toBe('NIT');
    expect(identity.person_type).toBe('JURIDICA');
    expect(identity.tax_regime).toBe('COMUN');
    expect(identity.tax_responsibilities).toEqual(['O-13', 'O-47']);
    expect(identity.ciiu_code).toBe('6209');
  });

  it('deriva el DV y NO lee el almacenado: 900123456 es DV 8, no 7', () => {
    // El valor que producción tenía en organizations.tax_id. Leerlo habría
    // propagado un par NIT+DV que no existe.
    const identity = resolveTenantFiscalIdentity(
      source({ fiscal_data: { ...QUICKSS_FISCAL_DATA, nit: '900123456-7' } }),
    );

    expect(identity.nit).toBe('900123456');
    expect(identity.nit_dv).toBe('8');
  });

  it('mantiene responsabilidades crudas (O-13, O-47) — la traducción DIAN vive en el adaptador', () => {
    // El contrato ancho NO traduce: los consumidores DIAN lo traducen, los no-DIAN
    // (colillas, export bancario, suscripciones) lo consumen crudo.
    const identity = resolveTenantFiscalIdentity(source());

    expect(identity.tax_responsibilities).toEqual(['O-13', 'O-47']);
  });

  it('el régimen derivado gana a una columna almacenada incoherente', () => {
    // La columna dice lo contrario de lo que dicen las responsabilidades.
    const identity = resolveTenantFiscalIdentity(
      source({
        organization: { fiscal_responsibilities: ['O-49'] },
        fiscal_data: {
          ...QUICKSS_FISCAL_DATA,
          tax_responsibilities: ['O-48'],
        },
      }),
    );

    // El contrato ancho devuelve el campo crudo del JSON: 'COMUN' (no 48/49).
    // La traducción DIAN '48'/'49' vive en el adaptador. Lo que afirma este test
    // es que el JSON gana a la columna cuando discrepan.
    expect(identity.tax_responsibilities).toEqual(['O-48']);
  });

  it('fiscal_data gana a config_name y a las columnas para la razón social', () => {
    const identity = resolveTenantFiscalIdentity(
      source({
        config_name: 'Nombre de la configuración',
        organization: { legal_name: 'Vendix Corporation S.A.S.', name: 'Vendix Corp' },
      }),
    );

    expect(identity.legal_name).toBe(
      'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    );
  });

  it('usa la fila de addresses cuando fiscal_data no trae la dirección', () => {
    const identity = resolveTenantFiscalIdentity(
      source({
        fiscal_data: {
          nit: '902056589',
          legal_name: 'QUICKSS S.A.S.',
          municipality_code: '44847',
          department: 'La Guajira',
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

    expect(identity.fiscal_address).toBe('CALLE 14H 26 13');
    expect(identity.municipality_code).toBe('44847');
    expect(identity.postal_code).toBe('440001');
  });

  it('lanza cuando no hay municipio DIAN en ninguna de las dos fuentes', () => {
    // Producción tenía cero filas en addresses para la organización 1, así que la
    // ruta real ya lanzaba. Fallar aquí cuesta nada; emitir con un municipio
    // inventado cuesta un consecutivo autorizado irrecuperable.
    expect(() =>
      resolveTenantFiscalIdentity(
        source({
          fiscal_data: { nit: '902056589', legal_name: 'QUICKSS S.A.S.' },
          address: null,
        }),
      ),
    ).toThrow(/municipio DIAN/);
  });

  it('lanza cuando no hay razón social en ninguna de las fuentes (PR #524 hueco #1)', () => {
    // Antes devolvía '' silenciosamente, lo que producía `<cbc:RegistrationName/>`
    // vacío en el XML. La DIAN rechaza igual, pero ahora fallamos antes de emitir
    // y el error apunta a la causa real.
    expect(() =>
      resolveTenantFiscalIdentity(
        source({
          fiscal_data: { nit: '902056589', municipality_code: '44847' },
          config_name: null,
          organization: null,
        }),
      ),
    ).toThrow(/razón social/);
  });

  it('lanza cuando no hay departamento y NO deriva de municipality_code.slice(0,2) (PR #524 hueco #2)', () => {
    // Antes caía a `municipality_code.slice(0,2)` que devolvía '44' (código
    // numérico) en `cbc:CountrySubentity`, campo de nombre. Lanzar es más barato
    // que emitir un departamento falso que la DIAN rechaza.
    expect(() =>
      resolveTenantFiscalIdentity(
        source({
          fiscal_data: {
            ...QUICKSS_FISCAL_DATA,
            department: undefined,
          },
          address: null,
        }),
      ),
    ).toThrow(/departamento/);
  });

  it('cae al NIT de la configuración DIAN cuando fiscal_data no lo trae', () => {
    const identity = resolveTenantFiscalIdentity(
      source({
        nit: '902075738',
        fiscal_data: {
          legal_name: 'HIDRO INSTALACIONES J.L. S.A.S',
          municipality_code: '11001',
          department: 'Bogotá D.C.',
        },
      }),
    );

    expect(identity.nit).toBe('902075738');
    expect(identity.nit_dv).toBe('0');
  });

  it('responsabilidades desde columnas se preservan cuando fiscal_data no las trae', () => {
    // Tenants que aún no han vuelto a guardar tras migrar el formato: la columna
    // `fiscal_responsibilities` es la única fuente hasta que lo hagan.
    const identity = resolveTenantFiscalIdentity(
      source({
        fiscal_data: {
          nit: '902056589',
          legal_name: 'QUICKSS S.A.S.',
          municipality_code: '44847',
          department: 'La Guajira',
        },
        organization: { fiscal_responsibilities: ['O-13'] },
      }),
    );

    expect(identity.tax_responsibilities).toEqual(['O-13']);
  });

  it('responsabilidad singular `tax_scheme` se trata como array de un elemento', () => {
    // Tenants que solo guardaron `tax_scheme` en vez del array — el helper los
    // acepta como entrada válida y los proyecta como responsabilidades únicas.
    const identity = resolveTenantFiscalIdentity(
      source({
        fiscal_data: {
          ...QUICKSS_FISCAL_DATA,
          tax_responsibilities: undefined,
          tax_scheme: 'O-15',
        },
      }),
    );

    expect(identity.tax_responsibilities).toEqual(['O-15']);
    expect(identity.tax_scheme).toBe('O-15');
  });
});
