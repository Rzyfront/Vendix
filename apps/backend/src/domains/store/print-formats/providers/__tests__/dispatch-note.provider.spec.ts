/**
 * F-101 (CP-pos-exclusive-tax-double-charge, unificación 2026-09-14).
 *
 * Antes de este fix, `DispatchNoteDataProvider.fetchDocumentData` leía
 * `order.order_items` / `order.subtotal_amount` / `order.grand_total` — el
 * snapshot de la ORDEN completa, no el de ESTA remisión. Eso es incorrecto
 * en dos escenarios reales del dominio:
 *
 *   1. Remisión PARCIAL: una orden despachada en varias remisiones. Leer
 *      `order.grand_total` imprime el total de TODA la orden en la
 *      remisión de una sola parte de ella.
 *   2. Remisión SIN orden: traslados (`transfer_out/in`) y recepciones de
 *      compra (`purchase_receipt`) tienen `order_id: null` — el provider
 *      devolvía una tabla de ítems vacía y totales en cero.
 *
 * `dispatch_note_items` + los totales propios de `dispatch_notes`
 * (`subtotal_amount`, `discount_amount`, `tax_amount`, `shipping_cost`,
 * `grand_total`) son el único snapshot correcto — el mismo que ya usaba
 * `dispatch-notes/pdf/dispatch-note-pdf.service.ts` (el otro riel de
 * impresión de la remisión).
 *
 * Cobertura:
 *  1. formatType identifica el formato.
 *  2. El include nombra `dispatch_note_items` (no `order.order_items`).
 *  3. Los ítems salen de `dispatch_note_items`, con SKU vía `product_variant`.
 *  4. Los totales salen de `dispatch_notes.*`, NUNCA de `order.*` — incluso
 *     cuando la orden relacionada tiene un total mayor (remisión parcial).
 *  5. Remisión sin orden (`order_id: null`, traslado/recepción de compra):
 *     ítems y totales se resuelven igual desde el propio `note`.
 *  6. `prints_vat_breakdown` reutiliza `resolvePrintsVatBreakdownForPrint`
 *     (mismo gate que el otro riel de impresión) — fail-closed sin config.
 *  7. El cliente prioriza el snapshot `note.customer_name`/`customer_tax_id`
 *     y cae a la relación `note.customer` sólo si el snapshot falta.
 */
import { VendixHttpException } from 'src/common/errors';
import { DispatchNoteDataProvider } from '../dispatch-note.provider';

describe('DispatchNoteDataProvider', () => {
  const nulo = null as any;

  const storeRow = (fiscalSettings?: any) => ({
    id: 7,
    name: 'Bodega Central',
    legal_name: 'Vendix Logistics S.A.S.',
    phone: '+57 601 000 0000',
    email: 'bodega@vendix.co',
    addresses: [{ address_line1: 'Cra 50 # 10-20', city: 'Medellín' }],
    store_settings: fiscalSettings
      ? { settings: fiscalSettings.store ?? {} }
      : null,
    organizations: {
      tax_id: '900111222',
      fiscal_scope: 'STORE',
      organization_settings: fiscalSettings?.org
        ? { settings: fiscalSettings.org }
        : null,
    },
  });

  /** Remisión PARCIAL: la orden vale mucho más que esta sola remisión. */
  const partialDispatchNoteRow = () => ({
    id: 501,
    dispatch_number: 'REM-0501',
    created_at: new Date('2026-09-10T15:00:00.000Z'),
    state: 'shipped',
    carrier_name: 'Coordinadora',
    tracking_number: 'GUIA-1',
    notes: null,
    customer_name: 'Ferretería El Tornillo',
    customer_phone: '+57 320 111 2233',
    customer_tax_id: '800222333',
    customer_address: { address_line1: 'Cll 80 # 40-10', city: 'Bogotá' },
    // Remisión de SÓLO una fracción de la orden (5 de 20 unidades pedidas).
    subtotal_amount: '250000.00',
    discount_amount: '0.00',
    tax_amount: '47500.00',
    shipping_cost: '0.00',
    grand_total: '297500.00',
    dispatch_note_items: [
      {
        product_id: 9,
        product: { id: 9, name: 'Taladro Percutor 750W' },
        product_variant: { id: 3, sku: 'TAL-750W' },
        ordered_quantity: 20,
        dispatched_quantity: 5,
        unit_price: '50000.00',
        // I-6 — `dispatch_note_items.total_price` lo escribe el servicio como
        // `unit_price × dispatched_quantity − descuento + tax_amount`
        // (`dispatch-notes.service.ts:1247` y `:1749`): es BRUTO de línea.
        // 50.000 × 5 + 47.500 = 297.500. La fixture anterior decía 250.000 —
        // una fila que el escritor nunca pudo producir, y por eso el censo
        // pasaba con el unitario en base (F-228).
        total_price: '297500.00',
        discount_amount: '0.00',
        tax_amount: '47500.00',
      },
    ],
    customer: null,
    store: storeRow(),
  });

  /** Remisión SIN orden — traslado entre bodegas (`order_id: null`). */
  const transferDispatchNoteRow = () => ({
    id: 502,
    dispatch_number: 'REM-0502',
    created_at: new Date('2026-09-11T09:00:00.000Z'),
    state: 'confirmed',
    carrier_name: null,
    tracking_number: null,
    notes: 'Traslado interno',
    customer_name: null,
    customer_phone: null,
    customer_tax_id: null,
    customer_address: null,
    subtotal_amount: '80000.00',
    discount_amount: '0.00',
    tax_amount: '0.00',
    shipping_cost: '0.00',
    grand_total: '80000.00',
    dispatch_note_items: [
      {
        product_id: 4,
        product: { id: 4, name: 'Cemento Gris 50kg' },
        product_variant: null,
        ordered_quantity: 0,
        dispatched_quantity: 40,
        unit_price: '2000.00',
        total_price: '80000.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
      },
    ],
    customer: null,
    store: storeRow(),
  });

  const prismaWith = (row: any) => {
    const calls: any[] = [];
    return {
      calls,
      prisma: {
        dispatch_notes: {
          findFirst: (args: any) => {
            calls.push(args);
            return Promise.resolve(row);
          },
        },
      } as any,
    };
  };

  it('1. formatType identifica el formato de remisión', () => {
    expect(new DispatchNoteDataProvider(nulo).formatType).toBe(
      'dispatch_note',
    );
  });

  it('2. el include nombra dispatch_note_items, no order.order_items', async () => {
    const { prisma, calls } = prismaWith(partialDispatchNoteRow());
    await new DispatchNoteDataProvider(prisma).fetchDocumentData(7, 501);

    const include = calls[0].include;
    expect(include).toHaveProperty('dispatch_note_items');
    expect(include).not.toHaveProperty('order');
    expect(calls[0].where).toEqual({ id: 501, store_id: 7 });
  });

  it('3. los ítems salen de dispatch_note_items, con SKU vía product_variant', async () => {
    const { prisma } = prismaWith(partialDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      501,
    );

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      index: 1,
      product_name: 'Taladro Percutor 750W',
      variant_sku: 'TAL-750W',
      quantity: 5,
      // F-228 — la remisión declara `money_basis: 'gross'`: las dos columnas
      // de línea van en la MISMA magnitud. El unitario prorratea el impuesto
      // de línea (47.500 / 5 = 9.500) sobre la base (50.000) → 59.500.
      unit_price: 59500,
      total_price: 297500,
    });
  });

  it('3b. la fila cuadra consigo misma: unitario × cantidad = total (F-228)', async () => {
    const { prisma } = prismaWith(partialDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      501,
    );

    const linea = data.items[0]!;
    expect(linea.unit_price! * linea.quantity!).toBe(linea.total_price);
    // Y Σ de totales de línea cierra contra el total del documento, que es la
    // cifra que el papel imprime bajo `money_basis: 'gross'` (sin fila
    // `Subtotal:` ni `Impuestos:`, suprimidas por la regla anti-huérfana).
    const suma = data.items.reduce((a, i) => a + Number(i.total_price || 0), 0);
    expect(suma).toBe(data.totals.grand_total);
  });

  it('3c. sin impuesto de línea el unitario queda intacto (traslado)', async () => {
    const { prisma } = prismaWith(transferDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      502,
    );

    expect(data.items[0]).toMatchObject({
      quantity: 40,
      unit_price: 2000,
      total_price: 80000,
    });
  });

  it('4. los totales salen de dispatch_notes.*, NO del total de la orden completa (remisión parcial)', async () => {
    const { prisma } = prismaWith(partialDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      501,
    );

    // La remisión sólo despachó 5 de 20 unidades: su total es 297.500, no el
    // de una orden completa (que sería 4x mayor). Antes del fix, este
    // provider habría leído `order.grand_total` y roto esta invariante.
    expect(data.totals.subtotal).toBe(250000);
    expect(data.totals.tax_total).toBe(47500);
    expect(data.totals.grand_total).toBe(297500);
  });

  it('5. remisión sin orden (traslado): ítems y totales se resuelven desde el propio note', async () => {
    const { prisma } = prismaWith(transferDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      502,
    );

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      product_name: 'Cemento Gris 50kg',
      quantity: 40,
      total_price: 80000,
    });
    expect(data.totals.grand_total).toBe(80000);
    // Sin cliente formal (traslado interno): cae al literal por defecto.
    expect(data.customer!.name).toBe('Destinatario');
  });

  it('6. prints_vat_breakdown reutiliza resolvePrintsVatBreakdownForPrint (fail-closed sin config)', async () => {
    const { prisma } = prismaWith(partialDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      501,
    );

    expect(data.prints_vat_breakdown).toBe(false);
    expect(data.money_basis).toBe('gross');
  });

  it('6b. prints_vat_breakdown en true cuando invoicing está ACTIVE y hay responsabilidad de IVA (O-48)', async () => {
    const row = {
      ...partialDispatchNoteRow(),
      store: storeRow({
        store: {
          fiscal_status: { invoicing: { state: 'ACTIVE' } },
          fiscal_data: { tax_responsibilities: ['O-48'] },
        },
      }),
    };
    const { prisma } = prismaWith(row);
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      501,
    );

    expect(data.prints_vat_breakdown).toBe(true);
  });

  it('7. el cliente prioriza el snapshot de la remisión sobre la relación customer', async () => {
    const { prisma } = prismaWith(partialDispatchNoteRow());
    const data = await new DispatchNoteDataProvider(prisma).fetchDocumentData(
      7,
      501,
    );

    expect(data.customer!.name).toBe('Ferretería El Tornillo');
    expect(data.customer!.tax_id).toBe('800222333');
  });

  it('fetchDocumentData rechaza un documentId no numérico antes de tocar la base', async () => {
    const { prisma, calls } = prismaWith(partialDispatchNoteRow());
    await expect(
      new DispatchNoteDataProvider(prisma).fetchDocumentData(7, 'abc'),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(calls).toHaveLength(0);
  });

  it('fetchDocumentData lanza 404 cuando la remisión no es de la tienda', async () => {
    const { prisma } = prismaWith(null);
    await expect(
      new DispatchNoteDataProvider(prisma).fetchDocumentData(7, 999),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });
});
