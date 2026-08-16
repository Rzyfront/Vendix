import { UblCreditNoteBuilder } from './ubl-credit-note.builder';
import { ProviderInvoiceData } from '../../invoice-provider.interface';
import {
  DianCustomerData,
  DianIssuerData,
  DianInvoiceControl,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';

/**
 * The credit note reached the habilitación set with exactly ONE structural
 * rejection — `CAN01`, the missing payment group — plus the ordering rejection
 * that belongs to the test-set generator, not to this builder. That is the
 * evidence that its sequence was otherwise right, and it is why this spec pins
 * the elements a "unify the two notes" refactor would be tempted to change.
 */
describe('UblCreditNoteBuilder', () => {
  const issuer: DianIssuerData = {
    document_type: '31',
    nit: '902056589',
    nit_dv: '4',
    legal_name: 'Quickss SAS',
    address_line: 'Calle 1',
    city_code: '11001',
    city_name: 'Bogotá',
    department_code: '11',
    department_name: 'Bogotá D.C.',
    country_code: 'CO',
    postal_code: '111711',
    email: 'facturacion@quickss.co',
    tax_regime: '48',
    tax_scheme: 'O-13',
  };

  const customer: DianCustomerData = {
    document_type: 'NIT',
    document_number: '900123456',
    verification_digit: '7',
    legal_name: 'Cliente Demo SAS',
    tax_responsibilities: ['O-13'],
    person_type: 'JURIDICA',
    ciiu_code: null,
  };

  const credit_note_data: ProviderInvoiceData = {
    invoice_number: 'SETP990000180',
    invoice_type: 'credit_note',
    issue_date: '2026-08-09',
    issue_time: '10:15:30-05:00',
    currency: 'COP',
    subtotal_amount: '50000.00',
    discount_amount: '0.00',
    tax_amount: '9500.00',
    withholding_amount: '0.00',
    total_amount: '59500.00',
    payment_form: '1',
    payment_means: '10',
    notes: 'Devolución de mercancía',
    items: [
      {
        description: 'Devolución producto',
        quantity: '1.00',
        unit_price: '50000.00',
        discount_amount: '0.00',
        tax_amount: '9500.00',
        total_amount: '59500.00',
      },
    ],
    taxes: [
      {
        tax_name: 'IVA',
        tax_type: 'iva',
        tax_rate: '19.00',
        taxable_amount: '50000.00',
        tax_amount: '9500.00',
      },
    ],
  };

  const software_security: DianSoftwareSecurity = {
    software_id: 'guid-software',
    software_pin: '11111',
    software_security_code: 'c'.repeat(96),
    provider_nit: '902056589',
    provider_nit_dv: '4',
  };

  const control: DianInvoiceControl = {
    invoice_authorization: '18760000001',
    authorization_start_date: '2019-01-19',
    authorization_end_date: '2030-01-19',
    prefix: 'SETP',
    range_from: '990000000',
    range_to: '995000000',
  };

  type BuildParams = Parameters<typeof UblCreditNoteBuilder.build>[0];

  function build(overrides: Partial<BuildParams> = {}): string {
    return UblCreditNoteBuilder.build({
      credit_note_data,
      issuer,
      customer,
      software_security,
      cude: 'd'.repeat(96),
      environment: 'test',
      original_invoice_number: 'SETP990000100',
      original_invoice_cufe: 'a'.repeat(96),
      original_invoice_date: '2026-08-08',
      control,
      ...overrides,
    });
  }

  /**
   * CAN01 — «Rechazo si grupo no informado», `/CreditNote/cac:PaymentMeans`,
   * cardinality `1..N`. This was the credit note's only structural rejection in
   * the habilitación set.
   */
  it('emits cac:PaymentMeans with its three fields (CAN01)', () => {
    const xml = build();
    expect(xml).toContain('<cac:PaymentMeans>');
    expect(xml).toContain('<cbc:ID>1</cbc:ID>');
    expect(xml).toContain('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>');
    expect(xml).toContain('<cbc:PaymentDueDate>2026-08-09</cbc:PaymentDueDate>');
  });

  it('places PaymentMeans after the parties and before the tax totals', () => {
    const xml = build();
    const customer_party = xml.indexOf('<cac:AccountingCustomerParty>');
    const payment_means = xml.indexOf('<cac:PaymentMeans>');
    const tax_total = xml.indexOf('<cac:TaxTotal>');
    const totals = xml.indexOf('<cac:LegalMonetaryTotal>');
    expect(customer_party).toBeLessThan(payment_means);
    expect(payment_means).toBeLessThan(tax_total);
    expect(tax_total).toBeLessThan(totals);
  });

  /**
   * `cbc:CreditNoteTypeCode` IS defined by UBL 2.1 for `CreditNote`. The debit
   * note's equivalent is not, and removing THIS one because the debit note lost
   * its own would be a regression. The asymmetry is the point.
   */
  it('keeps cbc:CreditNoteTypeCode — UBL defines it here, unlike the debit note', () => {
    expect(build()).toContain(
      '<cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>',
    );
  });

  /**
   * CAU01 points at `/CreditNote/cac:LegalMonetaryTotal`. The debit note is the
   * exception that uses `cac:RequestedMonetaryTotal`; unifying the two breaks
   * whichever one is changed.
   */
  it('emits cac:LegalMonetaryTotal, never RequestedMonetaryTotal (CAU01)', () => {
    const xml = build();
    expect(xml).toContain('<cac:LegalMonetaryTotal>');
    expect(xml).not.toContain('RequestedMonetaryTotal');
  });

  it('publishes the note type through CustomizationID', () => {
    // 20 = nota crédito que referencia una factura electrónica; 22 = sin referencia.
    expect(build()).toContain('<cbc:CustomizationID>20</cbc:CustomizationID>');
    expect(build({ original_invoice_number: undefined })).toContain(
      '<cbc:CustomizationID>22</cbc:CustomizationID>',
    );
  });

  it('carries the numbering authorization block and the CUDE QR', () => {
    const xml = build();
    expect(xml).toContain('<sts:Prefix>SETP</sts:Prefix>');
    expect(xml).toContain('<sts:InvoiceAuthorization>18760000001');
    expect(xml).toContain(`documentkey=${'d'.repeat(96)}`);
    expect(xml).toContain('catalogo-vpfe-hab.dian.gov.co');
  });

  it('announces the key as CUDE-SHA384 for its own UUID', () => {
    const xml = build();
    const uuid_line = xml.slice(
      xml.indexOf('<cbc:UUID'),
      xml.indexOf('</cbc:UUID>'),
    );
    expect(uuid_line).toContain('schemeName="CUDE-SHA384"');
    expect(uuid_line).not.toContain('CUFE-SHA384');
  });

  it('references the original invoice with its number, CUFE and date', () => {
    const xml = build();
    const ref = xml.slice(
      xml.indexOf('<cac:BillingReference>'),
      xml.indexOf('</cac:BillingReference>'),
    );
    expect(ref).toContain('<cbc:ID>SETP990000100</cbc:ID>');
    expect(ref).toContain('schemeName="CUFE-SHA384"');
    expect(ref).toContain('<cbc:IssueDate>2026-08-08</cbc:IssueDate>');
  });

  it('carries a line-level TaxTotal — the line body is shared, not duplicated', () => {
    const xml = build();
    const line = xml.slice(
      xml.indexOf('<cac:CreditNoteLine>'),
      xml.indexOf('</cac:CreditNoteLine>'),
    );
    // Writing the line by hand instead of delegating left it without its own
    // cac:TaxTotal (rule CAS01b) on 10 of the 50 documents of an earlier set.
    expect(line).toContain('<cac:TaxTotal>');
    expect(line).toContain('<cbc:CreditedQuantity');
  });

  it('uses the production execution id and catalog in production', () => {
    const xml = build({ environment: 'production' });
    expect(xml).toContain('<cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>');
    expect(xml).toContain('catalogo-vpfe.dian.gov.co');
    expect(xml).not.toContain('vpfe-hab');
  });

  /**
   * Anexo Técnico 19 — the credit-note customer block must follow the same
   * structural rules as the invoice: NATURAL → cac:Person/FirstName/FamilyName,
   * JURIDICA → cac:PartyLegalEntity/CompanyID@schemeID=DIAN code. This is the
   * `cac:AccountingCustomerParty` side of the fix that the habilitación set
   * was missing; emitting `cac:PartyLegalEntity` for a NATURAL was the original
   * rejection path.
   */
  describe('buildCustomerParty — Anexo 19 customer branch', () => {
    it('persona natural → cac:Person + R-99-PN; cac:PartyLegalEntity ausente', () => {
      const xml = build({
        customer: {
          document_type: 'CC',
          document_number: '12345678',
          verification_digit: null,
          legal_name: null,
          first_name: 'Ana',
          last_name: 'Pérez',
          tax_responsibilities: ['R-99-PN'],
          person_type: 'NATURAL',
          ciiu_code: null,
        },
      });
      // Scope to the customer block — the issuer side also emits its own
      // cac:PartyLegalEntity unconditionally for the supplier NIT entity, so a
      // document-wide substring check would falsely match that.
      const customer_block = xml.slice(
        xml.indexOf('<cac:AccountingCustomerParty>'),
        xml.indexOf('</cac:AccountingCustomerParty>') +
          '</cac:AccountingCustomerParty>'.length,
      );
      expect(customer_block).toContain('<cac:Person>');
      expect(customer_block).toContain('<cbc:FirstName>Ana</cbc:FirstName>');
      expect(customer_block).toContain('<cbc:FamilyName>Pérez</cbc:FamilyName>');
      expect(customer_block).not.toContain('<cac:PartyLegalEntity>');
      expect(customer_block).toMatch(/TaxLevelCode[^>]*>R-99-PN</);
      expect(customer_block).toMatch(/AdditionalAccountID>2</);
    });

    it('persona jurídica → cac:PartyLegalEntity + CompanyID@schemeID=31; cac:Person ausente', () => {
      const xml = build({
        customer: {
          document_type: 'NIT',
          document_number: '900123456',
          verification_digit: '7',
          legal_name: 'Acme S.A.S',
          tax_responsibilities: ['O-13', 'O-15'],
          person_type: 'JURIDICA',
          ciiu_code: '4711',
        },
      });
      const customer_block = xml.slice(
        xml.indexOf('<cac:AccountingCustomerParty>'),
        xml.indexOf('</cac:AccountingCustomerParty>') +
          '</cac:AccountingCustomerParty>'.length,
      );
      expect(customer_block).toContain('<cac:PartyLegalEntity>');
      expect(customer_block).toMatch(
        /schemeID="7"[^>]*>900123456<\/cbc:CompanyID>/,
      );
      expect(customer_block).toContain(
        '<cbc:IndustryClassificationCode>4711</cbc:IndustryClassificationCode>',
      );
      expect(customer_block).toMatch(/TaxLevelCode[^>]*>O-13;O-15</);
      expect(customer_block).not.toContain('<cac:Person>');
    });
  });
});
