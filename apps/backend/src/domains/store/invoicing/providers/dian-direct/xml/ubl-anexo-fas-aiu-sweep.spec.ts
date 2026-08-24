import { create } from 'xmlbuilder2';
import {
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
  DIAN_AIU_NOTE_PREFIX,
  ProviderInvoiceWithholding,
  UblCommonBuilder,
  UblDocumentLine,
  buildAiuNote,
} from './ubl-common.builder';
import { DianTotalsValidator } from './dian-totals.validator';
import { UBL_NAMESPACES } from './xml-namespaces';
import { ProviderInvoiceTax } from '../../invoice-provider.interface';
import { DIAN_INVOICE_OPERATION_TYPES } from '../constants/dian-document-types';

/**
 * Barrido nodo por nodo del Anexo Técnico 1.9 (Res. 000165 de 01/NOV/2023) sobre
 * los grupos que este plan toca y que NINGUNA spec cubría: los grupos de
 * tributos de CABECERA (familia FAS), la nota del contrato AIU (FAV03) y el tipo
 * de operación (FAD02). Los totales monetarios (FAU02/04/06/14) ya los cubren
 * `ubl-monetary-total.builder.spec.ts`, `ubl-fau04-header-line-agreement.spec.ts`
 * y `dian-totals.validator.spec.ts`; acá no se repiten.
 *
 * Las páginas citadas son las IMPRESAS en el pie del PDF («Página N de 753»),
 * extraídas con `pdftotext -layout`, no las del visor.
 *
 * ## Dos divergencias quedan FIJADAS, no arregladas
 *
 * Los casos marcados «DIVERGE» afirman lo que el emisor hace HOY, con la regla
 * que incumple citada al lado. Se fijan a propósito: cambiarlos altera el XML de
 * todo documento con más de un tributo o más de una tarifa, así que el arreglo
 * es un paso de plan con su propia verificación, no un efecto colateral de una
 * spec. Si alguien corrige el emisor, ESTOS casos se caen y ahí está la señal.
 */
describe('Anexo 1.9 — barrido de los grupos FAS, FAV03 y FAD02', () => {
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

  /** Documento COMPLETO, en el orden del emisor real (`ubl-invoice.builder.ts`). */
  function emit(data: {
    discount_amount: string;
    tax_amount: string;
    items: UblDocumentLine[];
    taxes: ProviderInvoiceTax[];
  }): string {
    const doc = createInvoice();
    doc.ele(UBL_NAMESPACES.CBC, 'DocumentCurrencyCode').txt('COP');
    UblCommonBuilder.buildTaxTotals(doc, data.taxes, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(doc, data, 'COP');
    UblCommonBuilder.buildInvoiceLines(doc, data.items, data.taxes, 'COP');
    return doc.end({ prettyPrint: false });
  }

  interface Subtotal {
    taxable: string;
    amount: string;
    percent: string;
    scheme_id: string;
    scheme_name: string;
    currencies: string[];
  }
  interface TaxGroup {
    amount: string;
    amount_currency: string;
    subtotals: Subtotal[];
  }

  /**
   * Los `cac:TaxTotal` de CABECERA, o sea los que NO están bajo una línea. Se
   * recortan las líneas del XML antes de leer, que es el `not(ancestor::)` de la
   * fórmula del anexo hecho con tijeras.
   */
  function headerTaxGroups(xml: string): TaxGroup[] {
    const header = xml.replace(
      /<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g,
      '',
    );
    const groups: TaxGroup[] = [];
    for (const g of header.matchAll(
      /<cac:TaxTotal>([\s\S]*?)<\/cac:TaxTotal>/g,
    )) {
      const body = g[1];
      const head = body.split('<cac:TaxSubtotal>')[0];
      const amount = /<cbc:TaxAmount currencyID="([^"]*)">([^<]*)</.exec(head);
      const subtotals: Subtotal[] = [];
      for (const s of body.matchAll(
        /<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/g,
      )) {
        const sub = s[1];
        const pick = (name: string): string => {
          const m = new RegExp('<cbc:' + name + '[^>]*>([^<]*)<').exec(sub);
          return m ? m[1] : '';
        };
        subtotals.push({
          taxable: pick('TaxableAmount'),
          amount: pick('TaxAmount'),
          percent: pick('Percent'),
          scheme_id: pick('ID'),
          scheme_name: pick('Name'),
          currencies: [...sub.matchAll(/currencyID="([^"]*)"/g)].map(
            (m) => m[1],
          ),
        });
      }
      groups.push({
        amount: amount ? amount[2] : '',
        amount_currency: amount ? amount[1] : '',
        subtotals,
      });
    }
    return groups;
  }

  function sum(values: string[]): string {
    return values
      .reduce((acc, value) => acc + Math.round(Number(value) * 100), 0)
      .toString()
      .replace(/(\d{2})$/, '.$1');
  }

  // ---------------------------------------------------------------------------
  // FAS02 — el tributo de cabecera es la Σ DE SUS SUBTOTALES
  // ---------------------------------------------------------------------------

  describe('FAS02 (pág. 77 estructura, pág. 428 regla) — cabecera = Σ subtotales', () => {
    it('NO es base × tarifa: tres líneas al 19 % suman 21.111,10, no 21.111,11', () => {
      const bases = ['55555.55', '22222.22', '33333.34'];
      const amounts = ['10555.55', '4222.22', '6333.33'];
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: sum(amounts),
        items: bases.map((base, i) =>
          line({
            unit_price: base,
            total_amount: base,
            tax_amount: amounts[i],
          }),
        ),
        taxes: bases.map((base, i) =>
          tax({ taxable_amount: base, tax_amount: amounts[i] }),
        ),
      });

      const [group] = headerTaxGroups(xml);
      // 19 % de la base (111.111,11) daría 21.111,11 — un céntimo más. La regla
      // que la DIAN ejecuta es la Σ de los subtotales ya truncados.
      expect(sum(bases)).toBe('111111.11');
      expect(group.amount).toBe('21111.10');
      expect(sum(group.subtotals.map((s) => s.amount))).toBe(group.amount);
    });

    it('la identidad se mantiene con dos esquemas en el mismo documento', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '270.00',
        items: [line({ tax_amount: '270.00' })],
        taxes: [
          tax({ tax_amount: '190.00' }),
          tax({
            tax_name: 'INC',
            tax_type: 'inc',
            tax_rate: '8.00',
            tax_amount: '80.00',
          }),
        ],
      });

      const groups = headerTaxGroups(xml);
      const declared = sum(groups.map((g) => g.amount));
      const backing = sum(
        groups.flatMap((g) => g.subtotals.map((s) => s.amount)),
      );
      expect(declared).toBe(backing);
      expect(declared).toBe('270.00');
    });
  });

  // ---------------------------------------------------------------------------
  // FAS05 / FAS03 / FAS06 / FAS08 — base informada y moneda coherente
  // ---------------------------------------------------------------------------

  describe('FAS05 (pág. 78 / 429) y FAS03·FAS06·FAS08 (págs. 78-79 / 429-431)', () => {
    it('todo subtotal informa su base, y toda cifra monetaria lleva el @currencyID del documento', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00' })],
        taxes: [tax({})],
      });

      expect(xml).toContain(
        '<cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>',
      );
      const [group] = headerTaxGroups(xml);
      expect(group.amount_currency).toBe('COP');
      for (const subtotal of group.subtotals) {
        expect(subtotal.taxable).not.toBe('');
        expect(subtotal.currencies).toEqual(['COP', 'COP']);
      }
      // Ninguna cifra monetaria sin moneda en ninguna parte del documento.
      expect(xml).not.toMatch(/<cbc:(Taxable|Tax|Payable)Amount>/);
    });

    it('el par (ID, Name) del esquema sale de la tabla 13.2.2, no del nombre libre del tributo', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00' })],
        taxes: [tax({ tax_name: 'iva general 19' })],
      });

      const [group] = headerTaxGroups(xml);
      expect(group.subtotals[0].scheme_id).toBe('01');
      expect(group.subtotals[0].scheme_name).toBe('IVA');
    });
  });

  // ---------------------------------------------------------------------------
  // FAS01 — UN GRUPO POR CÓDIGO DE TRIBUTO  ·  DIVERGE
  // ---------------------------------------------------------------------------

  describe('FAS01 (pág. 76-77 estructura, FAS01a/FAS01b pág. 428) — un cac:TaxTotal por tributo', () => {
    /**
     * La regla, literal (pág. 76): «Grupo que informa los totales para un
     * impuesto. Es decir, por cada impuesto que se requiera informar el total,
     * debe ir un grupo TaxTotal. Un bloque para cada código de tributo».
     * FAS01a (pág. 428) lo repite en el mensaje de rechazo: «Debe existir un
     * TaxTotal a nivel de la cabecera por cada tipo de impuesto que se informa a
     * nivel de línea».
     *
     * DIVERGE — `buildTaxTotals` abre UN solo `cac:TaxTotal` y mete dentro un
     * `cac:TaxSubtotal` por código, así que una cuenta con IVA e INC declara los
     * dos tributos en el grupo de uno. `cac:TaxSubtotal` separa TARIFAS del
     * MISMO tributo (FAS04), no tributos distintos.
     */
    it('DIVERGE: IVA + INC salen en UN grupo con dos subtotales, no en dos grupos', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '270.00',
        items: [line({ tax_amount: '270.00' })],
        taxes: [
          tax({ tax_amount: '190.00' }),
          tax({
            tax_name: 'INC',
            tax_type: 'inc',
            tax_rate: '8.00',
            tax_amount: '80.00',
          }),
        ],
      });

      const groups = headerTaxGroups(xml);
      // Lo que la regla pide: groups.length === 2, uno por código.
      expect(groups).toHaveLength(1);
      expect(groups[0].subtotals.map((s) => s.scheme_id)).toEqual(['01', '04']);
    });

    it('con un solo código el resultado ya coincide con la regla: un grupo, un tributo', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00' })],
        taxes: [tax({})],
      });

      const groups = headerTaxGroups(xml);
      expect(groups).toHaveLength(1);
      expect(groups[0].subtotals.map((s) => s.scheme_id)).toEqual(['01']);
    });
  });

  // ---------------------------------------------------------------------------
  // FAS04 / FAS07 — UN SUBTOTAL POR TARIFA  ·  DIVERGE
  // ---------------------------------------------------------------------------

  describe('FAS04 (pág. 78 / 429) y FAS07 (pág. 78-79 / 430) — un subtotal por tarifa', () => {
    /**
     * FAS04: «Debe ser informado un grupo de estos para cada tarifa».
     * FAS01a: «si hay más de una tarifa del mismo impuesto se deben informar en
     * TaxSubtotal diferentes dentro del mismo TaxTotal».
     * FAS07 (rechazo): el importe del subtotal es el producto del porcentaje por
     * la base imponible.
     *
     * DIVERGE — `buildTaxTotals` agrupa por CÓDIGO DE ESQUEMA, no por (código,
     * tarifa): dos tarifas de IVA se funden en un subtotal que publica la tarifa
     * de la PRIMERA fila y la suma de las dos bases. El importe deja de ser el
     * producto de esa tarifa por esa base, que es exactamente el rechazo FAS07.
     *
     * La función hermana del mismo archivo, `buildWithholdingTaxTotal`, sí
     * acumula por (esquema, tarifa) citando FAT04 — la asimetría está dentro de
     * un archivo, no entre archivos.
     */
    it('DIVERGE: IVA 19 % + IVA 5 % se funden en un subtotal al 19 %, y base × tarifa ya no da el importe', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '240.00',
        items: [line({ tax_amount: '240.00' })],
        taxes: [
          tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
          tax({ tax_rate: '5.00', taxable_amount: '1000.00', tax_amount: '50.00' }),
        ],
      });

      const [group] = headerTaxGroups(xml);
      // Lo que la regla pide: dos subtotales, 19,00 sobre 1.000 y 5,00 sobre 1.000.
      expect(group.subtotals).toHaveLength(1);
      const [only] = group.subtotals;
      expect(only.percent).toBe('19.00');
      expect(only.taxable).toBe('2000.00');
      expect(only.amount).toBe('240.00');
      // FAS07 sobre lo emitido: 2.000,00 × 19 % = 380,00 <> 240,00 ⇒ rechazo.
      expect(Number(only.taxable) * (Number(only.percent) / 100)).toBeCloseTo(
        380,
        2,
      );
    });

    it('FAT04 (pág. 83) — la función hermana de retenciones SÍ abre un subtotal por tarifa', () => {
      const withholdings: ProviderInvoiceWithholding[] = [
        {
          withholding_type: 'reteica',
          concept_code: 'servicios',
          rate: '9.66',
          base: '1000.00',
          amount: '96.60',
        },
        {
          withholding_type: 'reteica',
          concept_code: 'comercio',
          rate: '4.14',
          base: '1000.00',
          amount: '41.40',
        },
      ];
      const doc = createInvoice();
      UblCommonBuilder.buildWithholdingTaxTotal(doc, withholdings, 'COP');
      const xml = doc.end({ prettyPrint: false });

      const groups = [
        ...xml.matchAll(
          /<cac:WithholdingTaxTotal>([\s\S]*?)<\/cac:WithholdingTaxTotal>/g,
        ),
      ];
      expect(groups).toHaveLength(1);
      const percents = [
        ...groups[0][1].matchAll(/<cbc:Percent>([^<]*)</g),
      ].map((m) => m[1]);
      expect(percents).toEqual(['9.66', '4.14']);
    });
  });

  // ---------------------------------------------------------------------------
  // FAX01 / FAX02 / FAX04 — el grupo de tributos DE LÍNEA  ·  DIVERGE
  // ---------------------------------------------------------------------------

  describe('FAX01 (pág. 95 / 448), FAX02 (pág. 95-96 / 449) y FAX04 (pág. 96) — un bloque por código', () => {
    /**
     * FAX01, literal (pág. 95): «Un bloque para cada código de tributo. Rechazo:
     * Si existe más de un bloque con el mismo valor en el elemento
     * de:TaxTotal/TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:ID».
     *
     * FAX02 lo hace aritmético (pág. 96): «every $i in //cac:InvoiceLine
     * satisfies if ($i/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/
     * cac:TaxScheme/cbc:ID = '01') then round($i/cac:TaxTotal[cac:TaxSubtotal/
     * cac:TaxCategory/cac:TaxScheme/cbc:ID = '01']/cbc:TaxAmount) =
     * round(sum($i/cac:TaxTotal/cac:TaxSubtotal[cac:TaxCategory/…]…))», con la
     * nota «01 representa un ejemplo … se debe considerar el código del impuesto
     * informado que aplique a esta línea». El predicado selecciona el bloque POR
     * ESQUEMA y lo compara contra los subtotales DE ESE ESQUEMA.
     *
     * DIVERGE — `buildLineTaxTotal` abre UN bloque por línea (:2145) y le cuelga
     * un subtotal por fila de `item.taxes` (:2194-2197), cada uno con SU esquema.
     * En la cuenta mixta IVA + INC —el caso para el que se construyó el desglose
     * de línea— el bloque queda seleccionado por los dos esquemas y su
     * `cbc:TaxAmount` es la suma de ambos, así que el lado izquierdo del
     * predicado vale 270,00 donde el derecho vale 190,00.
     */
    it('DIVERGE: IVA + INC en la MISMA línea salen en un bloque cuyo total no es el de ningún esquema', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '270.00',
        items: [
          line({
            tax_amount: '270.00',
            taxes: [
              tax({ tax_amount: '190.00' }),
              tax({
                tax_name: 'INC',
                tax_type: 'inc',
                tax_rate: '8.00',
                tax_amount: '80.00',
              }),
            ],
          }),
        ],
        taxes: [
          tax({ tax_amount: '190.00' }),
          tax({
            tax_name: 'INC',
            tax_type: 'inc',
            tax_rate: '8.00',
            tax_amount: '80.00',
          }),
        ],
      });

      const chunks = xml.split('<cac:InvoiceLine>').slice(1);
      expect(chunks).toHaveLength(1);
      const blocks = [
        ...chunks[0].matchAll(/<cac:TaxTotal>([\s\S]*?)<\/cac:TaxTotal>/g),
      ];
      // Lo que la regla pide: blocks.length === 2, uno por código.
      expect(blocks).toHaveLength(1);

      const body = blocks[0][1];
      const head = body.split('<cac:TaxSubtotal>')[0];
      expect(/<cbc:TaxAmount currencyID="COP">([^<]*)</.exec(head)?.[1]).toBe(
        '270.00',
      );
      const schemes = [...body.matchAll(/<cbc:ID>([^<]*)</g)].map((m) => m[1]);
      expect(schemes).toEqual(['01', '04']);
      // FAX02 con el esquema '01': el bloque seleccionado declara 270,00 y sus
      // subtotales de IVA suman 190,00 ⇒ rechazo.
      const iva = [
        ...body.matchAll(
          /<cac:TaxSubtotal>[\s\S]*?<cbc:TaxAmount currencyID="COP">([^<]*)<[\s\S]*?<cbc:ID>01<\/cbc:ID>/g,
        ),
      ].map((m) => m[1]);
      expect(iva).toEqual(['190.00']);
    });

    it('el camino heredado —una línea sin desglose— sí cumple: un bloque, un esquema, una tarifa', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00' })],
        taxes: [tax({})],
      });

      const chunks = xml.split('<cac:InvoiceLine>').slice(1);
      const blocks = [
        ...chunks[0].matchAll(/<cac:TaxTotal>([\s\S]*?)<\/cac:TaxTotal>/g),
      ];
      expect(blocks).toHaveLength(1);
      const subtotals = [
        ...blocks[0][1].matchAll(/<cac:TaxSubtotal>/g),
      ];
      expect(subtotals).toHaveLength(1);
      expect(blocks[0][1]).toContain('<cbc:Percent>19.00</cbc:Percent>');
    });
  });

  // ---------------------------------------------------------------------------
  // FAV03 — la nota del contrato AIU
  // ---------------------------------------------------------------------------

  describe('FAV03 (pág. 89 estructura, pág. 443 regla) — cbc:Note del ítem Administración', () => {
    it('la cota del nodo es 20..5000 y el literal es el exacto del anexo', () => {
      expect(DIAN_AIU_NOTE_PREFIX).toBe(
        'Contrato de servicios AIU por concepto de:',
      );
      expect(DIAN_AIU_NOTE_MIN_LENGTH).toBe(20);
      expect(DIAN_AIU_NOTE_MAX_LENGTH).toBe(5000);
    });

    it('compone prefijo + un espacio + objeto, y devuelve vacío sin objeto', () => {
      expect(buildAiuNote('interventoría vía Chía-Cajicá')).toBe(
        'Contrato de servicios AIU por concepto de: interventoría vía Chía-Cajicá',
      );
      expect(buildAiuNote('   ')).toBe('');
      expect(buildAiuNote(null)).toBe('');
      expect(buildAiuNote(undefined)).toBe('');
    });

    it('el nodo va INMEDIATAMENTE después de cbc:ID, que es donde la secuencia de InvoiceLineType lo pone', () => {
      const note = buildAiuNote('obra civil');
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00', note })],
        taxes: [tax({})],
      });

      expect(xml).toContain(
        '<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:Note>' +
          note +
          '</cbc:Note><cbc:InvoicedQuantity',
      );
    });

    it('la línea sin nota no emite el nodo: FAV03 es 0..N, no 1..1', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00' })],
        taxes: [tax({})],
      });

      expect(xml).not.toContain('<cbc:Note>');
    });
  });

  // ---------------------------------------------------------------------------
  // FAD02 — el tipo de operación
  // ---------------------------------------------------------------------------

  describe('FAD02 (pág. 28 estructura, pág. 382 regla) y numeral 13.2.1.1 (pág. 731)', () => {
    it('el catálogo declara los cuatro códigos de la tabla, con 09 = AIU y 10 por defecto', () => {
      expect(DIAN_INVOICE_OPERATION_TYPES.AIU).toBe('09');
      expect(DIAN_INVOICE_OPERATION_TYPES.STANDARD).toBe('10');
      expect(DIAN_INVOICE_OPERATION_TYPES.MANDATE).toBe('11');
      expect(DIAN_INVOICE_OPERATION_TYPES.TRANSPORT).toBe('12');
    });
  });

  // ---------------------------------------------------------------------------
  // El contrato AIU medido en vivo, emitido entero
  // ---------------------------------------------------------------------------

  describe('AIU 4/3/3/90 sobre un contrato de 100.000 — el documento completo cuadra', () => {
    /**
     * El cruce ya medido: contrato de 100.000 repartido A 4 % / I 3 % / U 3 % /
     * costo 90 %. Bajo `taxable_basis: 'aiu'` la base gravable es 10.000 y el
     * piso legal del 10 % (E.T. art. 462-1) es también 10.000, así que el
     * documento está JUSTO en el límite. El costo reembolsable sale de la base
     * con `omit_tax_total` (FAX01, pág. 95 / 448: «ítems cuyo concepto en
     * contratos de AIU no haga parte de la base gravable»).
     */
    it('LineExtensionAmount es el contrato y TaxExclusiveAmount la base gravable: 100.000 vs 10.000', () => {
      const items: UblDocumentLine[] = [
        line({
          description: 'Administración',
          unit_price: '4000.00',
          total_amount: '4000.00',
          tax_amount: '760.00',
          note: buildAiuNote('interventoría'),
        }),
        line({
          description: 'Imprevistos',
          unit_price: '3000.00',
          total_amount: '3000.00',
          tax_amount: '570.00',
        }),
        line({
          description: 'Utilidad',
          unit_price: '3000.00',
          total_amount: '3000.00',
          tax_amount: '570.00',
        }),
        line({
          description: 'Costo reembolsable',
          unit_price: '90000.00',
          total_amount: '90000.00',
          tax_amount: '0.00',
          omit_tax_total: true,
        }),
      ];
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '1900.00',
        items,
        taxes: [tax({ taxable_amount: '10000.00', tax_amount: '1900.00' })],
      });

      const totals: Record<string, string> = {};
      const group = /<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/.exec(
        xml,
      );
      for (const m of (group ? group[1] : '').matchAll(
        /<cbc:(\w+) currencyID="COP">([^<]*)</g,
      )) {
        totals[m[1]] = m[2];
      }

      expect(totals.LineExtensionAmount).toBe('100000.00');
      expect(totals.TaxExclusiveAmount).toBe('10000.00');
      expect(totals.TaxInclusiveAmount).toBe('101900.00');
      expect(totals.PayableAmount).toBe('101900.00');

      // El piso del 10 % del contrato es la propia base: el documento está en el
      // límite y NO por debajo. Truncar es lo que lo salva (ver la nota del
      // repositorio sobre el piso del AIU).
      expect(Number(totals.TaxExclusiveAmount)).toBeGreaterThanOrEqual(
        Number(totals.LineExtensionAmount) * 0.1,
      );

      // La línea del costo no emite grupo de tributos, así que no aporta base.
      const chunks = xml.split('<cac:InvoiceLine>').slice(1);
      expect(chunks).toHaveLength(4);
      const cost = chunks.find((chunk) =>
        chunk.includes('Costo reembolsable'),
      );
      expect(cost).toBeDefined();
      expect(cost as string).not.toContain('<cac:TaxTotal>');
      expect(
        chunks.filter((chunk) => chunk.includes('<cac:TaxTotal>')),
      ).toHaveLength(3);

      // Y la compuerta real no encuentra nada que objetar.
      expect(DianTotalsValidator.validate(xml).violations).toEqual([]);
    });
  });
});
