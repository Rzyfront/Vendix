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
    document_type: '13',
    document_number: '123456789',
    legal_name: 'Proveedor No Obligado',
    address_line: 'Carrera 4 # 5-6',
    city_code: '11001',
    city_name: 'Bogota',
    department_code: '11',
    department_name: 'Bogota',
    country_code: 'CO',
    tax_regime: '2',
    tax_responsibilities: ['R-99-PN'],
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
    customer_name: seller.legal_name,
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
    expect(xml).toContain('>900123456</cbc:CompanyID>');
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
});
