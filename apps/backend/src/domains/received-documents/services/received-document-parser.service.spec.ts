import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReceivedDocumentParserService } from './received-document-parser.service';
import { operationalValidationStatus, summarizeReceivedDocumentValidation } from './received-document-validation';

const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const CREDIT = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const ATTACHED = 'urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2';

const emailFixture = (name: string) => readFileSync(join(__dirname, '../__fixtures__/email', name), 'utf8');

function invoiceXml(options: { prefix?: string; taxes?: string; headerTaxes?: string; key?: string; headerDiscount?: string; lineDiscount?: string; lineNet?: string; taxAmount?: string; taxBase?: string; taxExclusive?: string; taxInclusive?: string; payable?: string; prepaid?: string; rounding?: string } = {}): string {
  const c = options.prefix ?? 'cac';
  const b = options.prefix ? 'basic' : 'cbc';
  const lineNet = options.lineNet ?? '100.00';
  const lineDiscount = options.lineDiscount ?? '5.00';
  const taxAmount = options.taxAmount ?? '19.00';
  const taxBase = options.taxBase ?? '100.00';
  const headerDiscount = options.headerDiscount ?? '5.00';
  const taxInclusive = options.taxInclusive ?? (Number(lineNet) + Number(taxAmount)).toFixed(2);
  const payable = options.payable ?? (Number(taxInclusive) - Number(headerDiscount)).toFixed(2);
  const tax = options.taxes ?? `<${c}:TaxTotal><${b}:TaxAmount currencyID="COP">${taxAmount}</${b}:TaxAmount><${c}:TaxSubtotal><${b}:TaxableAmount currencyID="COP">${taxBase}</${b}:TaxableAmount><${b}:TaxAmount currencyID="COP">${taxAmount}</${b}:TaxAmount><${c}:TaxCategory><${b}:Percent>19</${b}:Percent><${c}:TaxScheme><${b}:ID>01</${b}:ID><${b}:Name>IVA</${b}:Name></${c}:TaxScheme></${c}:TaxCategory></${c}:TaxSubtotal></${c}:TaxTotal>`;
  const headerTax = options.headerTaxes ?? tax;
  const prefixes = options.prefix
    ? `xmlns:${c}="${CAC}" xmlns:${b}="${CBC}"`
    : `xmlns:cac="${CAC}" xmlns:cbc="${CBC}"`;
  return `<Invoice xmlns="${INVOICE}" ${prefixes}>
    <${b}:ID>FV-2026-001</${b}:ID><${b}:UUID>${options.key ?? 'a'.repeat(96)}</${b}:UUID>
    <${b}:IssueDate>2026-09-30</${b}:IssueDate><${b}:DueDate>2026-10-30</${b}:DueDate><${b}:DocumentCurrencyCode>COP</${b}:DocumentCurrencyCode>
    <${c}:AccountingSupplierParty><${c}:Party><${c}:PartyTaxScheme><${b}:CompanyID>900123456</${b}:CompanyID></${c}:PartyTaxScheme><${c}:PartyLegalEntity><${b}:RegistrationName>Proveedor Uno</${b}:RegistrationName></${c}:PartyLegalEntity></${c}:Party></${c}:AccountingSupplierParty>
    <${c}:AccountingCustomerParty><${c}:Party><${c}:PartyTaxScheme><${b}:CompanyID>800765432</${b}:CompanyID></${c}:PartyTaxScheme><${c}:PartyLegalEntity><${b}:RegistrationName>Comprador Dos</${b}:RegistrationName></${c}:PartyLegalEntity></${c}:Party></${c}:AccountingCustomerParty>
    <${c}:InvoiceLine><${b}:ID>1</${b}:ID><${b}:InvoicedQuantity unitCode="NIU">2.5</${b}:InvoicedQuantity><${b}:LineExtensionAmount currencyID="COP">${lineNet}</${b}:LineExtensionAmount>
      <${c}:AllowanceCharge><${b}:ChargeIndicator>false</${b}:ChargeIndicator><${b}:Amount currencyID="COP">${lineDiscount}</${b}:Amount></${c}:AllowanceCharge>
      <${c}:Item><${b}:Description>Producto de prueba</${b}:Description><${c}:SellersItemIdentification><${b}:ID>SKU-1</${b}:ID></${c}:SellersItemIdentification></${c}:Item>
      <${c}:Price><${b}:PriceAmount currencyID="COP">42.00</${b}:PriceAmount><${b}:BaseQuantity unitCode="NIU">1</${b}:BaseQuantity></${c}:Price>${tax}
    </${c}:InvoiceLine>
    ${headerTax}
    <${c}:AllowanceCharge><${b}:ChargeIndicator>false</${b}:ChargeIndicator><${b}:Amount currencyID="COP">${headerDiscount}</${b}:Amount></${c}:AllowanceCharge>
    <${c}:LegalMonetaryTotal><${b}:LineExtensionAmount currencyID="COP">${lineNet}</${b}:LineExtensionAmount><${b}:TaxExclusiveAmount currencyID="COP">${options.taxExclusive ?? '100.00'}</${b}:TaxExclusiveAmount><${b}:TaxInclusiveAmount currencyID="COP">${taxInclusive}</${b}:TaxInclusiveAmount><${b}:AllowanceTotalAmount currencyID="COP">${headerDiscount}</${b}:AllowanceTotalAmount>${options.prepaid ? `<${b}:PrepaidAmount currencyID="COP">${options.prepaid}</${b}:PrepaidAmount>` : ''}${options.rounding ? `<${b}:PayableRoundingAmount currencyID="COP">${options.rounding}</${b}:PayableRoundingAmount>` : ''}<${b}:PayableAmount currencyID="COP">${payable}</${b}:PayableAmount></${c}:LegalMonetaryTotal>
  </Invoice>`;
}

describe('ReceivedDocumentParserService', () => {
  let service: ReceivedDocumentParserService;
  beforeEach(() => { service = new ReceivedDocumentParserService(); });

  it.each([
    ['invoice.xml', 'Invoice', '01', 'CUFE-SHA384'],
    ['credit-note.xml', 'CreditNote', '91', 'CUDE-SHA384'],
    ['debit-note.xml', 'DebitNote', '92', 'CUDE-SHA384'],
    ['pos-20.xml', 'Invoice', '20', 'CUDE-SHA384'],
  ])('exposes fiscal metadata and the exact commercial source without changing legacy parsing for %s', (file, root, code, scheme) => {
    const xml = emailFixture(file);
    const detailed = service.parseDetailed(xml);
    expect(detailed.normalized).toEqual(service.parse(xml));
    expect(detailed.commercial_xml).toBe(xml);
    expect(detailed.application_responses).toEqual([]);
    expect(detailed.fiscal).toEqual({
      root, profile_execution_id: '1', document_type_code: code,
      uuid: { value: detailed.normalized.document_key, scheme_id: '1', scheme_name: scheme },
      receiver_company_id: { value: '800765432', scheme_name: '31', scheme_id: '3' },
    });
    expect(detailed.normalized.validation.has_signature).toBe(false);
    if (file === 'debit-note.xml') expect(xml).not.toContain('DebitNoteTypeCode');
  });

  it('preserves actual embedded commercial and ApplicationResponse sources and container environment', () => {
    const xml = emailFixture('invoice.attached.xml');
    const detailed = service.parseDetailed(xml);
    expect(detailed.normalized).toEqual(service.parse(xml));
    expect(detailed.commercial_xml).toBe(emailFixture('invoice.xml').trim());
    expect(detailed.application_responses).toEqual([emailFixture('invoice.application-response.xml').trim()]);
    expect(detailed.fiscal.container).toEqual({
      profile_execution_id: '1', uuid: detailed.fiscal.uuid,
    });
    expect(summarizeReceivedDocumentValidation(detailed.normalized.validation).dian.status).toBe('not_checked');
    expect(detailed.normalized.validation.warnings.map(({ code }) => code)).toContain('APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED');
  });

  it('keeps an AttachedDocument without response valid for legacy parsing and returns no invented evidence', () => {
    const xml = emailFixture('attached-without-application-response.xml');
    const detailed = service.parseDetailed(xml);
    expect(detailed.application_responses).toEqual([]);
    expect(detailed.commercial_xml).toBeTruthy();
    expect(detailed.normalized).toEqual(service.parse(xml));
    expect(detailed.fiscal.container?.profile_execution_id).toBe('1');
  });

  it('retains CC and NIT identification attributes without removing digits or deriving a DV', () => {
    const cc = service.parseDetailed(emailFixture('receiver-cc-13.xml'));
    expect(cc.fiscal.receiver_company_id).toEqual({ value: '1118860776', scheme_name: '13', scheme_id: null });
    const nit = service.parseDetailed(emailFixture('receiver-nit-schemeid.xml'));
    expect(nit.fiscal.receiver_company_id).toEqual({ value: '800765432', scheme_name: '31', scheme_id: '3' });
    const appended = service.parseDetailed(emailFixture('receiver-nit-appended-dv.xml'));
    expect(appended.fiscal.receiver_company_id.value).toBe('8007654323');
    expect(appended.normalized.receiver_tax_id).toBe('8007654323');
  });

  it('extracts fiscal attributes by direct namespace children, not nested or foreign namespace lookalikes', () => {
    const xml = invoiceXml({ prefix: 'agg' }).replace('</Invoice>',
      '<basic:ProfileExecutionID>1</basic:ProfileExecutionID><basic:InvoiceTypeCode>20</basic:InvoiceTypeCode>' +
      '<agg:DocumentReference><basic:ProfileExecutionID>2</basic:ProfileExecutionID></agg:DocumentReference>' +
      '<evil:InvoiceTypeCode xmlns:evil="urn:not-ubl">05</evil:InvoiceTypeCode></Invoice>');
    expect(service.parseDetailed(xml).fiscal).toMatchObject({ profile_execution_id: '1', document_type_code: '20' });
  });

  it('preserves explicit NoteTypeCode on DebitNote for later coherent preflight instead of silently replacing it', () => {
    const xml = emailFixture('debit-note.xml').replace('</DebitNote>', '<cbc:NoteTypeCode>94</cbc:NoteTypeCode></DebitNote>');
    expect(service.parseDetailed(xml).fiscal.document_type_code).toBe('94');
    expect(service.parseDetailed(xml.replace('>94</cbc:NoteTypeCode>', '></cbc:NoteTypeCode>')).fiscal.document_type_code).toBeNull();
  });

  it('does not invent a commercial source for unsupported roots or an empty AttachedDocument', () => {
    const unsupported = service.parseDetailed('<Unknown/>');
    expect(unsupported.normalized).toEqual(service.parse('<Unknown/>'));
    expect(unsupported.commercial_xml).toBeNull();
    const attached = `<AttachedDocument xmlns="${ATTACHED}"/>`;
    const empty = service.parseDetailed(attached);
    expect(empty.normalized).toEqual(service.parse(attached));
    expect(empty.commercial_xml).toBeNull();
    expect(empty.application_responses).toEqual([]);
  });

  it('retains the same XXE and ambiguous AttachedDocument protections for detailed parsing', () => {
    expect(() => service.parseDetailed(emailFixture('xml-xxe.xml'))).toThrow(BadRequestException);
    const invoice = invoiceXml();
    const xml = `<AttachedDocument xmlns="${ATTACHED}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}">` +
      `<cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${invoice}]]></cbc:Description></cac:ExternalReference></cac:Attachment>`.repeat(2) +
      '</AttachedDocument>';
    expect(() => service.parseDetailed(xml)).toThrow(BadRequestException);
  });

  it('parses namespace-prefix variations using direct namespace children', () => {
    const result = service.parse(invoiceXml({ prefix: 'agg' }));
    expect(result.document_type).toBe('invoice');
    expect(result.issuer_name).toBe('Proveedor Uno');
    expect(result.issuer_tax_id).toBe('900123456');
    expect(result.receiver_name).toBe('Comprador Dos');
    expect(result.validation.document_key_format_valid).toBe(true);
    expect(result.taxes[0].tax_type).toBe('iva');
  });

  it('treats a structurally valid signed XML as operationally valid without verifying the signature', () => {
    const xml = invoiceXml().replace('</Invoice>',
      '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/></Invoice>');
    const parsed = service.parse(xml);
    const summary = summarizeReceivedDocumentValidation(parsed.validation);
    expect(parsed.validation.errors).toEqual([]);
    expect(parsed.validation.warnings.map((warning) => warning.code)).toContain('SIGNATURE_NOT_VERIFIED');
    expect(summary.signature.status).toBe('not_verified');
    expect(summary.dian.status).toBe('not_checked');
    expect(operationalValidationStatus(summary)).toBe('valid');
  });

  it('extracts payment condition only from unambiguous PaymentMeans ID or explicit PaymentTerms', () => {
    const withPayment = (body: string) => invoiceXml().replace('</Invoice>', `${body}</Invoice>`);
    expect(service.parse(withPayment('<cac:PaymentMeans><cbc:ID>1</cbc:ID><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode></cac:PaymentMeans>')).payment_condition).toBe('cash');
    expect(service.parse(withPayment('<cac:PaymentMeans><cbc:ID>2</cbc:ID></cac:PaymentMeans>')).payment_condition).toBe('credit');
    expect(service.parse(invoiceXml()).payment_condition).toBe('unknown');
    expect(service.parse(withPayment('<cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode></cac:PaymentMeans>')).payment_condition).toBe('unknown');
    expect(service.parse(withPayment('<cac:PaymentTerms><cbc:Note>Condición de pago: Pago a crédito</cbc:Note></cac:PaymentTerms>')).payment_condition).toBe('credit');
    expect(service.parse(withPayment('<cac:PaymentTerms><cbc:Note>Pago de contado</cbc:Note></cac:PaymentTerms>')).payment_condition).toBe('cash');
    expect(service.parse(withPayment('<cac:PaymentTerms><cbc:Note>Pago de contado a 30 días</cbc:Note></cac:PaymentTerms>')).payment_condition).toBe('unknown');
    expect(service.parse(withPayment('<cac:PaymentTerms><cbc:Note>Transferencia con descuento pronto pago 5 días</cbc:Note></cac:PaymentTerms>')).payment_condition).toBe('unknown');
    expect(service.parse(withPayment('<cac:PaymentMeans><cbc:ID>1</cbc:ID></cac:PaymentMeans><cac:PaymentTerms><cbc:Note>Descuento pronto pago 5 días</cbc:Note></cac:PaymentTerms>')).payment_condition).toBe('cash');
    expect(service.parse(withPayment('<cac:PaymentTerms><cbc:PaymentMeansID>cash</cbc:PaymentMeansID></cac:PaymentTerms>')).payment_condition).toBe('cash');
    expect(service.parse(withPayment('<cac:PaymentTerms><cbc:PaymentMeansID>pago a crédito</cbc:PaymentMeansID></cac:PaymentTerms>')).payment_condition).toBe('credit');
    expect(service.parse(withPayment('<cac:PaymentMeans><cbc:ID>1</cbc:ID></cac:PaymentMeans><cac:PaymentTerms><cbc:Note>Crédito</cbc:Note></cac:PaymentTerms>')).payment_condition).toBe('unknown');
    const conflict = service.parse(withPayment('<cac:PaymentTerms><cbc:Note>Contado</cbc:Note><cbc:Note>Crédito</cbc:Note></cac:PaymentTerms>'));
    expect(conflict.payment_condition).toBe('unknown');
    expect(conflict.validation.warnings.map((warning) => warning.code)).toContain('PAYMENT_CONDITION_AMBIGUOUS');
    const dueDateOnly = service.parse(invoiceXml());
    expect(dueDateOnly.due_date).toBe('2026-10-30');
    expect(dueDateOnly.payment_condition).toBe('unknown');
  });

  it('extracts UBL from AttachedDocument CDATA and does not trust an embedded ApplicationResponse', () => {
    const embedded = invoiceXml();
    const xml = `<AttachedDocument xmlns="${ATTACHED}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[${embedded}]]></cbc:Description></cac:ExternalReference></cac:Attachment><cac:ParentDocumentLineReference><cac:DocumentReference><cbc:ID>evidence-ref</cbc:ID><cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:ID>AR-1</cbc:ID><cbc:UUID>unverified</cbc:UUID><cac:DocumentResponse><cac:Response><cbc:ResponseCode>00</cbc:ResponseCode><cbc:Description>Texto DIAN no verificado</cbc:Description></cac:Response></cac:DocumentResponse></ApplicationResponse>]]></cbc:Description></cac:ExternalReference></cac:Attachment></cac:DocumentReference></cac:ParentDocumentLineReference></AttachedDocument>`;
    const result = service.parse(xml);
    expect(result.invoice_number).toBe('FV-2026-001');
    expect(result.validation.warnings.map((warning) => warning.code)).toContain('APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED');
    expect(result.validation.warnings.find((warning) => warning.code === 'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED')?.message).toContain('AR-1');
    expect(result.validation.warnings.find((warning) => warning.code === 'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED')?.message).toContain('ResponseCode=00');
    expect(result.validation.warnings.find((warning) => warning.code === 'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED')?.message).toContain('no se interpreta como aceptación DIAN');
  });

  it('decodes escaped embedded XML but rejects junk around the complete embedded document', () => {
    const embedded = invoiceXml();
    const escaped = embedded.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrap = (description: string) => `<AttachedDocument xmlns="${ATTACHED}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cac:Attachment><cac:ExternalReference><cbc:Description>${description}</cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;
    expect(service.parse(wrap(escaped)).invoice_number).toBe('FV-2026-001');
    expect(() => service.parse(wrap(`before ${embedded}`))).toThrow(BadRequestException);
    expect(() => service.parse(wrap(`${embedded} after`))).toThrow(BadRequestException);
  });

  it('rejects raw nested UBL elements in Description and validates the full CDATA/escaped text', () => {
    const embedded = invoiceXml();
    const escaped = embedded.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrap = (description: string) => `<AttachedDocument xmlns="${ATTACHED}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cac:Attachment><cac:ExternalReference><cbc:Description>${description}</cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;

    // A raw Invoice is parsed as real descendants; it must not disappear when
    // Description.textContent flattens those child elements to text.
    expect(() => service.parse(wrap(embedded))).toThrow(BadRequestException);
    expect(() => service.parse(wrap(`junk before ${embedded} junk after`))).toThrow(BadRequestException);

    // Encoded forms remain accepted only when the entire text value is the UBL
    // document; a prefix or suffix inside either representation is rejected.
    expect(service.parse(wrap(`<![CDATA[${embedded}]]>`)).invoice_number).toBe('FV-2026-001');
    expect(service.parse(wrap(escaped)).invoice_number).toBe('FV-2026-001');
    expect(() => service.parse(wrap(`<![CDATA[prefix ${embedded}]]>`))).toThrow(BadRequestException);
    expect(() => service.parse(wrap(`<![CDATA[${embedded} suffix]]>`))).toThrow(BadRequestException);
    expect(() => service.parse(wrap(`prefix ${escaped}`))).toThrow(BadRequestException);
    expect(() => service.parse(wrap(`${escaped} suffix`))).toThrow(BadRequestException);
  });

  it('keeps credit-note amounts positive and extracts its purchase invoice reference', () => {
    const xml = `<CreditNote xmlns="${CREDIT}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:ID>NC-4</cbc:ID><cbc:IssueDate>2026-09-30</cbc:IssueDate><cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FV-9</cbc:ID><cbc:UUID>${'b'.repeat(96)}</cbc:UUID></cac:InvoiceDocumentReference></cac:BillingReference></CreditNote>`;
    const result = service.parse(xml);
    expect(result.document_type).toBe('credit_note');
    expect(result.reference_number).toBe('FV-9');
    expect(result.reference_key).toBe('b'.repeat(96));
    expect(result.total_amount).toBe('0.00');
  });

  it('blocks negative credit-note source values instead of using abs()', () => {
    const xml = `<CreditNote xmlns="${CREDIT}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:ID>NC-NEG</cbc:ID><cbc:UUID>${'d'.repeat(96)}</cbc:UUID><cbc:IssueDate>2026-09-30</cbc:IssueDate><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode><cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="NIU">-1</cbc:CreditedQuantity><cbc:LineExtensionAmount>-10.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Producto</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount>-10.00</cbc:PriceAmount></cac:Price></cac:CreditNoteLine></CreditNote>`;
    const result = service.parse(xml);
    expect(result.document_type).toBe('credit_note');
    expect(result.items[0].quantity).toBe('0');
    expect(result.items[0].net_amount).toBe('0.00');
    expect(result.validation.errors.some((error) => error.code.startsWith('NEGATIVE_SOURCE_'))).toBe(true);
  });

  it('blocks negative source values instead of taking their absolute value, including invoice quantities', () => {
    const xml = invoiceXml()
      .replace('>2.5</cbc:InvoicedQuantity>', '>-2.5</cbc:InvoicedQuantity>')
      .replace('>100.00</cbc:LineExtensionAmount>', '>-100.00</cbc:LineExtensionAmount>')
      .replace('>42.00</cbc:PriceAmount>', '>-42.00</cbc:PriceAmount>')
      .replace('>5.00</cbc:Amount>', '>-5.00</cbc:Amount>')
      .replace('>19.00</cbc:TaxAmount>', '>-19.00</cbc:TaxAmount>')
      .replace('>114.00</cbc:PayableAmount>', '>-114.00</cbc:PayableAmount>');
    const result = service.parse(xml);
    expect(result.subtotal_amount).toBe('100.00');
    expect(result.discount_amount).toBe('5.00');
    expect(result.tax_amount).toBe('19.00');
    expect(result.total_amount).toBe('0.00');
    expect(result.items[0].quantity).toBe('0');
    expect(result.items[0].unit_price).toBe('0');
    expect(result.validation.errors.map((error) => error.code)).toContain('NEGATIVE_SOURCE_LINE_1_QUANTITY');
    expect(result.validation.errors.some((error) => error.code.startsWith('NEGATIVE_SOURCE_'))).toBe(true);
  });

  it('checks line, document discount and tax totals without subtracting prepaid amount', () => {
    const result = service.parse(invoiceXml({
      taxBase: '95.00', taxAmount: '18.05', taxExclusive: '95.00',
      taxInclusive: '118.05', headerDiscount: '5.00', payable: '113.05', prepaid: '10.00',
    }));
    expect(result.items[0]).toMatchObject({ quantity: '2.5', unit_price: '42', discount_amount: '5.00', net_amount: '100.00' });
    expect(result.subtotal_amount).toBe('100.00');
    expect(result.discount_amount).toBe('5.00');
    expect(result.tax_exclusive_amount).toBe('95.00');
    expect(result.tax_inclusive_amount).toBe('118.05');
    expect(result.prepaid_amount).toBe('10.00');
    expect(result.total_amount).toBe('113.05');
    expect(result.validation.errors).toEqual([]);
  });

  it('does not subtract a line discount twice when no header discount is declared', () => {
    const result = service.parse(invoiceXml({ headerDiscount: '0.00', payable: '119.00', prepaid: '10.00' }));
    expect(result.items[0].net_amount).toBe('100.00');
    expect(result.discount_amount).toBe('0.00');
    expect(result.tax_inclusive_amount).toBe('119.00');
    expect(result.total_amount).toBe('119.00');
    expect(result.validation.errors).toEqual([]);
  });

  it('preserves decimals, units, discounts and typed multi-tax lines', () => {
    const multiTax = `<cac:TaxTotal><cbc:TaxAmount>19.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount>100.00</cbc:TaxableAmount><cbc:TaxAmount>19.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal><cac:TaxSubtotal><cbc:TaxableAmount>20.00</cbc:TaxableAmount><cbc:TaxAmount>2.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>10</cbc:Percent><cac:TaxScheme><cbc:ID>04</cbc:ID><cbc:Name>INC</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`;
    const result = service.parse(invoiceXml({ taxes: multiTax }));
    expect(result.items[0]).toMatchObject({ quantity: '2.5', unit_code: 'NIU', unit_price: '42', discount_amount: '5.00', net_amount: '100.00' });
    expect(result.items[0].taxes.map((tax) => [tax.tax_type, tax.rate])).toEqual([['iva', '19'], ['inc', '10']]);
  });

  it.each(['99', '32', '33', '36', 'ZZ'])('marks unknown DIAN tax code %s unclassified and blocking', (code) => {
    const unknown = `<cac:TaxTotal><cac:TaxSubtotal><cbc:TaxableAmount>100</cbc:TaxableAmount><cbc:TaxAmount>1</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>1</cbc:Percent><cac:TaxScheme><cbc:ID>${code}</cbc:ID><cbc:Name>Unknown</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`;
    const result = service.parse(invoiceXml({ taxes: unknown }));
    expect(result.items[0].taxes[0].tax_type).toBe('unclassified');
    expect(result.items[0].taxes[0]).toMatchObject({ scheme_code: code, tax_name: 'Unknown' });
    expect(result.validation.errors.map((error) => error.code)).toContain('UNCLASSIFIED_TAX_SCHEME');
  });

  it('classifies DIAN scheme 34 as nominal IBUA and 35 as percentage ICUI', () => {
    const taxSubtotal = `<cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">1.00</cbc:TaxAmount><cbc:BaseUnitMeasure unitCode="ML">1000</cbc:BaseUnitMeasure><cbc:PerUnitAmount currencyID="COP">0.10</cbc:PerUnitAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>34</cbc:ID><cbc:Name>IBUA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">2.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>2</cbc:Percent><cac:TaxScheme><cbc:ID>35</cbc:ID><cbc:Name>ICUI</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
    const taxes = `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">3.00</cbc:TaxAmount>${taxSubtotal}</cac:TaxTotal>`;
    const result = service.parse(invoiceXml({
      taxes, headerTaxes: taxes, taxAmount: '3.00', taxInclusive: '103.00', payable: '98.00',
    }));
    expect(result.items[0].taxes.map((tax) => tax.tax_type)).toEqual(['ibua', 'icui']);
    expect(result.items[0].taxes[0]).toMatchObject({
      tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML',
      per_unit_amount: '0.10', base_amount: '0.00', amount: '1.00', rate: '0',
    });
    expect(result.items[0].taxes[1]).toMatchObject({ tax_basis_type: 'monetary', base_amount: '100.00', amount: '2.00', rate: '2' });
    expect(result.validation.errors).toEqual([]);
  });

  it('blocks nominal IBUA unit values that exceed DIAN two-decimal precision', () => {
    const subtotal = `<cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">1.00</cbc:TaxAmount><cbc:BaseUnitMeasure unitCode="ML">1000.000015</cbc:BaseUnitMeasure><cbc:PerUnitAmount currencyID="COP">0.100015</cbc:PerUnitAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>34</cbc:ID><cbc:Name>IBUA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
    const tax = `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">1.00</cbc:TaxAmount>${subtotal}</cac:TaxTotal>`;
    const result = service.parse(invoiceXml({
      taxes: tax, headerTaxes: tax, taxAmount: '1.00', taxInclusive: '101.00', payable: '96.00',
    }));
    expect(result.items[0].taxes[0]).toMatchObject({
      tax_type: 'ibua', tax_basis_type: 'unit',
      base_amount: '0.00', amount: '1.00',
    });
    expect(result.validation.errors.map((error) => error.code)).toContain('DECIMAL_OVERFLOW_IBUA_BASE_UNIT');
    expect(result.validation.errors.map((error) => error.code)).toContain('DECIMAL_OVERFLOW_IBUA_PER_UNIT_AMOUNT');
  });

  it('preserves valid nominal IBUA basis values at DIAN two-decimal precision', () => {
    const subtotal = `<cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">1.00</cbc:TaxAmount><cbc:BaseUnitMeasure unitCode="ML">1000.00</cbc:BaseUnitMeasure><cbc:PerUnitAmount currencyID="COP">0.10</cbc:PerUnitAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>34</cbc:ID><cbc:Name>IBUA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
    const tax = `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">1.00</cbc:TaxAmount>${subtotal}</cac:TaxTotal>`;
    const result = service.parse(invoiceXml({
      taxes: tax, headerTaxes: tax, taxAmount: '1.00', taxInclusive: '101.00', payable: '96.00',
    }));
    expect(result.items[0].taxes[0]).toMatchObject({
      tax_type: 'ibua', tax_basis_type: 'unit',
      base_quantity: '1000.00', per_unit_amount: '0.10',
      base_unit_code: 'ML', base_amount: '0.00', amount: '1.00',
    });
    expect(result.validation.errors).toEqual([]);
  });

  it('uses DIAN half-to-even rounding on each nominal IBUA line before summing', () => {
    const subtotal = `<cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount><cbc:BaseUnitMeasure unitCode="ML">0.50</cbc:BaseUnitMeasure><cbc:PerUnitAmount currencyID="COP">1.00</cbc:PerUnitAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>34</cbc:ID><cbc:Name>IBUA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
    const line = (number: number) => `<cac:InvoiceLine><cbc:ID>${number}</cbc:ID><cbc:InvoicedQuantity unitCode="NIU">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">100.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Producto ${number}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="COP">100.00</cbc:PriceAmount><cbc:BaseQuantity unitCode="NIU">1</cbc:BaseQuantity></cac:Price><cac:TaxTotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount>${subtotal}</cac:TaxTotal></cac:InvoiceLine>`;
    const parties = `<cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900123456</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Proveedor</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>800123456</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Comprador</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`;
    const xml = `<Invoice xmlns="${INVOICE}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:ID>FV-ROUND</cbc:ID><cbc:UUID>${'e'.repeat(96)}</cbc:UUID><cbc:IssueDate>2026-09-30</cbc:IssueDate><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>${parties}${line(1)}${line(2)}${line(3)}<cac:TaxTotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount>${subtotal.repeat(3)}</cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">300.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="COP">300.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="COP">300.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="COP">300.00</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;
    const result = service.parse(xml);
    expect(result.items.map((item) => item.taxes[0].amount)).toEqual(['0.00', '0.00', '0.00']);
    expect(result.tax_amount).toBe('0.00');
    expect(result.validation.errors).toEqual([]);
  });

  it.each([
    ['0.01', '114.01'],
    ['-0.01', '113.99'],
  ])('applies declared payable rounding %s while leaving prepaid informational', (rounding, payable) => {
    const result = service.parse(invoiceXml({ rounding, payable, prepaid: '10.00' }));
    expect(result.payable_rounding_amount).toBe(rounding);
    expect(result.prepaid_amount).toBe('10.00');
    expect(result.total_amount).toBe(payable);
    expect(result.validation.errors).toEqual([]);
  });

  it('blocks a TaxTotal whose amount differs from its subtotals', () => {
    const result = service.parse(invoiceXml().replace('<cbc:TaxAmount currencyID="COP">19.00</cbc:TaxAmount><cac:TaxSubtotal>', '<cbc:TaxAmount currencyID="COP">18.00</cbc:TaxAmount><cac:TaxSubtotal>'));
    expect(result.validation.errors.map((error) => error.code)).toContain('TAX_TOTAL_SUBTOTAL_MISMATCH');
  });

  it('blocks header-to-line tax mismatches beyond one cent', () => {
    const result = service.parse(invoiceXml().replace('<cbc:TaxAmount currencyID="COP">19.00</cbc:TaxAmount><cac:TaxCategory>', '<cbc:TaxAmount currencyID="COP">19.02</cbc:TaxAmount><cac:TaxCategory>'));
    expect(result.validation.errors.map((error) => error.code)).toContain('HEADER_LINE_TAX_MISMATCH');
  });

  it('blocks zero BaseQuantity, negative tax rates and Decimal precision overflow', () => {
    const zeroBase = service.parse(invoiceXml().replace('<cbc:BaseQuantity unitCode="NIU">1</cbc:BaseQuantity>', '<cbc:BaseQuantity unitCode="NIU">0</cbc:BaseQuantity>'));
    expect(zeroBase.validation.errors.map((error) => error.code)).toContain('BASE_QUANTITY_MUST_BE_POSITIVE');

    const negativeRate = service.parse(invoiceXml().replace('<cbc:Percent>19</cbc:Percent>', '<cbc:Percent>-19</cbc:Percent>'));
    expect(negativeRate.validation.errors.some((error) => error.code.startsWith('NEGATIVE_SOURCE_'))).toBe(true);

    const overAmount = service.parse(invoiceXml().replace('<cbc:PayableAmount currencyID="COP">114.00</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="COP">10000000000000.00</cbc:PayableAmount>'));
    expect(overAmount.validation.errors.some((error) => error.code.startsWith('DECIMAL_OVERFLOW_'))).toBe(true);

    const overQuantity = service.parse(invoiceXml().replace('unitCode="NIU">2.5</cbc:InvoicedQuantity>', 'unitCode="NIU">123456789012</cbc:InvoicedQuantity>'));
    expect(overQuantity.validation.errors).toContainEqual(expect.objectContaining({ code: 'DECIMAL_OVERFLOW_LINE_1_QUANTITY' }));

    const overPrice = service.parse(invoiceXml().replace('<cbc:PriceAmount currencyID="COP">42.00</cbc:PriceAmount>', '<cbc:PriceAmount currencyID="COP">1000000000.00</cbc:PriceAmount>'));
    expect(overPrice.validation.errors).toContainEqual(expect.objectContaining({ code: 'DECIMAL_OVERFLOW_LINE_1_PRICE' }));
  });

  it('uses RequestedMonetaryTotal for DebitNote and preserves reference number', () => {
    const xml = `<DebitNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:ID>ND-8</cbc:ID><cbc:UUID>${'c'.repeat(96)}</cbc:UUID><cbc:IssueDate>2026-09-30</cbc:IssueDate><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode><cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FV-8</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900123456</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Proveedor</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>800123456</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Comprador</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty><cac:DebitNoteLine><cbc:ID>1</cbc:ID><cbc:DebitedQuantity unitCode="NIU">1</cbc:DebitedQuantity><cbc:LineExtensionAmount>10.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Servicio</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount>10.00</cbc:PriceAmount><cbc:BaseQuantity>1</cbc:BaseQuantity></cac:Price></cac:DebitNoteLine><cac:RequestedMonetaryTotal><cbc:LineExtensionAmount>10.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount>10.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>10.00</cbc:TaxInclusiveAmount><cbc:PayableAmount>10.00</cbc:PayableAmount></cac:RequestedMonetaryTotal></DebitNote>`;
    const result = service.parse(xml);
    expect(result.document_type).toBe('debit_note');
    expect(result.reference_number).toBe('FV-8');
    expect(result.subtotal_amount).toBe('10.00');
    expect(result.tax_inclusive_amount).toBe('10.00');
    expect(result.total_amount).toBe('10.00');
  });

  it('returns blocking validation for missing party identities and invalid/missing key', () => {
    const result = service.parse(invoiceXml({ key: 'not-a-dian-key' }).replace(/<cac:Accounting(?:Supplier|Customer)Party>[\s\S]*?<\/cac:Accounting(?:Supplier|Customer)Party>/g, ''));
    const codes = result.validation.errors.map((error) => error.code);
    expect(codes).toContain('INVALID_DOCUMENT_KEY_FORMAT');
    expect(codes).toContain('MISSING_ISSUER_TAX_ID');
    expect(codes).toContain('MISSING_RECEIVER_TAX_ID');
    expect(result.validation.document_key_format_valid).toBe(false);
  });

  it.each([
    ['malformed XML', '<Invoice><cbc:ID>x</Invoice>'],
    ['multiple roots', '<Invoice/><Invoice/>'],
    ['trailing text', '<Invoice/>unexpected'],
    ['DOCTYPE', '<!DOCTYPE x [<!ENTITY x "y">]><Invoice/>'],
    ['external entity declaration', '<!ENTITY x SYSTEM "file:///etc/passwd"><Invoice/>'],
  ])('rejects %s', (_label, xml) => {
    expect(() => service.parse(xml)).toThrow(BadRequestException);
  });

  it('rejects XML beyond byte-size and structural limits', () => {
    expect(() => service.parse(`<Invoice>${' '.repeat(10 * 1024 * 1024)}</Invoice>`)).toThrow(BadRequestException);
    const nested = `${'<x>'.repeat(65)}z${'</x>'.repeat(65)}`;
    expect(() => service.parse(`<Invoice>${nested}</Invoice>`)).toThrow(BadRequestException);
  });
});
