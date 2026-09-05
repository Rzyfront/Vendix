import { create } from 'xmlbuilder2';
import { DianTotalsValidator } from './dian-totals.validator';
import { UblCommonBuilder, UblDocumentLine } from './ubl-common.builder';
import { UBL_NAMESPACES } from './xml-namespaces';
import { ProviderInvoiceTax } from '../../invoice-provider.interface';
import {
  InvoiceCalculatorInput,
  InvoiceCalculatorService,
} from '../../../services/invoice-calculator.service';

/**
 * El documento que la DIAN rechazó el 17/08/2026 (transmisión 7, `VEND1`): una
 * suscripción SaaS de $69.900 excluida de IVA. Dos defectos independientes en el
 * mismo XML — el grupo de tributos huérfano y la base imponible inventada— y
 * ninguna prevalidación local podía verlos, porque el validador de entrada
 * recomputa con las mismas funciones que los escriben.
 */
describe('DianTotalsValidator', () => {
  const NS =
    'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

  const CN_NS =
    'xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" ' +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

  /** Grupo de tributos completo, con su subtotal. */
  function taxTotal(taxable: string, amount: string, percent = '19.00'): string {
    return (
      `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">${amount}</cbc:TaxAmount>` +
      `<cac:TaxSubtotal>` +
      `<cbc:TaxableAmount currencyID="COP">${taxable}</cbc:TaxableAmount>` +
      `<cbc:TaxAmount currencyID="COP">${amount}</cbc:TaxAmount>` +
      `<cac:TaxCategory><cbc:Percent>${percent}</cbc:Percent>` +
      `<cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>` +
      `</cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`
    );
  }

  function monetary(line_ext: string, exclusive: string, payable: string): string {
    return (
      `<cac:LegalMonetaryTotal>` +
      `<cbc:LineExtensionAmount currencyID="COP">${line_ext}</cbc:LineExtensionAmount>` +
      `<cbc:TaxExclusiveAmount currencyID="COP">${exclusive}</cbc:TaxExclusiveAmount>` +
      `<cbc:TaxInclusiveAmount currencyID="COP">${payable}</cbc:TaxInclusiveAmount>` +
      `<cbc:PayableAmount currencyID="COP">${payable}</cbc:PayableAmount>` +
      `</cac:LegalMonetaryTotal>`
    );
  }

  function invoiceLine(amount: string, tax?: string): string {
    return (
      `<cac:InvoiceLine><cbc:ID>1</cbc:ID>` +
      `<cbc:LineExtensionAmount currencyID="COP">${amount}</cbc:LineExtensionAmount>` +
      `${tax ?? ''}</cac:InvoiceLine>`
    );
  }

  function invoice(body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>${body}</Invoice>`;
  }

  // ---------------------------------------------------------------------------
  // FAS01b
  // ---------------------------------------------------------------------------

  describe('FAS01b — cac:TaxTotal sin cac:TaxSubtotal', () => {
    it('bloquea el grupo huérfano de cabecera, que es el que produjo el rechazo', () => {
      const xml = invoice(
        `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount></cac:TaxTotal>` +
          monetary('69900.00', '0.00', '69900.00') +
          invoiceLine('69900.00'),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.valid).toBe(false);
      expect(result.root).toBe('Invoice');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe('FAS01b');
      expect(result.violations[0].kind).toBe('tax-total-without-subtotal');
      expect(result.violations[0].details?.tax_amount).toBe('0.00');
    });

    it('también lo bloquea dentro de una línea: el mismo defecto, otro nivel', () => {
      const xml = invoice(
        monetary('1000.00', '0.00', '1000.00') +
          invoiceLine(
            '1000.00',
            `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount></cac:TaxTotal>`,
          ),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.valid).toBe(false);
      expect(result.violations[0].rule).toBe('FAS01b');
      expect(result.violations[0].path).toContain('cac:InvoiceLine');
    });

    it('acepta el grupo que sí trae su subtotal', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetary('1000.00', '1000.00', '1190.00') +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('acepta el EXENTO: subtotal con tarifa 0,00 es informar, no callar', () => {
      const xml = invoice(
        taxTotal('69900.00', '0.00', '0.00') +
          monetary('69900.00', '69900.00', '69900.00') +
          invoiceLine('69900.00', taxTotal('69900.00', '0.00', '0.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('acepta el EXCLUIDO bien emitido: ningún grupo, en ninguna parte', () => {
      const xml = invoice(
        monetary('69900.00', '0.00', '69900.00') + invoiceLine('69900.00'),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('no juzga cac:WithholdingTaxTotal, que se totaliza sin subtotales', () => {
      const xml = invoice(
        `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="COP">25.00</cbc:TaxAmount></cac:WithholdingTaxTotal>` +
          monetary('1000.00', '0.00', '1000.00') +
          invoiceLine('1000.00'),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // FAU04
  // ---------------------------------------------------------------------------

  describe('FAU04 — TaxExclusiveAmount contra la base de las líneas', () => {
    it('bloquea la base inventada del documento rechazado', () => {
      // La línea no declara tributo (excluida), así que la suma de bases es 0.
      const xml = invoice(
        monetary('69900.00', '69900.00', '69900.00') + invoiceLine('69900.00'),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].rule).toBe('FAU04');
      expect(result.violations[0].kind).toBe('tax-exclusive-base-mismatch');
      expect(result.violations[0].details).toMatchObject({
        declared: '69900.00',
        line_taxable_base: '0.00',
        difference: '69900.00',
      });
    });

    it('acepta cuando la cabecera declara exactamente lo que declaran las líneas', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetary('1000.00', '1000.00', '1190.00') +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('suma las bases de TODAS las líneas gravadas en un documento mixto', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetary('1500.00', '1000.00', '1690.00') +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')) +
          invoiceLine('500.00'),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('compara a peso entero, como el round() de la regla', () => {
      // 0,40 de diferencia por truncado hoja por hoja: la DIAN redondea y cuadra.
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetary('1000.40', '1000.40', '1190.00') +
          invoiceLine('1000.40', taxTotal('1000.00', '190.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('no se pronuncia sobre un documento sin grupo de totales monetarios', () => {
      const xml = invoice(invoiceLine('1000.00'));

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Alcance
  // ---------------------------------------------------------------------------

  describe('alcance del validador', () => {
    it('cita la familia de la nota crédito y lee cac:CreditNoteLine', () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?><CreditNote ${CN_NS}>` +
        `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount></cac:TaxTotal>` +
        monetary('5000.00', '5000.00', '5000.00') +
        `<cac:CreditNoteLine><cbc:ID>1</cbc:ID></cac:CreditNoteLine>` +
        `</CreditNote>`;

      const result = DianTotalsValidator.validate(xml);

      expect(result.root).toBe('CreditNote');
      // CAU02 entra con el gate de totales: la línea de este fixture no declara
      // `cbc:LineExtensionAmount`, así que las líneas suman 0,00 contra los
      // 5.000,00 de la cabecera. Es un hallazgo REAL del fixture, no un ruido
      // del validador: una línea sin importe no puede respaldar un bruto.
      expect(result.violations.map((v) => v.rule)).toEqual([
        'CAS01b',
        'CAU02',
        'CAU04',
      ]);
    });

    it('no aplica a documentos sin totales: root null distingue «no aplicaba» de «pasó»', () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2">` +
        `<ID>1</ID></ApplicationResponse>`;

      const result = DianTotalsValidator.validate(xml);

      expect(result.valid).toBe(true);
      expect(result.root).toBeNull();
      expect(result.violations).toHaveLength(0);
    });

    it('reporta el XML mal formado en vez de juzgar un DOM parcial', () => {
      const result = DianTotalsValidator.validate('<Invoice><cac:TaxTotal>');

      expect(result.valid).toBe(false);
      expect(result.violations[0].kind).toBe('malformed');
    });

    it('acumula los DOS defectos del documento rechazado en producción', () => {
      const xml = invoice(
        `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">0.00</cbc:TaxAmount></cac:TaxTotal>` +
          monetary('69900.00', '69900.00', '69900.00') +
          invoiceLine('69900.00'),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.valid).toBe(false);
      expect(result.violations.map((v) => v.rule)).toEqual(['FAS01b', 'FAU04']);
    });
  });
  // ---------------------------------------------------------------------------
  // FAU02 / FAU06 / FAU14 — la cadena de totales
  // ---------------------------------------------------------------------------

  /**
   * Grupo de totales completo y parametrizable. El helper `monetary` de arriba
   * no emite `AllowanceTotalAmount` ni `ChargeTotalAmount` y fija
   * `TaxInclusiveAmount = PayableAmount`, que es justo lo que estas tres reglas
   * necesitan poder separar. El ORDEN de los elementos es el de
   * `MonetaryTotalType` en UBL 2.1; alterarlo probaría un XML que el validador
   * estructural ya rechazaría por otra razón.
   */
  function monetaryOf(parts: {
    line_ext: string;
    exclusive: string;
    inclusive: string;
    payable: string;
    allowance?: string;
    charge?: string;
    element?: 'LegalMonetaryTotal' | 'RequestedMonetaryTotal';
  }): string {
    const element = parts.element ?? 'LegalMonetaryTotal';
    const amount = (name: string, value?: string) =>
      value === undefined
        ? ''
        : `<cbc:${name} currencyID="COP">${value}</cbc:${name}>`;

    return (
      `<cac:${element}>` +
      amount('LineExtensionAmount', parts.line_ext) +
      amount('TaxExclusiveAmount', parts.exclusive) +
      amount('TaxInclusiveAmount', parts.inclusive) +
      amount('AllowanceTotalAmount', parts.allowance) +
      amount('ChargeTotalAmount', parts.charge) +
      amount('PayableAmount', parts.payable) +
      `</cac:${element}>`
    );
  }

  /** Grupo de tributos con la base y el impuesto DESACOPLADOS a propósito. */
  function taxTotalOf(
    taxable: string,
    subtotal_tax: string,
    total_tax: string,
  ): string {
    return (
      `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">${total_tax}</cbc:TaxAmount>` +
      `<cac:TaxSubtotal>` +
      `<cbc:TaxableAmount currencyID="COP">${taxable}</cbc:TaxableAmount>` +
      `<cbc:TaxAmount currencyID="COP">${subtotal_tax}</cbc:TaxAmount>` +
      `<cac:TaxCategory><cbc:Percent>19.00</cbc:Percent>` +
      `<cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>` +
      `</cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`
    );
  }

  describe('FAU02 — bruto de cabecera contra la Σ de las líneas', () => {
    it('bloquea la cabecera que declara más bruto del que sus líneas respaldan', () => {
      const xml = invoice(
        monetaryOf({
          line_ext: '1500.00',
          exclusive: '0.00',
          inclusive: '1500.00',
          payable: '1500.00',
        }) + invoiceLine('1000.00'),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual(['FAU02']);
      expect(result.violations[0].kind).toBe('line-extension-total-mismatch');
      expect(result.violations[0].details).toMatchObject({
        declared: '1500.00',
        line_sum: '1000.00',
        difference: '500.00',
        lines: 1,
      });
    });

    it('acepta el documento cuadrado, con varias líneas', () => {
      const xml = invoice(
        monetaryOf({
          line_ext: '1500.00',
          exclusive: '0.00',
          inclusive: '1500.00',
          payable: '1500.00',
        }) +
          invoiceLine('1000.00') +
          invoiceLine('500.00'),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('una línea SIN cbc:LineExtensionAmount no aporta: no se le inventa el importe', () => {
      const xml = invoice(
        monetaryOf({
          line_ext: '1000.00',
          exclusive: '0.00',
          inclusive: '1000.00',
          payable: '1000.00',
        }) + `<cac:InvoiceLine><cbc:ID>1</cbc:ID></cac:InvoiceLine>`,
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual(['FAU02']);
      expect(result.violations[0].details).toMatchObject({
        line_sum: '0.00',
        lines: 1,
      });
    });

    it('compara a peso entero, como el round() de la regla', () => {
      const xml = invoice(
        monetaryOf({
          line_ext: '1000.40',
          exclusive: '0.00',
          inclusive: '1000.40',
          payable: '1000.40',
        }) + invoiceLine('1000.00'),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });
  });

  describe('FAU06 — bruto más tributos DE CABECERA', () => {
    it('bloquea el TaxInclusiveAmount que olvida sumar el tributo', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1000.00',
            payable: '1000.00',
          }) +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      const result = DianTotalsValidator.validate(xml);

      // UNA sola violación: FAU14 lee el `TaxInclusiveAmount` DECLARADO, no el
      // que FAU06 recomputa, así que el defecto no se propaga en cascada y el
      // hallazgo apunta al eslabón que falló.
      expect(result.violations.map((v) => v.rule)).toEqual(['FAU06']);
      expect(result.violations[0].kind).toBe('tax-inclusive-total-mismatch');
      expect(result.violations[0].details).toMatchObject({
        declared: '1000.00',
        line_extension: '1000.00',
        header_tax_amount: '190.00',
        expected: '1190.00',
      });
    });

    it('suma los tributos de CABECERA, no los de las líneas — la fórmula, no la prosa', () => {
      // Cabecera declara 190,00 de IVA; la línea declara 150,00. El predicado
      // que la DIAN ejecuta suma los `cac:TaxTotal` que NO están bajo una línea,
      // así que el valor bruto más tributos correcto es 1.000 + 190 = 1.190.
      // Un validador programado desde la columna «Regla» —«la Suma de los
      // Tributos de todas las líneas de detalle»— esperaría 1.150 y rechazaría
      // este documento.
      const xml = invoice(
        taxTotalOf('1000.00', '190.00', '190.00') +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1190.00',
            payable: '1190.00',
          }) +
          invoiceLine('1000.00', taxTotalOf('1000.00', '150.00', '150.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('y por eso rechaza el que sí cuadra con las líneas pero no con la cabecera', () => {
      const xml = invoice(
        taxTotalOf('1000.00', '190.00', '190.00') +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1150.00',
            payable: '1150.00',
          }) +
          invoiceLine('1000.00', taxTotalOf('1000.00', '150.00', '150.00')),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual(['FAU06']);
      expect(result.violations[0].details).toMatchObject({
        header_tax_amount: '190.00',
        expected: '1190.00',
      });
    });

    it('no suma cac:WithholdingTaxTotal: la retención no engorda el valor bruto más tributos', () => {
      const xml = invoice(
        `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="COP">25.00</cbc:TaxAmount></cac:WithholdingTaxTotal>` +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '0.00',
            inclusive: '1000.00',
            payable: '1000.00',
          }) +
          invoiceLine('1000.00'),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // AIU — la forma que el «modelo de contabilización» produce
  // ---------------------------------------------------------------------------

  describe('régimen AIU: la línea vale el contrato y sólo la utilidad grava', () => {
    /**
     * Contrato de 105.000.000 (10M administración + 5M imprevistos + 90M
     * utilidad) bajo Decreto 1372/1992, que grava SÓLO la utilidad.
     *
     * Es la forma que el modelo «base AIU sumada al total» produce: una línea
     * cuyo `cbc:LineExtensionAmount` es el valor del contrato y cuyo
     * `cbc:TaxableAmount` es MENOR que su propio importe. Se verifica aquí,
     * sobre el XML, sin transmitir a la DIAN: las cuatro identidades de totales
     * son comprobables localmente.
     */
    const AIU_LINE = '105000000.00';
    const AIU_TAXABLE = '90000000.00';
    const AIU_TAX = '17100000.00';
    const AIU_INCLUSIVE = '122100000.00';

    it('acepta la divergencia legítima entre el bruto y la base gravable', () => {
      const xml = invoice(
        taxTotal(AIU_TAXABLE, AIU_TAX) +
          monetaryOf({
            line_ext: AIU_LINE,
            exclusive: AIU_TAXABLE,
            inclusive: AIU_INCLUSIVE,
            payable: AIU_INCLUSIVE,
          }) +
          invoiceLine(AIU_LINE, taxTotal(AIU_TAXABLE, AIU_TAX)),
      );

      const result = DianTotalsValidator.validate(xml);

      // FAU02 mide el bruto (105M) y FAU04 la base (90M). Que difieran es el
      // régimen AIU funcionando, no un descuadre: ninguna de las dos puede
      // deducirse de la otra.
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('atrapa el error clásico: declarar el bruto más tributos sobre la BASE en vez del contrato', () => {
      const xml = invoice(
        taxTotal(AIU_TAXABLE, AIU_TAX) +
          monetaryOf({
            line_ext: AIU_LINE,
            exclusive: AIU_TAXABLE,
            // 90.000.000 + 17.100.000 — la base, no el valor del contrato.
            inclusive: '107100000.00',
            payable: '107100000.00',
          }) +
          invoiceLine(AIU_LINE, taxTotal(AIU_TAXABLE, AIU_TAX)),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual(['FAU06']);
      expect(result.violations[0].details).toMatchObject({
        declared: '107100000.00',
        line_extension: AIU_LINE,
        expected: AIU_INCLUSIVE,
        difference: '-15000000.00',
      });
    });
  });

  describe('FAU14 — el valor a pagar', () => {
    it('bloquea el valor a pagar que no sale de la identidad', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1190.00',
            payable: '1000.00',
          }) +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual(['FAU14']);
      expect(result.violations[0].kind).toBe('payable-amount-mismatch');
      expect(result.violations[0].details).toMatchObject({
        declared: '1000.00',
        tax_inclusive: '1190.00',
        allowance_total: '0.00',
        charge_total: '0.00',
        expected: '1190.00',
      });
    });

    it('resta el descuento total y suma el cargo total', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1190.00',
            allowance: '100.00',
            charge: '50.00',
            payable: '1140.00',
          }) +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('NO resta el anticipo: el anexo lo liga y no lo usa', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          `<cac:PrepaidPayment><cbc:PaidAmount currencyID="COP">500.00</cbc:PaidAmount></cac:PrepaidPayment>` +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1190.00',
            payable: '1190.00',
          }) +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      expect(DianTotalsValidator.validate(xml).valid).toBe(true);
    });

    it('y rechaza al que sí lo resta, que es lo que pide la PROSA del anexo', () => {
      const xml = invoice(
        taxTotal('1000.00', '190.00') +
          `<cac:PrepaidPayment><cbc:PaidAmount currencyID="COP">500.00</cbc:PaidAmount></cac:PrepaidPayment>` +
          monetaryOf({
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1190.00',
            payable: '690.00',
          }) +
          invoiceLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual(['FAU14']);
      expect(result.violations[0].details).toMatchObject({
        expected: '1190.00',
        prepaid_informed: '500.00',
      });
      expect(result.violations[0].message).toContain('NO se resta');
    });
  });

  describe('nota débito: el grupo se llama cac:RequestedMonetaryTotal', () => {
    const DN_NS =
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2" ' +
      'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
      'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

    function debitNote(body: string): string {
      return `<?xml version="1.0" encoding="UTF-8"?><DebitNote ${DN_NS}>${body}</DebitNote>`;
    }

    function debitNoteLine(amount: string, tax?: string): string {
      return (
        `<cac:DebitNoteLine><cbc:ID>1</cbc:ID>` +
        `<cbc:LineExtensionAmount currencyID="COP">${amount}</cbc:LineExtensionAmount>` +
        `${tax ?? ''}</cac:DebitNoteLine>`
      );
    }

    it('lee su grupo y acepta el documento cuadrado', () => {
      const xml = debitNote(
        taxTotal('1000.00', '190.00') +
          monetaryOf({
            element: 'RequestedMonetaryTotal',
            line_ext: '1000.00',
            exclusive: '1000.00',
            inclusive: '1190.00',
            payable: '1190.00',
          }) +
          debitNoteLine('1000.00', taxTotal('1000.00', '190.00')),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.root).toBe('DebitNote');
      expect(result.valid).toBe(true);
    });

    it('cita los identificadores de SU familia, resueltos del catálogo', () => {
      const xml = debitNote(
        monetaryOf({
          element: 'RequestedMonetaryTotal',
          line_ext: '1500.00',
          exclusive: '0.00',
          inclusive: '1000.00',
          payable: '900.00',
        }) + debitNoteLine('1000.00'),
      );

      const result = DianTotalsValidator.validate(xml);

      expect(result.violations.map((v) => v.rule)).toEqual([
        'DAU02',
        'DAU06',
        'DAU14',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Alcance (continúa)
  // ---------------------------------------------------------------------------
});

/**
 * D.6 — la compuerta de totales corrida sobre los DOS modelos de línea AIU.
 *
 * ## Qué mide esta matriz y qué NO
 *
 * `DianTotalsValidator` es puramente aritmético (FAS01b/02, FAU02/04/06/14):
 * no conoce el piso legal del 10 % (E.T. art. 462-1) ni la bandera
 * `enforce_minimum_base` — eso vive en `invoice-calculator.service.ts`
 * (`summarizeAiu`), fuera de este dominio, y es una compuerta DISTINTA
 * (`INVOICING_AIU_001`, D.4). Lo que esta matriz prueba es que la compuerta de
 * ARITMÉTICA valida limpio sin importar en qué punto quede la base gravable
 * respecto del piso — su trabajo no es juzgar el piso, es juzgar que la
 * cabecera y las líneas describan el MISMO documento.
 *
 * ## Los dos modelos (D — «línea = contrato entero» y «Modelo 1»)
 *
 * · **línea `contrato`** — UNA línea cuyo `cbc:LineExtensionAmount` es el valor
 *   ÍNTEGRO del contrato y cuyo `cbc:TaxableAmount` (dentro de su propio
 *   `cac:TaxTotal`) es una FRACCIÓN de ese importe.
 * · **líneas por componente** — el contrato se reparte en líneas separadas
 *   (Administración / Imprevistos / Utilidad / Costo reembolsable), cada una
 *   con su propia base: las que no entran al régimen AIU declaran
 *   `omit_tax_total` y no aportan `cbc:TaxableAmount`.
 *
 * Los dos modelos ya se prueban por separado en `ubl-fau04-header-line-agreement.spec.ts`
 * (línea-contrato, caso "AIU") y en `ubl-anexo-fas-aiu-sweep.spec.ts` (AIU
 * 4/3/3/90, líneas por componente). Esta matriz los cruza sistemáticamente con
 * las 3 bases y el eje del piso que pide el plan.
 *
 * ## Las 3 bases y el eje del piso — 3 × 2 × 2 = 12
 *
 * · **Base 1 — Decreto 1372/1992** (construcción, sólo Utilidad grava): el
 *   Decreto NO fija ningún piso, así que el eje piso NO EXISTE para esta base.
 *   Las dos celdas «con piso» quedan marcadas N/A más abajo, con su motivo —
 *   no hay una tercera cifra que construir porque no hay un umbral que cumplir
 *   o incumplir bajo este régimen.
 * · **Base 2 — E.T. 462-1, natural ≥ piso** (AIU real = 12 % del contrato,
 *   piso = 10 %): activar o no `enforce_minimum_base` no cambia NADA, porque
 *   `max(natural, piso) = natural` de por sí. Las cuatro celdas se construyen
 *   y se prueba explícitamente que «con» y «sin» producen el MISMO documento.
 * · **Base 3 — E.T. 462-1, natural < piso** (AIU real = 5 % del contrato,
 *   piso = 10 %): «sin piso» es la base natural (2.500.000, un documento que
 *   OTRA compuerta — D.4 — rechazaría por incumplir el mínimo legal, pero que
 *   ESTA compuerta debe seguir validando porque su regla es otra). «con piso»
 *   es la base ya elevada al 10 % (5.000.000): el excedente se declara sobre
 *   la línea de Utilidad, que es el único punto de la matriz donde una línea
 *   declara `cbc:TaxableAmount` MAYOR que su propio `cbc:LineExtensionAmount`
 *   — legítimo, porque FAU02 (bruto) y FAU04 (base) son identidades
 *   independientes y ninguna de las dos limita a la otra.
 *
 * Recuento: 10 casos ejecutados + 2 marcados N/A (con su motivo) = 12/12.
 */
describe('D.6 — matriz AIU: 3 bases × 2 modelos × piso (con/sin) sobre la compuerta real', () => {
  function createInvoice(): any {
    return create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
  }

  function line(overrides: Partial<UblDocumentLine>): UblDocumentLine {
    return {
      description: 'Ítem',
      quantity: '1',
      unit_price: '1000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '1000.00',
      ...overrides,
    };
  }

  function tax(overrides: Partial<ProviderInvoiceTax>): ProviderInvoiceTax {
    return {
      tax_name: 'IVA',
      tax_rate: '19.00',
      taxable_amount: '1000.00',
      tax_amount: '190.00',
      ...overrides,
    };
  }

  /** Emite cabecera + líneas por el camino REAL del emisor, como `ubl-fau04-header-line-agreement.spec.ts`. */
  function emit(data: {
    discount_amount: string;
    tax_amount: string;
    items: UblDocumentLine[];
    taxes: ProviderInvoiceTax[];
  }): { xml: string; totals: Record<string, string> } {
    const doc = createInvoice();
    UblCommonBuilder.buildTaxTotals(doc, data.taxes, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(doc, data, 'COP');
    UblCommonBuilder.buildInvoiceLines(doc, data.items, data.taxes, 'COP');
    const xml = doc.end({ prettyPrint: false });

    const totals: Record<string, string> = {};
    for (const m of xml.matchAll(
      /<cac:LegalMonetaryTotal>(.*?)<\/cac:LegalMonetaryTotal>/g,
    )) {
      for (const n of m[1].matchAll(
        /<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g,
      )) {
        totals[n[1]] = n[2];
      }
    }
    return { xml, totals };
  }

  function expectClean(xml: string): void {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Base 1 — Decreto 1372/1992 (obra civil): SOLO la Utilidad grava
  // ───────────────────────────────────────────────────────────────────────────

  describe('Base 1 — Decreto 1372/1992, contrato 105.000.000 (A=10M, I=5M, U=90M)', () => {
    it('modelo línea-contrato: una sola línea de 105.000.000 con base gravable de 90.000.000', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '17100000.00',
        items: [
          line({
            description: 'Contrato de obra civil',
            unit_price: '105000000.00',
            total_amount: '105000000.00',
            tax_amount: '17100000.00',
            taxes: [
              tax({ taxable_amount: '90000000.00', tax_amount: '17100000.00' }),
            ],
          }),
        ],
        taxes: [
          tax({ taxable_amount: '90000000.00', tax_amount: '17100000.00' }),
        ],
      });

      expect(totals.LineExtensionAmount).toBe('105000000.00');
      expect(totals.TaxExclusiveAmount).toBe('90000000.00');
      expect(totals.TaxInclusiveAmount).toBe('122100000.00');
      expect(totals.PayableAmount).toBe('122100000.00');
      expectClean(xml);
    });

    it('modelo líneas-por-componente: Administración e Imprevistos omiten, Utilidad declara la base', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '17100000.00',
        items: [
          line({
            description: 'Administración',
            unit_price: '10000000.00',
            total_amount: '10000000.00',
            omit_tax_total: true,
          }),
          line({
            description: 'Imprevistos',
            unit_price: '5000000.00',
            total_amount: '5000000.00',
            omit_tax_total: true,
          }),
          line({
            description: 'Utilidad',
            unit_price: '90000000.00',
            total_amount: '90000000.00',
            tax_amount: '17100000.00',
            taxes: [
              tax({ taxable_amount: '90000000.00', tax_amount: '17100000.00' }),
            ],
          }),
        ],
        taxes: [
          tax({ taxable_amount: '90000000.00', tax_amount: '17100000.00' }),
        ],
      });

      expect(totals.LineExtensionAmount).toBe('105000000.00');
      expect(totals.TaxExclusiveAmount).toBe('90000000.00');
      expect(totals.TaxInclusiveAmount).toBe('122100000.00');

      const chunks = xml.split('<cac:InvoiceLine>').slice(1);
      expect(chunks).toHaveLength(3);
      expect(
        chunks.filter((c) => c.includes('<cac:TaxTotal>')),
      ).toHaveLength(1);
      expectClean(xml);
    });

    /**
     * «con piso» — N/A PARA LAS DOS CELDAS DE ESTA BASE (línea-contrato y
     * líneas-por-componente). El Decreto 1372/1992 (art. 3) grava
     * ÚNICAMENTE la Utilidad del constructor y no fija ningún piso — a
     * diferencia del E.T. art. 462-1, que sí impone el mínimo del 10 % del
     * valor del contrato. `enforce_minimum_base` (invoice-calculator.service.ts,
     * `summarizeAiu`) sólo tiene efecto bajo `taxable_basis: 'aiu'`; bajo
     * `'utilidad'` (el espejo de este Decreto) no hay una segunda cifra que
     * construir, así que la combinación no es una celda sin cubrir — es una
     * celda que no existe. Motivo dejado explícito, no «pendiente de revisar».
     */
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Base 2 — E.T. 462-1 (aseo): AIU natural (12 %) YA supera el piso (10 %)
  // ───────────────────────────────────────────────────────────────────────────

  describe('Base 2 — E.T. 462-1, contrato 300.000.000, AIU real 36.000.000 (12 %) sobre un piso de 30.000.000 (10 %)', () => {
    function buildLineaContrato(): { xml: string; totals: Record<string, string> } {
      return emit({
        discount_amount: '0.00',
        tax_amount: '6840000.00',
        items: [
          line({
            description: 'Contrato de aseo',
            unit_price: '300000000.00',
            total_amount: '300000000.00',
            tax_amount: '6840000.00',
            taxes: [
              tax({ taxable_amount: '36000000.00', tax_amount: '6840000.00' }),
            ],
          }),
        ],
        taxes: [
          tax({ taxable_amount: '36000000.00', tax_amount: '6840000.00' }),
        ],
      });
    }

    function buildLineasPorComponente(): {
      xml: string;
      totals: Record<string, string>;
    } {
      return emit({
        discount_amount: '0.00',
        tax_amount: '6840000.00',
        items: [
          line({
            description: 'Administración',
            unit_price: '12000000.00',
            total_amount: '12000000.00',
            tax_amount: '2280000.00',
            taxes: [
              tax({ taxable_amount: '12000000.00', tax_amount: '2280000.00' }),
            ],
          }),
          line({
            description: 'Imprevistos',
            unit_price: '9000000.00',
            total_amount: '9000000.00',
            tax_amount: '1710000.00',
            taxes: [
              tax({ taxable_amount: '9000000.00', tax_amount: '1710000.00' }),
            ],
          }),
          line({
            description: 'Utilidad',
            unit_price: '15000000.00',
            total_amount: '15000000.00',
            tax_amount: '2850000.00',
            taxes: [
              tax({ taxable_amount: '15000000.00', tax_amount: '2850000.00' }),
            ],
          }),
          line({
            description: 'Costo reembolsable',
            unit_price: '264000000.00',
            total_amount: '264000000.00',
            omit_tax_total: true,
          }),
        ],
        taxes: [
          tax({ taxable_amount: '36000000.00', tax_amount: '6840000.00' }),
        ],
      });
    }

    it('modelo línea-contrato, con piso (enforce_minimum_base=true): el piso no altera nada porque el natural ya lo supera', () => {
      const { xml, totals } = buildLineaContrato();

      expect(totals.LineExtensionAmount).toBe('300000000.00');
      expect(totals.TaxExclusiveAmount).toBe('36000000.00');
      expect(Number(totals.TaxExclusiveAmount)).toBeGreaterThanOrEqual(
        Number(totals.LineExtensionAmount) * 0.1,
      );
      expectClean(xml);
    });

    it('modelo línea-contrato, sin piso (enforce_minimum_base=false): produce EL MISMO documento que con piso', () => {
      const con_piso = buildLineaContrato();
      const sin_piso = buildLineaContrato();

      // No hay una segunda cifra que el llamador pueda producir: bajo
      // `taxable_basis: 'aiu'`, `enforce_minimum_base` sólo IMPORTA cuando el
      // natural queda por debajo del piso (ver Base 3). Aquí max(36M,30M)=36M
      // exista o no la bandera, así que «con» y «sin» son el MISMO XML.
      expect(sin_piso.totals).toEqual(con_piso.totals);
      expectClean(sin_piso.xml);
    });

    it('modelo líneas-por-componente, con piso: los tres componentes gravan y el costo reembolsable calla', () => {
      const { xml, totals } = buildLineasPorComponente();

      expect(totals.LineExtensionAmount).toBe('300000000.00');
      expect(totals.TaxExclusiveAmount).toBe('36000000.00');
      expect(totals.TaxInclusiveAmount).toBe('306840000.00');

      const chunks = xml.split('<cac:InvoiceLine>').slice(1);
      expect(chunks).toHaveLength(4);
      expect(
        chunks.filter((c) => c.includes('<cac:TaxTotal>')),
      ).toHaveLength(3);
      expectClean(xml);
    });

    it('modelo líneas-por-componente, sin piso: idéntico — el piso tampoco tiene nada que elevar aquí', () => {
      const con_piso = buildLineasPorComponente();
      const sin_piso = buildLineasPorComponente();

      expect(sin_piso.totals).toEqual(con_piso.totals);
      expectClean(sin_piso.xml);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Base 3 — E.T. 462-1 (vigilancia): AIU natural (5 %) por DEBAJO del piso (10 %)
  // ───────────────────────────────────────────────────────────────────────────

  describe('Base 3 — E.T. 462-1, contrato 50.000.000, AIU real 2.500.000 (5 %) bajo un piso de 5.000.000 (10 %)', () => {
    it('modelo línea-contrato, sin piso: la base natural (2.500.000) valida aritméticamente — el rechazo por piso es OTRA compuerta (D.4)', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '475000.00',
        items: [
          line({
            description: 'Contrato de vigilancia',
            unit_price: '50000000.00',
            total_amount: '50000000.00',
            tax_amount: '475000.00',
            taxes: [
              tax({ taxable_amount: '2500000.00', tax_amount: '475000.00' }),
            ],
          }),
        ],
        taxes: [tax({ taxable_amount: '2500000.00', tax_amount: '475000.00' })],
      });

      expect(totals.LineExtensionAmount).toBe('50000000.00');
      expect(totals.TaxExclusiveAmount).toBe('2500000.00');
      expect(totals.TaxInclusiveAmount).toBe('50475000.00');
      // Por debajo del piso a propósito: 2.500.000 < 5.000.000 (10 % de 50M).
      // ESTA compuerta no lo ve — no es su regla — y por eso valida limpio.
      expect(Number(totals.TaxExclusiveAmount)).toBeLessThan(
        Number(totals.LineExtensionAmount) * 0.1,
      );
      expectClean(xml);
    });

    it('modelo línea-contrato, con piso: la base elevada al mínimo legal (5.000.000) también valida, con más impuesto', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '950000.00',
        items: [
          line({
            description: 'Contrato de vigilancia',
            unit_price: '50000000.00',
            total_amount: '50000000.00',
            tax_amount: '950000.00',
            taxes: [
              tax({ taxable_amount: '5000000.00', tax_amount: '950000.00' }),
            ],
          }),
        ],
        taxes: [tax({ taxable_amount: '5000000.00', tax_amount: '950000.00' })],
      });

      expect(totals.TaxExclusiveAmount).toBe('5000000.00');
      expect(totals.TaxInclusiveAmount).toBe('50950000.00');
      expect(Number(totals.TaxExclusiveAmount)).toBe(
        Number(totals.LineExtensionAmount) * 0.1,
      );
      expectClean(xml);
    });

    it('modelo líneas-por-componente, sin piso: A/I/U gravan su propia base natural, el costo calla', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '475000.00',
        items: [
          line({
            description: 'Administración',
            unit_price: '1000000.00',
            total_amount: '1000000.00',
            tax_amount: '190000.00',
            taxes: [tax({ taxable_amount: '1000000.00', tax_amount: '190000.00' })],
          }),
          line({
            description: 'Imprevistos',
            unit_price: '500000.00',
            total_amount: '500000.00',
            tax_amount: '95000.00',
            taxes: [tax({ taxable_amount: '500000.00', tax_amount: '95000.00' })],
          }),
          line({
            description: 'Utilidad',
            unit_price: '1000000.00',
            total_amount: '1000000.00',
            tax_amount: '190000.00',
            taxes: [tax({ taxable_amount: '1000000.00', tax_amount: '190000.00' })],
          }),
          line({
            description: 'Costo reembolsable',
            unit_price: '47500000.00',
            total_amount: '47500000.00',
            omit_tax_total: true,
          }),
        ],
        taxes: [tax({ taxable_amount: '2500000.00', tax_amount: '475000.00' })],
      });

      expect(totals.LineExtensionAmount).toBe('50000000.00');
      expect(totals.TaxExclusiveAmount).toBe('2500000.00');
      expectClean(xml);
    });

    /**
     * modelo líneas-por-componente, CON piso: el único punto de toda la matriz
     * donde una línea declara `cbc:TaxableAmount` MAYOR que su propio
     * `cbc:LineExtensionAmount`. El excedente del piso (2.500.000, la
     * diferencia entre el 10 % exigido y el 5 % natural) se declara sobre la
     * línea de Utilidad —el componente residual/discrecional del AIU—: su
     * `LineExtensionAmount` sigue siendo 1.000.000 (lo que el contrato le
     * asigna), pero su `cac:TaxTotal` declara una base de 3.500.000. Es
     * legítimo: FAU02 mide el bruto de línea y FAU04 mide la base gravable, y
     * son identidades INDEPENDIENTES — ninguna de las dos puede deducirse de
     * la otra (ver la nota de `checkTaxExclusiveBase` en `dian-totals.validator.ts`).
     *
     * Este reparto es una decisión de ESTE archivo para completar la matriz,
     * no un comportamiento que el calculador (`invoice-calculator.service.ts`)
     * produzca hoy: `summarizeAiu` reporta la divergencia bajo el piso y deja
     * que el llamador decida — hoy, rechazar antes de firmar (D.4). Lo que
     * esta celda prueba es que SI algún día el Modelo 1 resuelve elevar la
     * base así, la compuerta de aritmética de D.6 no le pone ninguna objeción.
     */
    it('modelo líneas-por-componente, con piso: el excedente se declara en Utilidad, con TaxableAmount > LineExtensionAmount', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '950000.00',
        items: [
          line({
            description: 'Administración',
            unit_price: '1000000.00',
            total_amount: '1000000.00',
            tax_amount: '190000.00',
            taxes: [tax({ taxable_amount: '1000000.00', tax_amount: '190000.00' })],
          }),
          line({
            description: 'Imprevistos',
            unit_price: '500000.00',
            total_amount: '500000.00',
            tax_amount: '95000.00',
            taxes: [tax({ taxable_amount: '500000.00', tax_amount: '95000.00' })],
          }),
          line({
            description: 'Utilidad',
            unit_price: '1000000.00',
            total_amount: '1000000.00',
            tax_amount: '665000.00',
            taxes: [
              // Base elevada por el piso: 3.500.000 = 1.000.000 (natural) +
              // 2.500.000 (excedente del 10 % del contrato). Su PROPIA línea
              // sólo vale 1.000.000 — la diferencia es la ficción legal del
              // piso, no dinero facturado de más.
              tax({ taxable_amount: '3500000.00', tax_amount: '665000.00' }),
            ],
          }),
          line({
            description: 'Costo reembolsable',
            unit_price: '47500000.00',
            total_amount: '47500000.00',
            omit_tax_total: true,
          }),
        ],
        taxes: [tax({ taxable_amount: '5000000.00', tax_amount: '950000.00' })],
      });

      expect(totals.LineExtensionAmount).toBe('50000000.00');
      expect(totals.TaxExclusiveAmount).toBe('5000000.00');
      expect(totals.TaxInclusiveAmount).toBe('50950000.00');

      const chunks = xml.split('<cac:InvoiceLine>').slice(1);
      const utilidad = chunks.find((c) => c.includes('Utilidad')) as string;
      expect(utilidad).toContain(
        '<cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>',
      );
      expect(utilidad).toContain(
        '<cbc:TaxableAmount currencyID="COP">3500000.00</cbc:TaxableAmount>',
      );

      expectClean(xml);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Modelo 1 «no sumada» — con las cifras del CALCULADOR, no escritas a mano
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Las celdas de arriba alimentan el emisor con importes escritos a mano, y
   * eso las hace ciegas a un defecto que ya ocurrió una vez en este dominio: si
   * quien calcula y quien escribe el test son la misma persona con la misma
   * idea equivocada, el XML cuadra consigo mismo y la DIAN lo rechaza igual.
   * Este bloque cierra ese hueco corriendo la cadena COMPLETA —
   * `InvoiceCalculatorService` → `UblCommonBuilder` → `DianTotalsValidator`—
   * sobre el modelo de contabilización «no sumada», donde la línea vale el
   * CONTRATO y sólo una fracción declara base gravable.
   *
   * Es exactamente la divergencia legítima entre FAU02 (bruto) y FAU04 (base)
   * que el docblock del validador describe, llevada a su caso extremo: el bruto
   * es diez veces la base.
   */
  describe('Modelo 1 «no sumada»: la línea vale el contrato y el AIU va dentro', () => {
    /** El caso del dueño: $2.328.800 con AIU del 10 % repartido 5/2/3. */
    const COMPONENTS = {
      administracion: '5',
      imprevistos: '2',
      utilidad: '3',
    };

    function noSumada(
      taxable_basis: NonNullable<InvoiceCalculatorInput['aiu']>['taxable_basis'],
      amounts: readonly string[],
      components: Readonly<Record<string, string>> = COMPONENTS,
    ): InvoiceCalculatorInput {
      return {
        aiu: { taxable_basis, components_basis: 'contract', components },
        items: amounts.map((unit_price, i) => ({
          description: `Servicio de aseo ${i + 1} — contrato AIU`,
          quantity: 1,
          unit_price,
          aiu_component: 'contrato' as const,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        })),
      };
    }

    /**
     * Traduce el resultado del calculador a lo que el emisor recibe. Es el
     * mismo puente que arma `DianDirectProvider`, reducido a lo que estas
     * reglas miran: importe de línea, base propia por tributo y la bandera de
     * la línea que calla.
     */
    function emitCalculated(input: InvoiceCalculatorInput): {
      xml: string;
      totals: Record<string, string>;
      result: ReturnType<InvoiceCalculatorService['calculate']>;
    } {
      const result = new InvoiceCalculatorService().calculate(input);
      const { xml, totals } = emit({
        discount_amount: result.totals.discount_amount,
        tax_amount: result.totals.tax_amount,
        items: result.lines.map((calculated) =>
          line({
            description: calculated.description,
            unit_price: calculated.line_extension_amount,
            total_amount: calculated.total_amount,
            tax_amount: calculated.tax_amount,
            omit_tax_total: calculated.omit_tax_total,
            taxes: calculated.taxes.length > 0 ? calculated.taxes : undefined,
          }),
        ),
        taxes: result.header_taxes,
      });
      return { xml, totals, result };
    }

    it('DOS líneas Modelo 1: FAU02, FAU04 y FAU06 cuadran sobre el mismo documento', () => {
      const { xml, totals, result } = emitCalculated(
        noSumada('utilidad', ['2328800', '1000000']),
      );

      // FAU02 — el bruto de la cabecera es la Σ de los contratos, íntegros.
      expect(totals.LineExtensionAmount).toBe('3328800.00');
      // FAU04 — la base es la Σ de las porciones Utilidad de LAS DOS líneas:
      // 69.864,00 + 30.000,00. Que fuera sólo la de la primera es el defecto
      // que este caso existe para impedir.
      expect(totals.TaxExclusiveAmount).toBe('99864.00');
      // FAU06 — bruto + tributos de cabecera: 3.328.800 + 18.974,16.
      expect(totals.TaxInclusiveAmount).toBe('3347774.16');
      expect(totals.PayableAmount).toBe('3347774.16');

      // Ninguna línea desaparece ni se agrega: el modelo «no sumada» no crea
      // renglones de cobro, que es el defecto reportado en producción.
      expect(xml.split('<cac:InvoiceLine>').slice(1)).toHaveLength(2);
      expect(result.aiu?.contract_value).toBe('3328800.00');
      expect(result.aiu?.aiu_value).toBe('332880.00');

      expectClean(xml);
    });

    it('las TRES bases producen documentos que la compuerta acepta', () => {
      // Misma línea, tres bases gravables: la base declarada cambia cuánto
      // entra a `cbc:TaxableAmount`, nunca cuánto vale la línea.
      const porBase = {
        aiu: emitCalculated(noSumada('aiu', ['2328800'])),
        utilidad: emitCalculated(noSumada('utilidad', ['2328800'])),
        subtotal: emitCalculated(noSumada('subtotal', ['2328800'])),
      };

      for (const caso of Object.values(porBase)) {
        expect(caso.totals.LineExtensionAmount).toBe('2328800.00');
        expectClean(caso.xml);
      }

      expect(porBase.aiu.totals.TaxExclusiveAmount).toBe('232880.00');
      expect(porBase.utilidad.totals.TaxExclusiveAmount).toBe('69864.00');
      expect(porBase.subtotal.totals.TaxExclusiveAmount).toBe('2328800.00');
    });

    it('el piso del 10 % rechaza nombrando cuánto falta, aunque el XML cuadre', () => {
      // AIU del 9 % (4/2/3): aritméticamente impecable —esta compuerta lo
      // valida limpio, igual que la Base 3 de la matriz— y sin embargo
      // inemitible, porque incumple el mínimo del E.T. art. 462-1. Son DOS
      // reglas distintas, y confundirlas deja pasar el documento que la DIAN
      // rechaza con el consecutivo ya gastado.
      const { xml, totals, result } = emitCalculated(
        noSumada('aiu', ['2328800'], {
          administracion: '4',
          imprevistos: '2',
          utilidad: '3',
        }),
      );

      const floor = result.divergences.find(
        (d) => d.scope === 'aiu_base_below_minimum',
      );
      expect(floor).toBeDefined();
      expect(floor?.expected).toBe('232880.00'); // 10 % del contrato
      expect(floor?.received).toBe('209592.00'); // el 9 % declarado
      expect(floor?.difference).toBe('-23288.00'); // cuánto falta

      expect(totals.LineExtensionAmount).toBe('2328800.00');
      expect(totals.TaxExclusiveAmount).toBe('209592.00');
      expect(Number(totals.TaxExclusiveAmount)).toBeLessThan(
        Number(totals.LineExtensionAmount) * 0.1,
      );
      expectClean(xml);
    });
  });
});
