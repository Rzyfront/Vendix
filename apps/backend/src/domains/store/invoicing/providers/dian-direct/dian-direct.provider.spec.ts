import { DianDirectProvider } from './dian-direct.provider';
import { UblInvoiceBuilder } from './xml/ubl-invoice.builder';
import { DianInvoiceControl } from './interfaces/dian-config.interface';

/**
 * Cobertura de los pasos 2, 3 y 4 del plan de conexión DIAN.
 *
 * Los tres defectos que se afirman aquí compartían una propiedad: producían un XML
 * sintácticamente válido y semánticamente falso, así que ninguna verificación sobre
 * el código los detectaba. Solo se ven mirando el XML emitido y la consulta que lo
 * alimenta.
 */

const CONTROL: DianInvoiceControl = {
  invoice_authorization: '18760000001',
  authorization_start_date: '2019-01-19',
  authorization_end_date: '2030-01-19',
  prefix: 'SETP',
  range_from: '990000000',
  range_to: '995000000',
};

// ─────────────────────────────────────────────────────────────────────────────
// PASO 2 — el bloque de control llega al XML, y con él el punto de facturación
// ─────────────────────────────────────────────────────────────────────────────

function buildXml(control?: DianInvoiceControl): string {
  return UblInvoiceBuilder.build({
    invoice_data: {
      invoice_number: 'SETP990000161',
      invoice_type: 'sales_invoice',
      issue_date: '2026-08-08',
      issue_time: '14:00:00-05:00',
      subtotal_amount: '1000.00',
      discount_amount: '0.00',
      tax_amount: '190.00',
      withholding_amount: '0.00',
      total_amount: '1190.00',
      items: [
        {
          description: 'Plan Vendix',
          quantity: '1',
          unit_price: '1000.00',
          discount_amount: '0.00',
          tax_amount: '190.00',
          total_amount: '1190.00',
        },
      ],
      taxes: [
        {
          tax_name: 'IVA',
          tax_rate: '19.00',
          taxable_amount: '1000.00',
          tax_amount: '190.00',
        },
      ],
      control,
    } as any,
    issuer: {
      nit: '902056589',
      nit_dv: '9',
      legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
      address_line: 'CALLE 14H 26 13',
      // DianIssuerData nombra el municipio `city_code`, no `municipality_code`:
      // el código DIVIPOLA de 5 dígitos va en cbc:ID de la ciudad.
      city_code: '44001',
      city_name: 'Riohacha',
      department_code: '44',
      department_name: 'La Guajira',
      country_code: 'CO',
      email: 'admin@vendix.com',
      tax_regime: '48',
      tax_scheme: 'O-05',
      document_type: '31',
    } as any,
    customer: {
      nit: '800987654',
      legal_name: 'Cliente de prueba',
      document_type: '31',
    } as any,
    software_security: {
      software_id: 'f1e2d3c4',
      security_code: 'abc123',
      pin: '9547',
    } as any,
    cufe: 'a'.repeat(96),
    environment: 'test',
    control,
  });
}

describe('UblInvoiceBuilder — bloque sts:InvoiceControl (paso 2)', () => {
  it('emite la autorización, el período y el rango con valores reales', () => {
    const xml = buildXml(CONTROL);

    expect(xml).toContain('<sts:InvoiceAuthorization>18760000001</sts:InvoiceAuthorization>');
    expect(xml).toContain('<cbc:StartDate>2019-01-19</cbc:StartDate>');
    expect(xml).toContain('<cbc:EndDate>2030-01-19</cbc:EndDate>');
    expect(xml).toContain('<sts:Prefix>SETP</sts:Prefix>');
    expect(xml).toContain('<sts:From>990000000</sts:From>');
    expect(xml).toContain('<sts:To>995000000</sts:To>');
  });

  it('emite cac:CorporateRegistrationScheme con el prefijo — el lado derecho de FAB10a', () => {
    const xml = buildXml(CONTROL);

    // FAB10a compara sts:AuthorizedInvoices/sts:Prefix contra este cbc:ID. Sin el
    // grupo no hay lado derecho, la DIAN no resuelve el punto de facturación, y en
    // cascada rechaza por FAD05e, FAB24a y FAB27b.
    expect(xml).toContain('<cac:CorporateRegistrationScheme>');
    const scheme = xml.slice(
      xml.indexOf('<cac:CorporateRegistrationScheme>'),
      xml.indexOf('</cac:CorporateRegistrationScheme>'),
    );
    expect(scheme).toContain('<cbc:ID>SETP</cbc:ID>');
  });

  // TESTIGO DE REGRESIÓN. Es el estado en el que estaba la emisión real: el bloque
  // presente y vacío, y el grupo del punto de facturación ausente. Si alguien
  // vuelve a dejar de pasar `control`, este test documenta qué se emite entonces —
  // y los dos de arriba fallan.
  it('sin control emite el bloque VACÍO y omite el punto de facturación', () => {
    const xml = buildXml(undefined);

    // Auto-cerrados, que es la forma exacta que la DIAN recibió: el bloque existe,
    // así que el XML valida contra el esquema, y no dice nada.
    expect(xml).toContain('<sts:InvoiceAuthorization/>');
    expect(xml).toContain('<sts:From/>');
    expect(xml).toContain('<sts:To/>');
    expect(xml).not.toContain('<sts:Prefix>');
    expect(xml).not.toContain('<cac:CorporateRegistrationScheme>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASOS 3 y 4 — la dirección fiscal y la identidad del NIT emisor
// ─────────────────────────────────────────────────────────────────────────────

/** Entidad contable con alcance de ORGANIZACIÓN y su dirección de facturación. */
function makeEntity(overrides: { fiscal_data?: Record<string, any> } = {}) {
  return {
    id: 95,
    fiscal_scope: 'ORGANIZATION',
    legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
    name: 'Quickss',
    store: null,
    organization: {
      id: 1,
      legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
      name: 'Quickss',
      email: 'admin@vendix.com',
      phone: '3234668500',
      document_type: '31',
      person_type: '1',
      // Prisma ya devuelve SOLO la fila billing gracias al `where` del include.
      addresses: [
        {
          address_line1: 'CALLE 14H 26 13',
          city: 'Riohacha',
          state_province: 'La Guajira',
          municipality_code: '44001',
          postal_code: null,
          phone_number: '3234668500',
        },
      ],
      organization_settings: {
        settings: {
          fiscal_data: {
            nit: '902056589',
            nit_dv: '9',
            legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
            municipality_code: '44001',
            department: 'La Guajira',
            city: 'Riohacha',
            tax_responsibilities: ['O-05', 'O-07', 'O-14', 'O-42', 'O-48'],
            ...(overrides.fiscal_data ?? {}),
          },
        },
      },
    },
  };
}

function makeProvider(entity: any) {
  const findFirst = jest.fn().mockResolvedValue(entity);
  const prisma = {
    withoutScope: () => ({ accounting_entities: { findFirst } }),
  };
  const provider = new DianDirectProvider(
    prisma as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  return { provider, findFirst };
}

const CONFIG = {
  id: 15,
  organization_id: 1,
  accounting_entity_id: 95,
  nit: '902056589',
  nit_dv: '9',
  environment: 'test' as const,
};

describe('DianDirectProvider.loadIssuerData', () => {
  it('paso 3 — pide la dirección con type=billing, no la primaria', async () => {
    const { provider, findFirst } = makeProvider(makeEntity());

    await (provider as any).loadIssuerData(CONFIG);

    const include = findFirst.mock.calls[0][0].include;
    // Se afirma la CONSULTA y no el resultado: con un mock el filtro no lo aplica
    // ninguna base, así que lo único que prueba el arreglo es que se pida.
    expect(include.organization.include.addresses.where).toEqual({
      type: 'billing',
    });
    expect(include.store.include.addresses.where).toEqual({ type: 'billing' });
  });

  it('paso 3 — el orderBy por is_primary sigue presente como desempate secundario', async () => {
    const { provider, findFirst } = makeProvider(makeEntity());

    await (provider as any).loadIssuerData(CONFIG);

    // La tienda 97 tiene DOS filas is_primary=true; el filtro por type decide, y
    // el orderBy solo desempata entre varias billing.
    const addresses =
      findFirst.mock.calls[0][0].include.organization.include.addresses;
    expect(addresses.orderBy).toEqual([{ is_primary: 'desc' }, { id: 'asc' }]);
    expect(addresses.take).toBe(1);
  });

  it('paso 4 — con NITs coincidentes resuelve la identidad', async () => {
    const { provider } = makeProvider(makeEntity());

    const issuer = await (provider as any).loadIssuerData(CONFIG);

    expect(issuer.nit).toBe('902056589');
    expect(issuer.city_code).toBe('44001');
  });

  it('paso 4 — lanza cuando el NIT del CUFE y el del XML difieren, nombrando los dos', async () => {
    // `fiscal_data.nit` gana sobre `config.nit` en el resolvedor: es exactamente
    // cómo se produce la divergencia entre el eje del CUFE y el del XML.
    const { provider } = makeProvider(
      makeEntity({ fiscal_data: { nit: '900123456', nit_dv: '7' } }),
    );

    await expect((provider as any).loadIssuerData(CONFIG)).rejects.toThrow(
      /no coinciden/,
    );
    await expect((provider as any).loadIssuerData(CONFIG)).rejects.toThrow(
      /902056589[\s\S]*900123456/,
    );
  });

  it('paso 4 — tolera el DV embebido: 902056589-9 contra base 902056589 + dv 9', async () => {
    const { provider } = makeProvider(makeEntity());

    // La fila 14 de `dian_configurations` en producción guarda el NIT con guion y
    // `nit_dv` vacío. Es el MISMO NIT, y una igualdad estricta lo rechazaría.
    await expect(
      (provider as any).loadIssuerData({ ...CONFIG, nit: '902056589-9' }),
    ).resolves.toMatchObject({ nit: '902056589' });
  });
});
