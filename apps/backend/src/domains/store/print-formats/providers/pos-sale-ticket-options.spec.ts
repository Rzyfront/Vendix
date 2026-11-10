import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';

/**
 * QUI-994 — the POS receipt lists each line's add-ons with their notes and
 * the line note. A sale without add-ons or notes prints exactly as before.
 */
describe('pos-sale-ticket — add-ons and notes per line (QUI-994)', () => {
  const baseOrder: any = {
    id: 21,
    order_number: 'POS-0021',
    created_at: new Date('2026-11-09T18:37:43.000Z'),
    state: 'finished',
    subtotal_amount: 95000,
    discount_amount: 0,
    tax_amount: 0,
    shipping_cost: 0,
    grand_total: 95000,
    users: null,
    stores: {
      name: 'Tienda Test',
      organizations: { tax_id: '900.000.000-1' },
      addresses: [],
    },
    table_sessions: [],
  };

  const item = (over: any = {}) => ({
    product_name: 'Torta personalizada',
    quantity: 1,
    unit_price: 95000,
    total_price: 95000,
    ...over,
  });

  const makeProvider = (order: any) => {
    const findFirst = jest.fn().mockResolvedValue(order);
    const provider = new PosSaleTicketDataProvider({
      orders: { findFirst },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);
    return { provider, findFirst };
  };

  it('prints the line note and every add-on with its note', async () => {
    const { provider } = makeProvider({
      ...baseOrder,
      order_items: [
        item({
          notes: 'Escribir "Feliz cumpleaños"',
          order_item_options: [
            { group_name: 'Relleno', option_name: 'Arequipe', note: 'Bien cargado' },
            { group_name: 'Decoración', option_name: 'Velas', note: null },
          ],
        }),
      ],
    });

    const data = await provider.fetchDocumentData(10, 21);

    expect(data.items[0].notes).toBe('Escribir "Feliz cumpleaños"');
    expect(data.items[0].modifiers).toEqual(['+ Arequipe — Bien cargado', '+ Velas']);
  });

  it('a line without add-ons or notes prints as before', async () => {
    const { provider } = makeProvider({
      ...baseOrder,
      order_items: [item({ notes: null, order_item_options: [] })],
    });

    const data = await provider.fetchDocumentData(10, 21);

    expect(data.items[0].notes).toBeUndefined();
    expect(data.items[0].modifiers).toBeUndefined();
  });

  it('reads the add-on snapshot (name and note) with the order lines', async () => {
    const { provider, findFirst } = makeProvider({
      ...baseOrder,
      order_items: [item()],
    });

    await provider.fetchDocumentData(10, 21);

    const include = findFirst.mock.calls[0][0].include.order_items.include;
    expect(include.order_item_options).toEqual({
      select: { option_name: true, note: true },
      orderBy: { id: 'asc' },
    });
  });
});
