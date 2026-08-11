import { create } from 'xmlbuilder2';
import { UblCommonBuilder } from './ubl-common.builder';
import { UBL_NAMESPACES } from './xml-namespaces';
import {
  ProviderInvoiceItem,
  ProviderInvoiceTax,
} from '../../invoice-provider.interface';

/**
 * QUI-648 — el `unitCode` que sale en el XML.
 *
 * `invoice-flow.unit-code.spec.ts` cubre la RESOLUCIÓN (de qué unidad se
 * declara cada línea). Este spec cubre el otro extremo: que esa resolución
 * llegue efectivamente al documento, sobre el builder real y leyendo el XML
 * emitido. Los dos hacen falta porque son dos fallas distintas: resolver mal
 * la unidad, o resolverla bien y perderla al serializar.
 *
 * Se prueba acá y no contra la emisión real porque emitir exige la
 * habilitación DIAN de la tienda, que en dev no existe: el endpoint responde
 * 403 antes de construir el XML.
 */
describe('UblCommonBuilder · unitCode en el XML emitido', () => {
  function buildItem(overrides: Partial<ProviderInvoiceItem> = {}) {
    return {
      description: 'Cable de cobre',
      quantity: '3',
      unit_price: '5000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '15000.00',
      ...overrides,
    } as ProviderInvoiceItem;
  }

  function serializeLines(items: ProviderInvoiceItem[]): string {
    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
    const taxes: ProviderInvoiceTax[] = [];
    UblCommonBuilder.buildInvoiceLines(root, items, taxes, 'COP');
    return root.end({ prettyPrint: true });
  }

  it('declara MTR con la cantidad en metros para una línea de 3 metros', () => {
    const xml = serializeLines([buildItem({ unit_code: 'MTR' })]);

    // La aserción que pide el plan: la línea de 3 metros declara MTR y 3.
    expect(xml).toContain('unitCode="MTR"');
    expect(xml).toMatch(/<cbc:InvoicedQuantity unitCode="MTR">3<\/cbc:InvoicedQuantity>/);
    expect(xml).not.toContain('unitCode="EA"');
  });

  it('declara EA cuando la línea no trae unidad — comportamiento histórico', () => {
    const xml = serializeLines([buildItem({ quantity: '2' })]);

    expect(xml).toMatch(/<cbc:InvoicedQuantity unitCode="EA">2<\/cbc:InvoicedQuantity>/);
  });

  it('declara una unidad distinta por línea en el mismo documento', () => {
    const xml = serializeLines([
      buildItem({ unit_code: 'MTR', quantity: '3' }),
      buildItem({ unit_code: 'KGM', quantity: '2.35', description: 'Queso' }),
      buildItem({ quantity: '1', description: 'Caja de clavos' }),
    ]);

    expect(xml).toMatch(/unitCode="MTR">3</);
    expect(xml).toMatch(/unitCode="KGM">2\.35</);
    expect(xml).toMatch(/unitCode="EA">1</);
  });

  it('mantiene el mismo unitCode en las notas crédito y débito', () => {
    // Las tres comparten `buildDocumentLines`; si una perdiera la unidad, la
    // nota crédito de una venta en metros diría "3 unidades" y no cuadraría
    // con la factura que corrige.
    for (const [lineEl, qtyEl] of [
      ['CreditNoteLine', 'CreditedQuantity'],
      ['DebitNoteLine', 'DebitedQuantity'],
    ] as const) {
      const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
        UBL_NAMESPACES.INVOICE,
        'Invoice',
        {
          'xmlns:cac': UBL_NAMESPACES.CAC,
          'xmlns:cbc': UBL_NAMESPACES.CBC,
          'xmlns:ext': UBL_NAMESPACES.EXT,
        },
      );
      UblCommonBuilder.buildDocumentLines(
        root,
        [buildItem({ unit_code: 'MTR' })],
        [],
        'COP',
        { line_element: lineEl, quantity_element: qtyEl },
      );
      const xml = root.end({ prettyPrint: true });
      expect(xml).toContain(`<cbc:${qtyEl} unitCode="MTR">3</cbc:${qtyEl}>`);
    }
  });

  /**
   * QUI-648 — la escala de precio (`products.price_unit_quantity`) en el XML.
   *
   * Una línea vendida por ESCALA DE PRECIO (sin presentación) declara la
   * cantidad en la unidad MÍNIMA y el precio de la unidad COMERCIAL: un queso a
   * $28.000 el kilo con el stock en gramos llega acá con `quantity = 2500` (g)
   * y `unit_price = 28000` (el kilo). El dinero real cobrado son $70.000, y lo
   * verifica `order_items.total_price` en la venta correspondiente.
   *
   * Dos elementos tienen que reflejarlo:
   *
   * 1. `cac:Price/cbc:BaseQuantity` — el campo de UBL que declara "a cuánta
   *    cantidad aplica este precio", que es exactamente `price_unit_quantity`.
   *    Con `1.00` el documento afirmaba $28.000 por GRAMO.
   * 2. `cbc:LineExtensionAmount` — `dianLineExtension()` recalcula
   *    `quantity × unit_price − discount` (ver `invoicing/utils/dian-money.util.ts`);
   *    sin dividir por la escala daba **70.000.000** para una venta de
   *    **70.000**. No se quedaba en la línea: el mismo helper alimenta
   *    `dianLineExtensionTotal()` —el total legal de la cabecera— y el `ValFac`
   *    del CUFE, así que el factor N se propagaba al documento entero y a la
   *    huella que la DIAN recomputa.
   *
   * No se pudo comprobar contra la DIAN: emitir exige habilitación de la tienda
   * y en dev `POST /store/invoicing/from-order/:id` responde 403 antes de
   * construir el XML.
   */
  it('declara la escala de precio en BaseQuantity y no infla el importe de la línea', () => {
    // Queso: stock en g, precio por kg (price_unit_quantity = 1000).
    const xml = serializeLines([
      buildItem({
        description: 'Queso campesino',
        unit_code: 'GRM',
        quantity: '2500',
        unit_price: '28000.00',
        total_amount: '70000.00',
        price_unit_quantity: '1000',
      }),
    ]);

    expect(xml).toMatch(
      /<cbc:InvoicedQuantity unitCode="GRM">2500<\/cbc:InvoicedQuantity>/,
    );
    expect(xml).toMatch(/<cbc:LineExtensionAmount[^>]*>70000\.00</);
    expect(xml).toMatch(
      /<cbc:BaseQuantity unitCode="GRM">1000\.00<\/cbc:BaseQuantity>/,
    );
  });

  it('sin escala de precio el importe y BaseQuantity quedan como siempre', () => {
    // No-regresión: todo el catálogo por pieza pasa por acá sin escala.
    const xml = serializeLines([
      buildItem({ quantity: '3', unit_price: '5000.00', unit_code: 'EA' }),
    ]);

    expect(xml).toMatch(/<cbc:LineExtensionAmount[^>]*>15000\.00</);
    expect(xml).toMatch(
      /<cbc:BaseQuantity unitCode="EA">1\.00<\/cbc:BaseQuantity>/,
    );
  });

  it('una escala inválida no puede producir un importe basura', () => {
    // 0 dividiría por cero y un negativo invertiría el signo del importe legal;
    // ambos colapsan a 1, que es el comportamiento histórico.
    for (const bad of ['0', '-5', 'abc']) {
      const xml = serializeLines([
        buildItem({
          quantity: '3',
          unit_price: '5000.00',
          unit_code: 'EA',
          price_unit_quantity: bad,
        }),
      ]);
      expect(xml).toMatch(/<cbc:LineExtensionAmount[^>]*>15000\.00</);
      expect(xml).toMatch(
        /<cbc:BaseQuantity unitCode="EA">1\.00<\/cbc:BaseQuantity>/,
      );
    }
  });
});
