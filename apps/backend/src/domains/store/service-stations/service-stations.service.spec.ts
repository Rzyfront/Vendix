import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ServiceStationsService } from './service-stations.service';

describe('ServiceStationsService.getPublicUrl', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let prisma: Record<string, any>;

  beforeEach(() => {
    prisma = {
      service_stations: {
        findFirst: jest.fn().mockResolvedValue({ id: 2, public_id: '11111111-2222-3333-4444-555555555555' }),
      },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
      domain_settings: { findFirst: jest.fn() },
    };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, {} as any);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContextService.runIsolated(context, fn);
  }

  it('usa el dominio ecommerce principal activo sin buscar más', async () => {
    prisma.domain_settings.findFirst.mockResolvedValue({ hostname: 'shop.vendix.com' });
    const url = await run(() => service.getPublicUrl(2));
    expect(url).toBe('https://shop.vendix.com/estacion/11111111-2222-3333-4444-555555555555');
    expect(prisma.domain_settings.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.domain_settings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: 10, app_type: 'STORE_ECOMMERCE', status: 'active' },
      }),
    );
  });

  it('acepta un ecommerce activo aunque no sea principal (no exige is_primary)', async () => {
    prisma.domain_settings.findFirst.mockResolvedValue({ hostname: 'all-in-one-shop.vendix.com' });
    const url = await run(() => service.getPublicUrl(2));
    expect(url).toContain('https://all-in-one-shop.vendix.com/estacion/');
  });

  it('cae al dominio landing activo cuando no hay ecommerce (S12)', async () => {
    prisma.domain_settings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ hostname: 'tienda.vendix.com' });
    const url = await run(() => service.getPublicUrl(2));
    expect(url).toBe('https://tienda.vendix.com/estacion/11111111-2222-3333-4444-555555555555');
    expect(prisma.domain_settings.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.domain_settings.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { store_id: 10, app_type: 'STORE_LANDING', status: 'active' },
      }),
    );
  });

  it('nunca resuelve un host que no sirve /estacion: sin ecommerce ni landing lanza STATION_014 (S12)', async () => {
    // A primary admin domain must not be used: the admin app has no /estacion route.
    prisma.domain_settings.findFirst.mockImplementation(async (args: any) =>
      args?.where?.app_type ? null : { hostname: 'admin.tienda.vendix.com' },
    );
    await expect(run(() => service.getPublicUrl(2))).rejects.toMatchObject({ errorCode: 'STATION_014' });
    for (const [args] of prisma.domain_settings.findFirst.mock.calls) {
      expect(['STORE_ECOMMERCE', 'STORE_LANDING']).toContain(args.where.app_type);
    }
  });

  it('lanza STATION_014 guiando a configuración cuando no hay dominio activo', async () => {
    prisma.domain_settings.findFirst.mockResolvedValue(null);
    await expect(run(() => service.getPublicUrl(2))).rejects.toMatchObject({ errorCode: 'STATION_014' });
  });
});

describe('ServiceStationsService.destroy', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let prisma: Record<string, any>;
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      service_allocations: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      booking_reschedule_requests: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service_station_exceptions: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service_station_schedules: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service_station_services: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service_station_providers: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service_station_rate_windows: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      booking_series: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      service_stations: { delete: jest.fn().mockResolvedValue({ id: 2 }) },
    };
    prisma = {
      service_stations: {
        findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'Bahía 1' }),
      },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
      service_sessions: { count: jest.fn().mockResolvedValue(0) },
      service_allocations: { count: jest.fn().mockResolvedValue(0) },
      booking_reschedule_requests: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, {} as any);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContextService.runIsolated(context, fn);
  }

  it('bloquea cuando la estación tiene atenciones registradas', async () => {
    prisma.service_sessions.count.mockResolvedValue(3);
    await expect(run(() => service.destroy(2))).rejects.toThrow('tiene 3 atención(es) registrada(s)');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bloquea cuando hay reservas o turnos activos', async () => {
    prisma.service_allocations.count.mockResolvedValue(1);
    await expect(run(() => service.destroy(2))).rejects.toThrow('reservas o turnos activos');
    expect(prisma.service_allocations.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ state: { in: ['held', 'confirmed', 'in_service'] } }) }),
    );
  });

  it('bloquea cuando hay reprogramaciones pendientes', async () => {
    prisma.booking_reschedule_requests.count.mockResolvedValue(2);
    await expect(run(() => service.destroy(2))).rejects.toThrow('reprogramación pendientes');
  });

  it('limpia config y borra la estación cuando no hay historial operativo', async () => {
    await run(() => service.destroy(2));
    expect(tx.service_stations.delete).toHaveBeenCalledWith({
      where: { store_id_id: { store_id: 10, id: 2 } },
    });
    expect(tx.service_station_services.deleteMany).toHaveBeenCalled();
    expect(tx.booking_reschedule_requests.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { requested_station_id: null } }),
    );
  });

  it('borra las ventanas de tarifa y suelta las series antes de borrar la estación (FKs RESTRICT)', async () => {
    await run(() => service.destroy(2));
    expect(tx.service_station_rate_windows.deleteMany).toHaveBeenCalledWith({
      where: { store_id: 10, station_id: 2 },
    });
    expect(tx.booking_series.updateMany).toHaveBeenCalledWith({
      where: { store_id: 10, station_id: 2 },
      data: { station_id: null },
    });
    const deleteOrder = tx.service_stations.delete.mock.invocationCallOrder[0];
    expect(tx.service_station_rate_windows.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(deleteOrder);
    expect(tx.booking_series.updateMany.mock.invocationCallOrder[0]).toBeLessThan(deleteOrder);
  });
});

describe('ServiceStationsService — impuesto del alquiler', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let prisma: Record<string, any>;
  let shippingTax: { assertCategoryAssignable: jest.Mock };

  beforeEach(() => {
    prisma = {
      service_stations: {
        findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'Cancha 1' }),
        create: jest.fn().mockResolvedValue({ id: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      data_collection_templates: { findFirst: jest.fn().mockResolvedValue({ id: 5, station_type: 'general' }) },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    shippingTax = { assertCategoryAssignable: jest.fn().mockResolvedValue(undefined) };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, shippingTax as any);
  });

  const run = <T>(fn: () => Promise<T>): Promise<T> => RequestContextService.runIsolated(context, fn);

  it('al crear valida la categoría con el contexto del alquiler y la guarda con su modo', async () => {
    await run(() => service.create({ name: 'Cancha 1', intake_template_id: 5, rental_tax_category_id: 3, rental_tax_is_inclusive: false }));
    expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(3, 'station_rental');
    expect(prisma.service_stations.create.mock.calls[0][0].data).toMatchObject({ rental_tax_category_id: 3, rental_tax_is_inclusive: false });
  });

  it('al crear sin impuesto guarda null y modo incluido (comportamiento actual)', async () => {
    await run(() => service.create({ name: 'Cancha 1', intake_template_id: 5 }));
    expect(prisma.service_stations.create.mock.calls[0][0].data).toMatchObject({ rental_tax_category_id: null, rental_tax_is_inclusive: true });
  });

  it('una categoría rechazada no toca la estación', async () => {
    shippingTax.assertCategoryAssignable.mockRejectedValue(new Error('no elegible'));
    await expect(run(() => service.update(2, { rental_tax_category_id: 9 }))).rejects.toThrow('no elegible');
    expect(prisma.service_stations.updateMany).not.toHaveBeenCalled();
  });

  it('al editar solo cambia los campos de impuesto enviados', async () => {
    await run(() => service.update(2, { rental_tax_category_id: null }));
    expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(null, 'station_rental');
    const data = prisma.service_stations.updateMany.mock.calls[0][0].data;
    expect(data.rental_tax_category_id).toBeNull();
    expect(data).not.toHaveProperty('rental_tax_is_inclusive');
  });
});


describe('ServiceStationsService.findAll — próxima reserva y sesión activa', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let prisma: Record<string, any>;

  beforeEach(() => {
    prisma = {
      service_stations: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Cava 1' }, { id: 2, name: 'Cava 2' }]),
        count: jest.fn().mockResolvedValue(2),
      },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
      service_allocations: {
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            args.where.state === 'in_service'
              ? [{ session_id: 70, end_at: new Date('2026-11-05T03:00:00Z') }]
              : [{ station_id: 1, booking_id: 8, start_at: new Date('2026-11-05T07:00:00Z'), booking: { customer: { first_name: 'Ana', last_name: null } } }],
          ),
        ),
      },
      service_sessions: {
        findMany: jest.fn().mockResolvedValue([{ id: 70, station_id: 2, opened_at: new Date('2026-11-05T01:00:00Z'), status: 'open' }]),
      },
    };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, {} as any);
  });

  const run = <T,>(fn: () => Promise<T>) => RequestContextService.runIsolated(context, fn);

  it('agrega next_reservation y active_session con consultas en lote', async () => {
    const result = await run(() => service.findAll({} as any));
    const [s1, s2]: any[] = result.data;
    expect(s1.next_reservation).toEqual({ start_at: '2026-11-05T07:00:00.000Z', booking_id: 8, customer_name: 'Ana' });
    expect(s1.active_session).toBeNull();
    expect(s2.next_reservation).toBeNull();
    expect(s2.active_session).toEqual({
      id: 70,
      opened_at: new Date('2026-11-05T01:00:00Z'),
      planned_end_at: '2026-11-05T03:00:00.000Z',
      status: 'open',
    });
    // One batched query per concern, never per station.
    expect(prisma.service_sessions.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.service_allocations.findMany).toHaveBeenCalledTimes(2);
    const nextCall = prisma.service_allocations.findMany.mock.calls.find((c: any[]) => c[0].where.state !== 'in_service');
    expect(nextCall[0].where).toEqual(expect.objectContaining({ store_id: 10, station_id: { in: [1, 2] }, start_at: { gte: expect.any(Date) } }));
  });

  it('la próxima reserva no muestra la asignación de la atención en curso', async () => {
    await run(() => service.findAll({} as any));
    const nextCall = prisma.service_allocations.findMany.mock.calls.find((c: any[]) => c[0].where.state !== 'in_service');
    // An early arrival keeps a future start_at on the session's own allocation:
    // it is the current session, not the next reservation.
    expect(nextCall[0].where.session_id).toBeNull();
    expect(nextCall[0].where.state.in).not.toContain('in_service');
  });
});

describe('ServiceStationsService.setSchedules — horarios nocturnos (S21)', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      service_station_schedules: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      service_stations: { findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'Cava 1' }) },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_schedules: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, {} as any);
  });

  const run = <T>(fn: () => Promise<T>): Promise<T> => RequestContextService.runIsolated(context, fn);

  it('guarda un bloque que termina al día siguiente', async () => {
    await run(() => service.setSchedules(2, { schedules: [{ weekday: 5, start_time: '20:00', end_time: '03:00' }] }));
    expect(tx.service_station_schedules.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ weekday: 5, start_time: '20:00', end_time: '03:00' })],
    });
  });

  it('acepta 00:00-00:00 como 24 horas', async () => {
    await run(() => service.setSchedules(2, { schedules: [{ weekday: 6, start_time: '00:00', end_time: '00:00' }] }));
    expect(tx.service_station_schedules.createMany).toHaveBeenCalled();
  });

  it('rechaza un día que se cruza con el bloque nocturno del día anterior', async () => {
    await expect(
      run(() => service.setSchedules(2, {
        schedules: [
          { weekday: 5, start_time: '20:00', end_time: '03:00' },
          { weekday: 6, start_time: '02:00', end_time: '10:00' },
        ],
      })),
    ).rejects.toThrow('no pueden superponerse');
    expect(tx.service_station_schedules.deleteMany).not.toHaveBeenCalled();
  });

  it('mantiene el rechazo de bloques diurnos superpuestos', async () => {
    await expect(
      run(() => service.setSchedules(2, {
        schedules: [
          { weekday: 1, start_time: '09:00', end_time: '13:00' },
          { weekday: 1, start_time: '12:00', end_time: '18:00' },
        ],
      })),
    ).rejects.toThrow('no pueden superponerse');
  });

  it('mantiene los bloques diurnos contiguos y ordena block_order', async () => {
    await run(() => service.setSchedules(2, {
      schedules: [
        { weekday: 1, start_time: '14:00', end_time: '18:00' },
        { weekday: 1, start_time: '09:00', end_time: '14:00' },
      ],
    }));
    expect(tx.service_station_schedules.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ start_time: '09:00', block_order: 0 }),
      expect.objectContaining({ start_time: '14:00', block_order: 1 }),
    ]);
  });
});

describe('ServiceStationsService — reglas de anticipo (S1)', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let prisma: Record<string, any>;
  let shippingTax: { assertCategoryAssignable: jest.Mock };
  let current: Record<string, any>;

  beforeEach(() => {
    current = { id: 2, store_id: 10, name: 'Cava 3', deposit_policy: 'none', deposit_amount: null };
    prisma = {
      service_stations: {
        create: jest.fn().mockResolvedValue({ id: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(async () => ({ ...current })),
      },
      data_collection_templates: { findFirst: jest.fn().mockResolvedValue({ id: 5, station_type: 'cava' }) },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    shippingTax = { assertCategoryAssignable: jest.fn().mockResolvedValue(undefined) };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, shippingTax as any);
  });

  const run = <T>(fn: () => Promise<T>) => RequestContextService.runIsolated(context, fn);

  it('create persiste las reglas de anticipo y valida la categoría del cargo de reserva', async () => {
    await run(() => service.create({
      name: 'Cava 3', intake_template_id: 5,
      deposit_policy: 'required', deposit_amount: 400000, deposit_exhausted_policy: 'recharge',
      leftover_policy: 'minimum_spend', booking_duration_mode: 'free', hold_minutes: 45,
      open_end_block_minutes: 240, cancel_refund_hours: 24, reservation_fee_tax_category_id: 3,
    } as any));
    expect(prisma.service_stations.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deposit_policy: 'required', deposit_amount: 400000, deposit_exhausted_policy: 'recharge',
        leftover_policy: 'minimum_spend', booking_duration_mode: 'free', hold_minutes: 45,
        open_end_block_minutes: 240, cancel_refund_hours: 24, reservation_fee_tax_category_id: 3,
      }),
    });
    expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(3, 'station_rental');
  });

  it('create sin reglas conserva los valores de siempre (sin columnas nuevas en el insert)', async () => {
    await run(() => service.create({ name: 'Bahía 1', intake_template_id: 5 } as any));
    const data = prisma.service_stations.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('deposit_policy');
    expect(data).not.toHaveProperty('hold_minutes');
    expect(data.rental_tax_is_inclusive).toBe(true);
  });

  it('create con anticipo "ninguno" no guarda monto', async () => {
    await run(() => service.create({ name: 'Cava 3', intake_template_id: 5, deposit_policy: 'none', deposit_amount: 1000 } as any));
    expect(prisma.service_stations.create.mock.calls[0][0].data.deposit_amount).toBeNull();
  });

  it('update rechaza pasar a anticipo obligatorio sin monto en la estación ni en el pedido', async () => {
    await expect(run(() => service.update(2, { deposit_policy: 'required' } as any))).rejects.toThrow('Indica el monto del anticipo');
    expect(prisma.service_stations.updateMany).not.toHaveBeenCalled();
  });

  it('update acepta una política con el monto que la estación ya tenía', async () => {
    current.deposit_amount = 200000;
    await run(() => service.update(2, { deposit_policy: 'optional' } as any));
    expect(prisma.service_stations.updateMany.mock.calls[0][0].data).toEqual(expect.objectContaining({ deposit_policy: 'optional' }));
  });

  it('update a "ninguno" borra el monto y no toca lo demás', async () => {
    current.deposit_policy = 'required';
    current.deposit_amount = 400000;
    await run(() => service.update(2, { deposit_policy: 'none' } as any));
    const data = prisma.service_stations.updateMany.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ deposit_policy: 'none', deposit_amount: null }));
    expect(data).not.toHaveProperty('hold_minutes');
  });

  it('create persiste unidad, modo y momento del cobro y el cobro parcial por porcentaje', async () => {
    await run(() => service.create({
      name: 'Cancha 1', intake_template_id: 5, rental_block_unit: 'hour', rental_billing_mode: 'planned',
      rental_charge_timing: 'at_start', booking_prepay_mode: 'partial', booking_prepay_percent: 30,
    } as any));
    expect(prisma.service_stations.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      rental_block_unit: 'hour', rental_billing_mode: 'planned', rental_charge_timing: 'at_start',
      booking_prepay_mode: 'partial', booking_prepay_percent: 30, booking_prepay_amount: null,
    }));
  });

  it('create sin reglas de alquiler no agrega esas columnas al insert', async () => {
    await run(() => service.create({ name: 'Bahía 1', intake_template_id: 5 } as any));
    const data = prisma.service_stations.create.mock.calls[0][0].data;
    for (const key of ['rental_block_unit', 'rental_billing_mode', 'rental_charge_timing', 'booking_prepay_mode', 'booking_prepay_percent', 'booking_prepay_amount']) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it('update a cobro total borra porcentaje y monto', async () => {
    current.booking_prepay_mode = 'partial';
    current.booking_prepay_percent = 30;
    await run(() => service.update(2, { booking_prepay_mode: 'full' } as any));
    expect(prisma.service_stations.updateMany.mock.calls[0][0].data).toEqual(expect.objectContaining({
      booking_prepay_mode: 'full', booking_prepay_percent: null, booking_prepay_amount: null,
    }));
  });

  it('update de parcial por porcentaje a parcial por monto borra el porcentaje guardado', async () => {
    current.booking_prepay_mode = 'partial';
    current.booking_prepay_percent = 30;
    await run(() => service.update(2, { booking_prepay_mode: 'partial', booking_prepay_amount: 50000 } as any));
    expect(prisma.service_stations.updateMany.mock.calls[0][0].data).toEqual(expect.objectContaining({
      booking_prepay_percent: null, booking_prepay_amount: 50000,
    }));
  });

  it('update rechaza un porcentaje suelto cuando la estación no cobra parcial', async () => {
    current.booking_prepay_mode = 'none';
    await expect(run(() => service.update(2, { booking_prepay_percent: 30 } as any)))
      .rejects.toThrow('El cobro parcial lleva un porcentaje o un monto');
    expect(prisma.service_stations.updateMany).not.toHaveBeenCalled();
  });

  it('update rechaza dejar el cobro parcial sin porcentaje ni monto', async () => {
    current.booking_prepay_mode = 'partial';
    current.booking_prepay_amount = 50000;
    await expect(run(() => service.update(2, { booking_prepay_amount: null } as any)))
      .rejects.toThrow('El cobro parcial lleva un porcentaje o un monto');
  });

  it('update solo de nombre no valida categorías nuevas ni anticipo', async () => {
    await run(() => service.update(2, { name: 'Cava 4' } as any));
    expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(undefined, 'station_rental');
    expect(prisma.service_stations.updateMany.mock.calls[0][0].data).not.toHaveProperty('deposit_policy');
  });
});

describe('ServiceStationsService — defaults y múltiplo del bloque (S7-h, S7-f)', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: ServiceStationsService;
  let prisma: Record<string, any>;
  let tx: Record<string, any>;
  let current: Record<string, any>;

  beforeEach(() => {
    current = { id: 2, store_id: 10, name: 'Sala 1', rental_block_minutes: 30, deposit_policy: 'none', deposit_amount: null };
    tx = {
      service_station_services: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      service_stations: {
        create: jest.fn().mockResolvedValue({ id: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(async () => ({ ...current })),
        findMany: jest.fn().mockResolvedValue([{ id: 2, name: 'Sala 1', rental_block_minutes: 30 }]),
        count: jest.fn().mockResolvedValue(1),
      },
      products: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7, product_type: 'service', service_duration_minutes: 45, rental_pricing_mode: 'station_rate',
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: 7, product_type: 'service', name: 'Alquiler', service_duration_minutes: 45, rental_pricing_mode: 'station_rate' },
        ]),
      },
      data_collection_templates: { findFirst: jest.fn().mockResolvedValue({ id: 5, station_type: 'cava' }) },
      service_station_services: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    service = new ServiceStationsService(prisma as unknown as StorePrismaService, { assertCategoryAssignable: jest.fn() } as any);
  });

  const run = <T>(fn: () => Promise<T>) => RequestContextService.runIsolated(context, fn);

  it('create sin booking_duration_mode guarda "free"', async () => {
    await run(() => service.create({ name: 'Bahía', intake_template_id: 5 } as any));
    expect(prisma.service_stations.create.mock.calls[0][0].data.booking_duration_mode).toBe('free');
  });

  it('create con booking_duration_mode explícito lo respeta', async () => {
    await run(() => service.create({ name: 'Bahía', intake_template_id: 5, booking_duration_mode: 'fixed' } as any));
    expect(prisma.service_stations.create.mock.calls[0][0].data.booking_duration_mode).toBe('fixed');
  });

  it('update sin booking_duration_mode no lo toca', async () => {
    await run(() => service.update(2, { name: 'Sala 1b' } as any));
    expect(prisma.service_stations.updateMany.mock.calls[0][0].data).not.toHaveProperty('booking_duration_mode');
  });

  it('setServices rechaza un servicio station_rate cuya duración no es múltiplo del bloque', async () => {
    await expect(run(() => service.setServices(2, { product_ids: [7] } as any))).rejects.toMatchObject({
      errorCode: 'STATION_017',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('setServices acepta un servicio que no es station_rate aunque no sea múltiplo', async () => {
    prisma.products.findMany.mockResolvedValue([
      { id: 7, product_type: 'service', name: 'Corte', service_duration_minutes: 45, rental_pricing_mode: null },
    ]);
    await run(() => service.setServices(2, { product_ids: [7] } as any));
    expect(tx.service_station_services.createMany).toHaveBeenCalled();
  });

  it('setProductStations rechaza si alguna estación elegida tiene un bloque que no divide la duración', async () => {
    await expect(run(() => service.setProductStations(7, { station_ids: [2] } as any))).rejects.toMatchObject({
      errorCode: 'STATION_017',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('update rechaza un cambio de bloque que deja un servicio station_rate vinculado fuera de múltiplo', async () => {
    prisma.service_station_services.findMany.mockResolvedValue([
      { product: { service_duration_minutes: 45, rental_pricing_mode: 'station_rate' } },
    ]);
    await expect(run(() => service.update(2, { rental_block_minutes: 30 } as any))).rejects.toMatchObject({
      errorCode: 'STATION_017',
    });
    expect(prisma.service_stations.updateMany).not.toHaveBeenCalled();
  });

  it('update sin cambio de bloque no consulta los servicios vinculados', async () => {
    await run(() => service.update(2, { name: 'Otra' } as any));
    const calls = prisma.service_station_services.findMany.mock.calls.filter((c: any[]) => c[0]?.where?.product);
    expect(calls).toHaveLength(0);
    expect(prisma.service_stations.updateMany).toHaveBeenCalled();
  });
});
