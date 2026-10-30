import {
  buildFulfillmentDays,
  BuildDaysInput,
  FulfillmentAvailabilityService,
} from './fulfillment-availability.service';
import { ScheduledOrdersSettings } from '../settings/interfaces/store-settings.interface';

const TZ = 'America/Bogota'; // UTC-5, sin horario de verano

function config(overrides: Partial<ScheduledOrdersSettings> = {}): ScheduledOrdersSettings {
  return {
    enabled: true,
    // martes (2) a domingo (0), 08:00-18:00
    weekly_schedule: [0, 2, 3, 4, 5, 6].map((day_of_week) => ({
      day_of_week,
      start_time: '08:00',
      end_time: '18:00',
    })),
    slot_duration_minutes: 120,
    slot_capacity: 3,
    day_capacity: 15,
    min_lead_time_hours: 24,
    max_days_ahead: 30,
    fulfillment_types: ['pickup'],
    reminders: [],
    ...overrides,
  };
}

function build(overrides: Partial<BuildDaysInput> = {}) {
  return buildFulfillmentDays({
    config: config(),
    timezone: TZ,
    from: '2026-11-02',
    to: '2026-11-04',
    // lunes 2 nov 08:00 hora Bogotá
    now: new Date('2026-11-02T13:00:00.000Z'),
    exceptions: [],
    taken_starts: [],
    ...overrides,
  });
}

describe('buildFulfillmentDays', () => {
  it('genera franjas de 2 h en hora de tienda y bloquea el día sin horario (lunes)', () => {
    const [monday, tuesday] = build();
    expect(monday.date).toBe('2026-11-02');
    expect(monday.blocked_reason).toBe('day_blocked');
    expect(monday.slots).toHaveLength(0);

    expect(tuesday.slots.map((s) => s.local_start)).toEqual([
      '08:00', '10:00', '12:00', '14:00', '16:00',
    ]);
    // 10:00 Bogotá = 15:00 UTC
    expect(tuesday.slots[1].start).toBe('2026-11-03T15:00:00.000Z');
    expect(tuesday.slots[1].end).toBe('2026-11-03T17:00:00.000Z');
  });

  it('marca lead_time en las franjas que no cumplen la anticipación mínima', () => {
    const [, tuesday] = build();
    // now + 24 h = martes 08:00 local: esa franja sí cumple, ninguna anterior existe.
    expect(tuesday.slots[0].blocked_reason).toBeNull();

    const late = build({ now: new Date('2026-11-02T17:00:00.000Z') }); // lunes 12:00
    const tue = late[1];
    expect(tue.slots[0].blocked_reason).toBe('lead_time'); // 08:00
    expect(tue.slots[1].blocked_reason).toBe('lead_time'); // 10:00
    expect(tue.slots[2].blocked_reason).toBeNull(); // 12:00
  });

  it('franja llena: con 3 pedidos en la franja aparece slot_full y no disponible', () => {
    const start = new Date('2026-11-03T15:00:00.000Z');
    const [, tuesday] = build({ taken_starts: [start, start, start] });
    const slot = tuesday.slots[1];
    expect(slot.taken).toBe(3);
    expect(slot.capacity).toBe(3);
    expect(slot.available).toBe(false);
    expect(slot.blocked_reason).toBe('slot_full');
    expect(tuesday.slots[2].available).toBe(true);
  });

  it('cupo diario lleno bloquea todas las franjas del día', () => {
    const starts = [
      new Date('2026-11-03T13:00:00.000Z'),
      new Date('2026-11-03T15:00:00.000Z'),
    ];
    const [, tuesday] = build({
      config: config({ day_capacity: 2 }),
      taken_starts: starts,
    });
    expect(tuesday.day_taken).toBe(2);
    expect(tuesday.slots.every((s) => s.blocked_reason === 'day_full')).toBe(true);
  });

  it('excepción de día cerrado bloquea el día con su motivo', () => {
    const [, tuesday] = build({
      exceptions: [{
        date: new Date('2026-11-03T00:00:00.000Z'),
        is_closed: true,
        start_time: null,
        end_time: null,
        slot_capacity: null,
        day_capacity: null,
        reason: 'Festivo',
      }],
    });
    expect(tuesday.blocked_reason).toBe('day_blocked');
    expect(tuesday.exception_reason).toBe('Festivo');
  });

  it('excepción con horario y cupo especial reemplaza el horario semanal', () => {
    const [, tuesday] = build({
      exceptions: [{
        date: '2026-11-03',
        is_closed: false,
        start_time: '10:00',
        end_time: '14:00',
        slot_capacity: 1,
        day_capacity: null,
        reason: null,
      }],
    });
    expect(tuesday.slots.map((s) => s.local_start)).toEqual(['10:00', '12:00']);
    expect(tuesday.slots[0].capacity).toBe(1);
  });

  it('cambio de día por zona horaria: un pedido a las 21:00 UTC cuenta en el día local correcto', () => {
    // 16:00 Bogotá del martes = 21:00 UTC del mismo martes; 23:30 Bogotá sería miércoles UTC.
    const lateStart = new Date('2026-11-03T21:00:00.000Z');
    const [, tuesday, wednesday] = build({
      config: config({ day_capacity: 1 }),
      taken_starts: [lateStart],
    });
    expect(tuesday.day_taken).toBe(1);
    expect(wednesday.day_taken).toBe(0);
    expect(wednesday.slots.some((s) => s.available)).toBe(true);
  });

  it('marca too_far las fechas más allá del horizonte', () => {
    const days = build({
      config: config({ max_days_ahead: 1 }),
      to: '2026-11-04',
    });
    expect(days[1].slots[0].blocked_reason).toBeNull(); // martes = hoy + 1
    expect(days[2].slots[0].blocked_reason).toBe('too_far'); // miércoles
  });
});

describe('FulfillmentAvailabilityService', () => {
  function makeService(settings: unknown, taken: Array<{ scheduled_start: Date }> = []) {
    const prisma = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings,
          stores: { timezone: TZ },
        }),
      },
      fulfillment_schedule_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
      order_fulfillment_schedules: { findMany: jest.fn().mockResolvedValue(taken) },
    };
    return { service: new FulfillmentAvailabilityService(prisma as any), prisma };
  }

  const enabled = { scheduled_orders: config() };
  const now = new Date('2026-11-02T13:00:00.000Z');

  it('con el ajuste apagado (default) responde SCHED_DISABLED', async () => {
    const { service } = makeService({});
    await expect(
      service.getAvailability(1, '2026-11-03', '2026-11-04', { now }),
    ).rejects.toMatchObject({ errorCode: 'SCHED_DISABLED' });
  });

  it('rechaza rangos invertidos o demasiado largos', async () => {
    const { service } = makeService(enabled);
    await expect(service.getAvailability(1, '2026-11-05', '2026-11-04')).rejects.toMatchObject({
      errorCode: 'SCHED_INVALID_RANGE',
    });
    await expect(service.getAvailability(1, '2026-11-01', '2027-02-01')).rejects.toMatchObject({
      errorCode: 'SCHED_INVALID_RANGE',
    });
  });

  it('assertSlotAvailable: franja llena → SCHED_SLOT_FULL con el mensaje al usuario', async () => {
    const start = new Date('2026-11-03T15:00:00.000Z');
    const { service } = makeService(enabled, [
      { scheduled_start: start }, { scheduled_start: start }, { scheduled_start: start },
    ]);
    await expect(
      service.assertSlotAvailable(1, start, new Date('2026-11-03T17:00:00.000Z'), { now }),
    ).rejects.toMatchObject({
      errorCode: 'SCHED_SLOT_FULL',
      message: 'No hay cupo en esa franja. Elige otra hora.',
    });
  });

  it('assertSlotAvailable: anticipación no cumplida → SCHED_LEAD_TIME con las horas', async () => {
    const { service } = makeService(enabled);
    const late = new Date('2026-11-02T17:00:00.000Z');
    await expect(
      service.assertSlotAvailable(
        1,
        new Date('2026-11-03T13:00:00.000Z'),
        new Date('2026-11-03T15:00:00.000Z'),
        { now: late },
      ),
    ).rejects.toMatchObject({
      errorCode: 'SCHED_LEAD_TIME',
      message: 'Este pedido requiere al menos 24 horas de anticipación.',
    });
  });

  it('assertSlotAvailable: día bloqueado (lunes) → SCHED_DAY_BLOCKED', async () => {
    const { service } = makeService(enabled);
    await expect(
      service.assertSlotAvailable(
        1,
        new Date('2026-11-09T15:00:00.000Z'),
        new Date('2026-11-09T17:00:00.000Z'),
        { now },
      ),
    ).rejects.toMatchObject({
      errorCode: 'SCHED_DAY_BLOCKED',
      message: 'La tienda no recibe pedidos para ese día.',
    });
  });

  it('assertSlotAvailable: hora que no coincide con una franja → SCHED_OUT_OF_HOURS', async () => {
    const { service } = makeService(enabled);
    await expect(
      service.assertSlotAvailable(
        1,
        new Date('2026-11-03T15:30:00.000Z'),
        new Date('2026-11-03T17:30:00.000Z'),
        { now },
      ),
    ).rejects.toMatchObject({ errorCode: 'SCHED_OUT_OF_HOURS' });
  });

  it('assertSlotAvailable: franja con cupo devuelve la franja; excluye el propio agendamiento al contar', async () => {
    const { service, prisma } = makeService(enabled);
    const slot = await service.assertSlotAvailable(
      1,
      new Date('2026-11-03T15:00:00.000Z'),
      new Date('2026-11-03T17:00:00.000Z'),
      { now, exclude_schedule_id: 7 },
    );
    expect(slot.available).toBe(true);
    expect(prisma.order_fulfillment_schedules.findMany.mock.calls[0][0].where.id).toEqual({ not: 7 });
  });
});
