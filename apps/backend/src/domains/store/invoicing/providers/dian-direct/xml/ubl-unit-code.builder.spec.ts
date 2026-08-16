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
   * FAV06 — la aritmética de la línea, y qué es realmente `cbc:BaseQuantity`.
   *
   * En UBL genérico `BaseQuantity` declara «a cuánta cantidad aplica el precio»
   * y PEPPOL DIVIDE por él (EN16931-R120). **El perfil de la DIAN no.** Su regla
   * es una multiplicación, sin división en ninguna parte:
   *
   * ```
   * LineExtensionAmount = PriceAmount × BaseQuantity
   *                     − Σ AllowanceCharge[ChargeIndicator=false]
   *                     + Σ AllowanceCharge[ChargeIndicator=true]
   * ```
   *
   * Verificado sobre los 27 renglones de los XML de ejemplo oficiales de la Caja
   * de Herramientas: 27/27 reconcilian con esa fórmula, 0/27 con la lectura de
   * divisor. `BaseQuantity` **es la cantidad facturada**.
   *
   * ## Qué significa para QUI-648
   *
   * La escala de precio (`products.price_unit_quantity`) NO es representable en
   * este perfil: el campo que la declararía está ocupado por la cantidad. Se
   * consume ANTES del XML, dentro del precio — `dianPriceAmount` despeja
   * `importe ÷ cantidad`. Un queso a $28.000 el kilo con el stock en gramos
   * llega con `quantity = 2500` (g) y `unit_price = 28000` (el kilo); el
   * documento sale declarando **$28,00 por gramo** y un importe de $70.000, que
   * es el dinero realmente cobrado (`order_items.total_price` lo verifica).
   *
   * La versión anterior emitía la escala en `BaseQuantity` y dejaba el precio
   * crudo. Eso rompía **toda línea con cantidad ≠ 1**, no sólo las que tienen
   * escala: con `BaseQuantity=1.00` el documento afirmaba que el importe de la
   * línea es el precio unitario.
   *
   * No se pudo comprobar contra la DIAN: emitir exige habilitación de la tienda
   * y en dev `POST /store/invoicing/from-order/:id` responde 403 antes de
   * construir el XML.
   */
  it('BaseQuantity es la cantidad facturada y el precio absorbe la escala', () => {
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
    // 28,00/g × 2500 g = 70.000 — la igualdad de FAV06 se cierra.
    expect(xml).toMatch(/<cbc:PriceAmount[^>]*>28\.00</);
    expect(xml).toMatch(
      /<cbc:BaseQuantity unitCode="GRM">2500<\/cbc:BaseQuantity>/,
    );
  });

  it('sin escala de precio, BaseQuantity sigue siendo la cantidad', () => {
    // No-regresión: todo el catálogo por pieza pasa por acá sin escala. Es el
    // caso que la lectura anterior rompía — emitía BaseQuantity=1.00 con
    // cantidad 3, afirmando que la línea vale 5.000 en vez de 15.000.
    const xml = serializeLines([
      buildItem({ quantity: '3', unit_price: '5000.00', unit_code: 'EA' }),
    ]);

    expect(xml).toMatch(/<cbc:LineExtensionAmount[^>]*>15000\.00</);
    expect(xml).toMatch(/<cbc:PriceAmount[^>]*>5000\.00</);
    expect(xml).toMatch(/<cbc:BaseQuantity unitCode="EA">3<\/cbc:BaseQuantity>/);
  });

  it('una escala inválida no puede producir un importe basura', () => {
    // 0 dividiría por cero y un negativo invertiría el signo del importe legal;
    // ambos colapsan a divisor 1, que es el comportamiento histórico. La
    // igualdad de FAV06 se mantiene en los tres casos.
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
      expect(xml).toMatch(/<cbc:PriceAmount[^>]*>5000\.00</);
      expect(xml).toMatch(
        /<cbc:BaseQuantity unitCode="EA">3<\/cbc:BaseQuantity>/,
      );
    }
  });
});
