/**
 * Suite del proveedor de comanda de cocina (hoja consolidada por orden).
 *
 * Cobertura:
 *  1. Físico: la hoja junta los ítems vivos de TODOS los tickets de la orden
 *     (sin delivered/cancelled), en orden de fired_at e id.
 *  2. Virtual: solo los ítems del ticket pedido.
 *  3. `document.notes` = `orders.notes`; número de orden y cliente.
 *  4. `packaging_label` en home_delivery, mesa + is_takeaway y
 *     direct_delivery sin mesa.
 *  5. Exclusiones con prefijo "SIN ".
 *  6. En físico no viaja `kds_name` ni `kds_station_type`.
 *  7. Composer: el HTML trae "SIN " y "PARA LLEVAR".
 */
import { KitchenTicketDataProvider } from '../kitchen-ticket.provider';
import { PrintLayoutComposerService } from '../../services/print-layout-composer.service';

describe('KitchenTicketDataProvider', () => {
  const item = (id: number, status: string, over: any = {}) => ({
    id,
    status,
    quantity: 1,
    notes: null,
    variant_label: null,
    product: { id: id * 10, name: `Plato ${id}`, sku: null },
    order_item: { is_takeaway: false },
    exclusions: [],
    ...over,
  });

  const orderRow = (over: any = {}) => ({
    id: 900,
    order_number: 'ORD-900',
    notes: 'Alergia a nueces',
    delivery_type: 'dine_in',
    customer_alias: null,
    users: { first_name: 'Ana', last_name: 'Pérez' },
    ...over,
  });

  const ticketRow = (over: any = {}) => ({
    id: 1,
    store_id: 3,
    order_id: 900,
    table_id: 7,
    status: 'pending',
    daily_number: 12,
    business_date: null,
    fired_at: new Date('2026-10-07T15:00:00Z'),
    created_at: new Date('2026-10-07T15:00:00Z'),
    ready_at: null,
    kds: { id: 1, name: 'Cocina', code: 'kitchen' },
    table: { id: 7, name: '4', zone: 'Salón' },
    order: orderRow(),
    items: [item(1, 'pending'), item(2, 'delivered')],
    ...over,
  });

  const build = (opts: { mode?: string; ticket?: any; siblings?: any[] } = {}) => {
    const ticket = opts.ticket ?? ticketRow();
    const findMany = jest.fn().mockResolvedValue(
      opts.siblings ?? [
        { ...ticketRow({ id: 1 }), items: [item(1, 'pending')] },
        {
          ...ticketRow({ id: 2, fired_at: new Date('2026-10-07T15:10:00Z') }),
          items: [item(3, 'in_preparation')],
        },
      ],
    );
    const prisma: any = {
      kitchen_tickets: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        findMany,
      },
      table_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { restaurant: { kitchen_mode: opts.mode ?? 'virtual' } },
        }),
      },
    };
    return { prisma, findMany, provider: new KitchenTicketDataProvider(prisma) };
  };

  it('físico: junta los ítems vivos de todos los tickets de la orden', async () => {
    const { provider, findMany } = build({ mode: 'physical' });
    const data = await provider.fetchDocumentData(3, 1);

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ order_id: 900, store_id: 3 });
    expect(args.orderBy).toEqual([{ fired_at: 'asc' }, { id: 'asc' }]);
    expect(args.include.items.where).toEqual({
      status: { notIn: ['delivered', 'cancelled'] },
    });
    expect(data.items.map((i) => i.product_name)).toEqual(['Plato 1', 'Plato 3']);
  });

  it('virtual: solo los ítems del ticket pedido, sin consultar hermanos', async () => {
    const { provider, findMany } = build({ mode: 'virtual' });
    const data = await provider.fetchDocumentData(3, 1);

    expect(findMany).not.toHaveBeenCalled();
    expect(data.items.map((i) => i.product_name)).toEqual(['Plato 1', 'Plato 2']);
    expect(data.custom_variables!.kds_name).toBe('Cocina');
  });

  it('físico: no envía kds_name ni kds_station_type', async () => {
    const { provider } = build({ mode: 'physical' });
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.custom_variables).not.toHaveProperty('kds_name');
    expect(data.custom_variables).not.toHaveProperty('kds_station_type');
  });

  it('document.notes, número de orden, comanda, cliente y servicio', async () => {
    const { provider } = build();
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.document.notes).toBe('Alergia a nueces');
    expect(data.document.order_number).toBe('ORD-900');
    expect(data.custom_variables!.order_number).toBe('ORD-900');
    expect(data.document.daily_number).toBe(12);
    expect(data.document.customer_name).toBe('Ana Pérez');
    expect(data.document.service_type_label).toBe('Mesa 4');
  });

  it('customer_alias manda sobre el nombre del usuario', async () => {
    const { provider } = build({
      ticket: ticketRow({ order: orderRow({ customer_alias: ' Don Pedro ' }) }),
    });
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.document.customer_name).toBe('Don Pedro');
  });

  it('packaging_label: home_delivery => ENVÍO', async () => {
    const { provider } = build({
      ticket: ticketRow({
        table_id: null,
        table: null,
        order: orderRow({ delivery_type: 'home_delivery' }),
      }),
    });
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.items[0].packaging_label).toBe('ENVÍO');
    expect(data.document.service_type_label).toBe('Domicilio');
  });

  it('packaging_label: mesa + is_takeaway => PARA LLEVAR; sin marca => vacío', async () => {
    const { provider } = build({
      ticket: ticketRow({
        items: [
          item(1, 'pending', { order_item: { is_takeaway: true } }),
          item(2, 'pending'),
        ],
      }),
    });
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.items[0].packaging_label).toBe('PARA LLEVAR');
    expect(data.items[1].packaging_label).toBeUndefined();
  });

  it('packaging_label: sin mesa + direct_delivery => PARA LLEVAR', async () => {
    const { provider } = build({
      ticket: ticketRow({
        table_id: null,
        table: null,
        order: orderRow({ delivery_type: 'direct_delivery' }),
      }),
    });
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.items[0].packaging_label).toBe('PARA LLEVAR');
    expect(data.document.service_type_label).toBe('Para llevar');
  });

  it('modifiers: exclusiones con prefijo "SIN "', async () => {
    const { provider } = build({
      ticket: ticketRow({
        items: [
          item(1, 'pending', {
            exclusions: [
              { component_product: { id: 1, name: 'cebolla' } },
              { component_product: { id: 2, name: 'tomate' } },
            ],
          }),
        ],
      }),
    });
    const data = await provider.fetchDocumentData(3, 1);
    expect(data.items[0].modifiers).toEqual(['SIN cebolla', 'SIN tomate']);
  });

  it('composer: el HTML de la comanda contiene "SIN " y "PARA LLEVAR"', async () => {
    const { provider } = build({
      ticket: ticketRow({
        items: [
          item(1, 'pending', {
            order_item: { is_takeaway: true },
            exclusions: [{ component_product: { id: 1, name: 'cebolla' } }],
          }),
        ],
      }),
    });
    const data = await provider.fetchDocumentData(3, 1);
    const composer = new PrintLayoutComposerService({
      escapeHtml: (v: any) => String(v ?? ''),
    } as any);
    const definition: any = {
      columns: [
        { id: 'c1', key: 'product_name', label: 'Plato', enabled: true, width_percent: 100, align: 'left' },
      ],
    };
    const itemsHtml = (composer as any).renderItemsTableSection({}, definition, data, 'dummy');
    expect(itemsHtml).toContain('SIN cebolla');
    expect(itemsHtml).toContain('PARA LLEVAR');

    const infoHtml = (composer as any).renderTableInfoSection({ id: 'sec_table' }, data, 'dummy');
    expect(infoHtml).toContain('Orden #');
    expect(infoHtml).toContain('Comanda #');
    const notesHtml = (composer as any).renderNotesSection({ id: 'sec_notes' }, data, 'dummy');
    expect(notesHtml).toContain('Nota de la orden');
    expect(notesHtml).toContain('Alergia a nueces');
  });
});
