import { DianDirectProvider } from './dian-direct.provider';
import { UblInvoiceBuilder } from './xml/ubl-invoice.builder';

/**
 * `resolveSigningInstant` — el instante con el que se firma sale del documento.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO: en producción, FVJL11 y FVJL12 se generaron el
 * 4-sep a las 23:28 y 23:43 (Bogotá) y se transmitieron a la 01:05 del 5-sep,
 * ya pasada la medianoche. El XML era impecable —`cbc:IssueDate`, `cbc:IssueTime`
 * y el CUFE describían el mismo instante— pero `xades:SigningTime` se estampaba
 * con `new Date()`, así que declaraba el día siguiente. La DIAN las rechazó con
 * «Valida que fecha de generación de la factura sea igual a la fecha de firma»,
 * quemando dos consecutivos autorizados.
 *
 * El defecto NO es exclusivo de la medianoche: cualquier documento transmitido
 * en un día distinto al de su fecha de emisión —un reintento al día siguiente,
 * una contingencia— caía igual.
 */

// El método sólo se apoya en `directChildText`/`directChildElements`, que viven
// en el prototipo. Instanciar el provider real exigiría ocho dependencias de
// Nest que no participan en la lectura del XML.
const provider = Object.create(DianDirectProvider.prototype) as any;
const resolve = (xml: string): Date | undefined =>
  provider.resolveSigningInstant(xml);

const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const CAC =
  'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';

function buildInvoiceXml(issue_date: string, issue_time: string): string {
  return UblInvoiceBuilder.build({
    invoice_data: {
      invoice_number: 'SETP990000161',
      invoice_type: 'sales_invoice',
      issue_date,
      issue_time,
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
    } as any,
    issuer: {
      nit: '902056589',
      dv: '5',
      business_name: 'VENDIX SAS',
      address: 'CL 1',
      city: 'Bogotá',
      department: 'Bogotá',
      country_code: 'CO',
      postal_code: '110111',
      city_code: '11001',
      department_code: '11',
    } as any,
    customer: {
      identification: '1234567890',
      name: 'CLIENTE DE PRUEBA',
      address: 'CL 2',
      city: 'Bogotá',
      department: 'Bogotá',
      country_code: 'CO',
    } as any,
    software_security: {
      software_id: '00000000-0000-0000-0000-000000000000',
      security_code: 'abc',
      provider_nit: '902056589',
      provider_dv: '5',
    } as any,
    cufe: 'a'.repeat(96),
    environment: 'testing',
  } as any);
}

describe('resolveSigningInstant — la firma toma la fecha del documento', () => {
  it('devuelve el instante exacto que declaran IssueDate + IssueTime', () => {
    const xml = buildInvoiceXml('2026-08-08', '14:00:00-05:00');

    expect(resolve(xml)).toEqual(new Date('2026-08-08T19:00:00.000Z'));
  });

  it('reproduce el caso de FVJL11: 4-sep 23:28 Bogotá, no el 5-sep', () => {
    // El instante real de generación de la factura rechazada en producción.
    const xml = buildInvoiceXml('2026-09-04', '23:28:56-05:00');
    const instant = resolve(xml)!;

    // En UTC ya es el día 5 — que es exactamente lo que confundía al firmante.
    expect(instant.toISOString()).toBe('2026-09-05T04:28:56.000Z');

    // Pero la fecha civil que se estampará coincide con `cbc:IssueDate`, que es
    // lo único que la regla de la DIAN compara.
    expect(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(instant),
    ).toBe('2026-09-04');
  });

  it('el offset viaja en IssueTime, así que no supone la zona del servidor', () => {
    // Mismo reloj de pared, husos distintos: instantes distintos.
    const bogota = resolve(buildInvoiceXml('2026-09-04', '23:28:56-05:00'))!;
    const madrid = resolve(buildInvoiceXml('2026-09-04', '23:28:56+02:00'))!;

    expect(bogota.getTime() - madrid.getTime()).toBe(7 * 60 * 60 * 1000);
  });

  it('lee el IssueDate hijo directo de la raíz, no el de una referencia anidada', () => {
    // Una nota crédito referencia la factura original y esa referencia trae su
    // propia `cbc:IssueDate`. Tomarla firmaría con la fecha del documento ajeno.
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" ` +
      `xmlns:cac="${CAC}" xmlns:cbc="${CBC}">` +
      `<cbc:ID>NC1</cbc:ID>` +
      `<cbc:IssueDate>2026-09-04</cbc:IssueDate>` +
      `<cbc:IssueTime>23:28:56-05:00</cbc:IssueTime>` +
      `<cac:BillingReference><cac:InvoiceDocumentReference>` +
      `<cbc:ID>FVJL11</cbc:ID>` +
      `<cbc:IssueDate>2026-01-15</cbc:IssueDate>` +
      `</cac:InvoiceDocumentReference></cac:BillingReference>` +
      `</CreditNote>`;

    expect(resolve(xml)).toEqual(new Date('2026-09-05T04:28:56.000Z'));
  });

  it('sin IssueTime cae a la medianoche civil, que conserva la FECHA', () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ` +
      `xmlns:cbc="${CBC}">` +
      `<cbc:IssueDate>2026-09-04</cbc:IssueDate>` +
      `</Invoice>`;

    // 00:00:00-05:00 del 4-sep.
    expect(resolve(xml)).toEqual(new Date('2026-09-04T05:00:00.000Z'));
  });

  it('devuelve undefined —y el firmante conserva su reloj— ante un XML ilegible', () => {
    expect(resolve('no es xml')).toBeUndefined();
    expect(resolve('')).toBeUndefined();
    expect(
      resolve(
        `<Invoice xmlns:cbc="${CBC}"><cbc:ID>SETP1</cbc:ID></Invoice>`,
      ),
    ).toBeUndefined();
    expect(
      resolve(
        `<Invoice xmlns:cbc="${CBC}"><cbc:IssueDate>ayer</cbc:IssueDate></Invoice>`,
      ),
    ).toBeUndefined();
  });
});

/**
 * El cableado: `signXml` es el único paso obligado de los siete caminos de
 * emisión —factura, notas crédito y débito, documento soporte, nota de ajuste,
 * documento equivalente POS y eventos RADIAN—, y por eso el instante se
 * resuelve ahí. Este bloque prueba que efectivamente llega al firmante.
 */
describe('signXml — el instante del documento llega al firmante', () => {
  const buildWired = () => {
    const wired = Object.create(DianDirectProvider.prototype) as any;
    wired.logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
    wired.s3_service = {
      downloadImage: jest.fn().mockResolvedValue(Buffer.from('p12')),
    };
    wired.xml_signer = { sign: jest.fn().mockResolvedValue('<signed/>') };
    return wired;
  };

  const CONFIG = {
    environment: 'testing',
    certificate_s3_key: 'certs/test.p12',
    certificate_password: 'secret',
    certificate_kms_key_id: null,
  } as any;

  it('pasa la fecha de emisión como quinto argumento de sign()', async () => {
    const wired = buildWired();
    const xml = buildInvoiceXml('2026-09-04', '23:28:56-05:00');

    await wired.signXml(xml, CONFIG);

    expect(wired.xml_signer.sign).toHaveBeenCalledTimes(1);
    expect(wired.xml_signer.sign.mock.calls[0][4]).toEqual(
      new Date('2026-09-05T04:28:56.000Z'),
    );
  });

  it('un documento sin IssueDate nunca llega a firmarse: lo aborta la compuerta estructural', async () => {
    // El respaldo `undefined` de `resolveSigningInstant` es defensa en
    // profundidad, no un camino vivo: `assertStructurallyValid` corre antes
    // dentro del mismo `signXml` y `cbc:IssueDate` es obligatorio. Se afirma
    // aquí para que quede escrito cuál de las dos compuertas manda.
    const wired = buildWired();
    const xml = buildInvoiceXml('2026-09-04', '23:28:56-05:00').replace(
      '<cbc:IssueDate>2026-09-04</cbc:IssueDate>',
      '',
    );

    await expect(wired.signXml(xml, CONFIG)).rejects.toThrow(
      /no cumple la estructura que exige la DIAN/,
    );
    expect(wired.xml_signer.sign).not.toHaveBeenCalled();
  });
});
