import { UblStructureValidator } from './ubl-structure.validator';
import { UblInvoiceBuilder } from './ubl-invoice.builder';
import { UblCreditNoteBuilder } from './ubl-credit-note.builder';
import { UblDebitNoteBuilder } from './ubl-debit-note.builder';
import { UblSupportDocumentBuilder } from './ubl-support-document.builder';
import { UblEquivalentDocumentBuilder } from './ubl-equivalent-document.builder';
import { UblApplicationResponseBuilder } from './ubl-application-response.builder';

/**
 * Compuerta estructural de los siete caminos de emisión.
 *
 * Este archivo existe porque los builders sostenían el orden de UBL con
 * comentarios. Se descubrieron cuatro violaciones reales corriendo esta misma
 * verificación por primera vez, todas invisibles para los specs de contenido que
 * ya existían: `cbc:ID` al final de `cac:Person`, `cac:Contact` detrás de
 * `cac:Person`, `cbc:IndustryClassificationCode` detrás de `cac:PartyTaxScheme`,
 * y `cbc:DueDate` detrás de `cbc:LineCountNumeric` en el documento soporte. Las
 * cuatro producían documentos con el contenido correcto que la DIAN rechaza por
 * estructura, gastando el consecutivo autorizado.
 *
 * Cada caso de abajo es una RAMA distinta del generador, no una repetición: el
 * adquiriente natural y el jurídico emiten grupos distintos, y con/sin contacto
 * y con/sin CIIU cambian qué elementos aparecen y por tanto qué orden se pone a
 * prueba.
 */

const issuer: any = {
  document_type: '31',
  nit: '900123456',
  nit_dv: '1',
  legal_name: 'EMISOR DE PRUEBA S.A.S',
  trade_name: 'EMISOR',
  address_line: 'CALLE 10 # 20-30',
  city_code: '11001',
  city_name: 'Bogotá, D.C.',
  department_code: '11',
  department_name: 'Bogotá D.C.',
  country_code: 'CO',
  postal_code: '110111',
  phone: '3001234567',
  email: 'facturacion@emisor.co',
  tax_regime: '48',
  tax_scheme: 'O-13',
  person_type: '1',
  tax_responsibilities: ['O-13'],
};

const customer_natural: any = {
  document_type: '13',
  document_number: '1118860776',
  verification_digit: null,
  legal_name: 'JUAN PEREZ',
  first_name: 'JUAN',
  last_name: 'PEREZ',
  address_line: 'CARRERA 5 # 6-7',
  city_code: '11001',
  city_name: 'Bogotá, D.C.',
  department_code: '11',
  department_name: 'Bogotá D.C.',
  country_code: 'CO',
  phone: '3009876543',
  email: 'juan@example.com',
  tax_regime: '49',
  tax_scheme: 'R-99-PN',
  person_type: 'NATURAL',
  tax_responsibilities: ['R-99-PN'],
};

const customer_juridica: any = {
  ...customer_natural,
  document_type: '31',
  document_number: '800199436',
  verification_digit: '8',
  legal_name: 'COMERCIAL DEL NORTE S.A.S',
  person_type: 'JURIDICA',
  tax_regime: '48',
  tax_scheme: 'O-13',
  tax_responsibilities: ['O-13', 'O-15'],
  ciiu_code: '4663',
};

const software_security: any = {
  software_id: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  software_pin: '12345',
  software_security_code: 'a'.repeat(96),
  provider_nit: '900123456',
  provider_nit_dv: '1',
};

const control: any = {
  invoice_authorization: '18764113258848',
  authorization_start_date: '2024-07-29',
  authorization_end_date: '2028-07-29',
  prefix: 'FV',
  range_from: '1',
  range_to: '100',
};

function invoiceData(overrides: Record<string, any> = {}): any {
  return {
    invoice_number: 'FV1',
    invoice_type: 'sales_invoice',
    issue_date: '2026-08-14',
    issue_time: '16:46:05-05:00',
    due_date: '2026-08-14',
    customer_name: 'JUAN PEREZ',
    customer_tax_id: '1118860776',
    subtotal_amount: '840.34',
    discount_amount: '0.00',
    tax_amount: '159.66',
    withholding_amount: '0.00',
    total_amount: '1000.00',
    currency: 'COP',
    payment_form: '1',
    payment_means: '10',
    notes: 'Documento de prueba estructural.',
    items: [
      {
        description: 'Tubería PVC 1/2"',
        quantity: '1',
        unit_price: '840.34',
        discount_amount: '0.00',
        tax_amount: '159.66',
        total_amount: '840.34',
        item_code: 'TUB-001',
        unit_code: 'EA',
      },
    ],
    taxes: [
      {
        tax_name: 'IVA',
        tax_type: 'iva',
        tax_rate: '19.00',
        taxable_amount: '840.34',
        tax_amount: '159.66',
      },
    ],
    ...overrides,
  };
}

/** Falla nombrando la violación, no con un `expect(true)` mudo. */
function expectValid(xml: string): void {
  const result = UblStructureValidator.validate(xml);
  if (!result.valid) {
    throw new Error(
      `XML inválido (${result.root ?? 'raíz desconocida'}):\n` +
        result.violations.map((v) => `  [${v.kind}] ${v.path}: ${v.message}`).join('\n'),
    );
  }
  expect(result.valid).toBe(true);
}

describe('UblStructureValidator', () => {
  describe('factura de venta', () => {
    it('adquiriente natural con contacto', () => {
      expectValid(
        UblInvoiceBuilder.build({
          invoice_data: invoiceData(),
          issuer,
          customer: customer_natural,
          software_security,
          cufe: 'f'.repeat(96),
          environment: 'production',
          control,
        }),
      );
    });

    it('adquiriente natural sin contacto', () => {
      expectValid(
        UblInvoiceBuilder.build({
          invoice_data: invoiceData(),
          issuer,
          customer: { ...customer_natural, email: undefined, phone: undefined },
          software_security,
          cufe: 'f'.repeat(96),
          environment: 'production',
          control,
        }),
      );
    });

    it('adquiriente jurídico con CIIU', () => {
      expectValid(
        UblInvoiceBuilder.build({
          invoice_data: invoiceData(),
          issuer,
          customer: customer_juridica,
          software_security,
          cufe: 'f'.repeat(96),
          environment: 'production',
          control,
        }),
      );
    });

    it('AIU, divisa declarada y retenciones', () => {
      expectValid(
        UblInvoiceBuilder.build({
          invoice_data: invoiceData({
            operation_type: '09',
            discount_amount: '50.00',
            // Las claves TIENEN que ser las de `DianExchangeRateDeclaration` y
            // `ProviderInvoiceWithholding`. `invoiceData()` devuelve `any`, así
            // que una clave mal escrita no la atrapa el compilador: el builder
            // lee `undefined`, omite la retención entera y emite la divisa con
            // elementos vacíos, y el test sigue en verde afirmando que validó
            // «AIU, divisa declarada y retenciones» cuando dos de las tres no
            // llegaron al documento.
            exchange_rate: {
              foreign_currency: 'USD',
              rate: '4100.50',
              date: '2026-08-14',
            },
            withholdings: [
              {
                withholding_type: 'retefuente',
                concept_code: 'servicios',
                rate: '2.50',
                base: '840.34',
                amount: '21.01',
              },
            ],
          }),
          issuer,
          customer: customer_natural,
          software_security,
          cufe: 'f'.repeat(96),
          environment: 'test',
          control,
        }),
      );
    });

    it('multi-línea con dos esquemas de impuesto', () => {
      expectValid(
        UblInvoiceBuilder.build({
          invoice_data: invoiceData({
            items: [
              {
                description: 'Servicio A',
                quantity: '2',
                unit_price: '1000.00',
                discount_amount: '100.00',
                tax_amount: '361.00',
                total_amount: '1900.00',
                item_code: 'SRV-A',
                unit_code: 'EA',
                price_unit_quantity: '1',
              },
              {
                description: 'Producto B',
                quantity: '3.5',
                unit_price: '500.00',
                discount_amount: '0.00',
                tax_amount: '140.00',
                total_amount: '1750.00',
                item_code: 'PRD-B',
                unit_code: 'KGM',
              },
            ],
            taxes: [
              {
                tax_name: 'IVA',
                tax_type: 'iva',
                tax_rate: '19.00',
                taxable_amount: '1900.00',
                tax_amount: '361.00',
              },
              {
                tax_name: 'INC',
                tax_type: 'inc',
                tax_rate: '8.00',
                taxable_amount: '1750.00',
                tax_amount: '140.00',
              },
            ],
            subtotal_amount: '3650.00',
            discount_amount: '100.00',
            tax_amount: '501.00',
            total_amount: '4151.00',
          }),
          issuer,
          customer: customer_natural,
          software_security,
          cufe: 'f'.repeat(96),
          environment: 'production',
          control,
        }),
      );
    });
  });

  it('nota crédito', () => {
    expectValid(
      UblCreditNoteBuilder.build({
        credit_note_data: invoiceData({
          invoice_number: 'NC1',
          invoice_type: 'credit_note',
        }),
        issuer,
        customer: customer_natural,
        software_security,
        cude: 'c'.repeat(96),
        environment: 'production',
        original_invoice_number: 'FV1',
        original_invoice_cufe: 'f'.repeat(96),
        original_invoice_date: '2026-08-14',
        control,
      }),
    );
  });

  it('nota débito', () => {
    expectValid(
      UblDebitNoteBuilder.build({
        debit_note_data: invoiceData({
          invoice_number: 'ND1',
          invoice_type: 'debit_note',
        }),
        issuer,
        customer: customer_natural,
        software_security,
        cude: 'd'.repeat(96),
        environment: 'production',
        original_invoice_number: 'FV1',
        original_invoice_cufe: 'f'.repeat(96),
        original_invoice_date: '2026-08-14',
        control,
      }),
    );
  });

  describe('documento soporte', () => {
    it('con fecha de vencimiento', () => {
      expectValid(
        UblSupportDocumentBuilder.buildDocument({
          support_document_data: invoiceData({
            invoice_number: 'DS1',
            invoice_type: 'support_document',
          }),
          buyer: issuer,
          seller: customer_natural,
          software_security,
          cuds: 's'.repeat(96),
          environment: 'production',
        }),
      );
    });

    it('sin fecha de vencimiento', () => {
      expectValid(
        UblSupportDocumentBuilder.buildDocument({
          support_document_data: invoiceData({
            invoice_number: 'DS2',
            invoice_type: 'support_document',
            due_date: undefined,
          }),
          buyer: issuer,
          seller: customer_natural,
          software_security,
          cuds: 's'.repeat(96),
          environment: 'production',
        }),
      );
    });

    it('nota de ajuste', () => {
      expectValid(
        UblSupportDocumentBuilder.buildAdjustmentNote({
          support_adjustment_data: invoiceData({
            invoice_number: 'NA1',
            invoice_type: 'support_document_adjustment',
          }),
          buyer: issuer,
          seller: customer_natural,
          software_security,
          cuds: 's'.repeat(96),
          environment: 'production',
          original_support_document_number: 'DS1',
          original_support_document_cuds: 's'.repeat(96),
          original_support_document_date: '2026-08-14',
        }),
      );
    });
  });

  it('documento equivalente POS', () => {
    expectValid(
      UblEquivalentDocumentBuilder.build({
        invoice_data: invoiceData({
          invoice_number: 'POS1',
          invoice_type: 'pos_equivalent',
        }),
        issuer,
        customer: customer_natural,
        software_security,
        cude: 'e'.repeat(96),
        environment: 'production',
        control,
      }),
    );
  });

  describe.each(['030', '031', '032', '033', '034'])(
    'evento RADIAN %s',
    (code) => {
      it('estructura válida', () => {
        const party: any = {
          document_type: '31',
          document_number: '900123456',
          document_dv: '1',
          legal_name: 'EMISOR DE PRUEBA S.A.S',
        };
        expectValid(
          UblApplicationResponseBuilder.build({
            event_number: '1',
            event_code: code as any,
            cude: 'e'.repeat(96),
            issue_date: '2026-08-14',
            issue_time: '16:46:05-05:00',
            sender: party,
            receiver: {
              ...party,
              document_number: '800199436',
              document_dv: '8',
              legal_name: 'COMERCIAL DEL NORTE S.A.S',
            },
            referenced_document_number: 'FV1',
            referenced_document_key: 'f'.repeat(96),
            referenced_document_date: '2026-08-14',
            software_security,
            environment: 'production',
            description: 'Evento RADIAN de prueba estructural.',
          }),
        );
      });
    },
  );

  describe('el validador detecta lo que debe detectar', () => {
    it('marca un elemento fuera de orden', () => {
      // `cbc:ID` (5) después de `cbc:IssueDate` (8) dentro de `InvoiceType`.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:IssueDate>2026-08-14</cbc:IssueDate>
  <cbc:ID>FV1</cbc:ID>
  <cac:AccountingSupplierParty/>
  <cac:AccountingCustomerParty/>
  <cac:LegalMonetaryTotal/>
  <cac:InvoiceLine/>
</Invoice>`;
      const result = UblStructureValidator.validate(xml);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.kind === 'order')).toBe(true);
    });

    it('marca un elemento obligatorio ausente', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>FV1</cbc:ID>
  <cbc:IssueDate>2026-08-14</cbc:IssueDate>
</Invoice>`;
      const result = UblStructureValidator.validate(xml);
      expect(result.valid).toBe(false);
      expect(
        result.violations.filter((v) => v.kind === 'missing').map((v) => v.path),
      ).toEqual(
        expect.arrayContaining([
          'Invoice/cac:AccountingSupplierParty',
          'Invoice/cac:AccountingCustomerParty',
          'Invoice/cac:LegalMonetaryTotal',
          'Invoice/cac:InvoiceLine',
        ]),
      );
    });

    it('marca un hijo que el tipo no admite', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:NoExisteEsteElemento>x</cbc:NoExisteEsteElemento>
</Invoice>`;
      const result = UblStructureValidator.validate(xml);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.kind === 'unknown-child')).toBe(true);
    });

    it('no confunde una raíz desconocida con un documento correcto', () => {
      const result = UblStructureValidator.validate('<Cualquiera/>');
      expect(result.valid).toBe(false);
      expect(result.root).toBeNull();
    });

    it('no da por bueno un XML mal formado', () => {
      const result = UblStructureValidator.validate('<Invoice><cbc:ID>');
      expect(result.valid).toBe(false);
    });

    it('resuelve el QName por namespace, no por el prefijo literal', () => {
      // Mismos namespaces, prefijos reescritos a `z9`/`q1`: un firmante puede
      // hacerlo y el documento sigue siendo el mismo. Si el validador comparara
      // prefijos, TODOS los hijos saldrían como desconocidos y los seis
      // obligatorios del nivel raíz como ausentes.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:z9="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:q1="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <z9:ID>FV1</z9:ID>
  <z9:IssueDate>2026-08-14</z9:IssueDate>
  <q1:AccountingSupplierParty/>
  <q1:AccountingCustomerParty/>
  <q1:LegalMonetaryTotal/>
  <q1:InvoiceLine/>
</Invoice>`;
      const result = UblStructureValidator.validate(xml);

      expect(result.root).toBe('Invoice');
      expect(result.violations.filter((v) => v.kind === 'order')).toEqual([]);
      expect(result.violations.filter((v) => v.kind === 'unknown-child')).toEqual([]);
      // Nada falta en el nivel raíz: los seis hijos se reconocieron pese al
      // prefijo. Lo único que queda son los obligatorios de los grupos que este
      // fixture deja vacíos a propósito, y sus rutas se reportan con el prefijo
      // CANÓNICO — que es la prueba de que la resolución fue por namespace.
      expect(
        result.violations.filter((v) => /^Invoice\/[^/]+$/.test(v.path)),
      ).toEqual([]);
      expect(result.violations.map((v) => v.path)).toEqual([
        'Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount',
        'Invoice/cac:InvoiceLine[1]/cbc:ID',
        'Invoice/cac:InvoiceLine[1]/cbc:LineExtensionAmount',
        'Invoice/cac:InvoiceLine[1]/cac:Item',
      ]);
    });
  });

  describe('overrides del perfil DIAN — receptor', () => {
    /**
     * `cac:AccountingCustomerParty` con el `cbc:AdditionalAccountID` que se
     * arme en cada caso. El resto del `Invoice` se deja mínimo, como en
     * `describe('el validador detecta lo que debe detectar')`: sólo importan
     * las violaciones del receptor, no que el documento esté completo.
     */
    function invoiceWithCustomerAdditionalAccountIds(values: string[]): string {
      const ids = values
        .map((value) => `    <cbc:AdditionalAccountID>${value}</cbc:AdditionalAccountID>`)
        .join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>FV1</cbc:ID>
  <cbc:IssueDate>2026-08-14</cbc:IssueDate>
  <cac:AccountingSupplierParty/>
  <cac:AccountingCustomerParty>
${ids}
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal/>
  <cac:InvoiceLine/>
</Invoice>`;
    }

    it('dos cbc:AdditionalAccountID en el receptor — el caso rechazado por la DIAN (FVJL7/FVJL8)', () => {
      // El XML transmitido llevaba exactamente esto: '1' (tipo de persona) y
      // '3' (marcador de agente de retención que nunca debió emitirse aquí).
      // El XSD genérico admite 0..*, así que sin el override esto pasaba.
      const xml = invoiceWithCustomerAdditionalAccountIds(['1', '3']);
      const result = UblStructureValidator.validate(xml);

      expect(result.valid).toBe(false);
      expect(
        result.violations.some(
          (v) =>
            v.kind === 'too-many' &&
            v.path.includes('cac:AccountingCustomerParty'),
        ),
      ).toBe(true);
    });

    it('un cbc:AdditionalAccountID con valor fuera de la lista DIAN (\'3\')', () => {
      const xml = invoiceWithCustomerAdditionalAccountIds(['3']);
      const result = UblStructureValidator.validate(xml);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.kind === 'bad-value')).toBe(true);
    });

    it('un solo cbc:AdditionalAccountID con valor \'1\' — receptor correcto', () => {
      const xml = invoiceWithCustomerAdditionalAccountIds(['1']);
      const result = UblStructureValidator.validate(xml);

      // El fixture es parcial (no completa el documento), así que puede haber
      // otras violaciones ajenas al receptor; lo único que se afirma es que
      // `cbc:AdditionalAccountID` en sí no produce ninguna.
      expect(
        result.violations.some((v) => v.path.includes('cbc:AdditionalAccountID')),
      ).toBe(false);
    });
  });
});
