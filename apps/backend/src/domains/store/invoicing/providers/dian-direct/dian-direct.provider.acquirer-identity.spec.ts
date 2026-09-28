import { DianDirectProvider } from './dian-direct.provider';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Cobertura del incidente Óptica Panorama SAS / Pollo Árabe en el punto de
 * EMISIÓN (`DianDirectProvider.buildCustomerData` / `translatePersonTypeToStructural`).
 *
 * `buildCustomerData` y `translatePersonTypeToStructural` son privados: se
 * invocan vía cast `as any` sobre una instancia con dependencias de
 * infraestructura vacías (`{} as any`), porque el camino bajo prueba —
 * adquiriente nominativo con dirección fiscal declarada inline (sin `type`,
 * por tanto clasificada `fiscal` por `resolveAcquirerAddress`) — nunca llega a
 * tocar Prisma/S3/SOAP: la cascada de dirección se resuelve en el primer
 * escalón y `loadCustomerAddressCandidates` (que sí usaría `this.prisma`) no
 * se invoca.
 */
function buildProvider(): DianDirectProvider {
  return new DianDirectProvider(
    {} as any, // StorePrismaService
    {} as any, // EncryptionService
    {} as any, // S3Service
    {} as any, // DianSoapClient
    {} as any, // DianXmlSignerService
    {} as any, // DianResponseParserService
    {} as any, // FiscalScopeService
    {} as any, // DianSecretEnvelopeService
  );
}

const FISCAL_ADDRESS = {
  // Sin `type`: `normalizeAddress` + `resolveAcquirerAddress` lo clasifican
  // `fiscal` (ver `classifyAcquirerAddressType`), lo que evita la consulta a
  // base de datos dentro de `buildCustomerData`.
  address_line: 'CALLE 14H 26 13',
  city_code: '44001',
  city_name: 'Riohacha',
  department_code: '44',
  department_name: 'La Guajira',
  country_code: 'CO',
};

describe('DianDirectProvider.buildCustomerData — identidad del adquiriente', () => {
  it('incidente real: factura manual sin customer_id, snapshot NIT/31 + DV 7 + correo ⇒ payload NIT/jurídica/DV/correo', async () => {
    const provider = buildProvider();

    const customer = await (provider as any).buildCustomerData(
      {
        invoice_number: 'SETP990000200',
        customer_tax_id: '800214345',
        customer_name: 'Óptica Panorama SAS',
        customer_document_type: '31',
        customer_verification_digit: '7',
        customer_email: 'facturacion@opticapanorama.co',
        customer_address: FISCAL_ADDRESS,
      },
      'adquiriente',
      { issuer: {} as any, config: {} as any },
    );

    expect(customer.document_type).toBe('31');
    expect(customer.document_number).toBe('800214345');
    expect(customer.verification_digit).toBe('7');
    expect(customer.person_type).toBe('JURIDICA');
    expect(customer.email).toBe('facturacion@opticapanorama.co');
    expect(customer.legal_name).toBe('Óptica Panorama SAS');
  });

  it('adquiriente nominativo (número + nombre) sin document_type declarado ⇒ lanza INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED, nunca CC', async () => {
    const provider = buildProvider();

    let caught: unknown;
    try {
      await (provider as any).buildCustomerData(
        {
          invoice_number: 'SETP990000201',
          customer_tax_id: '800214345',
          customer_name: 'Óptica Panorama SAS',
          // sin customer_document_type
        },
        'adquiriente',
        { issuer: {} as any, config: {} as any },
      );
      fail('esperaba que buildCustomerData lanzara');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code,
    );
  });

  it('consumidor final (número oficial 222222222222) permanece intacto: NATURAL, sin bloqueo, sin dirección', async () => {
    const provider = buildProvider();

    const customer = await (provider as any).buildCustomerData(
      {
        invoice_number: 'SETP990000202',
        customer_tax_id: '222222222222',
        customer_name: 'Consumidor Final',
      },
      'adquiriente',
      { issuer: {} as any, config: {} as any },
    );

    expect(customer.document_number).toBe('222222222222');
    expect(customer.person_type).toBe('NATURAL');
    expect(customer.address_line).toBeUndefined();
  });

  it('venta anónima de mostrador (sin tipo, sin número, sin nombre) sigue resolviendo a consumidor final, no a un bloqueo', async () => {
    const provider = buildProvider();

    const customer = await (provider as any).buildCustomerData(
      { invoice_number: 'SETP990000203' },
      'adquiriente',
      { issuer: {} as any, config: {} as any },
    );

    expect(customer.document_number).toBe('222222222222');
    expect(customer.person_type).toBe('NATURAL');
  });

  // P1-B — defensa en profundidad: MISMA política de
  // `resolveMissingAcquirerDocumentType` que ya aplican `acquirer-rail.resolver.ts`
  // (creación) y `resolveAcquirerIdentity` (validación/emisión), para que
  // `send()` no vuelva a bloquear las 67 fichas antiguas sin `document_type`
  // (sólo 21 de ellas con forma de NIT).
  it('ficha antigua: número SIN forma de NIT, sin document_type ni customer_person_type ⇒ infiere CC, no bloquea', async () => {
    const provider = buildProvider();

    const customer = await (provider as any).buildCustomerData(
      {
        invoice_number: 'SETP990000204',
        customer_tax_id: '1118860776',
        customer_name: 'Juan Pérez',
        customer_address: FISCAL_ADDRESS,
        // sin customer_document_type, sin customer_person_type
      },
      'adquiriente',
      { issuer: {} as any, config: {} as any },
    );

    expect(customer.document_type).toBe('CC');
    expect(customer.document_number).toBe('1118860776');
  });

  it('customer_person_type=JURIDICA sin document_type, número SIN forma de NIT ⇒ BLOQUEA igual (señal de riesgo por person_type)', async () => {
    const provider = buildProvider();

    let caught: unknown;
    try {
      await (provider as any).buildCustomerData(
        {
          invoice_number: 'SETP990000205',
          customer_tax_id: '1118860776',
          customer_name: 'Empresa Sin NIT Shape',
          customer_person_type: 'JURIDICA',
        },
        'adquiriente',
        { issuer: {} as any, config: {} as any },
      );
      fail('esperaba que buildCustomerData lanzara');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED.code,
    );
  });
});

describe('DianDirectProvider.translatePersonTypeToStructural — deriva por CÓDIGO, no por literal', () => {
  it('document_type_literal = código DIAN "31" (sin normalizar a NIT) deriva JURIDICA', () => {
    const provider = buildProvider();
    // Antes: `document_type_literal === 'NIT' ? 'JURIDICA' : 'NATURAL'` — un
    // '31' sin normalizar caía a NATURAL. Mitad exacta del incidente.
    const result = (provider as any).translatePersonTypeToStructural(
      undefined,
      '31',
    );
    expect(result).toBe('JURIDICA');
  });

  it('document_type_literal = "NIT" sigue derivando JURIDICA (compatibilidad)', () => {
    const provider = buildProvider();
    const result = (provider as any).translatePersonTypeToStructural(
      undefined,
      'NIT',
    );
    expect(result).toBe('JURIDICA');
  });

  it('document_type_literal = "13"/"CC" deriva NATURAL', () => {
    const provider = buildProvider();
    expect(
      (provider as any).translatePersonTypeToStructural(undefined, '13'),
    ).toBe('NATURAL');
    expect(
      (provider as any).translatePersonTypeToStructural(undefined, 'CC'),
    ).toBe('NATURAL');
  });

  it('un person_type explícito ("1"/"2") gana sobre el derivado del documento', () => {
    const provider = buildProvider();
    expect(
      (provider as any).translatePersonTypeToStructural('1', '13'),
    ).toBe('JURIDICA');
    expect(
      (provider as any).translatePersonTypeToStructural('2', '31'),
    ).toBe('NATURAL');
  });
});
