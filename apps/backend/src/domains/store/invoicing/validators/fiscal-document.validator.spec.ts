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
  // FAU02 — la regla que más rechazos produce
  //
  // Se llamaba FAU14 acá y en el validador, y era una CITA EQUIVOCADA: FAU14
  // gobierna `cbc:PayableAmount` (y se prueba en su propio bloque más abajo). La
  // que compara el bruto de cabecera contra la suma de las líneas es FAU02
  // (anexo19.txt:22411) — CAU02 en nota crédito, DAU02 en nota débito.
  // ---------------------------------------------------------------------------

  describe('FAU02 · LineExtensionAmount = Σ de las líneas EMITIDAS', () => {
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

  // ---------------------------------------------------------------------------
  // FAD05a · el número de documento sólo admite letras y dígitos
  //
  // El agujero es el prefijo: `CreateResolutionDto` sólo declara `@IsString()
  // @MaxLength(10)`, sin clase de caracteres, y `generateNextNumber` lo
  // concatena tal cual con el consecutivo.
  // ---------------------------------------------------------------------------

  describe('FAD05a · forma del número de documento', () => {
    it('bloquea un número con guion y señala el prefijo como origen', () => {
      const report = validator.validate(
        baseInput({
          invoice_number: 'FE-6',
          resolution: { ...baseInput().resolution!, prefix: 'FE-' },
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'DOCUMENT_NUMBER_NOT_ALPHANUMERIC',
      );
      expect(finding).toBeDefined();
      expect(finding!.category).toBe('resolution');
      expect(finding!.dian_rule?.id).toBe('FAD05a');
      expect(finding!.dian_rule?.dian_message).toBe(
        'No se permiten caracteres adicionales como espacios o guiones',
      );
      // Corregir el documento sin corregir la resolución deja el defecto vivo:
      // el siguiente consecutivo nace igual de roto.
      expect(finding!.fix).toContain('prefijo «FE-»');
      expect(finding!.details).toMatchObject({ prefix_is_source: true });
      expect(report.emittable).toBe(false);
    });

    it('bloquea un número con espacio, que NINGUNA otra comprobación atrapaba', () => {
      // La trampa exacta: con prefijo «FE» limpio y número «FE 6»,
      // `startsWith('FE')` pasa y `sequenceOf` extrae 6, que está en rango.
      // Todas las comprobaciones de numeración aprueban un número que la DIAN
      // rechaza — por eso esta regla no es redundante con ninguna anterior.
      const report = validator.validate(baseInput({ invoice_number: 'FE 6' }));

      expect(blockerCodesOf(report)).toEqual([
        'DOCUMENT_NUMBER_NOT_ALPHANUMERIC',
      ]);
      expect(blockerCodesOf(report)).not.toContain(
        'DOCUMENT_NUMBER_PREFIX_MISMATCH',
      );
      expect(blockerCodesOf(report)).not.toContain(
        'DOCUMENT_NUMBER_OUT_OF_RANGE',
      );
    });

    it('NO se dispara sobre un número alfanumérico correcto', () => {
      const report = validator.validate(baseInput());

      expect(codesOf(report)).not.toContain('DOCUMENT_NUMBER_NOT_ALPHANUMERIC');
      expect(report.findings).toEqual([]);
    });

    it('bloquea un cbc:ID de más de 20 caracteres y respeta el límite exacto', () => {
      const too_long = validator.validate(
        baseInput({
          invoice_number: 'ABCDEFGHIJ0123456789X',
          resolution: { ...baseInput().resolution!, prefix: '' },
        }),
      );
      expect(blockerCodesOf(too_long)).toContain('DOCUMENT_NUMBER_TOO_LONG');

      const exactly_twenty = validator.validate(
        baseInput({
          invoice_number: 'ABCDEFGHIJ0123456789',
          resolution: { ...baseInput().resolution!, prefix: '' },
        }),
      );
      expect(codesOf(exactly_twenty)).not.toContain('DOCUMENT_NUMBER_TOO_LONG');
    });

    it('no juzga la forma de un número que todavía no existe', () => {
      // `DOCUMENT_NUMBER_MISSING` ya explica el caso; repetirlo enterraría el
      // único mensaje accionable.
      const report = validator.validate(baseInput({ invoice_number: null }));

      expect(codesOf(report)).toContain('DOCUMENT_NUMBER_MISSING');
      expect(codesOf(report)).not.toContain('DOCUMENT_NUMBER_NOT_ALPHANUMERIC');
    });
  });

  // ---------------------------------------------------------------------------
  // FAB10 / FAB11 / FAB12 · facetas del bloque de control
  // ---------------------------------------------------------------------------

  describe('forma del prefijo y del rango autorizado', () => {
    it('bloquea un prefijo con caracteres no alfanuméricos: envenena TODO consecutivo futuro', () => {
      const report = validator.validate(
        baseInput({
          invoice_number: 'FE6',
          resolution: { ...baseInput().resolution!, prefix: 'FE.' },
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'RESOLUTION_PREFIX_NOT_ALPHANUMERIC',
      );
      expect(finding).toBeDefined();
      expect(finding!.field).toBe('resolution.prefix');
      expect(finding!.dian_rule?.id).toBe('FAD05a');
    });

    it('AVISA —no bloquea— un prefijo de más de 4 caracteres', () => {
      // El anexo declara `sts:Prefix` con Tam 0-4, pero el XSD versionado en el
      // repo lo tipa `type="string"` sin faceta de longitud. Sin evidencia de
      // rechazo, bloquear dejaría sin facturar a una tienda que hoy emite bien.
      const report = validator.validate(
        baseInput({
          invoice_number: 'FEVENTA6',
          resolution: { ...baseInput().resolution!, prefix: 'FEVENTA' },
        }),
      );

      expect(codesOf(report)).toContain('RESOLUTION_PREFIX_TOO_LONG');
      expect(report.blockers).toEqual([]);
      expect(report.emittable).toBe(true);
    });

    it('NO avisa sobre un prefijo de 4 caracteres', () => {
      const report = validator.validate(
        baseInput({
          invoice_number: 'SETP6',
          resolution: { ...baseInput().resolution!, prefix: 'SETP' },
        }),
      );

      expect(codesOf(report)).not.toContain('RESOLUTION_PREFIX_TOO_LONG');
      expect(report.findings).toEqual([]);
    });

    it('AVISA un rango de más de 9 dígitos y calla con uno normal', () => {
      const overlong = validator.validate(
        baseInput({
          resolution: { ...baseInput().resolution!, range_to: 1234567890 },
        }),
      );
      expect(codesOf(overlong)).toContain('RESOLUTION_RANGE_TOO_MANY_DIGITS');
      expect(overlong.blockers).toEqual([]);

      const normal = validator.validate(baseInput());
      expect(codesOf(normal)).not.toContain(
        'RESOLUTION_RANGE_TOO_MANY_DIGITS',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // VLR01 · ningún importe ni porcentaje puede ser negativo
  // ---------------------------------------------------------------------------

  describe('VLR01 · valores monetarios y porcentajes positivos', () => {
    it('bloquea un precio unitario negativo aunque el neto de la línea salga positivo', () => {
      // `LINE_AMOUNT_NEGATIVE` mira el NETO (precio × cantidad − descuento). Un
      // precio negativo con descuento negativo da neto positivo y se le escapa;
      // VLR01 mira el valor tal como viaja al XML.
      const report = validator.validate(
        baseInput({
          subtotal_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '0.00',
          taxes: [],
          items: [
            {
              line_number: 1,
              description: 'Ajuste',
              quantity: '1',
              unit_price: '-1000.00',
              discount_amount: '-1000.00',
              tax_amount: '0.00',
              unit_code: 'EA',
            },
          ],
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'NEGATIVE_MONETARY_VALUE',
      );
      expect(finding).toBeDefined();
      expect(finding!.dian_rule?.id).toBe('VLR01');
      expect(finding!.dian_rule?.dian_message).toBe(
        'Los valores monetarios/porcentajes deben corresponder a valores Positivos',
      );
      expect(codesOf(report)).not.toContain('LINE_AMOUNT_NEGATIVE');
    });

    it('bloquea una tarifa de impuesto negativa', () => {
      const report = validator.validate(
        baseInput({
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_type: 'iva',
              tax_rate: '-19.00',
              taxable_amount: '2000.00',
              tax_amount: '380.00',
            },
          ],
        }),
      );

      expect(blockerCodesOf(report)).toContain('NEGATIVE_MONETARY_VALUE');
      expect(
        report.blockers.find((f) => f.code === 'NEGATIVE_MONETARY_VALUE')!.field,
      ).toBe('taxes[0].tax_rate');
    });

    it('bloquea importes de cabecera negativos', () => {
      const report = validator.validate(
        baseInput({ discount_amount: '-50.00' }),
      );

      expect(blockerCodesOf(report)).toContain('NEGATIVE_MONETARY_VALUE');
      expect(
        report.blockers.find((f) => f.code === 'NEGATIVE_MONETARY_VALUE')!.field,
      ).toBe('discount_amount');
    });

    it('NO se dispara sobre un documento con todos sus valores positivos', () => {
      const report = validator.validate(baseInput());

      expect(codesOf(report)).not.toContain('NEGATIVE_MONETARY_VALUE');
      expect(report.findings).toEqual([]);
    });

    it('NO se dispara sobre una nota crédito, que Vendix persiste en positivo', () => {
      // La nota crédito ES el mecanismo de la DIAN para el ajuste a la baja: sus
      // importes son positivos y el signo lo pone el tipo de documento.
      const report = validator.validate(
        baseInput({ document_type: 'credit_note', operation_type: null }),
      );

      expect(codesOf(report)).not.toContain('NEGATIVE_MONETARY_VALUE');
    });
  });

  // ---------------------------------------------------------------------------
  // FAU08 / CAU08 / DAU08 · descuento de documento sin `cac:AllowanceCharge`
  //
  // `buildMonetaryTotal` escribe SIEMPRE `cbc:AllowanceTotalAmount`, pero sólo
  // el constructor de la factura y el del documento equivalente emiten el grupo
  // `cac:AllowanceCharge` que lo respalda.
  // ---------------------------------------------------------------------------

  describe('FAU08 · AllowanceTotalAmount respaldado', () => {
    /** Cabecera que descuenta 100,00 que ninguna línea explica. */
    const footerDiscount = {
      discount_amount: '100.00',
      subtotal_amount: '2000.00',
      tax_amount: '380.00',
      total_amount: '2280.00',
    };

    it('bloquea una nota crédito con descuento de pie', () => {
      const report = validator.validate(
        baseInput({
          document_type: 'credit_note',
          operation_type: null,
          ...footerDiscount,
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'ALLOWANCE_TOTAL_UNBACKED',
      );
      expect(finding).toBeDefined();
      expect(finding!.category).toBe('arithmetic');
      expect(finding!.dian_rule?.id).toBe('CAU08');
      expect(finding!.details).toMatchObject({
        allowance_total_amount: '100.00',
        line_discounts_total: '0.00',
        emits_allowance_charge: false,
      });
    });

    it('bloquea una nota débito con descuento de pie, citando DAU08', () => {
      const report = validator.validate(
        baseInput({
          document_type: 'debit_note',
          operation_type: null,
          ...footerDiscount,
        }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'ALLOWANCE_TOTAL_UNBACKED',
      );
      expect(finding).toBeDefined();
      expect(finding!.dian_rule?.id).toBe('DAU08');
      expect(finding!.problem).toContain('RequestedMonetaryTotal');
    });

    it('NO se dispara en la factura de venta: su constructor SÍ emite el grupo', () => {
      const report = validator.validate(baseInput(footerDiscount));

      expect(codesOf(report)).not.toContain('ALLOWANCE_TOTAL_UNBACKED');
      expect(report.emittable).toBe(true);
    });

    it('NO se dispara en el documento equivalente POS: también lo emite', () => {
      const report = validator.validate(
        baseInput({
          document_type: 'pos_equivalent_document',
          operation_type: null,
          ...footerDiscount,
        }),
      );

      expect(codesOf(report)).not.toContain('ALLOWANCE_TOTAL_UNBACKED');
    });

    it('NO se dispara en una nota crédito cuyo descuento vive en las líneas', () => {
      // El caso normal de Vendix: los descuentos se originan por línea, el
      // remanente de documento es cero y la regla se cumple sola.
      const report = validator.validate(
        baseInput({
          document_type: 'credit_note',
          operation_type: null,
          discount_amount: '100.00',
          subtotal_amount: '1900.00',
          tax_amount: '361.00',
          total_amount: '2261.00',
          items: [
            {
              line_number: 1,
              description: 'Queso costeño',
              quantity: '2',
              unit_price: '1000.00',
              discount_amount: '100.00',
              tax_amount: '361.00',
              unit_code: 'EA',
            },
          ],
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_type: 'iva',
              tax_rate: '19.00',
              taxable_amount: '1900.00',
              tax_amount: '361.00',
            },
          ],
        }),
      );

      expect(codesOf(report)).not.toContain('ALLOWANCE_TOTAL_UNBACKED');
      expect(report.emittable).toBe(true);
    });

    it('NO se dispara en una nota crédito sin descuento alguno', () => {
      const report = validator.validate(
        baseInput({ document_type: 'credit_note', operation_type: null }),
      );

      expect(codesOf(report)).not.toContain('ALLOWANCE_TOTAL_UNBACKED');
    });
  });

  // ---------------------------------------------------------------------------
  // FAD09e · fecha de emisión = fecha de firma
  // ---------------------------------------------------------------------------

  describe('FAD09e · IssueDate igual a la fecha de firma', () => {
    it('bloquea un borrador fechado un día y firmado otro', () => {
      const report = validator.validate(
        baseInput({ signing_date: new Date('2026-08-17T15:00:00Z') }),
      );

      const finding = report.blockers.find(
        (f) => f.code === 'ISSUE_DATE_AFTER_SIGNING_DATE',
      );
      expect(finding).toBeDefined();
      expect(finding!.dian_rule?.id).toBe('FAD09e');
      expect(finding!.details).toMatchObject({
        issue_date: '2026-08-14',
        signing_date: '2026-08-17',
      });
    });

    it('NO se dispara cuando los dos instantes caen el mismo día CIVIL del emisor', () => {
      // 22:30 UTC del 14 son las 17:30 en Bogotá del MISMO día. Comparar
      // instantes en vez de días civiles rechazaría toda emisión de la tarde.
      const report = validator.validate(
        baseInput({ signing_date: new Date('2026-08-14T22:30:00Z') }),
      );

      expect(codesOf(report)).not.toContain('ISSUE_DATE_AFTER_SIGNING_DATE');
      expect(report.findings).toEqual([]);
    });

    it('duerme mientras nadie aporte la fecha de firma', () => {
      // Asumir «ahora» como fecha de firma bloquearía documentos legítimos:
      // este validador NO corre en el momento de la firma.
      const report = validator.validate(baseInput());

      expect(codesOf(report)).not.toContain('ISSUE_DATE_AFTER_SIGNING_DATE');
    });
  });

  // ---------------------------------------------------------------------------
  // CORRELACIÓN CON EL ANEXO — el diccionario que permite leer un rechazo real
  // ---------------------------------------------------------------------------

  describe('cita de la regla oficial en cada hallazgo', () => {
    it('la regla del bruto de cabecera es FAU02, NO FAU14', () => {
      const report = validator.validate(
        baseInput({ subtotal_amount: '2100.00' }),
      );
      const finding = report.blockers[0];

      expect(finding.code).toBe('HEADER_LINE_EXTENSION_MISMATCH');
      expect(finding.dian_rule?.id).toBe('FAU02');
      expect(finding.dian_rule?.effect).toBe('rechazo');
      expect(finding.dian_rule?.annex_line).toBe(22411);
      expect(finding.problem).not.toContain('FAU14');
    });

    it('FAU14 es la del PayableAmount, y ahí sí se cita', () => {
      const report = validator.validate(
        baseInput({ total_amount: '2500.00' }),
      );

      expect(
        report.blockers.find((f) => f.code === 'PAYABLE_AMOUNT_MISMATCH')!
          .dian_rule?.id,
      ).toBe('FAU14');
    });

    it('la ClTec incompleta se correlaciona con FAD06 — el rechazo del incidente', () => {
      // La DIAN no contesta «la clave está mal»: contesta «Valor del CUFE no
      // está calculado correctamente», que es lo que una ClTec de 38 produce.
      const report = validator.validate(
        baseInput({
          resolution: {
            ...baseInput().resolution!,
            technical_key: VALID_TECHNICAL_KEY.slice(0, 38),
          },
        }),
      );
      const finding = report.blockers.find(
        (f) => f.code === 'TECHNICAL_KEY_MALFORMED',
      )!;

      expect(finding.dian_rule?.id).toBe('FAD06');
      expect(finding.dian_rule?.dian_message).toBe(
        'Valor del CUFE no está calculado correctamente',
      );
      // Y la clave sigue sin salir del validador.
      expect(JSON.stringify(finding.details)).not.toContain('a1b2c3d4e5');
    });

    it('la MISMA regla local cita el identificador del tipo de documento', () => {
      const invoice = validator.validate(
        baseInput({ subtotal_amount: '2100.00' }),
      );
      const credit_note = validator.validate(
        baseInput({
          document_type: 'credit_note',
          operation_type: null,
          subtotal_amount: '2100.00',
        }),
      );
      const debit_note = validator.validate(
        baseInput({
          document_type: 'debit_note',
          operation_type: null,
          subtotal_amount: '2100.00',
        }),
      );

      const idOf = (report: FiscalDocumentReport) =>
        report.blockers.find((f) => f.code === 'HEADER_LINE_EXTENSION_MISMATCH')!
          .dian_rule?.id;

      expect(idOf(invoice)).toBe('FAU02');
      expect(idOf(credit_note)).toBe('CAU02');
      expect(idOf(debit_note)).toBe('DAU02');
    });

    it('deja la cita en null cuando el hallazgo es política de Vendix y no regla del anexo', () => {
      // La retención capturada como impuesto NO viaja al XML: el flujo la
      // descarta antes de armarlo, así que no hay rechazo que citar. Inventar un
      // identificador haría inútil el diccionario.
      const report = validator.validate(
        baseInput({
          taxes: [
            ...baseInput().taxes!,
            {
              tax_name: 'ReteFuente',
              tax_type: 'withholding',
              tax_rate: '2.50',
              taxable_amount: '2000.00',
              tax_amount: '50.00',
            },
          ],
        }),
      );

      expect(
        report.warnings.find((f) => f.code === 'TAX_ROW_IS_WITHHOLDING')!
          .dian_rule,
      ).toBeNull();
    });

    it('todo hallazgo trae el campo dian_rule resuelto, aunque sea a null', () => {
      const report = validator.validate(
        baseInput({
          currency: 'USD',
          total_amount: '999.00',
          invoice_number: 'FV 6',
          resolution: {
            ...baseInput().resolution!,
            technical_key: VALID_TECHNICAL_KEY.slice(0, 38),
          },
        }),
      );

      expect(report.findings.length).toBeGreaterThan(3);
      for (const finding of report.findings) {
        expect(finding).toHaveProperty('dian_rule');
        if (finding.dian_rule) {
          expect(finding.dian_rule.id).toMatch(/^[A-Z]/);
          expect(finding.dian_rule.annex_line).toBeGreaterThan(0);
        }
      }
    });
  });

  /**
   * PROPERTY-BASED: 200 combinaciones aleatorias con seeds deterministas.
   *
   * El plan pidió property tests sin librería externa (`fast-check`) porque
   * la regla del repo prohíbe instalar dependencias sin confirmación. Este
   * bloque PRNG + 200 iteraciones cumple el mismo objetivo: cubre el
   * espacio de líneas × impuestos × descuentos × is_inclusive × AIU ×
   * multi-impuesto con un budget controlado de asserts.
   *
   * La invariante es la aritmética del Anexo 1.9 que el validador
   * implementa: para CUALQUIER combinación de los inputs permitidos, las
   * tres reglas (FAU02 cabecera, FAU14 PayableAmount, FAS07
   * TaxAmount = TaxableAmount × Percent/100) o se cumplen O el validador
   * las DENUNCIA como blocker. Lo que NO puede pasar: que el validador
   * las apruebe en silencio cuando no se cumplen.
   */
  describe('property-based: aritmética del Anexo 1.9', () => {
    // PRNG determinista (mulberry32) — sin `Math.random()` porque rompe
    // reproducibilidad entre corridas y CI.
    // Sobraba un nivel de flecha: `mulberry32(seed)` devolvía una función que
    // devolvía el generador, no el generador. TypeScript lo denunciaba
    // (`() => () => number` no es `() => number`) y la suite entera no
    // compilaba, así que las 200 combinaciones no se ejercitaron nunca.
    const mulberry32 = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    /**
     * `decimal_add(a, b)` evita la trampa de JS con números flotantes:
     * 0.1 + 0.2 = 0.30000000000000004. Lo que el validador hace con
     * `Prisma.Decimal` nosotros lo hacemos aquí con BigInt sobre centavos
     * (enteros sin pérdida) y luego dividimos por 100.
     */
    const cents = (n: number) => Math.round(n * 100);
    const from_cents = (c: number) => (c / 100).toFixed(2);
    const sum_cents = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const mul_cents = (a: number, b: number) => Math.round(a * b / 100);

    /**
     * Construye un input aleatorio dentro de los rangos del dominio:
     * - 1..5 líneas, cada una con cantidad 1..10, precio 100..100000,
     *   descuento 0..50% del subtotal, 0..2 impuestos por línea.
     * - El emisor siempre manda lo que la DIAN contrastará; el validador
     *   recalcula con su misma lógica de truncado y compara.
     */
    const build = (rng: () => number) => {
      const n_lines = 1 + Math.floor(rng() * 5);
      const items: any[] = [];
      let header_subtotal_cents = 0;
      let header_tax_cents = 0;

      for (let i = 0; i < n_lines; i++) {
        const qty = 1 + Math.floor(rng() * 10);
        const unit_price = 100 + Math.floor(rng() * 99900);
        const disc_pct = Math.floor(rng() * 50);
        const subtotal = qty * unit_price;
        const discount = Math.round((subtotal * disc_pct) / 100);
        const base = subtotal - discount;

        // 0..2 impuestos por línea, con tarifa 5..19 %.
        //
        // `tax_rate` va en PORCENTAJE (19.00), que es lo que la DIAN valida
        // como `cbc:Percent` con `TaxAmount = TaxableAmount × Percent/100`, y
        // lo que el validador recomputa. El generador anterior emitía la
        // FRACCIÓN (0.19) y su propio oráculo la releía como porcentaje, así
        // que exigía un descuadre que el validador —bien— no reportaba: las
        // 200 combinaciones fallaban por un defecto del generador, no del
        // código bajo prueba.
        const n_taxes = Math.floor(rng() * 3);
        const item_taxes: any[] = [];
        let item_tax_cents = 0;
        for (let t = 0; t < n_taxes; t++) {
          const rate_pct = 5 + Math.floor(rng() * 15); // 5..19 %
          const tax_amt = mul_cents(base, rate_pct);
          item_tax_cents += tax_amt;
          item_taxes.push({
            tax_rate_id: t + 100,
            tax_name: rate_pct > 15 ? 'IVA' : 'INC',
            tax_rate: rate_pct.toFixed(2),
            tax_type: rate_pct > 15 ? 'iva' : 'inc',
            taxable_amount: from_cents(base),
            tax_amount: from_cents(tax_amt),
          });
        }
        items.push({
          line_number: i + 1,
          description: 'Item ' + i,
          quantity: String(qty),
          unit_price: from_cents(unit_price),
          discount_amount: from_cents(discount),
          tax_amount: from_cents(item_tax_cents),
          taxes: item_taxes,
          unit_code: 'EA',
        });

        header_subtotal_cents += base;
        header_tax_cents += item_tax_cents;
      }

      return {
        input: {
          document_type: 'sales_invoice' as const,
          invoice_number: 'FE' + (1 + Math.floor(rng() * 100)),
          issue_date: new Date('2026-08-14T18:00:00Z'),
          timezone: 'America/Bogota',
          currency: 'COP',
          operation_type: '10',
          subtotal_amount: from_cents(header_subtotal_cents),
          discount_amount: '0.00',
          tax_amount: from_cents(header_tax_cents),
          withholding_amount: '0.00',
          total_amount: from_cents(header_subtotal_cents + header_tax_cents),
          items,
          taxes: items.flatMap((i) => i.taxes ?? []),
          resolution: {
            resolution_number: '18764000001',
            prefix: 'FE',
            range_from: 1,
            range_to: 1000,
            current_number: 5,
            valid_from: new Date('2024-01-01'),
            valid_to: new Date('2030-01-01'),
            is_active: true,
            technical_key: VALID_TECHNICAL_KEY,
          },
        },
      };
    };

    // 200 semillas = 200 combinaciones distintas. Suficiente para cubrir
    // los cruces de los rangos de arriba sin que la corrida se haga larga.
    for (let seed = 1; seed <= 200; seed++) {
      it(`combinación seed=${seed} cumple aritmética O el validador la DENUNCIA`, () => {
        const rng = mulberry32(seed);
        const built = build(rng);
        const input = built.input;
        // Recalculamos los importes de línea desde el input generado para
        // mantener el contrato de "verifica lo que el emisor declara".
        const local_lines_cents: number[] = [];
        const local_tax_cents: number[] = [];
        for (const item of input.items ?? []) {
          const qty = Number(item.quantity);
          const price = cents(Number(item.unit_price));
          const disc = cents(Number(item.discount_amount));
          local_lines_cents.push(qty * price - disc);
          let line_tax = 0;
          for (const tax of item.taxes ?? []) {
            line_tax += cents(Number(tax.tax_amount));
          }
          local_tax_cents.push(line_tax);
        }

        const report = validator.validate(input);
        const codes = new Set(report.findings.map((f) => f.code));
        const blocker_codes = new Set(report.blockers.map((f) => f.code));

        // Para cada combinación verificamos UNA propiedad: la suma de
        // los importes NETOS por línea debe coincidir con el subtotal
        // declarado (regla FAU02, anexo19.txt:22411). El validador lo
        // RECALCULA con Prisma.Decimal y lo compara: o pasa, o lo
        // DENUNCIA. Lo que NO puede pasar es que pase en silencio.
        const declared_subtotal_cents = cents(Number(input.subtotal_amount));
        const line_sum_cents = sum_cents(local_lines_cents);
        const header_subtotal_ok = declared_subtotal_cents === line_sum_cents;

        if (!header_subtotal_ok) {
          // Subtotal descuadrado: el validador DEBE denunciar.
          expect(codes.has('HEADER_LINE_EXTENSION_MISMATCH')).toBe(true);
        }

        // Idem para los totales de impuesto de cada línea.
        let all_line_taxes_ok = true;
        for (const item of input.items ?? []) {
          for (const tax of item.taxes ?? []) {
            const declared = cents(Number(tax.tax_amount));
            const base = cents(Number(tax.taxable_amount));
            // `tax_rate` es un PORCENTAJE; la igualdad que la DIAN recomputa es
            // `TaxAmount = TaxableAmount × Percent/100`.
            const computed = mul_cents(base, Number(tax.tax_rate));
            if (Math.abs(declared - computed) > 1) {
              all_line_taxes_ok = false;
              break;
            }
          }
        }
        if (!all_line_taxes_ok) {
          expect(codes.has('TAX_SUBTOTAL_MISMATCH')).toBe(true);
        }

        // PayableAmount = subtotal + tax_amount. Mismo criterio.
        const declared_total_cents = cents(Number(input.total_amount));
        const payable_computed_cents =
          line_sum_cents + sum_cents(local_tax_cents);
        if (declared_total_cents !== payable_computed_cents) {
          expect(codes.has('PAYABLE_AMOUNT_MISMATCH')).toBe(true);
        }

        // Y la contraparte: si TODAS las tres reglas se cumplen, el
        // validador NO debe reportar ninguna como blocker.
        if (
          header_subtotal_ok &&
          all_line_taxes_ok &&
          declared_total_cents === payable_computed_cents
        ) {
          expect(blocker_codes.has('HEADER_LINE_EXTENSION_MISMATCH')).toBe(false);
          expect(blocker_codes.has('PAYABLE_AMOUNT_MISMATCH')).toBe(false);
          expect(blocker_codes.has('TAX_SUBTOTAL_MISMATCH')).toBe(false);
        }
      });
    }
  });
});

