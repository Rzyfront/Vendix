import { create } from 'xmlbuilder2';
import { UblCommonBuilder, UblDocumentLine } from './ubl-common.builder';
import { DianTotalsValidator } from './dian-totals.validator';
import { UBL_NAMESPACES } from './xml-namespaces';
import { ProviderInvoiceTax } from '../../invoice-provider.interface';

/**
 * FAU04 — la cabecera y las líneas tienen que declarar la MISMA base imponible.
 *
 * Este archivo no afirma sobre importes sueltos: construye el documento
 * COMPLETO —líneas y grupo de totales— y lo pasa por `DianTotalsValidator`, que
 * es la misma compuerta que corre antes de firmar. Es la única forma de probar
 * la regla: los dos lados de la comparación los producen funciones distintas, y
 * un spec que sólo llama al grupo de totales no puede ver el desacuerdo.
 *
 * ## El defecto que motiva el archivo (Gap 11 / D2-d)
 *
 * La cabecera admitía una línea en la base con UNA condición (`!omit_tax_total`);
 * la línea emitía su `cac:TaxTotal` con DOS (`!omit_tax_total` **y** tener
 * tributo propio o de cabecera del que heredar). El documento SIN NINGÚN tributo
 * caía en la grieta: cero subtotales en las líneas, el bruto entero en la
 * cabecera, y FAU04 rechazándolo antes de firmar.
 *
 * El caso no es exótico: es una tienda que sólo vende bienes excluidos (art. 476
 * ET) y por lo tanto no marca `omit_tax_total` —esa bandera la pone el riel AIU,
 * no el catálogo—, así que llega con `taxes: []` y sin banderas.
 */
describe('FAU04 — la base de la cabecera es la que declaran las líneas', () => {
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

  /**
   * Emite el documento COMPLETO —grupos de tributos de cabecera, totales y
   * líneas— y devuelve el XML junto con los importes del grupo de totales.
   *
   * ## Por qué llama a `buildTaxTotals`
   *
   * La versión anterior emitía sólo totales y líneas, porque FAU04 no necesita
   * los grupos de cabecera. Al entrar FAU06 al validador eso dejó de valer: esa
   * regla suma justamente `//cac:TaxTotal[not(ancestor::cac:InvoiceLine)]`, así
   * que un fixture sin grupos de cabecera declara 0,00 de tributo y hace fallar
   * un documento que el emisor real produce bien. El orden es el del emisor
   * (`ubl-invoice.builder.ts`): `TaxTotal` → `LegalMonetaryTotal` → líneas.
   *
   * Y con eso el fixture cubre las CUATRO identidades de totales de una vez, que
   * es lo que hace falta: los dos lados de cada comparación los escriben
   * funciones distintas, y sólo el documento entero delata el desacuerdo.
   */
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

  /** Suma los `cbc:TaxableAmount` de línea tal como los lee la DIAN. */
  function lineTaxableSum(xml: string): number {
    let total = 0;
    for (const l of xml.matchAll(/<cac:InvoiceLine>(.*?)<\/cac:InvoiceLine>/g)) {
      for (const t of l[1].matchAll(
        /<cbc:TaxableAmount currencyID="COP">([^<]*)<\/cbc:TaxableAmount>/g,
      )) {
        total += Number(t[1]);
      }
    }
    return total;
  }

  function expectClean(xml: string): void {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('EL DEFECTO: 100 % excluida SIN bandera y sin tributos de cabecera', () => {
    // Ni una línea marca `omit_tax_total` ni hay tributos de cabecera. Antes del
    // arreglo la cabecera declaraba 69900,00 y las líneas 0,00 → FAU04.
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '0.00',
      items: [
        line({ unit_price: '69900.00', total_amount: '69900.00' }),
      ],
      taxes: [],
    });

    expect(totals.LineExtensionAmount).toBe('69900.00');
    expect(totals.TaxExclusiveAmount).toBe('0.00');
    // FAU06 / FAU14 intactas: el cliente sigue debiendo lo mismo.
    expect(totals.TaxInclusiveAmount).toBe('69900.00');
    expect(totals.PayableAmount).toBe('69900.00');

    expect(lineTaxableSum(xml)).toBe(0);
    expect(xml).not.toContain('cac:TaxTotal');
    expectClean(xml);
  });

  it('100 % excluida CON bandera — el camino que ya funcionaba', () => {
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '0.00',
      items: [
        line({
          unit_price: '69900.00',
          total_amount: '69900.00',
          omit_tax_total: true,
        }),
      ],
      taxes: [],
    });

    expect(totals.TaxExclusiveAmount).toBe('0.00');
    expect(lineTaxableSum(xml)).toBe(0);
    expectClean(xml);
  });

  it('mixta: sólo la línea que declara tributo aporta base', () => {
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '190.00',
      items: [
        line({ unit_price: '1000.00', tax_amount: '190.00', total_amount: '1190.00' }),
        line({ unit_price: '500.00', total_amount: '500.00', omit_tax_total: true }),
      ],
      taxes: [tax({})],
    });

    expect(totals.LineExtensionAmount).toBe('1500.00');
    expect(totals.TaxExclusiveAmount).toBe('1000.00');
    expect(lineTaxableSum(xml)).toBe(1000);
    expectClean(xml);
  });

  it('AIU: el valor del contrato y la base gravable son cifras DISTINTAS', () => {
    // Contrato de 100 M con base gravable de 10 M (A+I+U del 10 %). La cabecera
    // NO puede declarar el contrato como base: la línea declara 10 M.
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '1900000.00',
      items: [
        line({
          description: 'Administración',
          unit_price: '100000000.00',
          total_amount: '100000000.00',
          tax_amount: '1900000.00',
          taxes: [
            tax({ taxable_amount: '10000000.00', tax_amount: '1900000.00' }),
          ],
        }),
      ],
      taxes: [tax({ taxable_amount: '10000000.00', tax_amount: '1900000.00' })],
    });

    expect(totals.LineExtensionAmount).toBe('100000000.00');
    expect(totals.TaxExclusiveAmount).toBe('10000000.00');
    // FAU06: `TaxInclusiveAmount` = valor del contrato + impuesto, NO base +
    // impuesto. Es la cifra que el cliente debe.
    expect(totals.TaxInclusiveAmount).toBe('101900000.00');
    expect(lineTaxableSum(xml)).toBe(10000000);
    expectClean(xml);
  });

  it('dos tributos en una línea: la cabecera replica la Σ de subtotales', () => {
    // IVA 19 % e INC 8 % sobre la MISMA base de 1000. FAU04 suma NODOS
    // `cbc:TaxableAmount`, así que la Σ de línea es 2000 y la cabecera tiene que
    // declarar 2000 para cuadrar. "Corregir" el doble conteo a 1000 produciría el
    // rechazo — la regla no admite la interpretación contable.
    //
    // Los DOS tributos van también en `taxes`, no sólo en la línea. Antes iba
    // `[tax({})]` —sólo el IVA— y el documento declaraba 270,00 de tributo en el
    // total con un único grupo de cabecera de 190,00: un rechazo FAU06 que
    // ninguna aserción de este archivo podía ver, porque el fixture no emitía
    // los grupos de cabecera.
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '270.00',
      items: [
        line({
          unit_price: '1000.00',
          total_amount: '1270.00',
          tax_amount: '270.00',
          taxes: [
            tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
            tax({
              tax_name: 'INC',
              tax_rate: '8.00',
              taxable_amount: '1000.00',
              tax_amount: '80.00',
              tax_type: 'inc',
            }),
          ],
        }),
      ],
      taxes: [
        tax({}),
        tax({
          tax_name: 'INC',
          tax_rate: '8.00',
          taxable_amount: '1000.00',
          tax_amount: '80.00',
          tax_type: 'inc',
        }),
      ],
    });

    expect(totals.TaxExclusiveAmount).toBe('2000.00');
    expect(totals.TaxInclusiveAmount).toBe('1270.00');
    expect(lineTaxableSum(xml)).toBe(2000);
    expectClean(xml);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // FAU06 — la grieta entre el escalar y el arreglo
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `buildMonetaryTotal` calcula `TaxInclusiveAmount` con `data.tax_amount` —un
   * ESCALAR— mientras `buildTaxTotals` publica los grupos de cabecera desde
   * `data.taxes` —un ARREGLO—. Son dos entradas independientes del mismo hecho,
   * y nada dentro del emisor las obliga a coincidir: la única compuerta que ve
   * la divergencia es FAU06 sobre el XML armado.
   *
   * Este par de casos fija ese contrato. No es hipotético: el fixture de los dos
   * tributos de arriba llevaba exactamente esa divergencia (270,00 en el escalar,
   * 190,00 en el arreglo) y pasaba en verde.
   */
  it('rechaza el escalar que no cuadra con los grupos de cabecera', () => {
    const { xml, totals } = emit({
      discount_amount: '0.00',
      // 270,00 en el total, pero abajo sólo se declara el grupo de IVA (190,00).
      tax_amount: '270.00',
      items: [
        line({
          unit_price: '1000.00',
          total_amount: '1190.00',
          tax_amount: '190.00',
          taxes: [tax({})],
        }),
      ],
      taxes: [tax({})],
    });

    expect(totals.TaxInclusiveAmount).toBe('1270.00');

    const result = DianTotalsValidator.validate(xml);

    expect(result.violations.map((v) => v.rule)).toEqual(['FAU06']);
    expect(result.violations[0].details).toMatchObject({
      declared: '1270.00',
      line_extension: '1000.00',
      header_tax_amount: '190.00',
      expected: '1190.00',
    });
  });

  it('acepta el mismo documento cuando el escalar es la Σ del arreglo', () => {
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '190.00',
      items: [
        line({
          unit_price: '1000.00',
          total_amount: '1190.00',
          tax_amount: '190.00',
          taxes: [tax({})],
        }),
      ],
      taxes: [tax({})],
    });

    expect(totals.TaxInclusiveAmount).toBe('1190.00');
    expectClean(xml);
  });
  /**
   * CONTRATO AIU DEL MODELO 1 — la factura 63 (`FVJL11`).
   *
   * Contrato de $2.328.800 en dos líneas, AIU del 10 % repartido 5/2/3, base
   * Decreto 1372/1992 (sólo la utilidad, el 3 %): $69.864 de base gravable y
   * $13.274,16 de IVA. Las dos líneas son `aiu_component: 'contrato'`, o sea
   * cada una ES el contrato entero, y su base es una fracción de su importe.
   */
  describe('Modelo 1 del AIU — la línea que es el contrato entero', () => {
    /** El documento tal como lo emite el riel con el desglose por línea. */
    const contrato = () =>
      emit({
        discount_amount: '0.00',
        tax_amount: '13274.16',
        items: [
          line({
            description: 'instalacion de union de reparacion z 6"',
            unit_price: '852000.00',
            total_amount: '856856.40',
            tax_amount: '4856.40',
            taxes: [
              tax({ taxable_amount: '25560.00', tax_amount: '4856.40' }),
            ],
          }),
          line({
            description: 'instalacion de union de reparacion z de 8"',
            unit_price: '1476800.00',
            total_amount: '1485217.76',
            tax_amount: '8417.76',
            taxes: [
              tax({ taxable_amount: '44304.00', tax_amount: '8417.76' }),
            ],
          }),
        ],
        taxes: [tax({ taxable_amount: '69864.00', tax_amount: '13274.16' })],
      });

    it('declara la UTILIDAD como base imponible, no el valor del contrato', () => {
      const { xml, totals } = contrato();

      // El bruto sigue siendo el contrato entero: FAU14 (cabecera = Σ líneas) es
      // otra regla y el cliente debe lo que debe.
      expect(totals.LineExtensionAmount).toBe('2328800.00');
      // La BASE IMPONIBLE, en cambio, es sólo la utilidad.
      expect(totals.TaxExclusiveAmount).toBe('69864.00');
      expect(totals.TaxInclusiveAmount).toBe('2342074.16');
      expect(totals.PayableAmount).toBe('2342074.16');

      expect(lineTaxableSum(xml)).toBe(69864);
      expectClean(xml);
    });

    it('cada línea cierra contra su propia tarifa: 19 % de su base es su cuota', () => {
      const { xml } = contrato();

      const subtotales = [
        ...xml.matchAll(
          /<cbc:TaxableAmount currencyID="COP">([^<]*)<\/cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">([^<]*)<\/cbc:TaxAmount>/g,
        ),
      ].map((m) => [Number(m[1]), Number(m[2])]);

      for (const [base, cuota] of subtotales) {
        expect(base * 0.19).toBeCloseTo(cuota, 2);
      }
    });

    /**
     * EL DEFECTO, y por qué NINGUNA compuerta aritmética lo veía.
     *
     * Sin desglose por línea el emisor cae al camino histórico y escribe
     * `cbc:TaxableAmount = cbc:LineExtensionAmount`. Las cuatro identidades de
     * totales SIGUEN CUADRANDO —los dos lados de FAU04 salen de la misma
     * función, así que se mueven juntos— y el documento pasa el validador
     * entero. Lo que sale es un XML internamente consistente que declara
     * $2.328.800 de base gravable con $13.274,16 de IVA: la DIAN lo ACEPTA, y
     * el error sólo se corrige después con nota crédito.
     *
     * Por eso la base tiene que venir del desglose de línea y no puede
     * defenderse con una regla de totales.
     */
    it('sin desglose de línea el documento es consistente Y declara 33 veces la base', () => {
      const { xml, totals } = emit({
        discount_amount: '0.00',
        tax_amount: '13274.16',
        items: [
          line({
            unit_price: '852000.00',
            total_amount: '856856.40',
            tax_amount: '4856.40',
          }),
          line({
            unit_price: '1476800.00',
            total_amount: '1485217.76',
            tax_amount: '8417.76',
          }),
        ],
        taxes: [tax({ taxable_amount: '69864.00', tax_amount: '13274.16' })],
      });

      expect(totals.TaxExclusiveAmount).toBe('2328800.00');
      expect(lineTaxableSum(xml)).toBe(2328800);
      // Y aun así: cero violaciones.
      expectClean(xml);
    });
  });
});
