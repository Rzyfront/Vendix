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

  it('una casilla 53 declarada SIN O-48 emite 49 aunque el régimen diga COMUN', () => {
    // CAMBIO 2026-09-22 — inversión de la jerarquía de evidencia. Este test
    // afirmaba '48' y describía por qué: ['O-13','O-47'] no trae ni O-48 ni
    // O-49, así que el resolvedor caía al respaldo por `tax_regime` ('COMUN').
    // Eso es un dato INFERIDO ganando sobre uno DECLARADO, y es exactamente lo
    // que hacía que un restaurante sólo responsable de INC se declarara ante la
    // DIAN bajo esquema IVA. Hoy la casilla 53, mientras traiga al menos un
    // código, es autoridad total: NO enumerar O-48 ES la declaración.
    //
    // EL FIXTURE SE CONSERVA CON LOS DATOS REALES DE LA PLATAFORMA A PROPÓSITO,
    // porque deja a la vista el riesgo que el cambio introduce: Quickss cobra
    // 19% de IVA y su `tax_responsibilities` almacenado no enumera O-48, de modo
    // que su propia facturación pasa a declarar 'ZZ / No aplica'. Se corrige en
    // el DATO — añadir O-48 a la casilla 53 de la organización — no aflojando
    // el resolvedor, que es el único sitio donde la regla puede quedar bien.
    const issuer = resolveIssuerFiscalIdentity(source());

    expect(issuer.tax_regime).toBe('49');
  });

  it('con la casilla 53 VACÍA el régimen COMUN sigue siendo el respaldo', () => {
    // El respaldo por régimen no se eliminó: se degradó a último recurso. Sin
    // ninguna responsabilidad declarada (ni en fiscal_data, ni en columnas, ni
    // en el `tax_scheme` singular), 'COMUN' vuelve a ser la única señal y manda.
    const issuer = resolveIssuerFiscalIdentity(
      source({
        fiscal_data: {
          ...QUICKSS_FISCAL_DATA,
          tax_responsibilities: [],
          tax_scheme: undefined,
        },
        organization: null,
      }),
    );

    expect(issuer.tax_regime).toBe('48');
    expect(issuer.party_tax_scheme).toEqual({ id: '01', name: 'IVA' });
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

/**
 * `cac:PartyTaxScheme/cac:TaxScheme` del EMISOR — tabla 13.2.6.2 del anexo
 * técnico: `01` IVA, `04` INC, `ZA` IVA e INC, `ZZ` No aplica.
 *
 * Se prueba aquí, en el adaptador, y no sólo en el constructor de XML, porque
 * esta es la ruta que usa la emisión real: el par viaja YA resuelto desde
 * `projectTenantIdentityToDian`. Si el constructor lo recalculara distinto, el
 * documento firmado diría una cosa y este test otra.
 */
describe('resolveIssuerFiscalIdentity — esquema tributario del emisor', () => {
  function issuerFor(tax_responsibilities: string[], tax_regime = 'COMUN') {
    return resolveIssuerFiscalIdentity(
      source({
        fiscal_data: {
          ...QUICKSS_FISCAL_DATA,
          tax_regime,
          tax_scheme: undefined,
          tax_responsibilities,
        },
        organization: null,
      }),
    );
  }

  it('POLLO ÁRABE (store 105) — sólo INC: declara 04 / INC, nunca 01 / IVA', () => {
    // Casilla 53 real del restaurante, en la forma numérica en que la trae el
    // RUT. Siete responsabilidades, ninguna es 48 (responsable de IVA) y una es
    // 33 (Impuesto Nacional al Consumo). Su `tax_regime` heredado dice 'COMUN',
    // que es justo la señal rancia que antes lo volvía responsable de IVA.
    const issuer = issuerFor(['05', '07', '14', '33', '42', '52', '55']);

    expect(issuer.party_tax_scheme).toEqual({ id: '04', name: 'INC' });
    expect(issuer.party_tax_scheme).not.toEqual({ id: '01', name: 'IVA' });
    expect(issuer.tax_regime).toBe('49');
  });

  it('normaliza la casilla 53 — 33 y O-33 son el mismo código', () => {
    // El RUT se captura a veces con prefijo y a veces sin él. Si las dos formas
    // no convergieran, el mismo contribuyente emitiría dos esquemas distintos
    // según cómo se hubiera tecleado su ficha.
    expect(issuerFor(['O-05', 'O-33', 'O-42']).party_tax_scheme).toEqual(
      issuerFor(['05', '33', '42']).party_tax_scheme,
    );
  });

  it('FRANQUICIA — responsable de IVA y no de INC: declara 01 / IVA', () => {
    // El restaurante con contrato de franquicia SÍ es responsable de IVA (Art.
    // 426 ET excluye el expendio de comidas, salvo franquicia). Su casilla 53
    // enumera O-48 y no O-33.
    const issuer = issuerFor(['O-13', 'O-48']);

    expect(issuer.party_tax_scheme).toEqual({ id: '01', name: 'IVA' });
    expect(issuer.tax_regime).toBe('48');
  });

  it('MIXTO — responsable de IVA y de INC: declara ZA / IVA e INC', () => {
    // El caso que el booleano anterior no podía expresar: un comercio con
    // ambos tributos. 'ZA' sólo existe en la tabla 13.2.6.2 (partes), no en la
    // 13.2.2 (tributos de línea).
    const issuer = issuerFor(['O-33', 'O-48']);

    expect(issuer.party_tax_scheme).toEqual({ id: 'ZA', name: 'IVA e INC' });
    expect(issuer.tax_regime).toBe('48');
  });

  it('NINGUNO — O-49 declarado sin INC: declara ZZ / No aplica', () => {
    const issuer = issuerFor(['O-49'], 'SIMPLIFICADO');

    expect(issuer.party_tax_scheme).toEqual({ id: 'ZZ', name: 'No aplica' });
    expect(issuer.tax_regime).toBe('49');
  });

  it('O-50 (no responsable de consumo) no asciende a responsable de INC', () => {
    // O-50 es la NEGACIÓN del eje INC. Leerlo como presencia del eje — porque
    // contiene la palabra consumo — declararía un tributo que el RUT niega.
    const issuer = issuerFor(['O-50']);

    expect(issuer.party_tax_scheme).toEqual({ id: 'ZZ', name: 'No aplica' });
  });
});
