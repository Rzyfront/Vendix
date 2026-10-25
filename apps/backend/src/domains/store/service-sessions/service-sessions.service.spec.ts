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
  let templates: { getLinkedTemplateForProduct: jest.Mock; getActiveTemplateById: jest.Mock };
  let prisma: any;
  let notifications: { push: jest.Mock };
  let stockLevelManager: { reserveStock: jest.Mock; getDefaultLocationForProduct: jest.Mock; releaseReservationQuantity: jest.Mock; releaseReservationsByReference: jest.Mock };
  let stockValidator: { resolveInventoryPolicy: jest.Mock };
  let allocator: { allocateForLine: jest.Mock; absorbShortfall: jest.Mock };

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

    it('reserva por StockLevelManager en la ubicación vendible, con claim estricto', async () => {
      const tx = buildTx({});
      await add(tx, {});
      expect(allocator.allocateForLine).toHaveBeenCalledWith(1, 5, undefined, 1, [], tx);
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
        orders: { findFirst: jest.fn().mockResolvedValue({ grand_total: 119000, tip_amount: 0, currency: 'COP' }) },
        service_budgets: { findFirst: jest.fn().mockResolvedValue(budget), create: jest.fn() },
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
});
