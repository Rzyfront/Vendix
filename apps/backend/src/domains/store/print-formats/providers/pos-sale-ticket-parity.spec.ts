import { formatFiscalMoney } from './fiscal-document-print.mapper';
import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';

/**
 * F-007 — la tirilla POS con snapshot fiscal pinta la misma precisión que el
 * mapeador fiscal (`'$5.000,00'`, 2 decimales pineados).
 *
 * El override fiscal formateaba sin opciones (`$5.000`) mientras `money()`
 * del mapper pinea `minimum/maximumFractionDigits: 2`: mismo modelo, dos
 * precisiones. Ambos usan hoy el helper compartido `formatFiscalMoney`.
 */
describe('pos-sale-ticket — F-007 paridad decimal con el mapper fiscal', () => {
  const orderRow = {
    id: 7,
    order_number: 'POS-0007',
    created_at: new Date('2026-08-27T09:15:00.000Z'),
    state: 'finished',
    subtotal_amount: 4629.62,
    discount_amount: 0,
    tax_amount: 370.36,
    shipping_cost: 0,
    grand_total: 5000,
    order_items: [],
    users: null,
    stores: {
      name: 'Tienda Test',
      organizations: { tax_id: '900.000.000-1' },
      addresses: [],
    },
    table_sessions: [],
  };

  const invoiceRow = {
    id: 3,
    status: 'paid',
    subtotal_amount: 5000,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 5000,
    invoice_taxes: [],
  };

  const makeProvider = (invoice: any) =>
    new PosSaleTicketDataProvider({
      orders: { findFirst: jest.fn().mockResolvedValue(orderRow) },
      invoices: { findFirst: jest.fn().mockResolvedValue(invoice) },
    } as any);

  it('el helper compartido pinea 2 decimales (`$5.000,00`)', () => {
    expect(formatFiscalMoney(5000)).toBe('$5.000,00');
    expect(formatFiscalMoney(0)).toBe('$0,00');
  });

  it('tirilla con factura EMITIDA: pinta igual que el mapper fiscal', async () => {
    const data = await makeProvider(invoiceRow).fetchDocumentData(10, 7);

    expect(data.totals.grand_total).toBe(5000);
    expect(data.totals.grand_total_formatted).toBe('$5.000,00');
    expect(data.totals.subtotal_formatted).toBe(formatFiscalMoney(5000));
    expect(data.totals.tax_total_formatted).toBe(formatFiscalMoney(0));
    expect(data.totals.discount_total_formatted).toBe(formatFiscalMoney(0));
  });

  it('tirilla con factura en BORRADOR: no aplica el override (sigue pre-fiscal)', async () => {
    const data = await makeProvider({ ...invoiceRow, status: 'draft' }).fetchDocumentData(10, 7);

    // Los números siguen siendo los de la orden, no los del borrador.
    expect(data.totals.grand_total).toBe(5000);
    expect(data.totals.subtotal).toBe(4629.62);
  });
});

/**
 * C.6 / F-105 — la base del desglose se LEE de la línea (`total_price`),
 * nunca se deriva como `tax_amount / tax_rate` (con truncado DIAN la
 * inversión no es exacta: `1900 / 0.19` da `10000.000000000002`, no
 * `10000`; y con tasa 0 inventa base 0).
 */
describe('pos-sale-ticket — C.6 base leída en aggregateTaxes', () => {
  const baseOrder: any = {
    id: 9,
    order_number: 'POS-0009',
    created_at: new Date('2026-09-01T10:00:00.000Z'),
    state: 'finished',
    subtotal_amount: 10000,
    discount_amount: 0,
    tax_amount: 1900,
    shipping_cost: 0,
    grand_total: 11900,
    users: null,
    stores: {
      name: 'Tienda Test',
      organizations: { tax_id: '900.000.000-1' },
      addresses: [],
    },
    table_sessions: [],
  };

  const item = (over: any = {}) => ({
    product_name: 'Producto base',
    quantity: 1,
    unit_price: 10000,
    total_price: 10000,
    ...over,
  });

  const makeOrderProvider = (order: any) =>
    new PosSaleTicketDataProvider({
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
      invoices: { findFirst: jest.fn().mockResolvedValue({ ...order, status: 'draft' }) },
    } as any);

  it('línea 19 %: la base es el total leído, exacto (no 10000.000000000002)', async () => {
    const data = await makeOrderProvider({
      ...baseOrder,
      order_items: [
        item({ order_item_taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_amount: 1900 }] }),
      ],
    }).fetchDocumentData(10, 9);

    // `order_item_taxes.tax_rate` llega en fracción (0.19); `aggregateTaxes`
    // lo pinta en porcentaje (19) porque el compositor lo concatena literal
    // como `${rate}%` — sin esto salía "(0.19%)" en el papel real.
    expect(data.taxes).toEqual([
      expect.objectContaining({ name: 'IVA', rate: 19, tax_amount: 1900, base_amount: 10000 }),
    ]);
  });

  it('línea con tasa 0 %: la base se lee, sin NaN ni ficción de base 0', async () => {
    const data = await makeOrderProvider({
      ...baseOrder,
      order_items: [
        item({
          unit_price: 5000,
          total_price: 5000,
          order_item_taxes: [{ tax_name: 'IVA', tax_rate: 0, tax_amount: 0 }],
        }),
      ],
    }).fetchDocumentData(10, 9);

    expect(data.taxes).toEqual([
      expect.objectContaining({ rate: 0, tax_amount: 0, base_amount: 5000 }),
    ]);
    for (const t of data.taxes) {
      expect(Number.isFinite(t.base_amount)).toBe(true);
    }
  });

  it('línea multi-tarifa: la base se prorratea y la suma cuadra con la línea', async () => {
    const data = await makeOrderProvider({
      ...baseOrder,
      order_items: [
        item({
          order_item_taxes: [
            { tax_name: 'IVA', tax_rate: 0.19, tax_amount: 1900 },
            { tax_name: 'INC', tax_rate: 0.08, tax_amount: 800 },
          ],
        }),
      ],
    }).fetchDocumentData(10, 9);

    const byName = Object.fromEntries(data.taxes.map((t: any) => [t.name, t]));
    expect(byName['IVA'].tax_amount).toBe(1900);
    expect(byName['INC'].tax_amount).toBe(800);
    expect(byName['IVA'].base_amount + byName['INC'].base_amount).toBeCloseTo(10000, 8);
  });
});

/**
 * Envío duplicado en la tirilla con factura.
 *
 * `invoices.subtotal_amount` YA incluye la línea «Envio» (Σ bases de ítems +
 * envío, `computeOrderInvoiceSubtotal`). El override pintaba ese subtotal y,
 * al lado, el `shipping_cost` BRUTO de la orden: el envío salía dos veces y
 * la suma de filas no daba el TOTAL. Ahora: productos = subtotal − envío y la
 * fila Envío = `invoices.shipping_amount` (la BASE neta cuando el domicilio
 * lleva INC incluido, cuyo tributo ya viaja en `tax_amount`).
 */
describe('pos-sale-ticket — envío con factura: subtotal sin envío, envío = base fiscal', () => {
  const store = {
    name: 'Tienda Test',
    organizations: { tax_id: '900.000.000-1' },
    addresses: [],
  };

  const order = (over: any = {}) => ({
    id: 11,
    order_number: 'POS-0011',
    created_at: new Date('2026-09-20T18:00:00.000Z'),
    state: 'finished',
    order_items: [],
    users: null,
    stores: store,
    table_sessions: [],
    ...over,
  });

  const makeProvider = (orderRow: any, invoice: any) =>
    new PosSaleTicketDataProvider({
      orders: { findFirst: jest.fn().mockResolvedValue(orderRow) },
      invoices: { findFirst: jest.fn().mockResolvedValue(invoice) },
    } as any);

  const rowsSum = (t: any) =>
    Math.round(
      (t.subtotal - t.discount_total + t.tax_total + t.shipping_total) * 100,
    ) / 100;

  it('domicilio con INC 8 % incluido: subtotal sin envío, envío = base 13888.89, filas suman el total', async () => {
    // Plato $50.000 con INC 8 % incluido (46296.30 + 3703.70) y domicilio
    // $15.000 con INC 8 % incluido (13888.89 + 1111.11).
    const orderRow = order({
      subtotal_amount: 46296.3,
      discount_amount: 0,
      tax_amount: 3703.7,
      shipping_cost: 15000,
      grand_total: 65000,
    });
    const invoice = {
      id: 21,
      status: 'accepted',
      subtotal_amount: 60185.19,
      discount_amount: 0,
      tax_amount: 4814.81,
      shipping_amount: 13888.89,
      total_amount: 65000,
      invoice_taxes: [
        { tax_name: 'INC', tax_rate: 8, tax_amount: 4814.81, taxable_amount: 60185.19 },
      ],
    };

    const { totals } = await makeProvider(orderRow, invoice).fetchDocumentData(10, 11);

    expect(totals.subtotal).toBe(46296.3);
    expect(totals.subtotal_formatted).toBe(formatFiscalMoney(46296.3));
    expect(totals.shipping_total).toBe(13888.89);
    expect(totals.shipping_total_formatted).toBe(formatFiscalMoney(13888.89));
    expect(totals.tax_total).toBe(4814.81);
    expect(totals.grand_total).toBe(65000);
    expect(rowsSum(totals)).toBe(65000);
  });

  it('factura actual (envío bruto sin impuesto): el envío deja de contarse dos veces', async () => {
    const orderRow = order({
      subtotal_amount: 10000,
      discount_amount: 0,
      tax_amount: 1900,
      shipping_cost: 5000,
      grand_total: 16900,
    });
    const invoice = {
      id: 22,
      status: 'accepted',
      subtotal_amount: 15000,
      discount_amount: 0,
      tax_amount: 1900,
      shipping_amount: 5000,
      total_amount: 16900,
      invoice_taxes: [
        { tax_name: 'IVA', tax_rate: 19, tax_amount: 1900, taxable_amount: 10000 },
      ],
    };

    const { totals } = await makeProvider(orderRow, invoice).fetchDocumentData(10, 11);

    expect(totals.subtotal).toBe(10000);
    expect(totals.shipping_total).toBe(5000);
    expect(rowsSum(totals)).toBe(16900);
    expect(totals.grand_total).toBe(16900);
  });

  it('factura sin envío (shipping_amount 0 o ausente): subtotal entero, envío 0', async () => {
    const orderRow = order({
      subtotal_amount: 4629.62,
      discount_amount: 0,
      tax_amount: 370.36,
      shipping_cost: 0,
      grand_total: 5000,
    });
    const base = {
      id: 23,
      status: 'accepted',
      subtotal_amount: 4629.63,
      discount_amount: 0,
      tax_amount: 370.37,
      total_amount: 5000,
      invoice_taxes: [],
    };

    for (const invoice of [base, { ...base, shipping_amount: 0 }]) {
      const { totals } = await makeProvider(orderRow, invoice).fetchDocumentData(10, 11);
      expect(totals.subtotal).toBe(4629.63);
      expect(totals.shipping_total).toBe(0);
      expect(rowsSum(totals)).toBe(5000);
    }
  });

  it('tirilla SIN factura: igual que hoy (subtotal y envío de la orden)', async () => {
    const orderRow = order({
      subtotal_amount: 10000,
      discount_amount: 0,
      tax_amount: 1900,
      shipping_cost: 5000,
      grand_total: 16900,
    });

    for (const invoice of [null, { id: 24, status: 'draft', subtotal_amount: 15000, shipping_amount: 5000 }]) {
      const { totals } = await makeProvider(orderRow, invoice).fetchDocumentData(10, 11);
      expect(totals.subtotal).toBe(10000);
      expect(totals.shipping_total).toBe(5000);
      expect(totals.grand_total).toBe(16900);
    }
  });
});
