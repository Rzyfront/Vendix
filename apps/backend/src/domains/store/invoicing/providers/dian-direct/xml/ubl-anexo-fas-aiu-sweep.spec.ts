import { readFileSync } from 'fs';
import { join } from 'path';
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
 * ## Las divergencias FAS quedaron resueltas; ninguna sigue fijada
 *
 * Los casos marcados «DIVERGE» afirmaban lo que el emisor hacía HOY, con la
 * regla que incumple citada al lado. Se fijaban a propósito: cambiarlos altera
 * el XML de todo documento con más de un tributo, así que el arreglo era un
 * paso de plan con su propia verificación, no un efecto colateral de una spec.
 * Los tres cerraron:
 *
 * · **FAS01a / FAS04 / FAS07** — la cabecera abre un `cac:TaxSubtotal` por
 *   TARIFA, no uno por esquema. Antes un IVA 19 % + IVA 5 % salía como un
 *   subtotal al 19,00 % sobre 2.000,00 declarando 240,00, y `base × tarifa` daba
 *   380,00.
 * · **FAX01 / FAX02** — la línea abre un `cac:TaxTotal` por CÓDIGO DE TRIBUTO,
 *   cada uno con su propio importe. Antes un IVA 190 + INC 80 en la misma línea
 *   salía en un bloque que declaraba 270,00 donde el predicado de FAX02 para el
 *   esquema '01' exige 190,00.
 * · **FAS01** — DECIDIDA el 2026-08-25 (dueño, paso F.7): UN `cac:TaxTotal` de
 *   cabecera con TODOS los esquemas como `cac:TaxSubtotal`. El rechazo
 *   enumerado (pág. 76) castiga «más de un grupo con el mismo valor en
 *   …TaxScheme/cbc:ID» y FAS01b (pág. 428) exige «solo un grupo con información
 *   de totales para un mismo tributo»: el grupo único multi-esquema cumple las
 *   dos lecturas. Su caso pasó de `DIVERGE:` a exigir la forma decidida, junto
 *   con la política de redondeo escrita en `buildTaxTotals`: subtotal al centavo
 *   y total = suma EXACTA de los subtotales ya redondeados.
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

  interface LineTaxBlock {
    /** `cbc:TaxAmount` HIJO DIRECTO del bloque — el lado izquierdo de FAX02. */
    amount: string;
    schemes: string[];
    percents: string[];
    subtotal_bases: string[];
    subtotal_amounts: string[];
  }

  /**
   * Los bloques `cac:TaxTotal` de UNA línea, ya partidos. Es el `$i/cac:TaxTotal`
   * de la fórmula de FAX02 sobre un solo `cac:InvoiceLine`: el importe del bloque
   * a un lado, los subtotales que deberían respaldarlo al otro.
   */
  function lineTaxBlocks(line_chunk: string): LineTaxBlock[] {
    // Cortar en el cierre de la línea: `xml.split('<cac:InvoiceLine>')` deja
    // pegado todo lo que venga después, y sin este recorte una segunda línea
    // contaminaría los bloques de la primera.
    const body = line_chunk.split('</cac:InvoiceLine>')[0];
    return [...body.matchAll(/<cac:TaxTotal>([\s\S]*?)<\/cac:TaxTotal>/g)].map(
      (m) => {
        const block = m[1];
        const head = block.split('<cac:TaxSubtotal>')[0];
        const subtotals = [
          ...block.matchAll(/<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/g),
        ].map((s) => s[1]);
        const pick = (sub: string, name: string): string => {
          const found = new RegExp('<cbc:' + name + '[^>]*>([^<]*)<').exec(sub);
          return found ? found[1] : '';
        };
        return {
          amount:
            /<cbc:TaxAmount currencyID="[^"]*">([^<]*)</.exec(head)?.[1] ?? '',
          schemes: subtotals.map((sub) => pick(sub, 'ID')),
          percents: subtotals.map((sub) => pick(sub, 'Percent')),
          subtotal_bases: subtotals.map((sub) => pick(sub, 'TaxableAmount')),
          subtotal_amounts: subtotals.map((sub) => pick(sub, 'TaxAmount')),
        };
      },
    );
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
  // FAS01 — UN GRUPO DE CABECERA CON TODOS LOS ESQUEMAS · forma decidida (F.7)
  // ---------------------------------------------------------------------------

  describe('FAS01 (pág. 76-77 estructura, FAS01a/FAS01b pág. 428) — un cac:TaxTotal con todos los esquemas', () => {
    /**
     * DECISIÓN F.7 (dueño, 2026-08-25). La lectura «un TaxTotal por código de
     * tributo» convivió siempre con su propio rechazo enumerado: FAS01
     * (pág. 76) castiga «si existe MÁS DE UN grupo con el MISMO valor en
     * …TaxScheme/cbc:ID», y FAS01b (pág. 428) exige «existe SOLO un grupo con
     * información de totales para un mismo tributo». La forma que cumple las
     * dos — y la que el emisor decide — es UN `cac:TaxTotal` de cabecera cuyo
     * `cac:TaxSubtotal` separa esquemas y tarifas.
     *
     * Este caso vivió como `DIVERGE:` fijando la conducta contraria mientras la
     * decisión estaba abierta; hoy exige la forma del anexo decidida, junto con
     * la política de redondeo escrita en `buildTaxTotals`: cada subtotal al
     * centavo y el `cbc:TaxAmount` del grupo como SUMA EXACTA de los subtotales
     * ya redondeados, nunca recalculado aparte.
     */
    it('IVA + INC informan UN grupo de cabecera con dos subtotales, uno por esquema', () => {
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
      expect(groups).toHaveLength(1);
      expect(groups[0].subtotals.map((s) => s.scheme_id)).toEqual(['01', '04']);
    });

    it('un documento mono-impuesto: el mismo grupo único, con su único subtotal', () => {
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

    it('no aparecen dos grupos con el mismo TaxScheme/cbc:ID — el rechazo que sí está enumerado', () => {
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
      const seen = new Set<string>();
      for (const group of groups) {
        for (const subtotal of group.subtotals) {
          expect(seen.has(subtotal.scheme_id)).toBe(false);
          seen.add(subtotal.scheme_id);
        }
      }
      expect([...seen].sort()).toEqual(['01', '04']);
    });

    it('el documento IVA+INC completo pasa DianTotalsValidator y el total es la suma exacta de los subtotales', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '270.00',
        items: [
          line({
            tax_amount: '270.00',
            taxes: [
              tax({}),
              tax({
                tax_name: 'INC',
                tax_type: 'inc',
                tax_rate: '8.00',
                taxable_amount: '1000.00',
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

      const result = DianTotalsValidator.validate(xml);
      expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual(
        [],
      );
      expect(result.valid).toBe(true);

      // Política de redondeo F.7 sobre el XML emitido: el TaxAmount del grupo
      // es la suma EXACTA de los subtotales ya redondeados al centavo.
      const [group] = headerTaxGroups(xml);
      expect(group.amount).toBe('270.00');
      expect(group.amount).toBe(sum(group.subtotals.map((s) => s.amount)));
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
     * ARREGLADO — `buildTaxTotals` agrupa por (esquema, tarifa) reusando el
     * MISMO ayudante que la línea y las retenciones. Antes agrupaba sólo por
     * código de esquema y publicaba la tarifa de la PRIMERA fila sobre la suma de
     * las dos bases: un IVA 19 % + IVA 5 % de 1.000 cada uno salía como
     * `Percent 19.00` / `TaxableAmount 2000.00` / `TaxAmount 240.00`, y
     * `base × tarifa` daba 380,00 — el rechazo literal de FAS07.
     *
     * La función hermana del mismo archivo, `buildWithholdingTaxTotal`, ya
     * acumulaba por (esquema, tarifa) citando FAT04: la asimetría estaba dentro
     * de un archivo, no entre archivos, y se cerró extrayendo la agrupación a un
     * único ayudante en vez de copiarla.
     */
    it('IVA 19 % + IVA 5 % abren DOS subtotales, y en cada uno base × tarifa da su importe', () => {
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
      expect(group.subtotals).toHaveLength(2);
      expect(
        group.subtotals.map((s) => [s.percent, s.taxable, s.amount]),
      ).toEqual([
        ['19.00', '1000.00', '190.00'],
        ['5.00', '1000.00', '50.00'],
      ]);
      // Las dos tarifas son del MISMO tributo, así que van en el MISMO TaxTotal:
      // es lo que FAS01a distingue de FAS01 («dentro del mismo TaxTotal»).
      expect(group.subtotals.map((s) => s.scheme_id)).toEqual(['01', '01']);

      // FAS07 sobre lo emitido, subtotal por subtotal: ahora el importe SÍ es el
      // producto de la tarifa por la base.
      for (const subtotal of group.subtotals) {
        expect(
          Number(subtotal.taxable) * (Number(subtotal.percent) / 100),
        ).toBeCloseTo(Number(subtotal.amount), 2);
      }
      // FAS02 sigue cuadrando: la cabecera es la Σ de los DOS subtotales.
      expect(group.amount).toBe('240.00');
      expect(sum(group.subtotals.map((s) => s.amount))).toBe(group.amount);
    });

    it('una sola tarifa sigue emitiendo UN solo subtotal — cero regresión', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '380.00',
        items: [line({ tax_amount: '380.00' })],
        taxes: [
          tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
          tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
        ],
      });

      const [group] = headerTaxGroups(xml);
      expect(group.subtotals).toHaveLength(1);
      expect(group.subtotals[0].percent).toBe('19.00');
      expect(group.subtotals[0].taxable).toBe('2000.00');
      expect(group.subtotals[0].amount).toBe('380.00');
      expect(group.amount).toBe('380.00');
    });

    it('el ICA conserva su saneamiento por-mil COMO CLAVE: 7 ‰ y 4 ‰ son dos tarifas', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '11.00',
        items: [line({ tax_amount: '11.00' })],
        taxes: [
          tax({
            tax_name: 'ICA',
            tax_type: 'ica',
            tax_rate: '7.00',
            taxable_amount: '1000.00',
            tax_amount: '7.00',
          }),
          tax({
            tax_name: 'ICA',
            tax_type: 'ica',
            tax_rate: '4.00',
            taxable_amount: '1000.00',
            tax_amount: '4.00',
          }),
        ],
      });

      const [group] = headerTaxGroups(xml);
      expect(group.subtotals.map((s) => s.percent)).toEqual([
        '0.7000',
        '0.4000',
      ]);
      expect(group.subtotals.map((s) => s.scheme_id)).toEqual(['03', '03']);
      expect(group.amount).toBe('11.00');
    });

    it('KG-17 — con dos tarifas la cabecera es la Σ DE LOS SUBTOTALES, no la Σ cruda', () => {
      // `dianSum` trunca a 2 decimales UNA VEZ POR LLAMADA, y agrupar multiplica
      // las llamadas. Con dos filas de 10,005 la Σ cruda trunca a 20,01 mientras
      // cada subtotal trunca a 10,00 y suman 20,00: el céntimo de diferencia
      // existe y es medible. FAS02 exige que la cabecera sea la de los
      // SUBTOTALES, así que el emisor la computa desde ellos y la identidad se
      // cumple por construcción.
      //
      // NOTA MEDIDA: por el camino real este caso NO puede ocurrir.
      // `invoice_taxes.taxable_amount` y `.tax_amount` son `Decimal(12,2)`
      // (schema.prisma), así que toda fila llega ya truncada y truncar dos veces
      // es la identidad. El céntimo sólo aparece si un productor entrega más de
      // dos decimales sin persistirlos.
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '20.01',
        items: [line({ tax_amount: '20.01' })],
        taxes: [
          tax({ taxable_amount: '100.00', tax_amount: '10.005' }),
          tax({
            tax_rate: '5.00',
            taxable_amount: '100.00',
            tax_amount: '10.005',
          }),
        ],
      });

      const [group] = headerTaxGroups(xml);
      expect(group.subtotals.map((s) => s.amount)).toEqual(['10.00', '10.00']);
      // La identidad que la DIAN ejecuta se cumple…
      expect(group.amount).toBe('20.00');
      expect(sum(group.subtotals.map((s) => s.amount))).toBe(group.amount);
      // …y el céntimo queda EN EL ESCALAR del documento, que es otra entrada del
      // mismo hecho y vive fuera de este builder: `TaxInclusiveAmount` se publica
      // desde `data.tax_amount` (20,01) mientras los tributos de cabecera suman
      // 20,00.
      expect(xml).toContain(
        '<cbc:TaxInclusiveAmount currencyID="COP">1020.01</cbc:TaxInclusiveAmount>',
      );
      // Y NO es rechazo: FAU06 compara con `round()`, es decir A PESO ENTERO
      // —`DianTotalsValidator.pesos` replica esa semántica—, así que un céntimo
      // de residuo es invisible para la regla. Medido, no supuesto: la compuerta
      // no encuentra nada que objetar.
      expect(DianTotalsValidator.validate(xml).violations).toEqual([]);
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
     * ARREGLADO — `buildLineTaxTotal` abre un bloque POR ESQUEMA y cada uno
     * declara la Σ de SUS subtotales. Antes abría UN bloque por línea con un
     * subtotal por fila de `item.taxes`: en la cuenta mixta IVA + INC —el caso
     * para el que se construyó el desglose de línea— el bloque quedaba
     * seleccionado por los DOS esquemas y su `cbc:TaxAmount` era la suma de
     * ambos, así que el lado izquierdo del predicado valía 270,00 donde el
     * derecho valía 190,00.
     *
     * El comentario que lo justificaba —«Mixed IVA+INC invoices are reconciled at
     * the authoritative document-level TaxTotal above»— delegaba a la cabecera
     * una regla que es POR LÍNEA. FAX02 no mira la cabecera.
     */
    it('IVA + INC en la MISMA línea abren DOS bloques, y cada uno declara el total de SU esquema', () => {
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
      const blocks = lineTaxBlocks(chunks[0]);
      // FAX01 — un bloque para cada código de tributo.
      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => b.schemes)).toEqual([['01'], ['04']]);
      // Y ningún esquema repetido entre bloques, que es el rechazo literal de
      // FAX01 («si existe más de un bloque con el mismo valor en … cbc:ID»).
      const all_schemes = blocks.flatMap((b) => b.schemes);
      expect(new Set(all_schemes).size).toBe(all_schemes.length);

      // FAX02 evaluado esquema por esquema: el importe del bloque seleccionado ES
      // la Σ de los subtotales de ESE esquema.
      expect(blocks[0].amount).toBe('190.00');
      expect(blocks[0].subtotal_amounts).toEqual(['190.00']);
      expect(blocks[1].amount).toBe('80.00');
      expect(blocks[1].subtotal_amounts).toEqual(['80.00']);
      for (const block of blocks) {
        expect(sum(block.subtotal_amounts)).toBe(block.amount);
      }

      // La base NO se duplica: IVA e INC gravan la misma base y van a bloques
      // distintos, así que cada uno la declara una vez — que es lo que
      // `lineTaxableContribution` suma para la base de cabecera (FAU04). La
      // compuerta real lo confirma sobre el XML armado.
      expect(blocks.flatMap((b) => b.subtotal_bases)).toEqual([
        '1000.00',
        '1000.00',
      ]);
      expect(xml).toContain(
        '<cbc:TaxExclusiveAmount currencyID="COP">2000.00</cbc:TaxExclusiveAmount>',
      );
      expect(DianTotalsValidator.validate(xml).violations).toEqual([]);
    });

    it('dos TARIFAS del mismo esquema en la línea: UN bloque, dos subtotales (FAX04)', () => {
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '240.00',
        items: [
          line({
            tax_amount: '240.00',
            taxes: [
              tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
              tax({
                tax_rate: '5.00',
                taxable_amount: '1000.00',
                tax_amount: '50.00',
              }),
            ],
          }),
        ],
        taxes: [
          tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
          tax({
            tax_rate: '5.00',
            taxable_amount: '1000.00',
            tax_amount: '50.00',
          }),
        ],
      });

      const blocks = lineTaxBlocks(xml.split('<cac:InvoiceLine>')[1]);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].amount).toBe('240.00');
      expect(blocks[0].percents).toEqual(['19.00', '5.00']);
      expect(blocks[0].subtotal_amounts).toEqual(['190.00', '50.00']);
      expect(sum(blocks[0].subtotal_amounts)).toBe(blocks[0].amount);
      expect(DianTotalsValidator.validate(xml).violations).toEqual([]);
    });

    it('dos filas de la MISMA tarifa se funden en un subtotal, y la base de cabecera sigue cuadrando', () => {
      const repeated = [
        tax({ taxable_amount: '600.00', tax_amount: '114.00' }),
        tax({ taxable_amount: '400.00', tax_amount: '76.00' }),
      ];
      const xml = emit({
        discount_amount: '0.00',
        tax_amount: '190.00',
        items: [line({ tax_amount: '190.00', taxes: repeated })],
        taxes: repeated,
      });

      const blocks = lineTaxBlocks(xml.split('<cac:InvoiceLine>')[1]);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].subtotal_bases).toEqual(['1000.00']);
      expect(blocks[0].subtotal_amounts).toEqual(['190.00']);
      expect(blocks[0].amount).toBe('190.00');
      // `lineTaxableContribution` suma las dos bases crudas (1.000,00) y el XML
      // emite un subtotal de 1.000,00: las dos caras leen el mismo número.
      expect(
        UblCommonBuilder.lineTaxableContribution(
          line({ tax_amount: '190.00', taxes: repeated }),
          repeated,
        ),
      ).toBe('1000.00');
      expect(DianTotalsValidator.validate(xml).violations).toEqual([]);
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
  // Alcance de estallido: quién consume la agrupación, y que sea UNA sola
  // ---------------------------------------------------------------------------

  describe('la agrupación (esquema, tarifa) es ÚNICA y la comparten todos los emisores', () => {
    const xml_dir = __dirname;
    const builder = readFileSync(
      join(xml_dir, 'ubl-common.builder.ts'),
      'utf8',
    );

    /**
     * El arreglo vive en `buildTaxTotals` / `buildLineTaxTotal`, que NO tienen
     * una rama por tipo de documento: los seis puntos de llamada reciben el mismo
     * XML. Este caso fija que sigan siendo puntos de llamada y no copias — una
     * segunda copia es cómo la asimetría que se acaba de cerrar vuelve.
     */
    it('los SEIS puntos de llamada a buildTaxTotals siguen delegando, ninguno arma su propio TaxTotal de cabecera', () => {
      const emitters = [
        'ubl-invoice.builder.ts',
        'ubl-credit-note.builder.ts',
        'ubl-debit-note.builder.ts',
        'ubl-equivalent-document.builder.ts',
        'ubl-support-document.builder.ts',
      ];

      let calls = 0;
      for (const file of emitters) {
        const source = readFileSync(join(xml_dir, file), 'utf8');
        const found = source.match(/UblCommonBuilder\.buildTaxTotals\(/g) ?? [];
        expect(found.length).toBeGreaterThanOrEqual(1);
        calls += found.length;
        // Ninguno abre un `cac:TaxTotal` por su cuenta: si lo hiciera, el arreglo
        // no lo alcanzaría y ese tipo de documento seguiría fundiendo tarifas.
        expect(source).not.toMatch(/ele\([^)]*,\s*'TaxTotal'\)/);
      }
      // 6, no 5: el documento soporte llama dos veces —el soporte y su nota de
      // ajuste son dos documentos del mismo archivo—.
      expect(calls).toBe(6);
    });

    it('la lógica de agrupación existe UNA vez, y las tres emisiones la consumen', () => {
      // Un solo sitio donde se decide el cubo…
      expect(
        builder.match(/private static groupTaxRowsBySchemeAndRate</g),
      ).toHaveLength(1);
      // …y exactamente tres consumidores: cabecera, retenciones y línea.
      expect(builder.match(/groupTaxRowsBySchemeAndRate\(/g)).toHaveLength(3);
      // Ningún `new Map<string, Map<` fuera del ayudante: ésa era la copia que
      // vivía dentro de `buildWithholdingTaxTotal`.
      expect(builder.match(/new Map<string, Map</g)).toHaveLength(1);
      // DOS sitios emiten `cac:TaxSubtotal`, y el segundo es deliberado: el
      // camino HEREDADO de la línea (sin desglose) publica su subtotal con
      // `dianLineExtension` y `dianRate` SIN el saneamiento por-mil del ICA,
      // porque es la forma con la que se emitieron las facturas ya aceptadas y
      // ésas se reenvían tal cual. Los tres caminos nuevos comparten uno solo.
      expect(builder.match(/'TaxSubtotal'/g)).toHaveLength(2);
      expect(builder.match(/private static emitTaxSubtotal\(/g)).toHaveLength(
        1,
      );
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
