import { UblSupportDocumentBuilder } from './ubl-support-document.builder';
import {
  DianCustomerData,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../../invoice-provider.interface';

describe('UblSupportDocumentBuilder', () => {
  const buyer: DianIssuerData = {
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
  const seller: DianCustomerData = {
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
  const software_security: DianSoftwareSecurity = {
    software_id: 'software-1',
    software_pin: 'pin',
    software_security_code: 'hash',
  };
  const baseDocument: ProviderInvoiceData = {
    invoice_number: 'DS100',
    invoice_type: 'support_document',
    issue_date: '2026-03-10',
    issue_time: '10:00:00-05:00',
    due_date: '2026-03-20',
    customer_name: seller.legal_name || '',
    customer_tax_id: seller.document_number,
    subtotal_amount: '1000.00',
    discount_amount: '0.00',
    tax_amount: '190.00',
    withholding_amount: '120.00',
    total_amount: '1190.00',
    currency: 'COP',
    items: [
      {
        description: 'Servicio profesional',
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
        tax_rate: '19',
        taxable_amount: '1000.00',
        tax_amount: '190.00',
      },
    ],
    notes: 'Documento soporte compra a no obligado',
  };

  it('builds support document XML with DIAN type 05 and CUDS scheme', () => {
    const xml = UblSupportDocumentBuilder.buildDocument({
      support_document_data: baseDocument,
      buyer,
      seller,
      software_security,
      cuds: 'cuds-hash',
      environment: 'test',
    });

    expect(xml).toContain('<cbc:CustomizationID>10</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:InvoiceTypeCode>05</cbc:InvoiceTypeCode>');
    expect(xml).toContain('schemeName="CUDS-SHA384"');
    expect(xml).toContain('<cbc:CompanyID schemeAgencyID="195"');
    expect(xml).toContain('>123456789</cbc:CompanyID>');
    // El DV viaja en `@schemeID`, nunca pegado al número: §11.2 toma el
    // identificador de este XPath para el hash y lo exige desnudo.
    expect(xml).toContain('>900123456</cbc:CompanyID>');
    expect(xml).not.toContain('900123456-7');
  });

  it('builds support adjustment note XML with DIAN type 95 and original CUDS reference', () => {
    const xml = UblSupportDocumentBuilder.buildAdjustmentNote({
      support_adjustment_data: {
        ...baseDocument,
        invoice_number: 'NADS100',
        invoice_type: 'support_adjustment_note',
        original_invoice_number: 'DS100',
        original_invoice_cufe: 'original-cuds',
        original_invoice_issue_date: '2026-03-10',
      },
      buyer,
      seller,
      software_security,
      cuds: 'adjustment-cuds',
      environment: 'test',
      original_support_document_number: 'DS100',
      original_support_document_cuds: 'original-cuds',
      original_support_document_date: '2026-03-10',
    });

    expect(xml).toContain(
      '<cbc:CreditNoteTypeCode>95</cbc:CreditNoteTypeCode>',
    );
    expect(xml).toContain('schemeName="CUDS-SHA384"');
    expect(xml).toContain('<cbc:ID>DS100</cbc:ID>');
    expect(xml).toContain(
      '<cbc:UUID schemeName="CUDS-SHA384">original-cuds</cbc:UUID>',
    );
  });

  /**
   * Anexo Técnico 19 — the support document's `cac:AccountingCustomerParty`
   * (the buyer side) follows the same structural branch as the invoice. The
   * buyer is always JURIDICA in practice (an organization buying from a no-
   * obligado), but the builder must accept both branches to round out the
   * customer-side coverage.
   */
  describe('buildCustomerParty — Anexo 19 customer branch (buyer)', () => {
    it('persona jurídica buyer → cac:PartyLegalEntity + CompanyID@schemeID=NIT', () => {
      const xml = UblSupportDocumentBuilder.buildDocument({
        support_document_data: baseDocument,
        buyer,
        seller,
        software_security,
        cuds: 'cuds-hash',
        environment: 'test',
      });
      const customer_block = xml.slice(
        xml.indexOf('<cac:AccountingCustomerParty>'),
        xml.indexOf('</cac:AccountingCustomerParty>') +
          '</cac:AccountingCustomerParty>'.length,
      );
      // The buyer's `cac:AccountingCustomerParty` is JURIDICA because the
      // support document maps the buyer (legal entity) to the customer role;
      // `buildCustomerParty` emits `cac:PartyLegalEntity` with CompanyID +
      // RegistrationName.
      expect(customer_block).toContain('<cac:PartyLegalEntity>');
      // The buyer's NIT-DV value lands at cac:CompanyID as `<NIT>-<DV>`
      // (canonical Anexo 19 form).
      expect(customer_block).toMatch(
        /schemeID="7"[^>]*>900123456<\/cbc:CompanyID>/,
      );
    });
  });

  /**
   * `sellerAsSupplier` — el vendedor NO OBLIGADO a facturar viaja por la ruta
   * del emisor (`buildSupplierParty`), así que su `cac:PartyTaxScheme` sale del
   * mismo resolvedor que el de una factura normal. Tenía dos defectos.
   */
  describe('sellerAsSupplier — el vendedor no obligado no puede salir como responsable de IVA', () => {
    function supplierBlockOf(seller_override: Partial<DianCustomerData>): string {
      const xml = UblSupportDocumentBuilder.buildDocument({
        support_document_data: baseDocument,
        buyer,
        seller: { ...seller, ...seller_override },
        software_security,
        cuds: 'cuds-hash',
        environment: 'test',
      });
      return xml.slice(
        xml.indexOf('<cac:AccountingSupplierParty>'),
        xml.indexOf('</cac:AccountingSupplierParty>') +
          '</cac:AccountingSupplierParty>'.length,
      );
    }

    it('sin tax_regime declarado el vendedor sale ZZ / No aplica, no IVA', () => {
      // DEFECTO 1: el default era `seller.tax_regime || '2'`, y el constructor
      // decidía con `tax_regime !== '49'`. Como '2' no es '49', TODO vendedor
      // sin régimen — el caso normal de un no obligado a facturar — quedaba
      // declarado responsable de IVA. El respaldo correcto es el contrario:
      // sólo '48' afirma responsabilidad.
      const block = supplierBlockOf({ tax_regime: undefined });

      expect(block).toMatch(
        /<cac:TaxScheme>\s*<cbc:ID>ZZ<\/cbc:ID>\s*<cbc:Name>No aplica<\/cbc:Name>/,
      );
      expect(block).not.toContain('<cbc:Name>IVA</cbc:Name>');
    });

    it("tax_regime '2' tampoco afirma IVA", () => {
      expect(supplierBlockOf({ tax_regime: '2' })).toMatch(
        /<cac:TaxScheme>\s*<cbc:ID>ZZ<\/cbc:ID>/,
      );
    });

    it('conserva TODAS las responsabilidades, no sólo la primera', () => {
      // DEFECTO 2: `seller.tax_responsibilities?.[0]` descartaba el resto. El
      // anexo permite varias separadas por ';' y el ejemplo canónico es
      // 'O-13;O-15'; quedarse con la primera pierde declaraciones reales.
      const block = supplierBlockOf({
        tax_responsibilities: ['O-13', 'O-15', 'O-23'],
      });

      expect(block).toMatch(/TaxLevelCode[^>]*>O-13;O-15;O-23</);
    });

    it('un vendedor responsable de IVA (O-48) sí declara 01 / IVA', () => {
      const block = supplierBlockOf({ tax_responsibilities: ['O-48'] });

      expect(block).toMatch(
        /<cac:TaxScheme>\s*<cbc:ID>01<\/cbc:ID>\s*<cbc:Name>IVA<\/cbc:Name>/,
      );
    });

    it('un vendedor responsable de INC (O-33) declara 04 / INC', () => {
      const block = supplierBlockOf({ tax_responsibilities: ['O-33'] });

      expect(block).toMatch(
        /<cac:TaxScheme>\s*<cbc:ID>04<\/cbc:ID>\s*<cbc:Name>INC<\/cbc:Name>/,
      );
    });
  });
});
