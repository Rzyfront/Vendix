import { RequestContextService } from '@common/context/request-context.service';
import { ServiceSessionsService } from './service-sessions.service';

const field = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  store_id: 1,
  entity_type: 'service_session',
  field_type: 'text',
  label: `Campo ${id}`,
  is_active: true,
  ...overrides,
});

const template = {
  id: 50,
  name: 'Recepción vehículo',
  tabs: [
    {
      sections: [
        {
          items: [
            { metadata_field_id: 1, is_required: true, sort_order: 0, metadata_field: field(1, { label: 'Placa' }) },
            { metadata_field_id: 2, is_required: false, sort_order: 1, metadata_field: field(2, { field_type: 'number', label: 'Kilometraje' }) },
          ],
          child_sections: [
            {
              items: [
                { metadata_field_id: 3, is_required: false, sort_order: 0, metadata_field: field(3, { entity_type: 'customer', label: 'Teléfono alterno' }) },
                { metadata_field_id: 4, is_required: false, sort_order: 1, metadata_field: field(4, { entity_type: 'booking', field_type: 'checkbox' }) },
              ],
            },
          ],
        },
      ],
    },
  ],
  sections: [
    { items: [{ metadata_field_id: 5, is_required: false, sort_order: 0, metadata_field: field(5, { field_type: 'date' }) }] },
  ],
};

describe('ServiceSessionsService — intake (Recolección de datos) y carga masiva', () => {
  let service: ServiceSessionsService;
  let templates: { getLinkedTemplateForProduct: jest.Mock };
  let prisma: any;
  let notifications: { push: jest.Mock };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, user_id: 9 } as any);
    templates = { getLinkedTemplateForProduct: jest.fn().mockResolvedValue(template) };
    notifications = { push: jest.fn() };
    prisma = {
      entity_metadata_values: { findMany: jest.fn().mockResolvedValue([]) },
      service_sessions: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new ServiceSessionsService(
      prisma,
      notifications as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      templates as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const prepare = (values: unknown, enforceRequired = true, customerId: number | null = null) =>
    (service as any).prepareIntake(10, values, { enforceRequired, customerId, bookingId: null });

  it('rechaza field_ids que no pertenecen a la plantilla vinculada', async () => {
    await expect(prepare([{ field_id: 1, value: 'ABC123' }, { field_id: 999, value: 'x' }])).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_013' }),
    });
  });

  it('exige los items obligatorios en walk-in, nombrando el campo', async () => {
    await expect(prepare([{ field_id: 2, value: 12 }])).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_007', message: expect.stringContaining('"Placa"') }),
    });
  });

  it('no exige obligatorios cuando la atención viene de una reserva', async () => {
    await expect(prepare([], false)).resolves.toMatchObject({ templateId: 50, entries: [] });
  });

  it('rechaza intake_values si el servicio no tiene plantilla vinculada', async () => {
    templates.getLinkedTemplateForProduct.mockResolvedValueOnce(null);
    await expect(prepare([{ field_id: 1, value: 'x' }])).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_013' }),
    });
    templates.getLinkedTemplateForProduct.mockResolvedValueOnce(null);
    await expect(prepare(undefined)).resolves.toBeNull();
  });

  it('mapea el valor por field_type y omite vacíos', async () => {
    const result = await prepare([
      { field_id: 1, value: ' ABC123 ' },
      { field_id: 2, value: '45000' },
      { field_id: 3, value: '' },
      { field_id: 4, value: true },
      { field_id: 5, value: '2026-10-21' },
    ]);
    const byId = Object.fromEntries(result.entries.map((e: any) => [e.field.id, e.columns]));
    expect(byId[1]).toEqual({ value_text: 'ABC123', value_number: null, value_date: null, value_bool: null });
    expect(byId[2].value_number).toBe(45000);
    expect(byId[3]).toBeUndefined();
    expect(byId[4].value_bool).toBe(true);
    expect(byId[5].value_date.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('rechaza un número inválido', async () => {
    await expect(prepare([{ field_id: 1, value: 'A' }, { field_id: 2, value: 'abc' }])).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_013' }),
    });
  });

  it('persiste cada respuesta en su entidad (service_session / customer) y salta las que no tienen entidad', async () => {
    const intake = await prepare([
      { field_id: 1, value: 'ABC123' },
      { field_id: 3, value: '3001234567' },
      { field_id: 4, value: true },
    ]);
    const tx = { entity_metadata_values: { upsert: jest.fn() } };
    await (service as any).persistIntake(tx, 1, intake, { service_session_id: 77, customer_id: 33, booking_id: null, order_id: 88 });
    const calls = tx.entity_metadata_values.upsert.mock.calls.map(([args]: any) => args.create);
    expect(calls).toEqual([
      expect.objectContaining({ store_id: 1, field_id: 1, entity_type: 'service_session', entity_id: 77, value_text: 'ABC123' }),
      expect.objectContaining({ store_id: 1, field_id: 3, entity_type: 'customer', entity_id: 33, value_text: '3001234567' }),
    ]);
  });

  it('getIntakePrefill devuelve solo los valores de campos customer de la plantilla', async () => {
    prisma.entity_metadata_values.findMany.mockResolvedValueOnce([
      { field_id: 3, entity_type: 'customer', value_text: '3001234567', value_number: null, value_date: null, value_bool: null, value_json: null },
    ]);
    await expect(service.getIntakePrefill(10, 33)).resolves.toEqual({ values: [{ field_id: 3, value: '3001234567' }] });
    expect(prisma.entity_metadata_values.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ store_id: 1, entity_type: 'customer', entity_id: 33, field_id: { in: [3] } }),
    }));
  });

  it('addItemsBulk carga todas las líneas en una sola transacción y emite un solo evento', async () => {
    prisma.service_sessions.findFirst.mockResolvedValue({ id: 77, status: 'open', order_id: null });
    let createdItems = 0;
    const tx = {
      products: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve({ id: where.id, name: `P${where.id}`, base_price: 1000, product_type: 'service', track_inventory: false })),
      },
      orders: { create: jest.fn().mockResolvedValue({ id: 88 }), update: jest.fn() },
      service_sessions: { updateMany: jest.fn() },
      order_items: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: ++createdItems, ...data })),
        findMany: jest.fn().mockResolvedValue([{ total_price: 2000 }, { total_price: 1500 }]),
      },
      service_progress_events: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const result = await service.addItemsBulk(77, [
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1, unit_price: 1500 },
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.orders.create).toHaveBeenCalledTimes(1);
    expect(tx.order_items.create).toHaveBeenCalledTimes(2);
    expect(tx.order_items.create.mock.calls[1][0].data).toMatchObject({ order_id: 88, unit_price: 1500, total_price: 1500 });
    expect(result).toMatchObject({ order_id: 88, grand_total: 3500 });
    expect(result.items).toHaveLength(2);
    expect(notifications.push).toHaveBeenCalledTimes(1);
    expect(notifications.push.mock.calls[0][1].data).toMatchObject({ session_id: 77, event_type: 'item_added', grand_total: 3500 });
  });

  it('addItemsBulk revierte todo si un producto no existe', async () => {
    prisma.service_sessions.findFirst.mockResolvedValue({ id: 77, status: 'open', order_id: 88 });
    const tx = { products: { findFirst: jest.fn().mockResolvedValue(null) } };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(service.addItemsBulk(77, [{ product_id: 1 }])).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'PROD_FIND_001' }),
    });
    expect(notifications.push).not.toHaveBeenCalled();
  });
});
