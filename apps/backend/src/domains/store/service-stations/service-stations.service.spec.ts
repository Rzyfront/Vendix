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

  it('cae al dominio principal activo de otra app cuando no hay ecommerce', async () => {
    prisma.domain_settings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ hostname: 'tienda.vendix.com' });
    const url = await run(() => service.getPublicUrl(2));
    expect(url).toContain('https://tienda.vendix.com/estacion/');
    expect(prisma.domain_settings.findFirst).toHaveBeenCalledTimes(2);
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
