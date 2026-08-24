import { DianTotalsValidator } from './dian-totals.validator';

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
