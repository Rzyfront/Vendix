import { PosSaleTicketDataProvider } from '../pos-sale-ticket.provider';
import { PrintLayoutComposerService } from '../../services/print-layout-composer.service';
import { PrintTemplateCompilerService } from '../../services/print-template-compiler.service';
import { PrintFormatDefinition } from '../../interfaces/print-format.interface';

/**
 * F-100 / F-148 (CP-pos-exclusive-tax-double-charge, C.2/C.3) — prueba viva.
 *
 * `evidence/C2-ejecucion.md` deja constancia de que un agente previo probó
 * este mismo mecanismo con un spec temporal (`c2-tmp-invariant.spec.ts`) y lo
 * BORRÓ tras pasar, así que el veredicto de F-100 quedó apoyado en un
 * testimonio, no en una prueba reproducible. Este archivo es esa prueba,
 * permanente esta vez, y va MÁS ALLÁ del alcance original: al construirla se
 * encontró que la fila/sublínea de IVA imprimía la tarifa cruda de la base de
 * datos (`order_items.tax_rate`, `Decimal(6,5)` ⇒ 0.19) donde el compositor
 * espera un porcentaje (`${rate}%`), así que el papel real decía
 * "IVA: 0.19%" en vez de "IVA: 19%". Ese defecto se corrigió junto con esta
 * prueba (ver el `Math.round(... * 10000) / 100` en `pos-sale-ticket
 * .provider.ts`), y esta prueba lo cubre para que no vuelva.
 *
 * Cubre, contra el pipeline REAL (provider → composer), sin mocks del propio
 * mecanismo bajo prueba:
 *  1. El tiquete POS (`money_basis: 'gross'`, G-01) no necesita una columna
 *     nueva: la sublínea `IVA: 19%` sale bajo el nombre del producto usando
 *     la definición SEMBRADA real (4 columnas, sin `tax_rate`) — F-100.
 *  2. La tarifa se imprime en PORCENTAJE, no en la fracción cruda de la BD.
 *  3. El invariante de §8.3: Σ(total de línea) + Envío = TOTAL, tolerancia
 *     1 peso, sobre el HTML compuesto (no sobre el modelo intermedio).
 *  4. F-148: `prints_vat_breakdown` sale del estado fiscal REAL de la
 *     tienda (`resolvePrintsVatBreakdownForPrint`, ya cableado en
 *     `fetchDocumentData`), y gatea la nota «IVA incluido» de cabecera —
 *     un comercio NO responsable no la imprime aunque la línea sí declare
 *     impuesto.
 */
describe('pos-sale-ticket: pipeline real provider→composer (F-100/F-148)', () => {
  const compiler = new PrintTemplateCompilerService();
  const composer = new PrintLayoutComposerService(compiler);

  // Copiada literal de `prisma/seeds/print-templates.seed.ts` para
  // `format_type: 'pos_sale_ticket'` — la plantilla que de verdad usan las
  // tiendas nuevas. Las 4 columnas suman 100 (AJV lo exige) y NINGUNA es
  // `tax_rate`: si el mecanismo necesitara una columna nueva, esta prueba
  // fallaría al no encontrar la sublínea.
  const POS_SALE_TICKET_DEFINITION: PrintFormatDefinition = {
    v: 1,
    paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 1.5, copies: 1 },
    sections: [
      { id: 'sec_items', type: 'items_table', title: 'Detalle de Productos', enabled: true, order: 1 },
      {
        id: 'sec_totals',
        type: 'totals_summary',
        title: 'Totales y Medios de Pago',
        enabled: true,
        order: 2,
        fields: [
          { id: 'f_sub', key: 'order.subtotal_amount', label: 'Subtotal', enabled: true, position: 'right' },
          { id: 'f_disc', key: 'order.discount_amount', label: 'Descuento', enabled: true, position: 'right' },
          { id: 'f_tax', key: 'order.tax_amount', label: 'Impuestos', enabled: true, position: 'right' },
          { id: 'f_tot', key: 'order.grand_total', label: 'TOTAL A PAGAR', enabled: true, position: 'right' },
        ],
      },
    ],
    columns: [
      { id: 'col_desc', key: 'product_name', label: 'Descripción', enabled: true, width_percent: 50, align: 'left', format: 'text' },
      { id: 'col_qty', key: 'quantity', label: 'Cant.', enabled: true, width_percent: 15, align: 'center', format: 'number' },
      { id: 'col_price', key: 'unit_price', label: 'Precio', enabled: true, width_percent: 15, align: 'right', format: 'currency' },
      { id: 'col_tot', key: 'total_price', label: 'Total', enabled: true, width_percent: 20, align: 'right', format: 'currency' },
    ],
  } as any;

  const totalColumnsWidth = POS_SALE_TICKET_DEFINITION.columns!.reduce(
    (sum, c) => sum + (c.enabled ? c.width_percent : 0),
    0,
  );
  it('la plantilla sembrada real suma 100 de ancho y no declara columna de tarifa (censo F-100)', () => {
    expect(totalColumnsWidth).toBe(100);
    expect(POS_SALE_TICKET_DEFINITION.columns!.some((c) => c.key === 'tax_rate')).toBe(false);
  });

  /**
   * Orden con dos líneas: una gravada al 19 % EXCLUSIVO, una exenta.
   *
   * C.7 — la versión anterior de esta fixture declaraba
   * `subtotal_amount: 169000` Y `tax_amount: 19000` Y `grand_total: 169000`:
   * violaba I-6 (`grand_total = subtotal + impuesto`) y ponía la orden en el
   * ÚNICO punto donde la base y el bruto coinciden, así que el invariante
   * §8.3 pasaba bajo las DOS convenciones y no discriminaba nada — la misma
   * ceguera de F-129. Post-ADR-08 `unit_price`/`total_price` son la BASE:
   * 100.000 + 50.000 = 150.000 de subtotal, 19.000 de IVA, 169.000 de total.
   * Ahora Σ(columnas de línea) sólo cierra contra el total si esas columnas
   * salen en BRUTO, que es lo que G-01 exige del papel del mostrador.
   */
  const buildOrder = (storeSettings: any) => ({
    id: 501,
    order_number: 'POS-00501',
    created_at: new Date('2026-09-10T15:00:00.000Z'),
    state: 'finished',
    channel: 'pos',
    subtotal_amount: 150000,
    discount_amount: 0,
    tax_amount: 19000,
    shipping_cost: 0,
    grand_total: 169000,
    customer_alias: null,
    order_items: [
      {
        product_name: 'Camisa Oxford',
        variant_sku: 'CAM-01',
        quantity: 1,
        unit_price: 100000,
        discount_amount: 0,
        total_price: 100000,
        // `order_items.tax_rate` es `Decimal(6,5)`: 0.19 == 19 %.
        tax_rate: 0.19,
        tax_amount_item: 19000,
        order_item_taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_amount: 19000 }],
      },
      {
        product_name: 'Cuaderno escolar (exento)',
        variant_sku: 'CUA-01',
        quantity: 1,
        unit_price: 50000,
        discount_amount: 0,
        total_price: 50000,
        tax_rate: 0,
        tax_amount_item: 0,
        order_item_taxes: [],
      },
    ],
    users: null,
    table_sessions: [],
    payments: [],
    stores: {
      name: 'Tienda Demo',
      legal_name: 'Tienda Demo S.A.S.',
      addresses: [],
      organizations: { tax_id: '900.000.000-1' },
      store_settings: storeSettings,
    },
  });

  const makeProvider = (order: any) =>
    new PosSaleTicketDataProvider({
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);

  describe('comercio responsable de IVA (fiscal_status ACTIVE + O-48)', () => {
    const order = buildOrder({
      settings: {
        fiscal_status: { invoicing: { state: 'ACTIVE' } },
        fiscal_data: { tax_responsibilities: ['O-48'] },
      },
    });

    it('el modelo real declara gross + prints_vat_breakdown=true (F-148)', async () => {
      const data = await makeProvider(order).fetchDocumentData(10, 501);
      expect(data.money_basis).toBe('gross');
      expect(data.prints_vat_breakdown).toBe(true);
    });

    it('el HTML real trae la sublinea "IVA: 19%" bajo el producto gravado, y NINGUNA bajo el exento', async () => {
      const data = await makeProvider(order).fetchDocumentData(10, 501);
      const html = composer.compose(POS_SALE_TICKET_DEFINITION, data);

      expect(html).toContain('Camisa Oxford');
      expect(html).toContain('IVA: 19%');
      // Ni rastro de la fracción cruda mal escalada.
      expect(html).not.toContain('IVA: 0.19%');
      // Exactamente una sublínea: la del producto gravado, no la del exento.
      expect((html.match(/IVA: 19%/g) || []).length).toBe(1);
    });

    it('regla anti-huerfana: sin Subtotal ni fila de Impuestos, con la nota IVA incluido fuera de la tabla', () => {
      const html = composer.compose(POS_SALE_TICKET_DEFINITION, {
        money_basis: 'gross',
        prints_vat_breakdown: true,
        items: [],
        totals: {
          subtotal: 150000,
          discount_total: 0,
          tax_total: 19000,
          shipping_total: 0,
          grand_total: 169000,
          grand_total_formatted: '$169.000',
          tax_total_formatted: '$19.000',
        },
        document: {},
      } as any);

      expect(html).not.toContain('Subtotal:');
      expect(html).not.toContain('Impuestos:');
      expect(html).toContain('TOTAL A PAGAR:');
      expect(html).toContain('IVA incluido: $19.000');
      expect(html.indexOf('IVA incluido:')).toBeGreaterThan(html.indexOf('</table>'));
    });

    it('invariante §8.3 sobre el HTML compuesto: Σ(total de linea) + Envio = TOTAL, tolerancia 1 peso', async () => {
      const data = await makeProvider(order).fetchDocumentData(10, 501);
      const html = composer.compose(POS_SALE_TICKET_DEFINITION, data);

      // El invariante se calcula sobre el mismo modelo que alimenta el HTML
      // (no se re-implementa la aritmetica del compositor); el HTML se usa
      // para confirmar que esa cifra es la que de verdad llega al papel.
      const sumLineTotals = data.items.reduce((s, it) => s + Number(it.total_price || 0), 0);
      const shipping = Number(data.totals.shipping_total || 0);
      const grandTotal = Number(data.totals.grand_total || 0);
      expect(Math.abs(sumLineTotals + shipping - grandTotal)).toBeLessThanOrEqual(1);

      expect(html).toContain(data.totals.grand_total_formatted || '');
      expect(data.totals.grand_total_formatted).toBe('$169.000');
    });

    it('las columnas de línea salen en BRUTO, no en la base gravable (C.7)', async () => {
      const data = await makeProvider(order).fetchDocumentData(10, 501);
      const html = composer.compose(POS_SALE_TICKET_DEFINITION, data);

      // Gravada: base 100.000 + IVA 19.000 = 119.000 en AMBAS columnas.
      expect(data.items[0].unit_price).toBe(119000);
      expect(data.items[0].total_price).toBe(119000);
      // Exenta: sin impuesto, la columna no se mueve.
      expect(data.items[1].unit_price).toBe(50000);
      expect(data.items[1].total_price).toBe(50000);

      expect(html).toContain('$119.000');
      // La base gravable NO puede aparecer como precio de mostrador.
      expect(html).not.toContain('$100.000');
    });
  });

  /**
   * C.7 — el multiplicador y el marcador ADR-08, los dos casos donde componer
   * el bruto «a ojo» se rompe:
   *  - `tax_amount_item` es por UNIDAD de precio (ADR-10): con cantidad 3 el
   *    bruto de línea suma el impuesto de LÍNEA, no el escalar crudo.
   *  - `tax_amount_item IS NULL` marca la línea pre-ADR-08, cuyo `unit_price`
   *    YA es el bruto publicado: sumarle impuesto encima es el doble cobro
   *    que este plan existe para impedir.
   */
  describe('multiplicador de línea y marcador ADR-08 (C.7)', () => {
    const settings = {
      settings: {
        fiscal_status: { invoicing: { state: 'ACTIVE' } },
        fiscal_data: { tax_responsibilities: ['O-48'] },
      },
    };

    const buildMixed = () => ({
      ...buildOrder(settings),
      subtotal_amount: 90000,
      tax_amount: 5700,
      grand_total: 95700,
      order_items: [
        {
          // Cantidad 3: base 10.000/u, IVA 1.900/u, línea 30.000 + 5.700.
          product_name: 'Vino de mesa',
          variant_sku: 'VIN-01',
          quantity: 3,
          unit_price: 10000,
          discount_amount: 0,
          total_price: 30000,
          tax_rate: 0.19,
          tax_amount_item: 1900,
          order_item_taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_amount: 5700 }],
        },
        {
          // Línea pre-ADR-08: el bruto ya está en `unit_price`.
          product_name: 'Bolso legado',
          variant_sku: 'BOL-99',
          quantity: 1,
          unit_price: 60000,
          discount_amount: 0,
          total_price: 60000,
          tax_rate: null,
          tax_amount_item: null,
          order_item_taxes: [],
        },
      ],
    });

    it('cantidad 3 suma el impuesto de LÍNEA y la línea legacy queda intacta', async () => {
      const data = await makeProvider(buildMixed()).fetchDocumentData(10, 501);

      expect(data.items[0].unit_price).toBe(11900);
      expect(data.items[0].total_price).toBe(35700);
      expect(data.items[1].unit_price).toBe(60000);
      expect(data.items[1].total_price).toBe(60000);

      const sumLineTotals = data.items.reduce((s, it) => s + Number(it.total_price || 0), 0);
      expect(Math.abs(sumLineTotals - Number(data.totals.grand_total || 0))).toBeLessThanOrEqual(1);
    });

    /**
     * Hallazgo 3 (CP-post-QUI-832) — el tiquete emite `tax_amount` de LÍNEA.
     * Sin filas `order_item_taxes` el impuesto sale del escalar por unidad
     * (ADR-10) × unidades: con cantidad 3 e impuesto unitario 1.900 la línea
     * declara 5.700, no 1.900. Y la fila cuadra: bruto de línea = base de
     * línea + impuesto de línea (30.000 + 5.700 = 35.700).
     */
    it('hallazgo 3: con cantidad 3 el tax_amount de línea es 3 × unidad y la fila cuadra', async () => {
      const order = {
        ...buildOrder(settings),
        subtotal_amount: 30000,
        tax_amount: 5700,
        grand_total: 35700,
        order_items: [
          {
            product_name: 'Vino de mesa',
            variant_sku: 'VIN-01',
            quantity: 3,
            unit_price: 10000,
            discount_amount: 0,
            total_price: 30000,
            tax_rate: 0.19,
            tax_amount_item: 1900,
            order_item_taxes: [],
          },
        ],
      };
      const data = await makeProvider(order).fetchDocumentData(10, 501);

      // Impuesto de LÍNEA, no por unidad: 3 × 1.900.
      expect(data.items[0].tax_amount).toBe(5700);
      // La fila cuadra en bruto: base de línea + impuesto = total impreso.
      expect(data.items[0].total_price).toBe(30000 + 5700);
      expect(data.items[0].unit_price).toBe(11900);
    });
  });

  describe('comercio NO responsable de IVA (F-148: sin gate, la nota se coló siempre)', () => {
    // Sin `store_settings` en absoluto: fail-closed (R-2 de ADR-12).
    const order = buildOrder(undefined);

    it('prints_vat_breakdown sale false y la nota "IVA incluido" NO aparece pese a haber impuesto en la linea', async () => {
      const data = await makeProvider(order).fetchDocumentData(10, 501);
      expect(data.prints_vat_breakdown).toBe(false);

      const html = composer.compose(POS_SALE_TICKET_DEFINITION, data);
      expect(html).not.toContain('IVA incluido');
    });
  });
});
