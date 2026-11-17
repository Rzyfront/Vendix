import { DianDirectProvider } from './dian-direct.provider';
import {
  DianResponseParserService,
  describeDianVerdict,
} from './dian-response-parser.service';
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

    expect(xml).toContain(
      '<sts:InvoiceAuthorization>18760000001</sts:InvoiceAuthorization>',
    );
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

describe('DianDirectProvider — mensaje y checkStatus con reglas estructuradas', () => {
  const b64 = (t: string) => Buffer.from(t).toString('base64');
  const raw = (strings: string[], is_valid: boolean, code: string, app = '') =>
    `<s:Envelope xmlns:s="s" xmlns:b="b" xmlns:c="c"><s:Body><b:IsValid>${is_valid}</b:IsValid><b:StatusCode>${code}</b:StatusCode><b:StatusDescription>Procesado</b:StatusDescription>${
      strings.length
        ? `<b:ErrorMessage>${strings.map((t) => `<c:string>${t}</c:string>`).join('')}</b:ErrorMessage>`
        : ''
    }<b:XmlBase64Bytes>${app ? b64(app) : ''}</b:XmlBase64Bytes></s:Body></s:Envelope>`;

  const makeStatusProvider = (dian_response: any) => {
    const soap = { getStatus: jest.fn().mockResolvedValue(dian_response) };
    const provider = new DianDirectProvider(
      null as any,
      null as any,
      null as any,
      soap as any,
      null as any,
      new DianResponseParserService(),
      null as any,
      null as any,
    );
    (provider as any).loadConfig = jest
      .fn()
      .mockResolvedValue({ id: 1, environment: 'test' });
    (provider as any).loadWsCredentials = jest
      .fn()
      .mockResolvedValue(undefined);
    return provider;
  };

  it('el mensaje de rechazo lista las reglas sin ", 0," ni vacíos', () => {
    const parsed = new DianResponseParserService().parseApplicationResponse(
      raw(
        [
          'Regla: 90, Rechazo: Documento procesado anteriormente',
          'Regla: CTG01, Rechazo: Contingencia invalida',
        ],
        false,
        '99',
      ),
    );
    const msg = describeDianVerdict(parsed, 'ok', 'Documento rechazado');
    expect(msg).toBe(
      'Documento rechazado: Regla 90: Documento procesado anteriormente; Regla CTG01: Contingencia invalida',
    );
    expect(msg).not.toMatch(/, 0,|undefined/);
  });

  it('el mensaje de éxito agrega las notificaciones', () => {
    const parsed = new DianResponseParserService().parseApplicationResponse(
      raw(
        ['Regla: RUT01, Notificación: Responsabilidad no informada'],
        true,
        '00',
      ),
    );
    expect(
      describeDianVerdict(parsed, 'Documento validado por la DIAN', 'x'),
    ).toBe(
      'Documento validado por la DIAN; Notificación RUT01: Responsabilidad no informada',
    );
  });

  it('checkStatus expone rule_messages, application_response_xml y timed_out', async () => {
    const xml = raw(
      ['Regla: 90, Rechazo: Documento procesado anteriormente'],
      false,
      '99',
    );
    const provider = makeStatusProvider({
      raw_response: xml,
      timed_out: false,
    });
    const res = await provider.checkStatus('CUFE123');
    expect(res.status).toBe('rejected');
    expect(res.provider_data.rule_messages[0].code).toBe('90');
    expect(res.provider_data.already_processed).toBe(true);
    expect(res.provider_data.application_response_xml).toBe(xml);
    expect(res.provider_data.timed_out).toBe(false);
  });

  it('checkStatus acepta con status_code 00 aunque IsValid falte', async () => {
    const xml = raw([], false, '00');
    const provider = makeStatusProvider({ raw_response: xml, timed_out: true });
    const res = await provider.checkStatus('CUFE123');
    expect(res.status).toBe('accepted');
    expect(res.provider_data.timed_out).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUI-683 — el ENVÍO de la nota de ajuste al documento soporte (no sólo el
// builder): lo que se firma y transmite es un tipo 95 que referencia el CUDS
// del original, y sin ese CUDS no sale nada hacia la DIAN.
// ─────────────────────────────────────────────────────────────────────────────

describe('DianDirectProvider.sendSupportAdjustmentNote — tipo 95 y CUDS del original', () => {
  const ORIGINAL_CUDS = 'ab'.repeat(48);

  const buyer = {
    document_type: '31',
    nit: '900123456',
    nit_dv: '7',
    legal_name: 'Vendix SAS',
    trade_name: 'Vendix',
    address_line: 'Calle 1 # 2-3',
    city_code: '11001',
    city_name: 'Bogota',
    department_code: '11',
    department_name: 'Bogota',
    country_code: 'CO',
    postal_code: '110111',
    email: 'contabilidad@vendix.test',
    tax_regime: '1',
    tax_scheme: 'O-48',
  };
  const seller = {
    document_type: 'CC',
    document_number: '123456789',
    verification_digit: null,
    legal_name: 'Proveedor No Obligado',
    address_line: 'Carrera 4 # 5-6',
    city_code: '11001',
    city_name: 'Bogota',
    department_code: '11',
    department_name: 'Bogota',
    country_code: 'CO',
    tax_regime: '2',
    tax_responsibilities: ['R-99-PN'],
    person_type: 'NATURAL',
    ciiu_code: null,
  };

  const adjustment = (overrides: Record<string, unknown> = {}) => ({
    invoice_number: 'NASVS1',
    invoice_type: 'support_adjustment_note',
    issue_date: '2026-03-12',
    issue_time: '10:00:00-05:00',
    customer_name: 'Proveedor No Obligado',
    customer_tax_id: '123456789',
    subtotal_amount: '1000.00',
    discount_amount: '0.00',
    tax_amount: '0.00',
    withholding_amount: '0.00',
    total_amount: '1000.00',
    currency: 'COP',
    items: [
      {
        description: 'Ajuste servicio',
        quantity: '1',
        unit_price: '1000.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        total_amount: '1000.00',
      },
    ],
    taxes: [],
    original_invoice_number: 'DS100',
    original_invoice_cufe: ORIGINAL_CUDS,
    original_invoice_issue_date: '2026-03-10',
    ...overrides,
  });

  const makeSendProvider = () => {
    const soap = {
      sendBillSync: jest.fn().mockResolvedValue({
        raw_response:
          '<s:Envelope xmlns:s="s" xmlns:b="b"><s:Body><b:IsValid>true</b:IsValid><b:StatusCode>00</b:StatusCode><b:StatusDescription>Procesado Correctamente.</b:StatusDescription></s:Body></s:Envelope>',
        timed_out: false,
      }),
    };
    const provider = new DianDirectProvider(
      null as any,
      null as any,
      null as any,
      soap as any,
      null as any,
      new DianResponseParserService(),
      null as any,
      null as any,
    );
    const p = provider as any;
    p.loadConfig = jest.fn().mockResolvedValue({
      id: 1,
      environment: 'test',
      software_id: 'software-1',
      software_pin: '12345',
      nit: '900123456',
      operation_mode: 'own_software',
    });
    p.validateCertificateExpiry = jest.fn();
    p.loadIssuerData = jest.fn().mockResolvedValue(buyer);
    p.buildCustomerData = jest.fn().mockResolvedValue(seller);
    p.signXml = jest.fn(async (xml: string) => xml);
    p.compressToZipBase64 = jest.fn().mockResolvedValue('zip');
    p.loadWsCredentials = jest.fn().mockResolvedValue(undefined);
    p.createAuditLog = jest.fn().mockResolvedValue(undefined);
    return { provider, soap, signXml: p.signXml as jest.Mock, loadConfig: p.loadConfig as jest.Mock };
  };

  it('firma y transmite una nota tipo 95 que referencia el CUDS del documento soporte original', async () => {
    const { provider, soap, signXml, loadConfig } = makeSendProvider();

    const response = await provider.sendSupportAdjustmentNote(adjustment() as any);

    expect(loadConfig).toHaveBeenCalledWith('support_document');
    expect(soap.sendBillSync).toHaveBeenCalledTimes(1);
    const signed: string = signXml.mock.calls[0][0];
    expect(signed).toContain('<cbc:CreditNoteTypeCode>95</cbc:CreditNoteTypeCode>');
    const billing = signed.slice(
      signed.indexOf('<cac:BillingReference>'),
      signed.indexOf('</cac:BillingReference>'),
    );
    expect(billing).toContain('<cbc:ID>DS100</cbc:ID>');
    expect(billing).toContain(
      `<cbc:UUID schemeName="CUDS-SHA384">${ORIGINAL_CUDS}</cbc:UUID>`,
    );
    expect(billing).toContain('<cbc:IssueDate>2026-03-10</cbc:IssueDate>');
    // La nota lleva su PROPIO CUDS, distinto del original que referencia.
    expect(response.success).toBe(true);
    expect(response.cuds).toBeTruthy();
    expect(response.cuds).not.toBe(ORIGINAL_CUDS);
  });

  it('sin el CUDS del original no firma ni transmite: la nota falla antes de salir', async () => {
    const { provider, soap, signXml } = makeSendProvider();

    await expect(
      provider.sendSupportAdjustmentNote(
        adjustment({ original_invoice_cufe: undefined }) as any,
      ),
    ).rejects.toThrow(/CUDS/);
    expect(signXml).not.toHaveBeenCalled();
    expect(soap.sendBillSync).not.toHaveBeenCalled();
  });
});

describe('DianDirectProvider.checkStatus — habilitación consultada', () => {
  const makeProvider = () => {
    const soap = {
      getStatus: jest.fn().mockResolvedValue({ raw_response: '', timed_out: true }),
    };
    const provider = new DianDirectProvider(
      null as any,
      null as any,
      null as any,
      soap as any,
      null as any,
      new DianResponseParserService(),
      null as any,
      null as any,
    );
    (provider as any).loadConfig = jest
      .fn()
      .mockResolvedValue({ id: 1, environment: 'test' });
    (provider as any).loadWsCredentials = jest.fn().mockResolvedValue(undefined);
    return { provider, loadConfig: (provider as any).loadConfig as jest.Mock };
  };

  it('sin opciones sigue usando la configuración de facturación (flujo de envío intacto)', async () => {
    const { provider, loadConfig } = makeProvider();
    await provider.checkStatus('CUFE123');
    expect(loadConfig).toHaveBeenCalledWith('invoicing');
  });

  it('con configuration_type consulta con la habilitación del documento soporte', async () => {
    const { provider, loadConfig } = makeProvider();
    await provider.checkStatus('CUDS123', { configuration_type: 'support_document' });
    expect(loadConfig).toHaveBeenCalledWith('support_document');
  });
});
