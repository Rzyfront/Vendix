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
      expect(result.violations.map((v) => v.rule)).toEqual(['CAS01b', 'CAU04']);
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
});
