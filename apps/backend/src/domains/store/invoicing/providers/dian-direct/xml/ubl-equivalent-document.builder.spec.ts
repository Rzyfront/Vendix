import { UblEquivalentDocumentBuilder } from './ubl-equivalent-document.builder';
import { UblInvoiceBuilder } from './ubl-invoice.builder';
import { ProviderInvoiceData } from '../../invoice-provider.interface';
import {
  DianCustomerData,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';

/**
 * The five header values below are what distinguish a POS equivalent document from
 * a sales invoice. Each is a rejection rule of its own annex, and a wrong one does
 * not degrade gracefully: it emits the wrong FISCAL DOCUMENT against a numbering
 * range authorized for the other, which cannot be undone once the DIAN accepts it.
 */
describe('UblEquivalentDocumentBuilder', () => {
  /**
   * These fixtures are TYPED on purpose. An `as any` fixture compiles with any
   * field name, so the builder silently reads `undefined` and the monetary blocks
   * come out as zeros while every structural assertion still passes — which is
   * exactly how a totals bug reaches the DIAN looking green locally.
   */
  const issuer: DianIssuerData = {
    document_type: '31',
    nit: '900123456',
    nit_dv: '1',
    legal_name: 'Tienda Demo SAS',
    address_line: 'Calle 1',
    city_code: '11001',
    city_name: 'Bogotá',
    department_code: '11',
    department_name: 'Bogotá D.C.',
    country_code: 'CO',
    postal_code: '111711',
    email: 'facturacion@tiendademo.co',
    tax_regime: '48',
    tax_scheme: 'O-13',
  };

  const customer: DianCustomerData = {
    document_type: '13',
    document_number: '222222222222',
    legal_name: 'Consumidor final',
    tax_responsibilities: ['R-99-PN'],
  };

  const invoice_data: ProviderInvoiceData = {
    invoice_number: 'POS1',
    invoice_type: 'pos_equivalent',
    issue_date: '2026-08-04',
    issue_time: '10:15:30-05:00',
    currency: 'COP',
    subtotal_amount: '1000.00',
    discount_amount: '0.00',
    tax_amount: '190.00',
    withholding_amount: '0.00',
    total_amount: '1190.00',
    payment_form: '1',
    payment_means: '10',
    items: [
      {
        description: 'Producto',
        quantity: '1.00',
        unit_price: '1000.00',
        discount_amount: '0.00',
        tax_amount: '190.00',
        total_amount: '1000.00',
      },
    ],
    taxes: [
      {
        tax_name: 'IVA',
        tax_type: 'iva',
        tax_rate: '19.00',
        taxable_amount: '1000.00',
        tax_amount: '190.00',
      },
    ],
  };

  const software_security: DianSoftwareSecurity = {
    software_id: 'guid-software',
    software_pin: '11111',
    software_security_code: 'c'.repeat(96),
    provider_nit: '900123456',
    provider_nit_dv: '1',
  };

  type BuildParams = Parameters<typeof UblEquivalentDocumentBuilder.build>[0];

  function build(overrides: Partial<BuildParams> = {}): string {
    return UblEquivalentDocumentBuilder.build({
      invoice_data,
      issuer,
      customer,
      software_security,
      cude: 'd'.repeat(96),
      environment: 'test',
      ...overrides,
    });
  }

  it('declares the POS equivalent-document profile', () => {
    const xml = build();
    expect(xml).toContain(
      '<cbc:ProfileID>DIAN 2.1: Documento Equivalente POS</cbc:ProfileID>',
    );
    expect(xml).not.toContain('Factura Electrónica de Venta');
  });

  it('emits InvoiceTypeCode 20 and CustomizationID 10', () => {
    const xml = build();
    expect(xml).toContain('<cbc:InvoiceTypeCode>20</cbc:InvoiceTypeCode>');
    // Numeral 16.4.1: single operation mode, shared by document types 20/25/35/40/45/50.
    expect(xml).toContain('<cbc:CustomizationID>10</cbc:CustomizationID>');
  });

  /**
   * `@schemeName` tells the DIAN WHICH key to recompute. The two keys differ in
   * their 14th field (ClTec vs Software-PIN), so announcing the wrong algorithm
   * makes the document unverifiable even when the hash itself is right.
   */
  it('announces the key as CUDE-SHA384, never CUFE', () => {
    const xml = build();
    expect(xml).toContain('schemeName="CUDE-SHA384"');
    expect(xml).not.toContain('CUFE-SHA384');
  });

  it('carries the QR of the equivalent document, built from its CUDE', () => {
    const xml = build();
    expect(xml).toContain(
      `documentkey=${'d'.repeat(96)}`,
    );
    // Habilitación environment must not publish the production catalog host.
    expect(xml).toContain('catalogo-vpfe-hab.dian.gov.co');
  });

  it('reuses the builder for the credit adjustment note', () => {
    const xml = build({ document_type_code: '94' });
    expect(xml).toContain('<cbc:InvoiceTypeCode>94</cbc:InvoiceTypeCode>');
    // Still the equivalent-document profile: the note belongs to the same annex.
    expect(xml).toContain('Documento Equivalente POS');
  });

  it('keeps the monetary blocks identical to the sales invoice', () => {
    const equivalent = build();
    const invoice = UblInvoiceBuilder.build({
      invoice_data,
      issuer,
      customer,
      software_security,
      cufe: 'd'.repeat(96),
      environment: 'test',
    });

    // The shared blocks come from UblCommonBuilder, so the totals must match
    // byte-for-byte — that is what makes this a header difference and not a fork.
    const totals = (xml: string) =>
      xml.slice(
        xml.indexOf('<cac:LegalMonetaryTotal>'),
        xml.indexOf('</cac:LegalMonetaryTotal>'),
      );
    expect(totals(equivalent)).toBe(totals(invoice));
    expect(totals(equivalent)).toContain('1190.00');
  });

  it('defaults the payment due date to the issue date', () => {
    const xml = build();
    // A POS ticket is settled on the spot; it carries no credit terms.
    expect(xml).toContain('<cbc:PaymentDueDate>2026-08-04</cbc:PaymentDueDate>');
  });

  it('uses the production execution id and catalog in production', () => {
    const xml = build({ environment: 'production' });
    expect(xml).toContain('<cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>');
    expect(xml).toContain('catalogo-vpfe.dian.gov.co');
    expect(xml).not.toContain('vpfe-hab');
  });
});
