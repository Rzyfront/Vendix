import { RequestContextService } from '@common/context/request-context.service';
import { SchedulingService, SCHEDULING_MAX_WINDOW } from './scheduling.service';
import { BusinessHoursService } from '../reservations/business-hours/business-hours.service';
import {
  SchedulingEvent,
  SchedulingEventType,
  SchedulingSource,
} from './scheduling.types';

function event(type: SchedulingEventType, id: number, start: string): SchedulingEvent {
  return {
    id: `${type}:${id}`,
    type,
    type_label: type,
    source_id: id,
    reference: `R${id}`,
    title: `E${id}`,
    start,
    end: start,
    date: start.slice(0, 10),
    local_start: '00:00',
    end_date: start.slice(0, 10),
    local_end: '00:00',
    status: 'x',
    status_label: 'x',
    status_group: 'confirmed',
    staff: null,
    customer: null,
    order_id: null,
    detail: null,
  };
}

function fakeSource(type: SchedulingEventType, events: SchedulingEvent[]): SchedulingSource & { fetch: jest.Mock } {
  return {
    type,
    fetch: jest.fn(async (_ctx, _filters, take: number) => ({
      total: events.length,
      events: events.slice(0, take),
      truncated: false,
    })),
  };
}

describe('SchedulingService (agenda-unificada F1)', () => {
  let prisma: any;
  let bookings: ReturnType<typeof fakeSource>;
  let orders: ReturnType<typeof fakeSource>;
  let service: SchedulingService;

  const setStore = (industries: string[], scheduledEnabled = true) => {
    prisma.store_settings.findFirst.mockResolvedValue({
      settings: { scheduled_orders: { enabled: scheduledEnabled } },
      stores: { industries, timezone: 'America/Bogota' },
    });
  };
  const setContext = (permissions: string[], store_id: number | null = 7) => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: store_id ?? undefined,
      permissions,
      is_super_admin: false,
      is_owner: false,
    } as any);
  };
  const ALL = ['store:reservations:read', 'store:scheduled_orders:read'];

  beforeEach(() => {
    prisma = {
      store_settings: { findFirst: jest.fn() },
      service_providers: { findMany: jest.fn().mockResolvedValue([]) },
      provider_schedules: { findMany: jest.fn().mockResolvedValue([]) },
      provider_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
    };
    bookings = fakeSource('booking', [
      event('booking', 1, '2026-11-23T14:00:00.000Z'),
      event('booking', 2, '2026-11-23T16:00:00.000Z'),
      event('booking', 3, '2026-11-24T14:00:00.000Z'),
    ]);
    orders = fakeSource('scheduled_order', [
      event('scheduled_order', 10, '2026-11-23T15:00:00.000Z'),
      event('scheduled_order', 11, '2026-11-24T13:00:00.000Z'),
    ]);
    service = new SchedulingService(prisma, bookings as any, orders as any, {
      loadStoreHours: jest.fn().mockResolvedValue(
        new Map([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start_time: '06:00', end_time: '22:00' }]])),
      ),
      // Lector real del horario efectivo del prestador (Parte 1).
      loadProviderBlocks: BusinessHoursService.prototype.loadProviderBlocks,
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sin tienda en el contexto responde STORE_CONTEXT_001', async () => {
    setContext(ALL, null);
    await expect(service.resolveAccess()).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STORE_CONTEXT_001' }),
    });
  });

  it('industria inactiva: una tienda retail no ve ninguna fuente y no consulta nada', async () => {
    setContext(ALL);
    setStore(['retail']);
    const result = await service.list({ order: 'asc' }, 1, 20);
    expect(result).toEqual({ data: [], total: 0, truncated: false, types: [] });
    expect(bookings.fetch).not.toHaveBeenCalled();
    expect(orders.fetch).not.toHaveBeenCalled();
  });

  it('servicio ve reservas; restaurante con el ajuste activo ve pedidos', async () => {
    setContext(ALL);
    setStore(['service']);
    expect((await service.resolveAccess()).types).toEqual(['booking']);
    setStore(['restaurant']);
    expect((await service.resolveAccess()).types).toEqual(['scheduled_order']);
    setStore(['service', 'restaurant']);
    expect((await service.resolveAccess()).types).toEqual(['booking', 'scheduled_order']);
  });

  it('pedidos programados apagados en la tienda: la fuente no entra', async () => {
    setContext(ALL);
    setStore(['restaurant', 'service'], false);
    expect((await service.resolveAccess()).types).toEqual(['booking']);
  });

  it('sin el permiso de lectura de un módulo, su fuente se omite (sin 403)', async () => {
    setContext(['store:scheduled_orders:read']);
    setStore(['service', 'restaurant']);
    expect((await service.resolveAccess()).types).toEqual(['scheduled_order']);
  });

  it('los adaptadores reciben la tienda y la zona horaria del contexto', async () => {
    setContext(ALL, 42);
    setStore(['service']);
    await service.list({ order: 'asc' }, 1, 5);
    expect(bookings.fetch).toHaveBeenCalledWith(
      { store_id: 42, timezone: 'America/Bogota' },
      { order: 'asc' },
      5,
    );
  });

  it('mezcla las fuentes en orden cronológico y corta la página en servidor', async () => {
    setContext(ALL);
    setStore(['service', 'restaurant']);
    const page1 = await service.list({ order: 'asc' }, 1, 2);
    expect(page1.data.map((e) => e.id)).toEqual(['booking:1', 'scheduled_order:10']);
    expect(page1.total).toBe(5);
    const page2 = await service.list({ order: 'asc' }, 2, 2);
    expect(page2.data.map((e) => e.id)).toEqual(['booking:2', 'scheduled_order:11']);
    // Cada fuente aporta como mucho `page * limit` filas.
    expect(bookings.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 4);
    const page3 = await service.list({ order: 'asc' }, 3, 2);
    expect(page3.data.map((e) => e.id)).toEqual(['booking:3']);
  });

  it('el filtro de tipo limita las fuentes consultadas', async () => {
    setContext(ALL);
    setStore(['service', 'restaurant']);
    const result = await service.list({ order: 'asc', types: ['scheduled_order'] }, 1, 20);
    expect(result.total).toBe(2);
    expect(bookings.fetch).not.toHaveBeenCalled();
  });

  it('rechaza páginas más allá de la ventana máxima', async () => {
    setContext(ALL);
    setStore(['service']);
    await expect(
      service.list({ order: 'asc' }, SCHEDULING_MAX_WINDOW / 20 + 1, 20),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'SYS_VALIDATION_001' }),
    });
  });

  it('el calendario valida el rango y devuelve todo lo del rango ordenado', async () => {
    setContext(ALL);
    setStore(['service', 'restaurant']);
    await expect(
      service.calendar({ order: 'asc', from: '2026-11-01', to: '2027-02-01' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'SYS_VALIDATION_001' }),
    });
    const result = await service.calendar({ order: 'asc', from: '2026-11-23', to: '2026-11-24' });
    expect(result.data.map((e) => e.id)).toEqual([
      'booking:1',
      'scheduled_order:10',
      'booking:2',
      'scheduled_order:11',
      'booking:3',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('sources: personal solo cuando las reservas están habilitadas', async () => {
    setContext(ALL);
    setStore(['restaurant']);
    const restaurant = await service.getSources();
    expect(restaurant.staff).toEqual([]);
    expect(prisma.service_providers.findMany).not.toHaveBeenCalled();

    setStore(['service']);
    prisma.service_providers.findMany.mockResolvedValue([
      { id: 3, display_name: ' Ana ', user: null },
      { id: 4, display_name: null, user: { first_name: 'Luis', last_name: 'Pérez' } },
    ]);
    const svc = await service.getSources();
    expect(svc.types).toEqual([{ value: 'booking', label: 'Reserva de servicio' }]);
    expect(svc.staff).toEqual([
      { id: 3, name: 'Ana' },
      { id: 4, name: 'Luis Pérez' },
    ]);
    expect(svc.timezone).toBe('America/Bogota');
  });

  it('filtro por prestador: llega a las fuentes y trae su disponibilidad en el rango', async () => {
    setContext(ALL);
    setStore(['service', 'restaurant']);
    prisma.service_providers.findMany.mockResolvedValue([{ id: 3 }]);
    prisma.provider_schedules.findMany.mockResolvedValue([
      { provider_id: 3, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' },
    ]);
    prisma.provider_exceptions.findMany.mockResolvedValue([
      {
        provider_id: 3,
        date: new Date('2026-11-24T00:00:00.000Z'),
        is_unavailable: true,
        custom_start_time: null,
        custom_end_time: null,
        reason: 'Vacaciones',
      },
    ]);
    const result = await service.calendar({
      order: 'asc',
      from: '2026-11-23',
      to: '2026-11-24',
      staff_ids: [3],
    });
    for (const source of [bookings, orders]) {
      expect(source.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ staff_ids: [3] }),
        expect.any(Number),
      );
    }
    expect(result.availability).toEqual([
      expect.objectContaining({ staff_id: 3, date: '2026-11-23', windows: [{ start: '08:00', end: '12:00' }] }),
      expect.objectContaining({ staff_id: 3, date: '2026-11-24', unavailable: true, reason: 'Vacaciones' }),
    ]);
  });

  it('sin filtro de prestador, o sin reservas habilitadas, no calcula disponibilidad', async () => {
    setContext(ALL);
    setStore(['service']);
    const plain = await service.calendar({ order: 'asc', from: '2026-11-23', to: '2026-11-24' });
    expect(plain.availability).toEqual([]);
    setStore(['restaurant']);
    const noBookings = await service.calendar({
      order: 'asc',
      from: '2026-11-23',
      to: '2026-11-24',
      staff_ids: [3],
    });
    expect(noBookings.availability).toEqual([]);
    expect(prisma.provider_schedules.findMany).not.toHaveBeenCalled();
  });
});
