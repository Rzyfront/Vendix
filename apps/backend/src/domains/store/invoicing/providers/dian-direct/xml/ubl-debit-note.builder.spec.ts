import { UblDebitNoteBuilder } from './ubl-debit-note.builder';
import { UblCreditNoteBuilder } from './ubl-credit-note.builder';
import { ProviderInvoiceData } from '../../invoice-provider.interface';
import {
  DianCustomerData,
  DianIssuerData,
  DianInvoiceControl,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';

/**
 * The debit note is the document type this codebase got most wrong, and every
 * defect had the same shape: it was written as a credit note with a renamed
 * root. UBL 2.1 gives `DebitNote` its own sequence, and the DIAN rejected all 10
 * debit notes of the habilitación set on the two places where that sequence
 * differs — four of the rejections traceable to a single misnamed element.
 *
 * These assertions exist so the mirror assumption cannot come back. Each one
 * names the rejection rule it prevents, because without the rule code the
 * assertion reads like a style preference and someone "simplifies" it away.
 */
describe('UblDebitNoteBuilder', () => {
  /**
   * Typed fixtures on purpose: an `as any` fixture compiles with any field name,
   * so the builder reads `undefined`, the monetary blocks come out as zeros, and
   * every structural assertion still passes. That is exactly how a totals bug
   * reaches the DIAN looking green locally.
   */
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

  /**
   * Amounts taken from the habilitación set generator: subtotal 50000, IVA 19%,
   * total 59500. `lineExtensionDecimal` is `qty × unit_price − discount`, so the
   * header's `LineExtensionAmount` must come out 50000.00 — the same value the
   * CUDE hashes as `ValFac`.
   */
  const debit_note_data: ProviderInvoiceData = {
    invoice_number: 'SETP990000164',
    invoice_type: 'debit_note',
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
    notes: 'Intereses de mora',
    items: [
      {
        description: 'Ajuste por intereses',
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

  type BuildParams = Parameters<typeof UblDebitNoteBuilder.build>[0];

  function build(overrides: Partial<BuildParams> = {}): string {
    return UblDebitNoteBuilder.build({
      debit_note_data,
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
   * ZB01 — «Fallo en el esquema XML del archivo». UBL 2.1 does not define
   * `cbc:DebitNoteTypeCode` anywhere in the `DebitNote` sequence, so emitting it
   * fails schema validation before the DIAN reads a single business value. Every
   * other rejection on the debit note was invisible behind this one.
   */
  it('does not emit cbc:DebitNoteTypeCode — UBL has no such element (ZB01)', () => {
    const xml = build();
    expect(xml).not.toContain('DebitNoteTypeCode');
    // '92' is the debit note's document type. It must not reappear as a bare
    // element under another name either.
    expect(xml).not.toContain('<cbc:DebitNoteTypeCode>92</cbc:DebitNoteTypeCode>');
  });

  it('publishes the note type through CustomizationID instead', () => {
    // 30 = nota débito que referencia una factura electrónica; 32 = sin referencia.
    expect(build()).toContain('<cbc:CustomizationID>30</cbc:CustomizationID>');
    expect(build({ original_invoice_number: undefined })).toContain(
      '<cbc:CustomizationID>32</cbc:CustomizationID>',
    );
  });

  it('keeps the header sequence UBL expects around the removed element', () => {
    const xml = build();
    // The elements the ZB01 message listed as valid in that position must still
    // appear, and in order: removing `DebitNoteTypeCode` must not have shifted
    // anything else.
    const order = ['<cbc:IssueTime>', '<cbc:Note>', '<cbc:DocumentCurrencyCode>'];
    const positions = order.map((tag) => xml.indexOf(tag));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  /**
   * DAN01 — «Rechazo si grupo no informado», `/DebitNote/cac:PaymentMeans`,
   * cardinality `1..N`. The invoice, the equivalent document and the support
   * document all emitted this group; both notes emitted none.
   */
  it('emits cac:PaymentMeans with its three fields (DAN01)', () => {
    const xml = build();
    expect(xml).toContain('<cac:PaymentMeans>');
    expect(xml).toContain('<cbc:ID>1</cbc:ID>');
    expect(xml).toContain('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>');
    // DAN04 makes the due date mandatory on credit sales, so it is always sent;
    // with no due date it falls back to the issue date.
    expect(xml).toContain('<cbc:PaymentDueDate>2026-08-09</cbc:PaymentDueDate>');
  });

  it('places PaymentMeans after the parties and before the tax totals', () => {
    const xml = build();
    // UBL fixes `AccountingCustomerParty → PaymentMeans → TaxTotal → totals`.
    // A group in the wrong position is a schema failure, not a warning.
    const customer_party = xml.indexOf('<cac:AccountingCustomerParty>');
    const payment_means = xml.indexOf('<cac:PaymentMeans>');
    const tax_total = xml.indexOf('<cac:TaxTotal>');
    const totals = xml.indexOf('<cac:RequestedMonetaryTotal>');
    expect(customer_party).toBeLessThan(payment_means);
    expect(payment_means).toBeLessThan(tax_total);
    expect(tax_total).toBeLessThan(totals);
  });

  /**
   * DAU01 — `/DebitNote/cac:RequestedMonetaryTotal`, `1..1`. This one element
   * name carried four rejections: the CUDE reads `ValFac` and `ValTot` through
   * it (DAD06) and the three arithmetic rules read their operands through it
   * (DAU02, DAU04, DAU06). With `LegalMonetaryTotal` in its place the DIAN
   * resolves every one of those XPaths to nothing.
   */
  it('emits cac:RequestedMonetaryTotal and never LegalMonetaryTotal (DAU01)', () => {
    const xml = build();
    expect(xml).toContain('<cac:RequestedMonetaryTotal>');
    expect(xml).not.toContain('LegalMonetaryTotal');
  });

  it('exposes the two amounts the CUDE hashes at their DIAN XPath (DAD06)', () => {
    const xml = build();
    const totals = xml.slice(
      xml.indexOf('<cac:RequestedMonetaryTotal>'),
      xml.indexOf('</cac:RequestedMonetaryTotal>'),
    );
    // ValFac = .../cbc:LineExtensionAmount, ValTot = .../cbc:PayableAmount.
    // These are the values CufeCalculator receives as total_before_tax and
    // total_amount; if the two ever disagree the CUDE cannot be reproduced.
    expect(totals).toContain('<cbc:LineExtensionAmount currencyID="COP">50000.00');
    expect(totals).toContain('<cbc:PayableAmount currencyID="COP">59500.00');
  });

  it('keeps the arithmetic identical to the credit note — only the envelope differs', () => {
    const debit = build();
    const credit = UblCreditNoteBuilder.build({
      credit_note_data: debit_note_data,
      issuer,
      customer,
      software_security,
      cude: 'd'.repeat(96),
      environment: 'test',
      original_invoice_number: 'SETP990000100',
      original_invoice_cufe: 'a'.repeat(96),
      original_invoice_date: '2026-08-08',
      control,
    });

    const body = (xml: string, tag: string) =>
      xml.slice(xml.indexOf(`<cac:${tag}>`) + `<cac:${tag}>`.length, xml.indexOf(`</cac:${tag}>`));

    // Same numbers, different wrapper. This is what proves the four DAU/DAD
    // rejections were a naming defect and not an arithmetic one: the function
    // that produced these figures is the one that backed 30 accepted invoices.
    expect(body(debit, 'RequestedMonetaryTotal')).toBe(
      body(credit, 'LegalMonetaryTotal'),
    );
  });

  /**
   * The asymmetry itself is the contract. Asserting it from one place is what
   * stops a future "unify the two notes" refactor from reintroducing both bugs.
   */
  it('differs from the credit note in exactly the two places UBL differs', () => {
    const debit = build();
    const credit = UblCreditNoteBuilder.build({
      credit_note_data: debit_note_data,
      issuer,
      customer,
      software_security,
      cude: 'd'.repeat(96),
      environment: 'test',
      control,
    });

    // 1. The credit note DOES define its type code element; the debit note does not.
    expect(credit).toContain('<cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>');
    expect(debit).not.toContain('TypeCode>92<');

    // 2. Each note's totals group, asserted on BOTH sides. Checking only the
    //    credit side let a mutation that reverted the debit note to
    //    `LegalMonetaryTotal` pass this test while four others caught it — the
    //    name promised an asymmetry it was only half verifying.
    expect(credit).toContain('<cac:LegalMonetaryTotal>');
    expect(credit).not.toContain('RequestedMonetaryTotal');
    expect(debit).toContain('<cac:RequestedMonetaryTotal>');
    expect(debit).not.toContain('LegalMonetaryTotal');

    // And they agree everywhere else that matters: both carry the payment group.
    expect(credit).toContain('<cac:PaymentMeans>');
    expect(debit).toContain('<cac:PaymentMeans>');
  });

  it('carries the numbering authorization block and the CUDE QR', () => {
    const xml = build();
    // Without sts:Prefix the DIAN loses the right-hand side of FAB10a and
    // rejects the whole cluster; the note goes through the same resolver as the
    // invoice, so the block must be present here too.
    expect(xml).toContain('<sts:Prefix>SETP</sts:Prefix>');
    expect(xml).toContain('<sts:InvoiceAuthorization>18760000001');
    expect(xml).toContain(`documentkey=${'d'.repeat(96)}`);
    expect(xml).toContain('catalogo-vpfe-hab.dian.gov.co');
  });

  it('announces the key as CUDE-SHA384, never CUFE, for its own UUID', () => {
    const xml = build();
    const uuid_line = xml.slice(xml.indexOf('<cbc:UUID'), xml.indexOf('</cbc:UUID>'));
    // The CUFE of the referenced invoice also appears in the document, inside
    // BillingReference — so the assertion has to be scoped to the note's own UUID.
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

  /**
   * Same defect as the credit note, different catalog: `cbc:ResponseCode` was
   * the literal `'2'`, so a debit note for interest on arrears DECLARED
   * «Gastos por cobrar». Table 13.2.5 has FOUR concepts, not the five of the
   * credit note — the `'5'` that is valid there does not exist here.
   */
  it('declares the note concept it was given, not a fixed code', () => {
    const xml = build({
      debit_note_data: { ...debit_note_data, note_concept_code: '1' },
    });
    const discrepancy = xml.slice(
      xml.indexOf('<cac:DiscrepancyResponse>'),
      xml.indexOf('</cac:DiscrepancyResponse>'),
    );
    expect(discrepancy).toContain('<cbc:ResponseCode>1</cbc:ResponseCode>');
  });

  it('falls back to 2 when the note carries no concept (pre-column notes)', () => {
    const xml = build();
    const discrepancy = xml.slice(
      xml.indexOf('<cac:DiscrepancyResponse>'),
      xml.indexOf('</cac:DiscrepancyResponse>'),
    );
    expect(discrepancy).toContain('<cbc:ResponseCode>2</cbc:ResponseCode>');
  });

  it('uses the production execution id and catalog in production', () => {
    const xml = build({ environment: 'production' });
    expect(xml).toContain('<cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>');
    expect(xml).toContain('catalogo-vpfe.dian.gov.co');
    expect(xml).not.toContain('vpfe-hab');
  });

  /**
   * Anexo Técnico 19 — debit note uses the same customer builder; the
   * structural branch (`cac:Person` vs `cac:PartyLegalEntity`) applies
   * identically. Both branches must coexist across invoice, the two notes,
   * the equivalent document and the support document.
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
      const customer_block = xml.slice(
        xml.indexOf('<cac:AccountingCustomerParty>'),
        xml.indexOf('</cac:AccountingCustomerParty>') +
          '</cac:AccountingCustomerParty>'.length,
      );
      expect(customer_block).toContain('<cac:Person>');
      expect(customer_block).toContain('<cbc:FirstName>Ana</cbc:FirstName>');
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
