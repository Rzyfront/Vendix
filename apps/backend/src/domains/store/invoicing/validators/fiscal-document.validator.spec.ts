import {
  FiscalDocumentFindingCode,
  FiscalDocumentReport,
  FiscalDocumentValidationInput,
  FiscalDocumentValidator,
} from './fiscal-document.validator';

/**
 * El prevalidador es PURO: se instancia con `new`, sin Nest, sin Prisma y sin
 * contexto. Si algún día deja de poder hacerse, es que dejó de ser puro.
 */
const validator = new FiscalDocumentValidator();

/** 40 hexadecimales — la forma exacta que emite la DIAN. */
const VALID_TECHNICAL_KEY = 'a1b2c3d4e5'.repeat(4);

function codesOf(report: FiscalDocumentReport): FiscalDocumentFindingCode[] {
  return report.findings.map((finding) => finding.code);
}

function blockerCodesOf(
  report: FiscalDocumentReport,
): FiscalDocumentFindingCode[] {
  return report.blockers.map((finding) => finding.code);
}

/**
 * Factura de venta CORRECTA: 2 × 1.000,00 = 2.000,00 de base, IVA 19 % =
 * 380,00, total 2.380,00, numerada FE6 dentro del rango 1..1000 de una
 * resolución vigente con ClTec de 40 caracteres.
 *
 * Cada prueba parte de acá y rompe UNA cosa: así el hallazgo que aparece es
 * necesariamente el que la prueba provocó.
 */
function baseInput(
  overrides: Partial<FiscalDocumentValidationInput> = {},
): FiscalDocumentValidationInput {
  return {
    document_type: 'sales_invoice',
    invoice_number: 'FE6',
    issue_date: new Date('2026-08-14T18:00:00Z'),
    timezone: 'America/Bogota',
    currency: 'COP',
    operation_type: '10',
    subtotal_amount: '2000.00',
    discount_amount: '0.00',
    tax_amount: '380.00',
    withholding_amount: '0.00',
    total_amount: '2380.00',
    items: [
      {
        line_number: 1,
        description: 'Queso costeño',
        quantity: '2',
        unit_price: '1000.00',
        discount_amount: '0.00',
        tax_amount: '380.00',
        unit_code: 'EA',
      },
    ],
    taxes: [
      {
        tax_name: 'IVA 19%',
        tax_type: 'iva',
        tax_rate: '19.00',
        taxable_amount: '2000.00',
        tax_amount: '380.00',
      },
    ],
    resolution: {
      id: 7,
      resolution_number: '18760000001',
      prefix: 'FE',
      range_from: 1,
      range_to: 1000,
      current_number: 5,
      valid_from: new Date('2026-01-01T00:00:00Z'),
      valid_to: new Date('2026-12-31T00:00:00Z'),
      is_active: true,
      technical_key: VALID_TECHNICAL_KEY,
    },
    ...overrides,
  };
}

describe('FiscalDocumentValidator', () => {
  describe('documento correcto', () => {
    it('no encuentra nada que corregir en una factura bien armada', () => {
      const report = validator.validate(baseInput());

      expect(report.findings).toEqual([]);
      expect(report.emittable).toBe(true);
      expect(report.computed).toMatchObject({
        line_extension_amount: '2000.00',
        allowance_total_amount: '0.00',
        tax_total_amount: '380.00',
        tax_inclusive_amount: '2380.00',
        payable_amount: '2380.00',
        monetary_total_element: 'LegalMonetaryTotal',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // FAU14 — la regla que más rechazos produce
  // ---------------------------------------------------------------------------

  describe('FAU14 · LineExtensionAmount = Σ de las líneas EMITIDAS', () => {
    it('denuncia una base de cabecera que sus líneas no sostienen', () => {
      // Sólo se toca la base persistida: el total sigue derivándose de las
      // líneas, así que el único descuadre posible es el que la prueba provoca.
      const report = validator.validate(
        baseInput({ subtotal_amount: '2100.00' }),
      );

      expect(blockerCodesOf(report)).toEqual([
        'HEADER_LINE_EXTENSION_MISMATCH',
      ]);
      expect(report.blockers[0].category).toBe('arithmetic');
      expect(report.blockers[0].details).toMatchObject({
        declared: '2100.00',
        expected: '2000.00',
      });
      expect(report.emittable).toBe(false);
    });

    it('tolera un centavo: por debajo de eso es ruido de truncado que no llega al XML', () => {
      const report = validator.validate(
        baseInput({ subtotal_amount: '2000.01' }),
      );

      expect(codesOf(report)).not.toContain('HEADER_LINE_EXTENSION_MISMATCH');
    });

    it('SUMA DE TRUNCADOS, no truncado de la suma: 10 líneas de 10,555 dan 105,50 y no 105,55', () => {
      const items = Array.from({ length: 10 }, (_, index) => ({
        line_number: index + 1,
        description: `Servicio ${index + 1}`,
        quantity: '1',
        unit_price: '10.555',
        discount_amount: '0.00',
        tax_amount: '0.00',
        unit_code: 'EA',
      }));

      const report = validator.validate(
        baseInput({
          items,
          taxes: [],
          // Lo que declara quien suma primero y trunca después.
          subtotal_amount: '105.55',
          tax_amount: '0.00',
          total_amount: '105.50',
        }),
      );

      expect(report.computed.line_extension_amount).toBe('105.50');
      expect(blockerCodesOf(report)).toEqual([
        'HEADER_LINE_EXTENSION_MISMATCH',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // TaxAmount = TaxableAmount × Percent / 100
  // ---------------------------------------------------------------------------

  describe('TaxSubtotal · TaxAmount = TaxableAmount × Percent/100', () => {
    it('denuncia el impuesto que su propia base y tarifa no explican', () => {
      const report = validator.validate(
        baseInput({
          tax_amount: '400.00',
          total_amount: '2400.00',
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_type: 'iva',
              tax_rate: '19.00',
              taxable_amount: '2000.00',
              tax_amount: '400.00',
            },
          ],
        }),
      );

      expect(blockerCodesOf(report)).toEqual(['TAX_SUBTOTAL_MISMATCH']);
      expect(report.blockers[0].details).toMatchObject({
        expected: '380.00',
        declared: '400.00',
      });
    });

    it('tolera el centavo que introduce el truncado', () => {
      const report = validator.validate(
        baseInput({
          tax_amount: '380.01',
          total_amount: '2380.01',
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_type: 'iva',
              tax_rate: '19.00',
              taxable_amount: '2000.00',
              tax_amount: '380.01',
            },
          ],
        }),
      );

      expect(codesOf(report)).not.toContain('TAX_SUBTOTAL_MISMATCH');
    });

    it('el ICA va POR MIL: 7 sobre 2.000 son 14,00 y no 140,00', () => {
      const ica = {
        tax_name: 'ICA',
        tax_type: 'ica',
        tax_rate: '7.00',
        taxable_amount: '2000.00',
      };

      const correct = validator.validate(
        baseInput({
          tax_amount: '14.00',
          total_amount: '2014.00',
          taxes: [{ ...ica, tax_amount: '14.00' }],
        }),
      );
      expect(correct.findings).toEqual([]);

      const as_percentage = validator.validate(
        baseInput({
          tax_amount: '140.00',
          total_amount: '2140.00',
          taxes: [{ ...ica, tax_amount: '140.00' }],
        }),
      );
      expect(blockerCodesOf(as_percentage)).toEqual(['TAX_SUBTOTAL_MISMATCH']);
    });

    it('AVISA, no bloquea, cuando una RETENCIÓN quedó entre los impuestos', () => {
      // El camino legacy de `dto.taxes[]` admite `tax_type: 'reteica'`, así que
      // hay documentos con una retención persistida en `invoice_taxes`. El
      // emisor la descarta (`buildTaxTotals`), de modo que ni entra al XML ni
      // puede provocar un rechazo: juzgarle la aritmética sería inventarse un
      // bloqueante. Y sería MAL calculada, además — el ReteICA va por mil.
      const report = validator.validate(
        baseInput({
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_type: 'iva',
              tax_rate: '19.00',
              taxable_amount: '2000.00',
              tax_amount: '380.00',
            },
            {
              tax_name: 'ReteICA',
              tax_type: 'reteica',
              tax_rate: '7.00',
              taxable_amount: '2000.00',
              tax_amount: '14.00',
            },
          ],
        }),
      );

      expect(blockerCodesOf(report)).toEqual([]);
      expect(report.warnings.map((f) => f.code)).toContain(
        'TAX_ROW_IS_WITHHOLDING',
      );
      expect(
        report.warnings.find((f) => f.code === 'TAX_ROW_IS_WITHHOLDING')!
          .details,
      ).toMatchObject({ dian_tax_code: '07' });
    });

    it('denuncia dos tarifas del mismo tributo: el emisor las fusiona en UN subtotal', () => {
      const report = validator.validate(
        baseInput({
          tax_amount: '240.00',
          total_amount: '2240.00',
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_type: 'iva',
              tax_rate: '19.00',
              taxable_amount: '1000.00',
              tax_amount: '190.00',
            },
            {
              tax_name: 'IVA 5%',
              tax_type: 'iva',
              tax_rate: '5.00',
              taxable_amount: '1000.00',
              tax_amount: '50.00',
            },
          ],
        }),
      );

      expect(blockerCodesOf(report)).toEqual(['TAX_SCHEME_RATE_COLLISION']);
      expect(report.blockers[0].details).toMatchObject({ dian_tax_code: '01' });
    });

    it('denuncia un impuesto con importe y sin tarifa', () => {
      const report = validator.validate(
        baseInput({
          taxes: [
            {
              tax_name: 'IVA',
              tax_type: 'iva',
              tax_rate: '0',
              taxable_amount: '2000.00',
              tax_amount: '380.00',
            },
          ],
        }),
      );

      expect(blockerCodesOf(report)).toContain('TAX_RATE_MISSING');
    });

    it('denuncia el impuesto de cabecera que sus filas no suman', () => {
      const report = validator.validate(
        baseInput({ tax_amount: '500.00', total_amount: '2500.00' }),
      );

      expect(blockerCodesOf(report)).toContain('HEADER_TAX_TOTAL_MISMATCH');
    });
  });

  // ---------------------------------------------------------------------------
  // PayableAmount — y sobre todo, lo que NO entra
  // ---------------------------------------------------------------------------

  describe('PayableAmount · §11.9.1 y §11.9.2', () => {
    it('la RETENCIÓN no resta del total, y el hallazgo lo nombra', () => {
      const report = validator.validate(
        baseInput({
          withholding_amount: '68.00',
          total_amount: '2312.00',
        }),
      );

      expect(blockerCodesOf(report)).toEqual(['PAYABLE_NETS_WITHHOLDING']);
      expect(report.blockers[0].details).toMatchObject({
        declared: '2312.00',
        expected: '2380.00',
        withholding_amount: '68.00',
      });
    });

    it('el ANTICIPO tampoco resta', () => {
      const report = validator.validate(
        baseInput({
          prepaid_amount: '500.00',
          total_amount: '1880.00',
        }),
      );

      expect(blockerCodesOf(report)).toEqual(['PAYABLE_NETS_PREPAID']);
    });

    it('un descuadre que no es ni retención ni anticipo cae en el hallazgo genérico', () => {
      const report = validator.validate(baseInput({ total_amount: '2000.00' }));

      expect(blockerCodesOf(report)).toEqual(['PAYABLE_AMOUNT_MISMATCH']);
      expect(report.blockers[0].details).toMatchObject({
        declared: '2000.00',
        expected: '2380.00',
      });
    });

    it('el descuento de PIE sí resta, y sale como AllowanceTotal', () => {
      const report = validator.validate(
        baseInput({
          discount_amount: '100.00',
          total_amount: '2280.00',
        }),
      );

      expect(report.computed.allowance_total_amount).toBe('100.00');
      expect(report.findings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Resolución de numeración
  // ---------------------------------------------------------------------------

  describe('resolución de numeración', () => {
    it('exige una resolución para la factura de venta', () => {
      const report = validator.validate(baseInput({ resolution: null }));

      expect(blockerCodesOf(report)).toContain('RESOLUTION_MISSING');
    });

    it('AVISA, no bloquea, cuando el bloque de control no se transmite', () => {
      // El documento soporte declara `requires_authorized_range: true`, pero
      // `send()` lo excluye de `resolveInvoiceControl`: su `sts:InvoiceControl`
      // no viaja. Un dato que la DIAN nunca ve no puede provocar un rechazo, así
      // que bloquear por su ausencia rompería una emisión que hoy funciona a
      // cambio de proteger de un rechazo imposible.
      //
      // Este test es el que sostiene esa decisión: si alguien vuelve a subir la
      // severidad SIN empezar a transmitir el bloque, falla acá y no en
      // producción con los documentos soporte del tenant bloqueados.
      const report = validator.validate(
        baseInput({
          document_type: 'support_document',
          invoice_number: 'DS1',
          operation_type: undefined,
          resolution: null,
        }),
      );

      expect(blockerCodesOf(report)).not.toContain('RESOLUTION_MISSING');
      expect(report.warnings.map((f) => f.code)).toContain(
        'RESOLUTION_MISSING',
      );
      // Y el aviso dice POR QUÉ no bloquea, para que nadie lo lea como un bug.
      expect(
        report.warnings.find((f) => f.code === 'RESOLUTION_MISSING')!.problem,
      ).toContain('no se transmite');
    });

    it('denuncia una resolución desactivada', () => {
      const report = validator.validate(
        baseInput({
          resolution: { ...baseInput().resolution!, is_active: false },
        }),
      );

      expect(blockerCodesOf(report)).toContain('RESOLUTION_INACTIVE');
    });

    it('juzga la vigencia contra la FECHA DEL DOCUMENTO, no contra «ahora»', () => {
      const report = validator.validate(
        baseInput({ issue_date: new Date('2027-01-05T15:00:00Z') }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'RESOLUTION_NOT_VALID_AT_ISSUE_DATE',
      );
      expect(finding).toBeDefined();
      expect(finding!.details).toMatchObject({
        issue_date: '2027-01-05',
        valid_from: '2026-01-01',
        valid_to: '2026-12-31',
      });
    });

    it('NO rechaza la factura del último día hecha después de las 19:00 en Bogotá', () => {
      // El instante cae en el 1/01/2027 UTC, pero el día civil del emisor sigue
      // siendo el 31/12/2026 — el último día autorizado. Comparar instantes
      // rechazaría un documento perfectamente válido.
      const report = validator.validate(
        baseInput({ issue_date: new Date('2026-12-31T23:30:00Z') }),
      );

      expect(codesOf(report)).not.toContain(
        'RESOLUTION_NOT_VALID_AT_ISSUE_DATE',
      );
    });

    it('denuncia un rango agotado', () => {
      const report = validator.validate(
        baseInput({
          invoice_number: 'FE1000',
          resolution: { ...baseInput().resolution!, current_number: 1000 },
        }),
      );

      expect(blockerCodesOf(report)).toContain('RESOLUTION_RANGE_EXHAUSTED');
    });

    it('denuncia un prefijo que no es el de su resolución', () => {
      const report = validator.validate(baseInput({ invoice_number: 'FV6' }));

      expect(blockerCodesOf(report)).toContain(
        'DOCUMENT_NUMBER_PREFIX_MISMATCH',
      );
    });

    it('denuncia un consecutivo fuera del rango autorizado', () => {
      const report = validator.validate(
        baseInput({ invoice_number: 'FE5000' }),
      );

      expect(blockerCodesOf(report)).toContain('DOCUMENT_NUMBER_OUT_OF_RANGE');
      expect(
        report.blockers.find((f) => f.code === 'DOCUMENT_NUMBER_OUT_OF_RANGE')!
          .details,
      ).toMatchObject({ sequence: 5000, range_from: 1, range_to: 1000 });
    });

    it('denuncia un rango mal capturado', () => {
      const report = validator.validate(
        baseInput({
          resolution: {
            ...baseInput().resolution!,
            range_from: 900,
            range_to: 100,
          },
        }),
      );

      expect(blockerCodesOf(report)).toContain('RESOLUTION_RANGE_INVALID');
    });

    it('NO le exige rango autorizado a una nota: la DIAN no lo emite para ellas', () => {
      const report = validator.validate(
        baseInput({ document_type: 'credit_note', resolution: null }),
      );

      expect(
        report.findings.filter((f) => f.category === 'resolution'),
      ).toEqual([]);
      expect(report.emittable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Clave técnica — el defecto que originó todo este trabajo
  // ---------------------------------------------------------------------------

  describe('clave técnica (ClTec)', () => {
    it('rechaza una ClTec de 38 caracteres ANTES de gastar el consecutivo', () => {
      const truncated = VALID_TECHNICAL_KEY.slice(0, 38);
      const report = validator.validate(
        baseInput({
          resolution: {
            ...baseInput().resolution!,
            technical_key: truncated,
          },
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'TECHNICAL_KEY_MALFORMED',
      );
      expect(finding).toBeDefined();
      expect(finding!.details).toEqual({
        technical_key_length: 38,
        expected_length: 40,
      });
    });

    it('NUNCA devuelve el valor de la ClTec: es un secreto fiscal', () => {
      const truncated = VALID_TECHNICAL_KEY.slice(0, 38);
      const report = validator.validate(
        baseInput({
          resolution: {
            ...baseInput().resolution!,
            technical_key: truncated,
          },
        }),
      );

      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(truncated);
      expect(serialized).not.toContain(VALID_TECHNICAL_KEY);
      // Ni siquiera un fragmento reconocible: la longitud es todo lo que sale.
      expect(serialized).not.toContain(truncated.slice(0, 8));
    });

    it('exige la ClTec cuando el documento arma su clave con ella', () => {
      const report = validator.validate(
        baseInput({
          resolution: { ...baseInput().resolution!, technical_key: null },
        }),
      );

      expect(blockerCodesOf(report)).toContain('TECHNICAL_KEY_REQUIRED');
    });

    it('acepta la ClTec con los espacios que mete el PDF al copiarla', () => {
      const report = validator.validate(
        baseInput({
          resolution: {
            ...baseInput().resolution!,
            technical_key: ` ${VALID_TECHNICAL_KEY.slice(0, 20)} ${VALID_TECHNICAL_KEY.slice(20)}\n`,
          },
        }),
      );

      expect(codesOf(report)).not.toContain('TECHNICAL_KEY_MALFORMED');
    });

    it('avisa —sin bloquear— de una ClTec en una resolución que firma con Software-PIN', () => {
      const report = validator.validate(
        baseInput({
          document_type: 'credit_note',
          resolution: {
            ...baseInput().resolution!,
            technical_key: VALID_TECHNICAL_KEY,
          },
        }),
      );

      expect(report.warnings.map((f) => f.code)).toContain(
        'TECHNICAL_KEY_NOT_APPLICABLE',
      );
      expect(report.emittable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Moneda
  // ---------------------------------------------------------------------------

  describe('moneda', () => {
    it('rechaza una moneda distinta de COP', () => {
      const report = validator.validate(baseInput({ currency: 'USD' }));

      const finding = report.blockers.find(
        (f) => f.code === 'CURRENCY_NOT_COP',
      );
      expect(finding).toBeDefined();
      expect(finding!.category).toBe('content');
    });

    it('sólo AVISA cuando no se declara moneda: el emisor pondrá COP y es lo correcto', () => {
      const report = validator.validate(baseInput({ currency: null }));

      expect(report.warnings.map((f) => f.code)).toContain('CURRENCY_MISSING');
      expect(report.emittable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Unidades de medida — el catálogo corrompido de la DIAN
  // ---------------------------------------------------------------------------

  describe('unidad de medida', () => {
    it('rechaza el código correcto de UN/ECE que la DIAN no acepta, y sugiere el corrompido', () => {
      const report = validator.validate(
        baseInput({
          items: [{ ...baseInput().items![0], unit_code: 'MON' }],
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'LINE_UNIT_CODE_UNKNOWN',
      );
      expect(finding).toBeDefined();
      expect(finding!.details).toMatchObject({
        unit_code: 'MON',
        suggested_unit_code: 'LUN',
      });
      expect(finding!.fix).toContain('LUN');
    });

    it('acepta los códigos que la lista de la DIAN sí contiene', () => {
      for (const unit_code of ['EA', 'KGM', 'MTR', 'LUN', 'G K']) {
        const report = validator.validate(
          baseInput({ items: [{ ...baseInput().items![0], unit_code }] }),
        );
        expect(codesOf(report)).not.toContain('LINE_UNIT_CODE_UNKNOWN');
      }
    });

    it('sólo AVISA cuando la línea no declara unidad: «cada» es correcto en una línea por pieza', () => {
      const report = validator.validate(
        baseInput({ items: [{ ...baseInput().items![0], unit_code: null }] }),
      );

      expect(report.warnings.map((f) => f.code)).toContain(
        'LINE_UNIT_CODE_MISSING',
      );
      expect(report.emittable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // CustomizationID coherente con el contenido (AIU)
  // ---------------------------------------------------------------------------

  describe('tipo de operación (CustomizationID)', () => {
    it('rechaza un tipo de operación fuera de la lista cerrada (FAD02)', () => {
      const report = validator.validate(baseInput({ operation_type: '99' }));

      expect(blockerCodesOf(report)).toContain('OPERATION_TYPE_UNKNOWN');
    });

    it('rechaza «09» sin ninguna línea marcada como AIU', () => {
      const report = validator.validate(baseInput({ operation_type: '09' }));

      expect(blockerCodesOf(report)).toContain(
        'OPERATION_TYPE_AIU_WITHOUT_LINES',
      );
    });

    it('rechaza líneas AIU en un documento que no se declara AIU', () => {
      const report = validator.validate(
        baseInput({
          items: [
            { ...baseInput().items![0], aiu_component: 'administracion' },
          ],
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'AIU_WITHOUT_OPERATION_TYPE',
      );
      expect(finding).toBeDefined();
      expect(finding!.details).toMatchObject({ aiu_line_numbers: [1] });
    });

    it('acepta «09» con sus líneas marcadas', () => {
      const report = validator.validate(
        baseInput({
          operation_type: '09',
          items: [{ ...baseInput().items![0], aiu_component: 'utilidad' }],
        }),
      );

      expect(report.findings).toEqual([]);
    });

    it('no juzga el tipo de operación de una nota con la lista de facturas', () => {
      const report = validator.validate(
        baseInput({
          document_type: 'credit_note',
          resolution: null,
          operation_type: '20',
        }),
      );

      expect(codesOf(report)).not.toContain('OPERATION_TYPE_UNKNOWN');
    });
  });

  // ---------------------------------------------------------------------------
  // Contenido mínimo
  // ---------------------------------------------------------------------------

  describe('contenido de las líneas', () => {
    it('un documento sin líneas produce UN mensaje, no la lista de todo lo que falta', () => {
      const report = validator.validate(
        baseInput({
          items: [],
          taxes: [],
          subtotal_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '0.00',
        }),
      );

      expect(blockerCodesOf(report)).toEqual(['NO_LINES']);
    });

    it('rechaza una cantidad que no es positiva', () => {
      const report = validator.validate(
        baseInput({
          items: [{ ...baseInput().items![0], quantity: '0' }],
          subtotal_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '0.00',
          taxes: [],
        }),
      );

      expect(blockerCodesOf(report)).toContain('LINE_QUANTITY_NOT_POSITIVE');
    });

    it('rechaza una línea sin descripción', () => {
      const report = validator.validate(
        baseInput({
          items: [{ ...baseInput().items![0], description: '   ' }],
        }),
      );

      expect(blockerCodesOf(report)).toContain('LINE_DESCRIPTION_REQUIRED');
    });

    it('rechaza una línea cuyo descuento supera su propio importe', () => {
      const report = validator.validate(
        baseInput({
          items: [{ ...baseInput().items![0], discount_amount: '5000.00' }],
          taxes: [],
          subtotal_amount: '-3000.00',
          tax_amount: '0.00',
          total_amount: '-3000.00',
        }),
      );

      expect(blockerCodesOf(report)).toContain('LINE_AMOUNT_NEGATIVE');
    });

    it('respeta price_unit_quantity: el precio de 12 unidades no se cobra 12 veces', () => {
      const report = validator.validate(
        baseInput({
          items: [
            {
              ...baseInput().items![0],
              quantity: '6',
              unit_price: '12000.00',
              price_unit_quantity: '12',
            },
          ],
          taxes: [],
          subtotal_amount: '6000.00',
          tax_amount: '0.00',
          total_amount: '6000.00',
        }),
      );

      expect(report.computed.line_extension_amount).toBe('6000.00');
      expect(report.findings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Documentos sin líneas ni totales monetarios
  // ---------------------------------------------------------------------------

  describe('documentos que no llevan líneas', () => {
    it('la nómina electrónica no exige líneas ni cuadra LegalMonetaryTotal', () => {
      const report = validator.validate({
        document_type: 'payroll',
        items: [],
        taxes: [],
        currency: 'COP',
      });

      expect(report.computed.monetary_total_element).toBeNull();
      expect(codesOf(report)).not.toContain('NO_LINES');
      expect(
        report.findings.filter((f) => f.category === 'arithmetic'),
      ).toEqual([]);
      expect(report.emittable).toBe(true);
    });

    it('la nota débito cuadra contra RequestedMonetaryTotal', () => {
      const report = validator.validate(
        baseInput({ document_type: 'debit_note', resolution: null }),
      );

      expect(report.computed.monetary_total_element).toBe(
        'RequestedMonetaryTotal',
      );
      expect(report.emittable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Contrato del informe
  // ---------------------------------------------------------------------------

  describe('contrato del informe', () => {
    it('todo hallazgo dice QUÉ pasa y DÓNDE se corrige', () => {
      const report = validator.validate(
        baseInput({
          currency: 'USD',
          total_amount: '999.00',
          invoice_number: 'FV6',
          resolution: {
            ...baseInput().resolution!,
            technical_key: VALID_TECHNICAL_KEY.slice(0, 38),
          },
        }),
      );

      expect(report.findings.length).toBeGreaterThan(3);
      for (const finding of report.findings) {
        expect(finding.problem.trim().length).toBeGreaterThan(0);
        expect(finding.fix.trim().length).toBeGreaterThan(0);
        expect(finding.field.trim().length).toBeGreaterThan(0);
      }
      // Las cuatro familias son las que el servicio traduce a
      // INVOICING_PREVALIDATION_001..004.
      expect(new Set(report.findings.map((f) => f.category))).toEqual(
        new Set(['content', 'arithmetic', 'resolution', 'technical_key']),
      );
    });

    it('emittable depende SÓLO de los bloqueantes', () => {
      const report = validator.validate(baseInput({ currency: null }));

      expect(report.blockers).toEqual([]);
      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.emittable).toBe(true);
    });
  });
});
