import { create } from 'xmlbuilder2';
import { UblCommonBuilder, UblDocumentLine } from './ubl-common.builder';
import { UblEquivalentDocumentBuilder } from './ubl-equivalent-document.builder';
import { DianTotalsValidator } from './dian-totals.validator';
import { UBL_NAMESPACES } from './xml-namespaces';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
} from '../../invoice-provider.interface';
import {
  DianCustomerData,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { DianDirectProvider } from '../dian-direct.provider';
import { dianLineExtensionTotal } from '../../../utils/dian-money.util';

/**
 * Domicilio de restaurante con INC 8 % INCLUIDO: la línea Envío declara su
 * propio `cac:TaxTotal` 04 8 % sobre la base despejada.
 *
 * Documento del plan: plato 50.000 + INC 4.000; domicilio 15.000 = 13.888,89
 * + INC 1.111,11. Cabecera: base 63.888,89 · INC 5.111,11 · total 69.000.
 *
 * Antes: Envío sin TaxTotal (d04ff9c01), base 65.000 si se sumaba el bruto
 * como línea no gravada, INC 4.000. CUFE: `ValImp2` sube 1.111,11, `ValFac`
 * baja lo mismo y `ValTot` no cambia.
 *
 * Todo pasa por `DianTotalsValidator` (FAU04 / FAU06 / FAX07), que sólo ve los
 * dos lados emitidos a la vez.
 */
describe('UBL — la línea Envío con INC incluido', () => {
  const INC_HEADER: ProviderInvoiceTax = {
    tax_name: 'INC',
    tax_type: 'inc',
    tax_rate: '8.00',
    taxable_amount: '63888.89',
    tax_amount: '5111.11',
  } as ProviderInvoiceTax;

  const platoTax: ProviderInvoiceTax = {
    ...INC_HEADER,
    taxable_amount: '50000.00',
    tax_amount: '4000.00',
  };
  const envioTax: ProviderInvoiceTax = {
    ...INC_HEADER,
    taxable_amount: '13888.89',
    tax_amount: '1111.11',
  };

  const lines = (): UblDocumentLine[] => [
    {
      description: 'Plato',
      quantity: '1',
      unit_price: '50000.00',
      discount_amount: '0.00',
      tax_amount: '4000.00',
      total_amount: '54000.00',
      taxes: [{ ...platoTax }],
    } as UblDocumentLine,
    {
      description: 'Envío',
      quantity: '1',
      unit_price: '13888.89',
      discount_amount: '0.00',
      tax_amount: '1111.11',
      total_amount: '15000.00',
      taxes: [{ ...envioTax }],
    } as UblDocumentLine,
  ];

  const expectClean = (xml: string) => {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  };

  const invoiceLines = (xml: string) =>
    [...xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/g)].map(
      (m) => m[1],
    );

  const monetaryTotals = (xml: string) => {
    const totals: Record<string, string> = {};
    for (const m of xml.matchAll(
      /<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/g,
    )) {
      for (const n of m[1].matchAll(
        /<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g,
      )) {
        totals[n[1]] = n[2];
      }
    }
    return totals;
  };

  it('factura: el Envío emite TaxTotal 04 8 % y el documento cuadra (FAU04/FAU06/FAX07)', () => {
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
    const items = lines();
    UblCommonBuilder.buildTaxTotals(doc, [INC_HEADER], 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(
      doc,
      { tax_amount: '5111.11', items, taxes: [INC_HEADER], discount_amount: '0.00' },
      'COP',
    );
    UblCommonBuilder.buildInvoiceLines(doc, items, [INC_HEADER], 'COP');
    const xml = doc.end({ prettyPrint: false });

    const [, envio] = invoiceLines(xml);
    expect(envio).toContain('<cac:TaxTotal>');
    expect(envio).toContain('<cbc:ID>04</cbc:ID>');
    expect(envio).toContain('<cbc:Percent>8.00</cbc:Percent>');
    expect(envio).toContain(
      '<cbc:TaxableAmount currencyID="COP">13888.89</cbc:TaxableAmount>',
    );
    expect(envio).toContain(
      '<cbc:TaxAmount currencyID="COP">1111.11</cbc:TaxAmount>',
    );
    expect(UblCommonBuilder.inheritsNothingFromHeader(items[1], [INC_HEADER])).toBe(
      false,
    );

    const totals = monetaryTotals(xml);
    expect(totals.LineExtensionAmount).toBe('63888.89');
    expect(totals.TaxExclusiveAmount).toBe('63888.89');
    expect(totals.TaxInclusiveAmount).toBe('69000.00');
    expect(totals.PayableAmount).toBe('69000.00');
    expectClean(xml);
  });

  it('CUFE: ValImp2 incluye el INC del envío, ValFac baja lo mismo y ValTot no cambia', () => {
    const calculateTaxAmounts = (DianDirectProvider.prototype as any)
      .calculateTaxAmounts as (data: Partial<ProviderInvoiceData>) => {
      iva: string;
      inc: string;
      ica: string;
    };
    const now = calculateTaxAmounts.call({}, { taxes: [platoTax, envioTax] });
    expect(now).toEqual({ iva: '0.00', inc: '5111.11', ica: '0.00' });
    expect(dianLineExtensionTotal(lines())).toBe('63888.89');

    // Antes: Envío no gravado por el bruto.
    const before = calculateTaxAmounts.call({}, { taxes: [platoTax] });
    expect(before.inc).toBe('4000.00');
    expect(
      dianLineExtensionTotal([
        lines()[0],
        { ...lines()[1], unit_price: '15000.00', tax_amount: '0.00' },
      ]),
    ).toBe('65000.00');
    // ValTot = ValFac + ValImp: 63.888,89 + 5.111,11 = 65.000 + 4.000 = 69.000.
  });

  describe('documento equivalente POS', () => {
    const issuer: DianIssuerData = {
      document_type: '31',
      nit: '900123456',
      nit_dv: '1',
      legal_name: 'Restaurante Demo SAS',
      address_line: 'Calle 1',
      city_code: '11001',
      city_name: 'Bogotá',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      country_code: 'CO',
      postal_code: '111711',
      email: 'facturacion@restaurante.co',
      tax_regime: '49',
      tax_scheme: 'R-99-PN',
    };
    const customer: DianCustomerData = {
      document_type: 'CC',
      document_number: '222222222222',
      verification_digit: null,
      legal_name: 'Consumidor final',
      tax_responsibilities: ['R-99-PN'],
      person_type: 'NATURAL',
      ciiu_code: null,
    };
    const software_security: DianSoftwareSecurity = {
      software_id: 'guid-software',
      software_pin: '11111',
      software_security_code: 'c'.repeat(96),
      provider_nit: '900123456',
      provider_nit_dv: '1',
    };
    const invoice_data: ProviderInvoiceData = {
      invoice_number: 'POS1',
      invoice_type: 'pos_equivalent',
      issue_date: '2026-09-22',
      issue_time: '12:00:00-05:00',
      currency: 'COP',
      subtotal_amount: '63888.89',
      discount_amount: '0.00',
      tax_amount: '5111.11',
      withholding_amount: '0.00',
      total_amount: '69000.00',
      payment_form: '1',
      payment_means: '10',
      items: lines() as any,
      taxes: [INC_HEADER],
    };

    it('el Envío declara su INC y el documento cuadra', () => {
      const xml = UblEquivalentDocumentBuilder.build({
        invoice_data,
        issuer,
        customer,
        software_security,
        cude: 'd'.repeat(96),
        environment: 'test',
      });
      const [, envio] = invoiceLines(xml);
      expect(envio).toContain('<cbc:ID>04</cbc:ID>');
      expect(envio).toContain(
        '<cbc:TaxAmount currencyID="COP">1111.11</cbc:TaxAmount>',
      );
      const totals = monetaryTotals(xml);
      expect(totals.TaxExclusiveAmount).toBe('63888.89');
      expect(totals.PayableAmount).toBe('69000.00');
      expectClean(xml);
    });
  });
});
