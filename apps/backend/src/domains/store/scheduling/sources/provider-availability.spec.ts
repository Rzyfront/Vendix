import {
  AVAILABILITY_MAX_STAFF,
  loadProviderAvailability,
  providerDayAvailability,
} from './provider-availability';

// 2026-11-23 es lunes (day_of_week 1); 2026-11-24 martes; 2026-11-29 domingo.
const SCHEDULES = [
  { provider_id: 3, day_of_week: 1, block_order: 1, start_time: '14:00', end_time: '18:00' },
  { provider_id: 3, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' },
  { provider_id: 3, day_of_week: 2, block_order: 0, start_time: '09:00', end_time: '17:00' },
  { provider_id: 4, day_of_week: 1, block_order: 0, start_time: '10:00', end_time: '16:00' },
];

describe('Disponibilidad del prestador en la Agenda (requisito F1)', () => {
  it('toma los bloques del día de la semana, en orden (turno partido)', () => {
    expect(providerDayAvailability(3, '2026-11-23', SCHEDULES, undefined)).toEqual({
      staff_id: 3,
      date: '2026-11-23',
      windows: [
        { start: '08:00', end: '12:00' },
        { start: '14:00', end: '18:00' },
      ],
      unavailable: false,
      reason: null,
    });
    // Domingo sin bloques: no trabaja.
    expect(providerDayAvailability(3, '2026-11-29', SCHEDULES, undefined).windows).toEqual([]);
  });

  it('una excepción de día bloqueado deja el día sin franjas y con su motivo', () => {
    const blocked = providerDayAvailability(3, '2026-11-24', SCHEDULES, {
      provider_id: 3,
      date: new Date('2026-11-24'),
      is_unavailable: true,
      custom_start_time: null,
      custom_end_time: null,
      reason: 'Vacaciones',
    });
    expect(blocked).toEqual(
      jasmineLike({ windows: [], unavailable: true, reason: 'Vacaciones' }),
    );
  });

  it('una excepción con horario propio reemplaza las horas del bloque', () => {
    const custom = providerDayAvailability(3, '2026-11-24', SCHEDULES, {
      provider_id: 3,
      date: new Date('2026-11-24'),
      is_unavailable: false,
      custom_start_time: '12:00',
      custom_end_time: '15:00',
      reason: 'Cita médica en la mañana',
    });
    expect(custom.windows).toEqual([{ start: '12:00', end: '15:00' }]);
    expect(custom.unavailable).toBe(false);
  });

  it('lee bloques y excepciones de todos los prestadores en dos consultas y solo de la tienda', async () => {
    const prisma = {
      // El 99 no es de la tienda: el Prisma de tienda no lo devuelve.
      service_providers: { findMany: jest.fn().mockResolvedValue([{ id: 3 }, { id: 4 }]) },
      provider_schedules: { findMany: jest.fn().mockResolvedValue(SCHEDULES) },
      provider_exceptions: {
        findMany: jest.fn().mockResolvedValue([
          {
            provider_id: 4,
            date: new Date('2026-11-23T00:00:00.000Z'),
            is_unavailable: true,
            custom_start_time: null,
            custom_end_time: null,
            reason: 'Incapacidad',
          },
        ]),
      },
    };
    const rows = await loadProviderAvailability(prisma as any, [3, 4, 99, 3], '2026-11-23', '2026-11-24');
    expect(prisma.provider_schedules.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.provider_exceptions.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.provider_schedules.findMany.mock.calls[0][0].where).toEqual({
      provider_id: { in: [3, 4] },
      is_active: true,
    });
    expect(prisma.provider_exceptions.findMany.mock.calls[0][0].where.date).toEqual({
      gte: new Date('2026-11-23'),
      lte: new Date('2026-11-24'),
    });
    expect(rows.map((r) => [r.staff_id, r.date, r.unavailable, r.windows.length])).toEqual([
      [3, '2026-11-23', false, 2],
      [3, '2026-11-24', false, 1],
      [4, '2026-11-23', true, 0],
      [4, '2026-11-24', false, 0],
    ]);
  });

  it('sin prestadores de la tienda no consulta horarios; respeta el tope de prestadores', async () => {
    const prisma = {
      service_providers: { findMany: jest.fn().mockResolvedValue([]) },
      provider_schedules: { findMany: jest.fn() },
      provider_exceptions: { findMany: jest.fn() },
    };
    expect(await loadProviderAvailability(prisma as any, [99], '2026-11-23', '2026-11-23')).toEqual([]);
    expect(prisma.provider_schedules.findMany).not.toHaveBeenCalled();
    const many = Array.from({ length: AVAILABILITY_MAX_STAFF + 5 }, (_, i) => i + 1);
    await loadProviderAvailability(prisma as any, many, '2026-11-23', '2026-11-23');
    expect(prisma.service_providers.findMany.mock.calls[1][0].where.id.in).toHaveLength(
      AVAILABILITY_MAX_STAFF,
    );
  });
});

function jasmineLike<T extends object>(partial: T) {
  return expect.objectContaining(partial);
}
