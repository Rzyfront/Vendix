import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ServiceSessionsService } from './service-sessions.service';
import { rentalBlocksConsumed } from './utils/session-order-lines.util';

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
  let templates: { getLinkedTemplateForProduct: jest.Mock; getActiveTemplateById: jest.Mock };
  let prisma: any;
  let notifications: { push: jest.Mock };
  let stockLevelManager: { reserveStock: jest.Mock; getDefaultLocationForProduct: jest.Mock; releaseReservationQuantity: jest.Mock; releaseReservationsByReference: jest.Mock };
  let stockValidator: { resolveInventoryPolicy: jest.Mock };
  let allocator: { allocateForLine: jest.Mock; absorbShortfall: jest.Mock };
  let shippingTax: { taxRowsForCategory: jest.Mock };

  beforeEach(() => {
    stockLevelManager = {
      reserveStock: jest.fn(),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(7),
      releaseReservationQuantity: jest.fn().mockResolvedValue(0),
      releaseReservationsByReference: jest.fn(),
    };
    stockValidator = { resolveInventoryPolicy: jest.fn().mockResolvedValue({ allowOversell: false }) };
    allocator = {
      allocateForLine: jest.fn().mockResolvedValue({ slices: [{ location_id: 7, quantity: 1 }], shortfall: 0, available: 1 }),
      absorbShortfall: jest.fn((a: any, loc: number) => [{ location_id: loc, quantity: 1 }]),
    };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, user_id: 9, roles: ['admin'], permissions: ['store:pos:price_override'] } as any);
    templates = {
      getLinkedTemplateForProduct: jest.fn().mockResolvedValue(template),
      getActiveTemplateById: jest.fn().mockResolvedValue(null),
    };
    notifications = { push: jest.fn() };
    shippingTax = { taxRowsForCategory: jest.fn().mockResolvedValue([]) };
    prisma = {
      entity_metadata_values: { findMany: jest.fn().mockResolvedValue([]) },
      service_sessions: { findFirst: jest.fn() },
      service_stations: { findFirst: jest.fn().mockResolvedValue({ intake_template_id: null }) },
      $transaction: jest.fn(),
    };
    service = new ServiceSessionsService(
      prisma,
      notifications as any,
      { getStoreCurrency: jest.fn().mockResolvedValue('USD') } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      templates as any,
      stockLevelManager as any,
      stockValidator as any,
      allocator as any,
      shippingTax as any,
      { announceReceived: jest.fn() } as any,
      {} as any,
      { emit: jest.fn() } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const prepare = (values: unknown, enforceRequired = true, customerId: number | null = null) =>
    (service as any).prepareIntake(10, 3, values, { enforceRequired, customerId, bookingId: null });

  it('usa el formulario de la estación antes que el del servicio', async () => {
    const stationTemplate = { ...template, id: 77 };
    prisma.service_stations.findFirst.mockResolvedValueOnce({ intake_template_id: 77 });
    templates.getActiveTemplateById.mockResolvedValueOnce(stationTemplate);
    await expect(prepare([], false)).resolves.toMatchObject({ templateId: 77 });
    expect(prisma.service_stations.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3, store_id: 1 } }));
    expect(templates.getLinkedTemplateForProduct).not.toHaveBeenCalled();
  });

  it('si la estación no tiene formulario, usa el del servicio', async () => {
    await expect(prepare([], false)).resolves.toMatchObject({ templateId: 50 });
    expect(templates.getLinkedTemplateForProduct).toHaveBeenCalledWith(10);
  });

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
        findFirst: jest.fn(({ where }: any) => Promise.resolve({ id: where.id, name: `P${where.id}`, base_price: 1000, product_type: 'service', track_inventory: false, allow_pos_price_override: true })),
      },
      orders: { create: jest.fn().mockResolvedValue({ id: 88 }), update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ total_paid: 0 }) },
      product_variants: { count: jest.fn().mockResolvedValue(0) },
      service_sessions: { updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ status: 'open' }) },
      // Producto 2 lleva IVA 19 % sumado encima; el 1 no tiene impuesto.
      product_tax_assignments: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(where.product_id.in.includes(2)
          ? [{ product_id: 2, is_inclusive: false, tax_categories: { tax_type: 'iva', tax_rates: [{ id: 5, name: 'IVA 19%', rate: 0.19 }] } }]
          : [])),
      },
      order_items: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: ++createdItems, ...data })),
        findMany: jest.fn().mockResolvedValue([
          { total_price: 2000, tax_amount_item: 0, quantity: 2, weight: null, price_unit_quantity: null, order_item_taxes: [] },
          { total_price: 1500, tax_amount_item: 285, quantity: 1, weight: null, price_unit_quantity: null, order_item_taxes: [{ tax_amount: 285 }] },
        ]),
      },
      service_progress_events: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), ...tx }));

    const result = await service.addItemsBulk(77, [
      { product_id: 1, quantity: 2 },
      { product_id: 2, quantity: 1, unit_price: 1500 },
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.orders.create).toHaveBeenCalledTimes(1);
    expect(tx.orders.create.mock.calls[0][0].data.currency).toBe('USD');
    expect(tx.order_items.create).toHaveBeenCalledTimes(2);
    const taxed = tx.order_items.create.mock.calls[1][0].data;
    expect(Number(taxed.unit_price)).toBe(1500);
    expect(Number(taxed.total_price)).toBe(1500);
    expect(Number(taxed.tax_amount_item)).toBe(285);
    expect(Number(taxed.final_unit_price)).toBe(1785);
    expect(taxed.order_item_taxes.create[0]).toMatchObject({ tax_rate_id: 5, tax_type: 'iva', is_inclusive: false, tax_amount: 285 });
    expect(tx.order_items.create.mock.calls[0][0].data.order_item_taxes).toBeUndefined();
    expect(tx.orders.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ subtotal_amount: 3500, tax_amount: 285, grand_total: 3785, remaining_balance: 3785 }),
    }));
    expect(result).toMatchObject({ order_id: 88, grand_total: 3785 });
    expect(result.items).toHaveLength(2);
    expect(notifications.push).toHaveBeenCalledTimes(1);
    expect(notifications.push.mock.calls[0][1].data).toMatchObject({ session_id: 77, event_type: 'item_added', grand_total: 3785 });
  });

  it('IVA incluido: el precio publicado se mantiene y se despeja la base', async () => {
    prisma.service_sessions.findFirst.mockResolvedValue({ id: 77, status: 'open', order_id: 88 });
    const tx = {
      products: { findFirst: jest.fn().mockResolvedValue({ id: 3, name: 'Cambio de aceite', base_price: 119000, product_type: 'service', track_inventory: false }) },
      product_variants: { count: jest.fn().mockResolvedValue(0) },
      orders: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ total_paid: 0 }) },
      product_tax_assignments: {
        findMany: jest.fn().mockResolvedValue([{ product_id: 3, is_inclusive: true, tax_categories: { tax_type: 'iva', tax_rates: [{ id: 5, name: 'IVA 19%', rate: 0.19 }] } }]),
      },
      order_items: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })), findMany: jest.fn().mockResolvedValue([]) },
      service_progress_events: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), service_sessions: prisma.service_sessions, ...tx }));
    await service.addItemsBulk(77, [{ product_id: 3, quantity: 1 }]);
    const line = tx.order_items.create.mock.calls[0][0].data;
    expect(Number(line.final_unit_price)).toBe(119000);
    expect(Number(line.unit_price)).toBe(100000);
    expect(Number(line.tax_amount_item)).toBe(19000);
  });

  it('addItemsBulk revierte todo si un producto no existe', async () => {
    prisma.service_sessions.findFirst.mockResolvedValue({ id: 77, status: 'open', order_id: 88 });
    const tx = { products: { findFirst: jest.fn().mockResolvedValue(null) } };
    prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), service_sessions: prisma.service_sessions, ...tx }));
    await expect(service.addItemsBulk(77, [{ product_id: 1 }])).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'PROD_FIND_001' }),
    });
    expect(notifications.push).not.toHaveBeenCalled();
  });

  it('rechaza un cliente que no pertenece a la tienda al abrir un walk-in', async () => {
    prisma.service_stations.findFirst.mockResolvedValue({ id: 3, intake_template_id: null });
    prisma.products = { findFirst: jest.fn().mockResolvedValue({ id: 10, product_type: 'service', state: 'active' }) };
    prisma.service_station_services = { findFirst: jest.fn().mockResolvedValue({ id: 1 }) };
    prisma.users = { findFirst: jest.fn().mockResolvedValue(null) };
    await expect(service.open({ station_id: 3, product_id: 10, customer_id: 999 } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'CUST_FIND_001' }),
    });
    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 999, store_users: { some: { store_id: 1 } } } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['no asignado a la estación', null, 'active'],
    ['inactivo en el catálogo', { id: 1 }, 'inactive'],
  ])('rechaza abrir un walk-in con un servicio %s', async (_label, link, state) => {
    prisma.service_stations.findFirst.mockResolvedValue({ id: 3 });
    prisma.products = { findFirst: jest.fn().mockResolvedValue({ id: 10, product_type: 'service', state }) };
    prisma.service_station_services = { findFirst: jest.fn().mockResolvedValue(link) };
    await expect(service.open({ station_id: 3, product_id: 10 } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_001' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza un walk-in con un técnico que no está asignado a la estación', async () => {
    prisma.service_stations.findFirst.mockResolvedValue({ id: 3 });
    prisma.products = { findFirst: jest.fn().mockResolvedValue({ id: 10, product_type: 'service', state: 'active' }) };
    prisma.service_station_services = { findFirst: jest.fn().mockResolvedValue({ id: 1 }) };
    prisma.service_providers = { findFirst: jest.fn().mockResolvedValue({ id: 7 }) };
    prisma.service_station_providers = { findFirst: jest.fn().mockResolvedValue(null) };
    templates.getLinkedTemplateForProduct.mockResolvedValue(null); // sin formulario: aísla la regla del técnico
    await expect(service.open({ station_id: 3, product_id: 10, provider_id: 7 } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_001', message: expect.stringContaining('no está asignado') }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('stock y precio al cargar ítems', () => {
    const buildTx = (product: any) => {
      const tx: any = {
        products: { findFirst: jest.fn().mockResolvedValue({ id: 5, name: 'Aceite', base_price: 1000, product_type: 'physical', track_inventory: true, allow_pos_price_override: false, ...product }) },
        product_variants: { count: jest.fn().mockResolvedValue(0) },
        product_tax_assignments: { findMany: jest.fn().mockResolvedValue([]) },
        order_items: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })) },
        service_progress_events: { create: jest.fn() },
      };
      return tx;
    };
    const add = (tx: any, dto: any) =>
      (service as any).addItemTx(tx, 1, 9, { id: 77, order_id: 88 }, { product_id: 5, quantity: 1, ...dto }, new Date());

    it.each([
      [{ usage_nature: 'supply' }, 'Insumo'],
      [{ usage_nature: 'internal_use' }, 'Uso interno'],
      [{ usage_nature: 'sale', is_ingredient: true, is_sellable: false }, 'Insumo'],
    ])('rechaza con 422 un producto que no se vende (%j) sin reservar ni crear la línea', async (nature, label) => {
      const tx = buildTx(nature);
      await expect(add(tx, {})).rejects.toMatchObject({
        message: `"Aceite" es un producto de ${label} y no se puede vender.`,
        response: expect.objectContaining({ error_code: 'PROD_NATURE_NOT_SELLABLE' }),
      });
      expect(stockLevelManager.reserveStock).not.toHaveBeenCalled();
      expect(tx.order_items.create).not.toHaveBeenCalled();
    });

    it('un producto de Venta que además es ingrediente se carga normal', async () => {
      const tx = buildTx({ usage_nature: 'sale', is_ingredient: true, is_sellable: true });
      await add(tx, {});
      expect(tx.order_items.create).toHaveBeenCalled();
    });

    it('reserva por StockLevelManager en la ubicación vendible, con claim estricto', async () => {
      const tx = buildTx({});
      await add(tx, {});
      expect(allocator.allocateForLine).toHaveBeenCalledWith(1, 5, undefined, 1, [], tx, { orderId: 88 });
      // validate_availability=true y allow_negative_available=false: claim atómico estricto.
      expect(stockLevelManager.reserveStock).toHaveBeenCalledWith(5, undefined, 7, 1, 'order', 88, 9, true, tx, undefined, false, undefined, false);
    });

    it('sin stock suficiente lanza INV_STOCK_INSUFFICIENT_LINES y no crea la línea', async () => {
      allocator.allocateForLine.mockResolvedValue({ slices: [], shortfall: 1, available: 0 });
      const tx = buildTx({});
      await expect(add(tx, {})).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'INV_STOCK_INSUFFICIENT_LINES' }) });
      expect(stockLevelManager.reserveStock).not.toHaveBeenCalled();
      expect(tx.order_items.create).not.toHaveBeenCalled();
    });

    it('con allow_negative_stock absorbe el faltante en la ubicación por defecto', async () => {
      stockValidator.resolveInventoryPolicy.mockResolvedValue({ allowOversell: true });
      allocator.allocateForLine.mockResolvedValue({ slices: [], shortfall: 1, available: 0 });
      const tx = buildTx({});
      await add(tx, {});
      expect(stockLevelManager.getDefaultLocationForProduct).toHaveBeenCalledWith(5, undefined, tx);
      expect(stockLevelManager.reserveStock).toHaveBeenCalledWith(5, undefined, 7, 1, 'order', 88, 9, false, tx, undefined, false, undefined, true);
    });

    it('un producto sin inventario no toca el stock', async () => {
      const tx = buildTx({ track_inventory: false });
      await add(tx, {});
      expect(allocator.allocateForLine).not.toHaveBeenCalled();
      expect(stockLevelManager.reserveStock).not.toHaveBeenCalled();
    });

    it('rechaza un unit_price distinto al publicado si el producto no permite editar precio', async () => {
      const tx = buildTx({ track_inventory: false });
      await expect(add(tx, { unit_price: 500 })).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'POS_PRICE_OVERRIDE_NOT_ALLOWED_001' }) });
    });

    it('rechaza con AUTH_PERM_001 un precio editado sin el permiso store:pos:price_override', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, user_id: 9, roles: ['cashier'], permissions: [] } as any);
      const tx = buildTx({ track_inventory: false, allow_pos_price_override: true });
      await expect(add(tx, { unit_price: 500 })).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'AUTH_PERM_001' }) });
      expect(tx.order_items.create).not.toHaveBeenCalled();
    });

    it('acepta un precio editado con el permiso y el flag del producto', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, user_id: 9, roles: ['cashier'], permissions: ['store:pos:price_override'] } as any);
      const tx = buildTx({ track_inventory: false, allow_pos_price_override: true });
      await add(tx, { unit_price: 500 });
      expect(tx.order_items.create.mock.calls[0][0].data.is_price_overridden).toBe(true);
    });

    it('acepta un unit_price igual al publicado aunque el producto no permita override', async () => {
      const tx = buildTx({ track_inventory: false });
      await add(tx, { unit_price: 1000 });
      expect(tx.order_items.create.mock.calls[0][0].data.is_price_overridden).toBe(false);
    });
  });

  describe('prepareCharge', () => {
    const setup = (budget: any) => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 77, order_id: 88 } as any);
      const tx = {
        orders: {
          findFirst: jest.fn().mockResolvedValue({ grand_total: 119000, tip_amount: 0, currency: 'COP' }),
          findUnique: jest.fn().mockResolvedValue({ total_paid: 0 }),
          update: jest.fn().mockResolvedValue({ store_id: 1, service_session_id: 77 }),
        },
        order_items: { findMany: jest.fn().mockResolvedValue([]) },
        service_budgets: { findFirst: jest.fn().mockResolvedValue(budget), create: jest.fn() },
        service_stations: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), service_sessions: prisma.service_sessions, ...tx }));
      return tx;
    };

    it('sin presupuesto pactado crea el base con el total de la cuenta', async () => {
      const tx = setup(null);
      await expect(service.prepareCharge(77)).resolves.toEqual({ order_id: 88 });
      expect(tx.service_budgets.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ session_id: 77, version: 1, currency: 'COP', approved_at: null, is_system: true }),
      });
      expect(Number(tx.service_budgets.create.mock.calls[0][0].data.amount)).toBe(119000);
    });

    it('no sube un presupuesto del cliente que no cubre el total', async () => {
      const tx = setup({ amount: 100000, currency: 'COP' });
      await expect(service.prepareCharge(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_001' }),
      });
      expect(tx.service_budgets.create).not.toHaveBeenCalled();
    });

    it('el base del sistema sube con la cuenta: nunca bloquea el cobro', async () => {
      const tx = setup({ amount: 100000, currency: 'COP', version: 1, is_system: true });
      await expect(service.prepareCharge(77)).resolves.toEqual({ order_id: 88 });
      expect(tx.service_budgets.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 2, is_system: true }),
      });
      expect(Number(tx.service_budgets.create.mock.calls[0][0].data.amount)).toBe(119000);
    });

    it('acepta un presupuesto que cubre el total', async () => {
      const tx = setup({ amount: 150000, currency: 'COP' });
      await expect(service.prepareCharge(77)).resolves.toEqual({ order_id: 88 });
      expect(tx.service_budgets.create).not.toHaveBeenCalled();
    });

    it('incluye el alquiler por bloque de la estación en el cobro', async () => {
      const tx: any = setup(null);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 77, order_id: 88, station_id: 4, opened_at: new Date(Date.now() - 20 * 60_000) } as any);
      tx.service_stations.findFirst.mockResolvedValue({ name: 'Sala 2', rental_block_minutes: 60, rental_block_price: 15000 });
      tx.order_items.findFirst = jest.fn().mockResolvedValue(null);
      tx.order_items.create = jest.fn();
      await expect(service.prepareCharge(77)).resolves.toEqual({ order_id: 88 });
      expect(tx.order_items.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ order_id: 88, service_session_id: 77, product_name: 'Alquiler Sala 2', quantity: 1, item_type: 'service' }),
      });
    });
  });

  describe('variantes en la cuenta', () => {
    const txWith = (variant: any, variantCount = 0) => ({
      products: { findFirst: jest.fn().mockResolvedValue({ id: 4, name: 'Aceite', base_price: 50000, product_type: 'physical', track_inventory: false }) },
      product_variants: { findFirst: jest.fn().mockResolvedValue(variant), count: jest.fn().mockResolvedValue(variantCount) },
      orders: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ total_paid: 0 }) },
      product_tax_assignments: { findMany: jest.fn().mockResolvedValue([]) },
      order_items: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })), findMany: jest.fn().mockResolvedValue([]) },
      service_progress_events: { create: jest.fn() },
    });

    beforeEach(() => prisma.service_sessions.findFirst.mockResolvedValue({ id: 77, status: 'open', order_id: 88 }));

    it('usa el precio y el nombre de la variante', async () => {
      const tx = txWith({ id: 9, name: '4 L', sku: 'AC-4L', price_override: 180000, is_on_sale: false, sale_price: null, track_inventory_override: null });
      prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), service_sessions: prisma.service_sessions, ...tx }));
      await service.addItemsBulk(77, [{ product_id: 4, product_variant_id: 9, quantity: 1 }]);
      const line = tx.order_items.create.mock.calls[0][0].data;
      expect(line).toMatchObject({ product_variant_id: 9, product_name: 'Aceite - 4 L' });
      expect(Number(line.unit_price)).toBe(180000);
    });

    it('exige elegir variante si el producto las tiene', async () => {
      const tx = txWith(null, 2);
      prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), service_sessions: prisma.service_sessions, ...tx }));
      await expect(service.addItemsBulk(77, [{ product_id: 4, quantity: 1 }])).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'PRODUCT_VARIANT_MISMATCH' }),
      });
    });

    it('rechaza una variante de otro producto', async () => {
      const tx = txWith(null);
      prisma.$transaction.mockImplementation((fn: any) => fn({ $queryRaw: jest.fn().mockResolvedValue([{ id: 88, state: 'draft' }]), service_sessions: prisma.service_sessions, ...tx }));
      await expect(service.addItemsBulk(77, [{ product_id: 4, product_variant_id: 99, quantity: 1 }])).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'PRODUCT_VARIANT_MISMATCH' }),
      });
      expect(tx.order_items.create).not.toHaveBeenCalled();
    });
  });

  describe('assessProviders (horario y ocupación del personal)', () => {
    // Martes 2026-10-20 10:00 hora Bogotá (UTC-5).
    const NOW = new Date('2026-10-20T15:00:00.000Z');
    const END = new Date('2026-10-20T15:45:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
      prisma.store_settings = { findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }) };
      prisma.service_providers = { findMany: jest.fn().mockResolvedValue([
        { id: 1, display_name: 'Sin horario', is_active: true },
        { id: 2, display_name: 'Libre', is_active: true },
        { id: 3, display_name: 'Ocupado', is_active: true },
        { id: 4, display_name: 'Con reserva', is_active: true },
        { id: 5, display_name: 'Fuera de turno', is_active: true },
      ]) };
      const workday = (provider_id: number, start = '08:00', end = '18:00') => ({ provider_id, day_of_week: 2, start_time: start, end_time: end });
      prisma.provider_schedules = { findMany: jest.fn().mockResolvedValue([workday(2), workday(3), workday(4), workday(5, '14:00', '18:00')]) };
      prisma.provider_exceptions = { findMany: jest.fn().mockResolvedValue([]) };
      prisma.service_allocations = { findMany: jest.fn().mockResolvedValue([{ provider_id: 3, station_id: 9, session_id: 50, booking_id: null }]) };
      prisma.bookings = { findMany: jest.fn().mockResolvedValue([{ provider_id: 4, start_time: '10:15', end_time: '11:00' }]) };
      prisma.service_stations.findMany = jest.fn().mockResolvedValue([{ id: 9, name: 'Bahía 2' }]);
    });

    afterEach(() => jest.useRealTimers());

    it('clasifica sin horario, fuera de turno, ocupado, con reserva y disponible', async () => {
      const result = await service.assessProviders(3, END, [1, 2, 3, 4, 5]);
      const byName = Object.fromEntries(result.map((r: any) => [r.display_name, r]));
      expect(byName['Sin horario']).toMatchObject({ status: 'no_schedule' });
      expect(byName['Libre']).toMatchObject({ status: 'available' });
      expect(byName['Ocupado']).toMatchObject({ status: 'busy', detail: 'Atendiendo en Bahía 2' });
      expect(byName['Con reserva']).toMatchObject({ status: 'busy' });
      expect(byName['Fuera de turno']).toMatchObject({ status: 'off_schedule' });
    });

    it('una excepción de día libre deja al especialista fuera de turno', async () => {
      prisma.provider_exceptions.findMany.mockResolvedValue([{ provider_id: 2, is_unavailable: true, custom_start_time: null, custom_end_time: null }]);
      const result = await service.assessProviders(3, END, [2]);
      expect(result.find((r: any) => r.display_name === 'Libre')).toMatchObject({ status: 'off_schedule' });
    });
  });

  describe('transition — la estación no se libera hasta cobrar', () => {
    const session = { id: 21, store_id: 1, order_id: 149, status: 'open', station_id: 9, opened_at: new Date(Date.now() - 70 * 60_000) };
    let tx: any;

    beforeEach(() => {
      jest.spyOn(service, 'findOne').mockResolvedValue(session as any);
      tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 149, state: 'draft' }]),
        orders: { findFirst: jest.fn() },
        service_sessions: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        service_allocations: { updateMany: jest.fn() },
        service_session_tokens: { updateMany: jest.fn() },
        service_budgets: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
        service_progress_events: { create: jest.fn() },
        service_stations: { findFirst: jest.fn().mockResolvedValue(null) },
        order_items: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
        order_item_taxes: { deleteMany: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    });

    it('cierra con saldo pendiente → 409 y la sesión sigue abierta', async () => {
      tx.orders.findFirst.mockResolvedValue({ remaining_balance: 50000 });
      await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_006' }),
      });
      expect(tx.service_sessions.updateMany).not.toHaveBeenCalled();
      expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
    });

    it('con anticipo sin liquidar no cierra (normal ni con saldo por cobrar) y avisa que se liquide', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...session, deposit: { settled_at: null, balance: 400000 } } as any);
      await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_010', message: expect.stringContaining('liquídalo') }),
      });
      await expect(service.closePending(21)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_010' }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('con anticipo ya liquidado cierra como cualquier atención', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...session, deposit: { settled_at: new Date(), balance: 0 } } as any);
      tx.orders.findFirst.mockImplementation((args: any) =>
        Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 0 } : { grand_total: 100, tip_amount: 0, currency: 'COP' }),
      );
      await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({ status: 'closed' });
    });

    it('cierra con cuenta en cero y libera la asignación', async () => {
      tx.orders.findFirst.mockImplementation((args: any) =>
        Promise.resolve(
          args?.select?.remaining_balance !== undefined
            ? { remaining_balance: 0 }
            : { grand_total: 100, tip_amount: 0, currency: 'COP' },
        ),
      );
      await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({
        status: 'closed',
      });
      expect(tx.service_allocations.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'released' }) }),
      );
    });

    it('cierra si la orden se canceló aunque tenga saldo', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 149, state: 'cancelled' }]);
      tx.orders.findFirst.mockImplementation((args: any) =>
        Promise.resolve(
          args?.select?.remaining_balance !== undefined
            ? { remaining_balance: 50000 }
            : { grand_total: 100, tip_amount: 0, currency: 'COP' },
        ),
      );
      await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({
        status: 'closed',
      });
    });

    describe('closePending — cerrar dejando el saldo por cobrar', () => {
      const orderMock = (remaining: number, customerId: number | null) =>
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(
            args?.select?.remaining_balance !== undefined
              ? { remaining_balance: remaining, customer_id: customerId }
              : { grand_total: 100, tip_amount: 0, currency: 'COP' },
          ),
        );

      it('rechaza con STATION_015 si hay saldo y la orden no tiene cliente identificado', async () => {
        orderMock(50000, null);
        await expect(service.closePending(21)).rejects.toMatchObject({
          errorCode: 'STATION_015',
          response: expect.objectContaining({
            message: 'Para dejar la cuenta por cobrar, la atención debe tener un cliente identificado.',
          }),
        });
        expect(tx.service_sessions.updateMany).not.toHaveBeenCalled();
        expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
      });

      it('con cliente cierra, libera la asignación y deja el saldo intacto', async () => {
        orderMock(50000, 77);
        tx.orders.updateMany = jest.fn();
        tx.bookings = { updateMany: jest.fn() };
        await expect(service.closePending(21)).resolves.toMatchObject({ id: 21, status: 'closed', balance_pending: 50000 });
        expect(tx.service_allocations.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ state: 'released' }) }),
        );
        // The order is neither finished nor cancelled and its balance is not rewritten.
        expect(tx.orders.updateMany).not.toHaveBeenCalled();
      });

      it('con saldo cero simplemente cierra', async () => {
        orderMock(0, null);
        await expect(service.closePending(21)).resolves.toMatchObject({ status: 'closed', balance_pending: 0 });
      });

      it('el cierre normal sigue rechazando el saldo pendiente con STATION_006', async () => {
        orderMock(50000, 77);
        await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
          errorCode: 'STATION_006',
          response: expect.objectContaining({
            message: 'La atención tiene saldo pendiente; registra el pago antes de finalizar.',
          }),
        });
        expect(tx.service_sessions.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('alquiler por bloque de la estación', () => {
      const withTariff = () => {
        tx.service_stations.findFirst.mockResolvedValue({ name: 'Sala 1', rental_block_minutes: 30, rental_block_price: 20000 });
        tx.orders.update = jest.fn().mockResolvedValue({ store_id: 1, service_session_id: 21 });
        tx.orders.findUnique = jest.fn().mockResolvedValue({ total_paid: 0, discount_amount: 0 });
      };
      // Línea de alquiler ya creada: 3 bloques de $20.000 sin impuesto (lo que vale a los 70 min).
      const rentalLine = (overrides: Record<string, unknown> = {}) => ({
        id: 500, quantity: 3, unit_price: 20000, tax_rate: 0, tax_amount_item: 0, final_unit_price: 20000, cancelled_at: null, ...overrides,
      });

      it('al cerrar agrega "Alquiler <estación>" por bloques consumidos y exige cobrarlo', async () => {
        withTariff();
        tx.order_items.findMany.mockResolvedValue([
          { total_price: 60000, tax_amount_item: 0, quantity: 3, weight: null, price_unit_quantity: null, order_item_taxes: [] },
        ]);
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 60000 } : { grand_total: 60000, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_006' }),
        });
        // 70 min con bloques de 30 → 3 bloques de $20.000, sin impuesto ni producto.
        expect(tx.order_items.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            order_id: 149,
            service_session_id: 21,
            product_id: null,
            product_name: 'Alquiler Sala 1',
            quantity: 3,
            item_type: 'service',
          }),
        });
        const data = tx.order_items.create.mock.calls[0][0].data;
        expect(Number(data.unit_price)).toBe(20000);
        expect(Number(data.total_price)).toBe(60000);
        expect(data.order_item_taxes).toBeUndefined();
        expect(tx.orders.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ grand_total: 60000, remaining_balance: 60000 }) }));
        expect(tx.service_sessions.updateMany).not.toHaveBeenCalled();
        // La línea se carga en una transacción propia: el 409 del cierre no la revierte.
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        await expect(prisma.$transaction.mock.results[0].value).resolves.toBeUndefined();
      });

      it('la línea de alquiler toma el impuesto configurado en la estación', async () => {
        withTariff();
        tx.service_stations.findFirst.mockResolvedValue({
          name: 'Sala 1',
          rental_block_minutes: 30,
          rental_block_price: 20000,
          rental_tax_category_id: 3,
          rental_tax_is_inclusive: false,
        });
        shippingTax.taxRowsForCategory.mockResolvedValue([
          { tax_rate_id: 30, name: 'IVA 19%', rate: 0.19, tax_type: 'iva', is_inclusive: false },
        ]);
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 71400 } : { grand_total: 71400, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_006' }),
        });
        expect(shippingTax.taxRowsForCategory).toHaveBeenCalledWith(tx, { tax_category_id: 3, tax_is_inclusive: false, store_id: 1 });
        const data = tx.order_items.create.mock.calls[0][0].data;
        // Agregado encima: base $20.000 + IVA 19 % = $23.800 por bloque, 3 bloques.
        expect(Number(data.unit_price)).toBe(20000);
        expect(Number(data.total_price)).toBe(60000);
        expect(Number(data.tax_amount_item)).toBe(3800);
        expect(Number(data.final_unit_price)).toBe(23800);
        expect(data.order_item_taxes).toEqual({
          create: [
            { tax_rate_id: 30, tax_name: 'IVA 19%', tax_rate: 0.19, tax_amount: 11400, tax_type: 'iva', is_compound: false, is_inclusive: false },
          ],
        });
      });

      it('sin impuesto configurado la línea sale sin impuesto, como antes', async () => {
        withTariff();
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 60000 } : { grand_total: 60000, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_006' }),
        });
        expect(shippingTax.taxRowsForCategory).toHaveBeenCalledWith(tx, { tax_category_id: null, tax_is_inclusive: true, store_id: 1 });
        const data = tx.order_items.create.mock.calls[0][0].data;
        expect(Number(data.tax_amount_item)).toBe(0);
        expect(Number(data.final_unit_price)).toBe(20000);
        expect(data.order_item_taxes).toBeUndefined();
      });

      it('no duplica la línea si la sesión ya tiene el alquiler de esa estación', async () => {
        withTariff();
        tx.order_items.findFirst.mockResolvedValue(rentalLine());
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 0 } : { grand_total: 60000, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({ status: 'closed' });
        expect(tx.order_items.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { order_id: 149, service_session_id: 21, product_id: null, product_name: { startsWith: 'Alquiler ' } } }),
        );
        expect(tx.order_items.create).not.toHaveBeenCalled();
        expect(tx.order_items.update).not.toHaveBeenCalled();
      });

      it('recalcula la línea abierta si la sesión se extendió un bloque más', async () => {
        withTariff();
        // Creada en "Registrar pago" con 2 bloques; al cerrar van 70 min → 3 bloques.
        tx.order_items.findFirst.mockResolvedValue(rentalLine({ quantity: 2 }));
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 20000 } : { grand_total: 60000, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_006' }),
        });
        expect(tx.order_items.create).not.toHaveBeenCalled();
        expect(tx.order_item_taxes.deleteMany).toHaveBeenCalledWith({ where: { order_item_id: 500 } });
        const { where, data } = tx.order_items.update.mock.calls[0][0];
        expect(where).toEqual({ id: 500 });
        expect(data.quantity).toBe(3);
        expect(Number(data.total_price)).toBe(60000);
        expect(data.product_name).toBeUndefined();
        expect(tx.orders.update).toHaveBeenCalled();
      });

      it('el recálculo usa el precio de bloque vigente y reaplica el impuesto de la estación', async () => {
        withTariff();
        tx.service_stations.findFirst.mockResolvedValue({
          name: 'Sala 1',
          rental_block_minutes: 30,
          rental_block_price: 20000,
          rental_tax_category_id: 3,
          rental_tax_is_inclusive: false,
        });
        shippingTax.taxRowsForCategory.mockResolvedValue([
          { tax_rate_id: 30, name: 'IVA 19%', rate: 0.19, tax_type: 'iva', is_inclusive: false },
        ]);
        // La línea se creó cuando el bloque costaba $15.000.
        tx.order_items.findFirst.mockResolvedValue(rentalLine({ unit_price: 15000, final_unit_price: 15000 }));
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 71400 } : { grand_total: 71400, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_006' }),
        });
        expect(shippingTax.taxRowsForCategory).toHaveBeenCalledWith(tx, { tax_category_id: 3, tax_is_inclusive: false, store_id: 1 });
        const { data } = tx.order_items.update.mock.calls[0][0];
        expect(Number(data.unit_price)).toBe(20000);
        expect(Number(data.total_price)).toBe(60000);
        expect(Number(data.final_unit_price)).toBe(23800);
        expect(data.order_item_taxes).toEqual({
          create: [
            { tax_rate_id: 30, tax_name: 'IVA 19%', tax_rate: 0.19, tax_amount: 11400, tax_type: 'iva', is_compound: false, is_inclusive: false },
          ],
        });
      });

      it('no recalcula la línea si la cuenta ya tiene un pago registrado', async () => {
        withTariff();
        tx.orders.findUnique.mockResolvedValue({ total_paid: 40000, discount_amount: 0 });
        tx.order_items.findFirst.mockResolvedValue(rentalLine({ quantity: 2 }));
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 0 } : { grand_total: 40000, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({ status: 'closed' });
        expect(tx.order_items.update).not.toHaveBeenCalled();
        expect(tx.order_item_taxes.deleteMany).not.toHaveBeenCalled();
      });

      it('no duplica la línea si renombraron la estación después de cobrar', async () => {
        withTariff();
        // La estación cambió de nombre: la línea creada en "Registrar pago" conserva el viejo.
        tx.service_stations.findFirst.mockResolvedValue({ name: 'Sala A', rental_block_minutes: 30, rental_block_price: 20000 });
        const saved = [{ ...rentalLine(), product_name: 'Alquiler Sala 1' }];
        tx.order_items.findFirst.mockImplementation((args: any) => {
          const prefix: string | undefined = args?.where?.product_name?.startsWith;
          return Promise.resolve(saved.find((line) => prefix !== undefined && line.product_name.startsWith(prefix)) ?? null);
        });
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 0 } : { grand_total: 60000, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({ status: 'closed' });
        expect(tx.order_items.create).not.toHaveBeenCalled();
        expect(tx.order_items.update).not.toHaveBeenCalled();
      });

      it('una estación sin tarifa (gratis) no agrega línea', async () => {
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 0 } : { grand_total: 100, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({ status: 'closed' });
        expect(tx.order_items.create).not.toHaveBeenCalled();
      });

      it('una cuenta ya cobrada no recibe la línea de alquiler', async () => {
        withTariff();
        tx.$queryRaw.mockResolvedValue([{ id: 149, state: 'processing' }]);
        tx.orders.findFirst.mockImplementation((args: any) =>
          Promise.resolve(args?.select?.remaining_balance !== undefined ? { remaining_balance: 0 } : { grand_total: 100, tip_amount: 0, currency: 'COP' }),
        );
        await expect(service.transition(21, { action: 'close' } as any)).resolves.toMatchObject({ status: 'closed' });
        expect(tx.order_items.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('rentalBlocksConsumed', () => {
    const opened = new Date('2026-10-30T10:00:00Z');
    const at = (minutes: number) => new Date(opened.getTime() + minutes * 60_000);
    it.each([
      [0, 1],
      [1, 1],
      [30, 1],
      [31, 2],
      [70, 3],
    ])('%i min con bloques de 30 → %i bloques', (minutes, blocks) => {
      expect(rentalBlocksConsumed(opened, at(minutes), 30)).toBe(blocks);
    });
  });

  describe('open — walk-in sin estación', () => {
    let pickStation: jest.Mock;
    beforeEach(() => {
      pickStation = jest.fn();
      (service as any).allocationCoordinator = { pickStation };
      prisma.products = { findFirst: jest.fn().mockResolvedValue({ id: 10, product_type: 'service', state: 'active', service_duration_minutes: 45 }) };
      prisma.service_station_services = { findFirst: jest.fn().mockResolvedValue(null) };
    });

    it('asigna la estación elegible que devuelve el coordinador', async () => {
      pickStation.mockResolvedValue(4);
      prisma.service_stations.findFirst.mockResolvedValue({ id: 4 });
      // Se corta en la validación del servicio para aislar la asignación.
      await expect(service.open({ product_id: 10 } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_001' }),
      });
      expect(pickStation).toHaveBeenCalledWith(prisma, expect.objectContaining({ storeId: 1, productId: 10, providerId: null }));
      const { startAt, endAt } = pickStation.mock.calls[0][1];
      expect(endAt.getTime() - startAt.getTime()).toBe(45 * 60_000);
      expect(prisma.service_stations.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 4 }) }));
      expect(prisma.service_station_services.findFirst).toHaveBeenCalledWith({ where: { store_id: 1, station_id: 4, product_id: 10 } });
    });

    describe('carrera con otra atención por la estación elegida', () => {
      const opened = { id: 50, order_id: 60, station_id: 0, booking_id: null, status: 'open', access_token: 't', access_token_id: 1, access_expires_at: new Date(), email_delivery_status: 'no_email', access_url: null };
      beforeEach(() => {
        prisma.service_stations.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id }));
        prisma.service_station_services.findFirst.mockResolvedValue({ id: 1 });
        jest.spyOn(service as any, 'prepareIntake').mockResolvedValue({ templateId: null, values: [] });
        jest.spyOn(service as any, 'buildAccessUrl').mockResolvedValue(null);
        jest.spyOn(service as any, 'emit').mockImplementation(() => undefined);
      });

      it('si otra atención le gana la estación, toma la siguiente libre', async () => {
        pickStation.mockResolvedValueOnce(4).mockResolvedValueOnce(6);
        prisma.$transaction
          .mockRejectedValueOnce(new VendixHttpException(ErrorCodes.STATION_008))
          .mockResolvedValueOnce({ ...opened, station_id: 6 });

        await expect(service.open({ product_id: 10 } as any)).resolves.toMatchObject({ id: 50, station_id: 6 });
        expect(pickStation).toHaveBeenCalledTimes(2);
        expect(pickStation.mock.calls[0][1]).toMatchObject({ requireIdle: true });
        expect(pickStation.mock.calls[0][1].excludeStationIds).toBeUndefined();
        expect(pickStation.mock.calls[1][1]).toMatchObject({ requireIdle: true, excludeStationIds: [4] });
      });

      it('sin otra estación libre tras la carrera responde que no hay estación elegible', async () => {
        pickStation.mockResolvedValueOnce(4).mockResolvedValueOnce(null);
        prisma.$transaction.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.STATION_008));

        await expect(service.open({ product_id: 10 } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_009' }),
        });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('con estación indicada no reintenta y conserva el conflicto', async () => {
        prisma.$transaction.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.STATION_008));

        await expect(service.open({ station_id: 3, product_id: 10 } as any)).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'STATION_008' }),
        });
        expect(pickStation).not.toHaveBeenCalled();
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    it('sin estación elegible mantiene el error de siempre', async () => {
      pickStation.mockResolvedValue(null);
      await expect(service.open({ product_id: 10 } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_009' }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('con estación indicada no asigna automáticamente', async () => {
      prisma.service_stations.findFirst.mockResolvedValue({ id: 3 });
      await expect(service.open({ station_id: 3, product_id: 10 } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_001' }),
      });
      expect(pickStation).not.toHaveBeenCalled();
    });

    it('sin reserva, estación ni servicio sigue rechazando', async () => {
      await expect(service.open({} as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_009' }),
      });
      expect(pickStation).not.toHaveBeenCalled();
    });
  });
});


describe('ServiceSessionsService — próxima reserva y choques al extender', () => {
  let service: ServiceSessionsService;
  let prisma: any;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, user_id: 9, roles: ['admin'], permissions: [] } as any);
    prisma = {
      service_sessions: { findFirst: jest.fn() },
      service_subjects: { findMany: jest.fn().mockResolvedValue([]) },
      service_allocations: { findMany: jest.fn(), findFirst: jest.fn() },
      service_progress_events: { findMany: jest.fn().mockResolvedValue([]) },
      orders: { findFirst: jest.fn() },
      store_settings: { findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }) },
      $transaction: jest.fn(),
    };
    service = new ServiceSessionsService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findOne', () => {
    const start = new Date('2026-11-05T01:00:00Z');
    const end = new Date('2026-11-05T03:00:00Z');
    beforeEach(() => {
      prisma.service_sessions.findFirst.mockResolvedValue({ id: 21, store_id: 1, station_id: 9, order_id: null, booking_id: null, status: 'open', opened_at: start });
      prisma.service_allocations.findMany.mockResolvedValue([{ id: 5, station_id: 9, session_id: 21, state: 'in_service', start_at: start, end_at: end, created_at: start }]);
      jest.spyOn(service as any, 'buildIntakeSummary').mockResolvedValue(null);
    });

    it('expone opened_at, planned_end_at y la próxima reserva de la misma estación (sin la propia)', async () => {
      prisma.service_allocations.findFirst.mockResolvedValue({
        id: 6,
        booking_id: 44,
        start_at: new Date('2026-11-05T07:00:00Z'),
        booking: { customer: { first_name: 'Ana', last_name: 'Pérez' } },
      });
      const result: any = await service.findOne(21);
      expect(result.opened_at).toEqual(start);
      expect(result.planned_end_at).toBe(end.toISOString());
      expect(result.next_reservation).toEqual({ start_at: '2026-11-05T07:00:00.000Z', booking_id: 44, customer_name: 'Ana Pérez' });
      expect(prisma.service_allocations.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          store_id: 1,
          station_id: 9,
          id: { not: 5 },
          state: { in: ['held', 'payment_pending', 'confirmed', 'in_service'] },
          start_at: { gt: start },
        }),
        orderBy: { start_at: 'asc' },
      }));
    });

    it('sin otra reserva devuelve next_reservation null', async () => {
      prisma.service_allocations.findFirst.mockResolvedValue(null);
      const result: any = await service.findOne(21);
      expect(result.next_reservation).toBeNull();
    });
  });

  describe('extend — mensaje de choque', () => {
    it('nombra la hora local del inicio conflictivo en STATION_002', async () => {
      const now = Date.now();
      const tx: any = {
        service_sessions: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        service_allocations: {
          findFirst: jest.fn()
            .mockResolvedValueOnce({ id: 5, station_id: 9, provider_id: null, start_at: new Date(now - 3_600_000), end_at: new Date(now + 3_600_000) })
            .mockResolvedValueOnce({ id: 6, start_at: new Date('2026-11-05T07:00:00Z') }),
          updateMany: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 21, status: 'open' } as any);
      await expect(service.extend(21, new Date(now + 5 * 3_600_000))).rejects.toMatchObject({
        errorCode: 'STATION_002',
        response: expect.objectContaining({ message: expect.stringContaining('02:00') }),
      });
      expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('ServiceSessionsService — anticipo consumible de la estación', () => {
  let service: ServiceSessionsService;
  let prisma: any;
  let deposits: Record<string, jest.Mock>;
  let orderFlow: { settlePaidServiceSessionOrder: jest.Mock };
  let events: { emit: jest.Mock };
  let shippingTax: { taxRowsForCategory: jest.Mock };

  const RULES = { id: 3, deposit_policy: 'required', deposit_amount: 400000, deposit_exhausted_policy: 'recharge', leftover_policy: 'minimum_spend' };
  const balance = (received: number, applied = 0) => ({ received, applied, refunded: 0, released: 0, balance: received - applied });

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, user_id: 9, roles: ['admin'], permissions: [] } as any);
    deposits = {
      balanceOf: jest.fn().mockResolvedValue(balance(0)),
      balanceOfInTx: jest.fn().mockResolvedValue(balance(0)),
      receiveInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 1 }, event: { deposit_id: 1 } }),
      linkBookingToSessionInTx: jest.fn().mockResolvedValue(0),
      applyToOrderInTx: jest.fn(),
      refundInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 3 }, amount: 0, event: { deposit_id: 3 } }),
      releaseInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 4 }, amount: 0 }),
      announceReceived: jest.fn(),
      announceRefunded: jest.fn(),
    };
    orderFlow = { settlePaidServiceSessionOrder: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn() };
    shippingTax = { taxRowsForCategory: jest.fn().mockResolvedValue([]) };
    prisma = { $transaction: jest.fn(), service_sessions: { findFirst: jest.fn() }, orders: { findFirst: jest.fn() } };
    service = new ServiceSessionsService(
      prisma, { push: jest.fn() } as any, { getStoreCurrency: jest.fn().mockResolvedValue('COP') } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, shippingTax as any, deposits as any, orderFlow as any, events as any,
    );
    jest.spyOn(service as any, 'emit').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** In-memory order of a station session: the lines, the budgets and the paid totals the helpers read. */
  const buildOrderTx = (lines: Array<{ name: string; gross: number; kind?: string | null }>, extra: { budgets?: any[]; customer_id?: number | null; state?: string } = {}) => {
    const items: any[] = lines.map((line, i) => ({
      id: i + 1, product_name: line.name, product_id: 5, quantity: 1, total_price: line.gross, final_unit_price: line.gross,
      tax_amount_item: 0, weight: null, price_unit_quantity: null, service_line_kind: line.kind ?? null, cancelled_at: null, order_item_taxes: [],
    }));
    const order: any = { customer_id: extra.customer_id === undefined ? 5 : extra.customer_id, currency: 'COP', total_paid: 0, grand_total: 0, tip_amount: 0 };
    order.grand_total = lines.reduce((sum, line) => sum + line.gross, 0);
    const budgets: any[] = extra.budgets ?? [];
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 200, state: extra.state ?? 'draft' }]),
      orders: {
        findFirst: jest.fn(() => Promise.resolve({ ...order })),
        findUnique: jest.fn(() => Promise.resolve({ total_paid: order.total_paid, discount_amount: 0 })),
        update: jest.fn(({ data }: any) => { Object.assign(order, data); return Promise.resolve({ store_id: 1, service_session_id: 30 }); }),
      },
      order_items: {
        findMany: jest.fn(() => Promise.resolve(items.filter((i) => !i.cancelled_at))),
        findFirst: jest.fn(({ where }: any) => Promise.resolve(where.service_line_kind ? items.find((i) => i.service_line_kind === where.service_line_kind && !i.cancelled_at) ?? null : null)),
        create: jest.fn(({ data }: any) => { const row = { id: items.length + 1, weight: null, price_unit_quantity: null, cancelled_at: null, order_item_taxes: [], ...data }; items.push(row); return Promise.resolve(row); }),
        update: jest.fn(),
        delete: jest.fn(({ where }: any) => { items.splice(items.findIndex((i) => i.id === where.id), 1); return Promise.resolve({}); }),
      },
      order_item_taxes: { deleteMany: jest.fn() },
      service_stations: { findFirst: jest.fn().mockResolvedValue({ name: 'Cava', rental_block_minutes: null, rental_block_price: null, reservation_fee_tax_category_id: null }) },
      service_sessions: { findFirst: jest.fn().mockResolvedValue({ settled_at: null, status: 'open', deposit_policy: 'required', deposit_exhausted_policy: 'recharge' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      service_budgets: {
        findFirst: jest.fn(() => Promise.resolve(budgets.length ? budgets[budgets.length - 1] : null)),
        create: jest.fn(({ data }: any) => { budgets.push(data); return Promise.resolve(data); }),
      },
      service_progress_events: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    return { tx, items, order, budgets };
  };

  describe('open — anticipo (S4/S5)', () => {
    let tx: any;
    let sessionCreate: jest.Mock;
    let orderCreate: jest.Mock;
    const stub = (station: Record<string, unknown>) => {
      prisma.service_stations = { findFirst: jest.fn().mockResolvedValue(station) };
      prisma.service_station_services = { findFirst: jest.fn().mockResolvedValue({ id: 1 }) };
      prisma.products = { findFirst: jest.fn().mockResolvedValue({ id: 10, name: 'Cava', base_price: 0, product_type: 'service', state: 'active', service_duration_minutes: 60 }) };
      prisma.users = { findFirst: jest.fn().mockResolvedValue({ id: 5 }) };
      prisma.bookings = { findFirst: jest.fn() };
      prisma.service_allocations = { findFirst: jest.fn() };
      (service as any).allocationCoordinator = { allocateSession: jest.fn(), transferBookingToSession: jest.fn() };
      (service as any).sessionAccess = { createAccessToken: jest.fn().mockResolvedValue({ token: 't', token_id: 1, expires_at: new Date() }) };
      jest.spyOn(service as any, 'prepareIntake').mockResolvedValue(null);
      jest.spyOn(service as any, 'persistIntake').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'buildAccessUrl').mockResolvedValue(null);
      const built = buildOrderTx([]);
      tx = built.tx;
      sessionCreate = jest.fn().mockResolvedValue({ id: 30 });
      orderCreate = jest.fn().mockResolvedValue({ id: 200 });
      tx.service_sessions = { create: sessionCreate, updateMany: jest.fn() };
      tx.orders.create = orderCreate;
      tx.order_items.updateMany = jest.fn();
      tx.product_tax_assignments = { findMany: jest.fn().mockResolvedValue([]) };
      tx.bookings = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      return built;
    };
    const walkIn = { station_id: 3, product_id: 10, customer_id: 5 };

    it('con política required y sin anticipo ni saldo de la reserva no abre y nombra el mínimo', async () => {
      stub(RULES);
      await expect(service.open(walkIn as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_008', message: expect.stringContaining('$400.000') }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('con política required exige un cliente identificado', async () => {
      stub(RULES);
      await expect(service.open({ station_id: 3, product_id: 10, deposit: { amount: 400000, method: 'cash', request_id: 'req-open-1' } } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_002' }),
      });
    });

    it('un anticipo menor al mínimo tampoco abre', async () => {
      stub(RULES);
      await expect(service.open({ ...walkIn, deposit: { amount: 399999, method: 'cash', request_id: 'req-open-1' } } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_008' }),
      });
    });

    it('rechaza un anticipo en una estación que no lo maneja', async () => {
      stub({ id: 3, deposit_policy: 'none', deposit_amount: null, deposit_exhausted_policy: 'overflow', leftover_policy: 'refund_or_credit' });
      await expect(service.open({ ...walkIn, deposit: { amount: 10000, method: 'cash', request_id: 'req-open-1' } } as any)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_011' }),
      });
    });

    it('con el anticipo recibido abre: copia las reglas, recibe en la misma transacción y topa la cuenta (recarga)', async () => {
      const { budgets } = stub(RULES);
      deposits.balanceOfInTx.mockResolvedValue(balance(400000));
      const input = { ...walkIn, deposit: { amount: 400000, method: 'cash', request_id: 'req-open-1' } };
      await expect(service.open(input as any)).resolves.toMatchObject({ id: 30, order_id: 200, status: 'open' });
      expect(sessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ deposit_policy: 'required', deposit_required_amount: 400000, deposit_exhausted_policy: 'recharge', leftover_policy: 'minimum_spend' }),
      });
      expect(deposits.receiveInTx).toHaveBeenCalledWith(tx, expect.objectContaining({
        store_id: 1, customer_id: 5, session_id: 30, booking_id: null, amount: 400000, method: 'cash', request_id: 'req-open-1', user_id: 9,
      }));
      const cap = budgets[budgets.length - 1];
      expect(cap).toMatchObject({ session_id: 30, is_system: false, currency: 'COP' });
      expect(Number(cap.amount)).toBe(400000);
      expect(deposits.announceReceived).toHaveBeenCalledWith({ deposit_id: 1 });
    });

    it('en modo desborde (overflow) recibe el anticipo pero no escribe tope', async () => {
      const { budgets } = stub({ ...RULES, deposit_exhausted_policy: 'overflow' });
      deposits.balanceOfInTx.mockResolvedValue(balance(400000));
      await service.open({ ...walkIn, deposit: { amount: 400000, method: 'cash', request_id: 'req-open-1' } } as any);
      expect(deposits.receiveInTx).toHaveBeenCalled();
      expect(budgets.every((b) => b.is_system === true)).toBe(true);
    });

    it('la llegada de una reserva con el anticipo ya pagado abre sin recibir otro, lo vincula y la orden va por POS', async () => {
      stub(RULES);
      prisma.bookings.findFirst.mockResolvedValue({ id: 7, status: 'confirmed', customer_id: 5, product_id: 10, channel: 'ecommerce', order_id: null, checked_in_at: null, customer: { email: null } });
      prisma.service_allocations.findFirst.mockResolvedValue({ id: 3, state: 'confirmed', station_id: 3, provider_id: null, end_at: new Date(Date.now() + 3_600_000) });
      prisma.service_sessions.findFirst.mockResolvedValue(null);
      deposits.balanceOf.mockResolvedValue(balance(400000));
      deposits.balanceOfInTx.mockResolvedValue(balance(400000));
      await expect(service.open({ booking_id: 7 } as any)).resolves.toMatchObject({ id: 30, booking_id: 7 });
      expect(deposits.receiveInTx).not.toHaveBeenCalled();
      expect(deposits.linkBookingToSessionInTx).toHaveBeenCalledWith(tx, 7, 30, 1);
      expect(orderCreate.mock.calls[0][0].data).toMatchObject({ channel: 'pos' });
    });

    it('sin anticipo en la estación (atención de siempre) abre sin tocar el libro de anticipos', async () => {
      stub({ id: 3 });
      await expect(service.open({ station_id: 3, product_id: 10 } as any)).resolves.toMatchObject({ id: 30, order_id: 200 });
      expect(sessionCreate.mock.calls[0][0].data).not.toHaveProperty('deposit_policy');
      expect(deposits.balanceOf).not.toHaveBeenCalled();
      expect(deposits.balanceOfInTx).not.toHaveBeenCalled();
      expect(deposits.receiveInTx).not.toHaveBeenCalled();
      expect(deposits.announceReceived).toHaveBeenCalledWith(null);
      expect(orderCreate.mock.calls[0][0].data).toMatchObject({ channel: 'pos' });
    });
  });

  describe('addDeposit — recarga', () => {
    const sessionRow = { id: 30, status: 'open', order_id: 200, booking_id: null, deposit_policy: 'required', deposit_exhausted_policy: 'recharge', settled_at: null };
    const dto = { amount: 100000, method: 'cash', request_id: 'req-top-1' };

    beforeEach(() => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow);
      jest.spyOn(service, 'findOne').mockResolvedValue({ deposit: { balance: 500000 } } as any);
    });

    it('recibe el anticipo y sube el tope al total recibido en la misma transacción', async () => {
      const { tx, budgets } = buildOrderTx([], { budgets: [{ amount: 400000, currency: 'COP', version: 2, is_system: false }] });
      deposits.balanceOfInTx.mockResolvedValue(balance(500000));
      await expect(service.addDeposit(30, dto as any)).resolves.toEqual({ created: true, deposit: { balance: 500000 } });
      expect(deposits.receiveInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ store_id: 1, customer_id: 5, session_id: 30, amount: 100000, request_id: 'req-top-1' }));
      expect(budgets[budgets.length - 1]).toMatchObject({ version: 3, is_system: false });
      expect(Number(budgets[budgets.length - 1].amount)).toBe(500000);
      expect(deposits.announceReceived).toHaveBeenCalledWith({ deposit_id: 1 });
    });

    it('en desborde recibe sin escribir tope', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ ...sessionRow, deposit_exhausted_policy: 'overflow' });
      const { budgets } = buildOrderTx([]);
      await service.addDeposit(30, dto as any);
      expect(deposits.receiveInTx).toHaveBeenCalled();
      expect(budgets).toHaveLength(0);
    });

    it('una atención sin anticipo (legacy o none) lo rechaza', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ ...sessionRow, deposit_policy: null });
      await expect(service.addDeposit(30, dto as any)).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_011' }) });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('una atención liquidada no recibe más anticipo', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ ...sessionRow, settled_at: new Date() });
      await expect(service.addDeposit(30, dto as any)).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_009' }) });
    });

    it('sin cliente identificado en la cuenta no recibe', async () => {
      buildOrderTx([], { customer_id: null });
      await expect(service.addDeposit(30, dto as any)).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_002' }) });
      expect(deposits.receiveInTx).not.toHaveBeenCalled();
    });
  });

  describe('addItems — tope del anticipo (S8/S9)', () => {
    const sessionRow = { id: 30, status: 'open', order_id: 200, booking_id: null, settled_at: null };
    const live = (over: Record<string, unknown> = {}) => ({ settled_at: null, status: 'open', deposit_policy: 'required', deposit_exhausted_policy: 'recharge', ...over });

    beforeEach(() => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow);
      jest.spyOn(service as any, 'addItemTx').mockResolvedValue({ id: 99 });
    });

    it('en recarga rechaza el consumo que pasa el anticipo y nombra lo que falta', async () => {
      const { tx } = buildOrderTx([{ name: 'Cerveza', gross: 1000000 }]);
      tx.service_sessions.findFirst.mockResolvedValue(live());
      deposits.balanceOfInTx.mockResolvedValue(balance(400000));
      await expect(service.addItem(30, { product_id: 5 } as any)).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'SERVICE_DEPOSIT_007',
          message: expect.stringContaining('$600.000'),
        }),
      });
    });

    it('en recarga acepta el consumo que cabe en el anticipo', async () => {
      const { tx } = buildOrderTx([{ name: 'Cerveza', gross: 400000 }]);
      tx.service_sessions.findFirst.mockResolvedValue(live());
      deposits.balanceOfInTx.mockResolvedValue(balance(400000));
      await expect(service.addItem(30, { product_id: 5 } as any)).resolves.toMatchObject({ order_id: 200, grand_total: 400000 });
    });

    it('en desborde no hay tope: el consumo pasa del anticipo', async () => {
      const { tx } = buildOrderTx([{ name: 'Cerveza', gross: 1000000 }]);
      tx.service_sessions.findFirst.mockResolvedValue(live({ deposit_exhausted_policy: 'overflow' }));
      await expect(service.addItem(30, { product_id: 5 } as any)).resolves.toMatchObject({ grand_total: 1000000 });
      expect(deposits.balanceOfInTx).not.toHaveBeenCalled();
    });

    it('liquidada: no acepta consumos nuevos', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ ...sessionRow, settled_at: new Date() });
      await expect(service.addItem(30, { product_id: 5 } as any)).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_009' }) });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('una atención sin anticipo carga como siempre, sin consultar el libro', async () => {
      const { tx } = buildOrderTx([{ name: 'Cerveza', gross: 1000000 }]);
      tx.service_sessions.findFirst.mockResolvedValue({ settled_at: null, status: 'open', deposit_policy: null, deposit_exhausted_policy: null });
      await expect(service.addItem(30, { product_id: 5 } as any)).resolves.toMatchObject({ grand_total: 1000000 });
      expect(deposits.balanceOfInTx).not.toHaveBeenCalled();
    });
  });

  describe('removeItem — atención liquidada', () => {
    it('rechaza quitar un ítem si la liquidación se confirmó entre la lectura y el bloqueo', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ id: 30, store_id: 1, status: 'open', order_id: 200, settled_at: null });
      const { tx } = buildOrderTx([{ name: 'Cerveza', gross: 100000 }]);
      tx.service_sessions.findFirst.mockResolvedValue({ settled_at: new Date() });
      await expect(service.removeItem(30, 1)).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_009' }) });
      expect(tx.order_items.delete).not.toHaveBeenCalled();
    });

    it('sin liquidar quita el ítem como siempre', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ id: 30, store_id: 1, status: 'open', order_id: 200, settled_at: null });
      const { tx, items } = buildOrderTx([{ name: 'Cerveza', gross: 100000 }]);
      tx.service_sessions.findFirst.mockResolvedValue({ settled_at: null });
      tx.order_items.findFirst.mockResolvedValue({ ...items[0], products: null, product_variants: null });
      jest.spyOn(service as any, 'recalcOrderTotals').mockResolvedValue({ grand_total: 0 });
      jest.spyOn(service as any, 'writeProgress').mockResolvedValue(undefined);
      await expect(service.removeItem(30, 1)).resolves.toMatchObject({ deleted: true, itemId: 1 });
      expect(tx.order_items.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe('settle / settlement (S12, S14)', () => {
    const sessionRow = (over: Record<string, unknown> = {}) => ({
      id: 30, status: 'open', order_id: 200, booking_id: null, station_id: 3, opened_at: new Date(Date.now() - 3_600_000),
      deposit_policy: 'required', deposit_exhausted_policy: 'overflow', leftover_policy: 'minimum_spend', settled_at: null, ...over,
    });
    const received = { payment_id: 1, amount: 0 } as any;

    /** The deposit ledger follows the in-memory order: apply = min(balance, remaining), as `applyToOrderInTx` does. */
    const wireLedger = (order: any, receivedAmount: number) => {
      const state = { ...balance(receivedAmount) };
      deposits.balanceOfInTx.mockImplementation(() => Promise.resolve({ ...state }));
      deposits.applyToOrderInTx.mockImplementation(async () => {
        const amount = Math.min(state.balance, Number(order.grand_total) - Number(order.total_paid));
        order.total_paid += amount;
        state.applied += amount;
        state.balance -= amount;
        return { applied: amount > 0, amount, payment_id: 1, deposit_id: 2, payment_received: { ...received, amount } };
      });
      return state;
    };

    beforeEach(() => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow());
      jest.spyOn(service, 'findOne').mockResolvedValue({ deposit: { balance: 0 } } as any);
      jest.spyOn(service as any, 'emitDepositPaymentReceived').mockResolvedValue(undefined);
    });

    const dto = { request_id: 'settle-1' } as any;

    it('consumo de 250.000 con anticipo de 400.000 (consumo mínimo): suma "Gastos de reserva" por 150.000 y la factura queda en 400.000', async () => {
      const { tx, items, order } = buildOrderTx([{ name: 'Cerveza', gross: 250000 }]);
      wireLedger(order, 400000);
      const result: any = await service.settle(30, dto);
      const fee = items.find((i) => i.service_line_kind === 'reservation_fee');
      expect(fee).toMatchObject({ product_id: null, product_name: 'Gastos de reserva', item_type: 'service', quantity: 1, service_session_id: 30 });
      expect(Number(fee.final_unit_price)).toBe(150000);
      expect(items.reduce((sum, i) => sum + Number(i.final_unit_price) * i.quantity, 0)).toBe(400000);
      expect(order.grand_total).toBe(400000);
      expect(deposits.applyToOrderInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ store_id: 1, order_id: 200, session_id: 30, user_id: 9 }));
      expect(result).toMatchObject({ already_settled: false, invoice_total: 400000, fee: 150000, applied: 400000, remaining_to_collect: 0, leftover: { amount: 0, action: null } });
      expect(tx.service_sessions.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 30, store_id: 1, settled_at: null }, data: expect.objectContaining({ settled_at: expect.any(Date) }) }));
      expect(deposits.refundInTx).not.toHaveBeenCalled();
      expect(deposits.releaseInTx).not.toHaveBeenCalled();
      // S14: the account reaches the invoicing seam with the consumption line plus the fee line.
      expect(orderFlow.settlePaidServiceSessionOrder).toHaveBeenCalledWith(200, 9);
      expect((service as any).emitDepositPaymentReceived).toHaveBeenCalledWith(200, expect.objectContaining({ amount: 400000 }), 'COP', 9);
    });

    it('la línea de reserva lleva el impuesto de la categoría de la estación, siempre incluido', async () => {
      const { tx, order } = buildOrderTx([{ name: 'Cerveza', gross: 250000 }]);
      tx.service_stations.findFirst.mockResolvedValue({ name: 'Cava', rental_block_minutes: null, rental_block_price: null, reservation_fee_tax_category_id: 15 });
      wireLedger(order, 400000);
      await service.settle(30, dto);
      expect(shippingTax.taxRowsForCategory).toHaveBeenCalledWith(tx, { tax_category_id: 15, tax_is_inclusive: true, store_id: 1 });
    });

    it('consumo de 1.000.000 con anticipo de 400.000: aplica 400.000, quedan 600.000 por cobrar y no pasa por la factura', async () => {
      const { items, order } = buildOrderTx([{ name: 'Cerveza', gross: 1000000 }]);
      wireLedger(order, 400000);
      const result: any = await service.settle(30, dto);
      expect(items.some((i) => i.service_line_kind === 'reservation_fee')).toBe(false);
      expect(result).toMatchObject({ invoice_total: 1000000, fee: 0, applied: 400000, remaining_to_collect: 600000 });
      expect(orderFlow.settlePaidServiceSessionOrder).not.toHaveBeenCalled();
    });

    it('refund_or_credit: el sobrante se acredita por defecto (released) sin crear línea', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow({ leftover_policy: 'refund_or_credit' }));
      const { tx, items, order } = buildOrderTx([{ name: 'Cerveza', gross: 250000 }]);
      wireLedger(order, 400000);
      const result: any = await service.settle(30, dto);
      expect(items.some((i) => i.service_line_kind === 'reservation_fee')).toBe(false);
      expect(deposits.applyToOrderInTx).toHaveBeenCalled();
      expect(deposits.releaseInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ customer_id: 5, session_id: 30, request_id: 'settle-1:release' }));
      expect(deposits.refundInTx).not.toHaveBeenCalled();
      expect(result).toMatchObject({ invoice_total: 250000, applied: 250000, leftover: { amount: 150000, action: 'credit' } });
      expect(orderFlow.settlePaidServiceSessionOrder).toHaveBeenCalledWith(200, 9);
    });

    it('refund_or_credit con la opción devolver: reembolsa el sobrante por el método elegido y avisa a contabilidad', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow({ leftover_policy: 'refund_or_credit' }));
      const { tx, order } = buildOrderTx([{ name: 'Cerveza', gross: 250000 }]);
      wireLedger(order, 400000);
      const result: any = await service.settle(30, { ...dto, leftover_action: 'refund', refund_method: 'bank_transfer', store_payment_method_id: 4 });
      expect(deposits.refundInTx).toHaveBeenCalledWith(tx, expect.objectContaining({
        customer_id: 5, session_id: 30, method: 'bank_transfer', store_payment_method_id: 4, request_id: 'settle-1:refund',
      }));
      expect(deposits.releaseInTx).not.toHaveBeenCalled();
      expect(deposits.announceRefunded).toHaveBeenCalledWith({ deposit_id: 3 });
      expect(result.leftover).toEqual({ amount: 150000, action: 'refund' });
    });

    it('en recarga sube el tope existente al total final (A10) y nunca lo baja', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow({ deposit_exhausted_policy: 'recharge' }));
      const { budgets, order } = buildOrderTx([{ name: 'Cerveza', gross: 450000 }], { budgets: [{ amount: 400000, currency: 'COP', version: 2, is_system: false }] });
      wireLedger(order, 400000);
      await service.settle(30, dto);
      const last = budgets[budgets.length - 1];
      expect(last).toMatchObject({ version: 3, is_system: false });
      expect(Number(last.amount)).toBe(450000);
    });

    it('en recarga sin tope previo no crea uno al liquidar', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow({ deposit_exhausted_policy: 'recharge' }));
      const { budgets, order } = buildOrderTx([{ name: 'Cerveza', gross: 250000 }]);
      wireLedger(order, 400000);
      await service.settle(30, dto);
      expect(budgets.every((b) => b.is_system === true)).toBe(true);
    });

    it('es idempotente: con settled_at no escribe ni mueve dinero', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow({ settled_at: new Date('2026-11-04T12:00:00Z') }));
      prisma.orders.findFirst.mockResolvedValue({ grand_total: 400000, total_paid: 400000 });
      await expect(service.settle(30, dto)).resolves.toMatchObject({ already_settled: true, invoice_total: 400000, remaining_to_collect: 0 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(deposits.applyToOrderInTx).not.toHaveBeenCalled();
      expect(orderFlow.settlePaidServiceSessionOrder).not.toHaveBeenCalled();
    });

    it('la vista previa muestra los números del cierre y no escribe nada', async () => {
      const { tx, items, order } = buildOrderTx([{ name: 'Cerveza', gross: 250000 }]);
      wireLedger(order, 400000);
      await expect(service.getSettlement(30)).resolves.toMatchObject({
        already_settled: false, consumption: 250000, fee: 150000, invoice_total: 400000, apply: 400000, to_collect: 0, leftover: 0, leftover_actions: [],
      });
      expect(deposits.applyToOrderInTx).not.toHaveBeenCalled();
      expect(tx.service_sessions.updateMany).not.toHaveBeenCalled();
      expect(items.length).toBe(2); // the fee line lives only inside the rolled-back transaction
    });

    it('una atención sin anticipo no se liquida', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue(sessionRow({ deposit_policy: null }));
      await expect(service.settle(30, dto)).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'SERVICE_DEPOSIT_011' }) });
    });
  });

  describe('findOne — bloque deposit', () => {
    const open = new Date('2026-11-05T01:00:00Z');
    const base = { id: 30, store_id: 1, station_id: 9, order_id: 200, booking_id: null, status: 'open', opened_at: open };
    const order = { id: 200, grand_total: 250000, tip_amount: 0, customer_id: 5, users: null, order_items: [{ service_line_kind: null, cancelled_at: null, final_unit_price: 250000, quantity: 1 }] };

    beforeEach(() => {
      Object.assign(prisma, {
        service_subjects: { findMany: jest.fn().mockResolvedValue([]) },
        service_allocations: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
        service_progress_events: { findMany: jest.fn().mockResolvedValue([]) },
      });
      prisma.orders.findFirst.mockResolvedValue(order);
      jest.spyOn(service as any, 'buildIntakeSummary').mockResolvedValue(null);
    });

    it('expone requerido, recibido, aplicado, saldo y lo que queda por consumir (sin contar la línea de reserva)', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ ...base, deposit_policy: 'required', deposit_required_amount: 400000, deposit_exhausted_policy: 'recharge', leftover_policy: 'minimum_spend', settled_at: null });
      deposits.balanceOf.mockResolvedValue(balance(400000));
      const found: any = await service.findOne(30);
      expect(deposits.balanceOf).toHaveBeenCalledWith({ sessionId: 30, bookingId: null });
      expect(found.deposit).toEqual({
        required: 400000, received: 400000, applied: 0, balance: 400000, remaining_for_consumption: 150000,
        policy: 'required', exhausted_policy: 'recharge', leftover_policy: 'minimum_spend', settled_at: null,
      });
    });

    it('una atención anterior al anticipo (legacy) devuelve deposit null y no consulta el libro', async () => {
      prisma.service_sessions.findFirst.mockResolvedValue({ ...base });
      const found: any = await service.findOne(30);
      expect(found.deposit).toBeNull();
      expect(deposits.balanceOf).not.toHaveBeenCalled();
    });
  });
});
