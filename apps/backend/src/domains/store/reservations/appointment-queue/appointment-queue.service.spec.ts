import { AppointmentQueueService } from './appointment-queue.service';

describe('AppointmentQueueService', () => {
  function buildService(
    candidates: any[],
    options: { transactions?: boolean } = {},
  ) {
    const findMany = jest.fn().mockResolvedValue(candidates);
    const update = jest.fn().mockResolvedValue({});
    const findFirst = jest.fn().mockResolvedValue(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const transaction = jest.fn(async (ops: any[]) => {
      for (const op of ops) await op;
      return [];
    });
    const prisma = {
      bookings: {
        findMany,
        findFirst,
        update,
        updateMany,
      },
      $transaction: options.transactions === false ? jest.fn() : transaction,
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {},
          stores: { timezone: 'America/Bogota' },
        }),
      },
    } as any;
    const notifications = {
      createAndBroadcast: jest.fn().mockResolvedValue({}),
    } as any;
    return {
      service: new AppointmentQueueService(prisma, notifications),
      findMany,
      findFirst,
      update,
      updateMany,
      transaction,
      notifications,
    };
  }

  it('returns empty array when no candidates arrive', async () => {
    const { service, findMany } = buildService([]);
    const result = await service.computeQueueForStore(1, '2026-07-18');
    expect(result).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store_id: 1,
          status: 'arriving',
          arrival_at: { not: null },
        }),
      }),
    );
  });

  it('filters by the real bookings columns (date + start_time), never the missing starts_at', async () => {
    const { service, findMany } = buildService([]);
    await service.computeQueueForStore(1, '2026-07-18');
    const args = findMany.mock.calls[0][0];
    expect(args.where.date).toEqual(new Date('2026-07-18T00:00:00.000Z'));
    expect(args.where).not.toHaveProperty('starts_at');
    expect(args.select).not.toHaveProperty('starts_at');
    expect(args.select).toEqual(
      expect.objectContaining({ date: true, start_time: true, end_time: true, end_date: true }),
    );
  });

  it('ranks bookings by ABS(starts_at - arrival_at) with priority and created_at tiebreakers', async () => {
    const candidates = [
      {
        id: 10,
        booking_number: 'BKG-1',
        customer_id: 100,
        provider_id: 1,
        // 05:00 Bogota (UTC-5) = 10:00Z
        date: new Date('2026-07-18T00:00:00Z'),
        end_date: null,
        start_time: '05:00',
        end_time: '06:00',
        arrival_at: new Date('2026-07-18T09:55:00Z'),
        priority: 0,
      },
      {
        id: 11,
        booking_number: 'BKG-2',
        customer_id: 101,
        provider_id: 1,
        // 05:00 Bogota (UTC-5) = 10:00Z
        date: new Date('2026-07-18T00:00:00Z'),
        end_date: null,
        start_time: '05:00',
        end_time: '06:00',
        arrival_at: new Date('2026-07-18T09:30:00Z'),
        priority: 0,
      },
    ];
    const { service } = buildService(candidates);
    const ranked = await service.computeQueueForStore(1, '2026-07-18');
    // BKG-2 arrived 30 min early vs BKG-1 arrived 5 min early → BKG-1 ranked first.
    expect(ranked[0].booking_id).toBe(10);
    expect(ranked[1].booking_id).toBe(11);
    // Score for BKG-1: |10:00 - 09:55| = 5 min.
    expect(ranked[0].score).toBe(5 * 60_000);
    expect(ranked[0].starts_at).toEqual(new Date('2026-07-18T10:00:00Z'));
  });

  describe('dayBoard', () => {
    // 2026-07-18 09:00 en Bogotá (UTC-5).
    const now = new Date('2026-07-18T14:00:00Z');
    const row = (over: Record<string, any>) => ({
      id: 1,
      booking_number: 'BKG-1',
      status: 'confirmed',
      customer_id: 100,
      provider_id: 1,
      date: new Date('2026-07-18T00:00:00Z'),
      end_date: null,
      start_time: '11:00',
      end_time: '12:00',
      arrival_at: null,
      priority: 0,
      customer: { first_name: 'Ana', last_name: 'Díaz' },
      product: { name: 'Corte' },
      provider: { display_name: 'Laura', employee: null, user: null },
      ...over,
    });

    it('separa en atención, en sala y la programación confirmada que no ha empezado', async () => {
      const { service, findMany } = buildService([
        row({ id: 1, status: 'attending', start_time: '09:00', end_time: '10:00', arrival_at: new Date('2026-07-18T13:50:00Z') }),
        row({ id: 2, status: 'arriving', start_time: '10:00', end_time: '11:00', arrival_at: new Date('2026-07-18T13:30:00Z') }),
        row({ id: 3, status: 'arriving', start_time: '10:00', end_time: '11:00', arrival_at: new Date('2026-07-18T13:55:00Z') }),
        row({ id: 4, status: 'confirmed', start_time: '11:00', end_time: '12:00' }),
        row({ id: 5, status: 'confirmed', start_time: '08:00', end_time: '09:00' }),
      ]);

      const board = await service.dayBoard(1, '2026-07-18', now);

      expect(board.in_service.map((r) => r.booking_id)).toEqual([1]);
      // En sala: el que llegó más cerca de su hora va primero.
      expect(board.waiting.map((r) => r.booking_id)).toEqual([3, 2]);
      // Las confirmadas van por hora, incluidas las que ya pasaron sin check-in.
      expect(board.upcoming.map((r) => r.booking_id)).toEqual([5, 4]);
      expect(findMany.mock.calls[0][0].where.status).toEqual({
        in: ['confirmed', 'arriving', 'attending'],
      });
    });

    it('compone el nombre del cliente y del prestador para el monitor', async () => {
      const { service } = buildService([
        row({
          id: 9,
          status: 'confirmed',
          start_time: '11:00',
          provider: { display_name: null, employee: { first_name: 'María', last_name: 'Paz' }, user: null },
        }),
      ]);
      const board = await service.dayBoard(1, '2026-07-18', now);
      expect(board.upcoming[0].customer_name).toBe('Ana Díaz');
      expect(board.upcoming[0].provider_name).toBe('María Paz');
      expect(board.upcoming[0].service_name).toBe('Corte');
      expect(board.upcoming[0].minutes_to_start).toBe(120);
      expect(board.upcoming[0].checked_in).toBe(false);
    });

    it('sin día usa HOY en la zona de la tienda, no la fecha UTC', async () => {
      const { service } = buildService([]);
      // 2026-07-19 02:00Z = 18 de julio, 21:00 en Bogotá.
      const lateEvening = new Date('2026-07-19T02:00:00Z');
      const board = await service.dayBoard(1, undefined, lateEvening);
      expect(board.day).toBe('2026-07-18');
    });

    it('nunca persiste posiciones: es solo lectura', async () => {
      const { service, update, transaction } = buildService([row({ id: 4 })]);
      await service.dayBoard(1, '2026-07-18', now);
      expect(update).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  it('desempata por prioridad cuando dos reservas llegaron con el mismo score', async () => {
    const base = {
      booking_number: 'BKG',
      customer_id: 100,
      provider_id: 1,
      date: new Date('2026-07-18T00:00:00Z'),
      end_date: null,
      start_time: '05:00',
      end_time: '06:00',
      arrival_at: new Date('2026-07-18T09:55:00Z'),
      created_at: new Date('2026-07-18T08:00:00Z'),
    };
    // La entrada va al revés del resultado esperado: si el desempate no
    // existiera, el sort estable dejaría 21 primero.
    const { service } = buildService([
      { ...base, id: 21, priority: 5 },
      { ...base, id: 20, priority: 0 },
    ]);
    const ranked = await service.computeQueueForStore(1, '2026-07-18');
    expect(ranked.map((r) => r.booking_id)).toEqual([20, 21]);
  });

  it('desempata por orden de llegada (created_at) cuando score y prioridad empatan', async () => {
    const base = {
      booking_number: 'BKG',
      customer_id: 100,
      provider_id: 1,
      date: new Date('2026-07-18T00:00:00Z'),
      end_date: null,
      start_time: '05:00',
      end_time: '06:00',
      arrival_at: new Date('2026-07-18T09:55:00Z'),
      priority: 0,
    };
    const { service } = buildService([
      { ...base, id: 41, created_at: new Date('2026-07-18T08:30:00Z') },
      { ...base, id: 40, created_at: new Date('2026-07-18T08:00:00Z') },
    ]);
    const ranked = await service.computeQueueForStore(1, '2026-07-18');
    expect(ranked.map((r) => r.booking_id)).toEqual([40, 41]);
  });

  it('deja fuera a quien ya está en atención y ordena por cercanía a su hora', async () => {
    const base = {
      booking_number: 'BKG',
      customer_id: 100,
      provider_id: 1,
      date: new Date('2026-07-18T00:00:00Z'),
      end_date: null,
      start_time: '05:00',
      end_time: '06:00',
      priority: 0,
      created_at: new Date('2026-07-18T08:00:00Z'),
    };
    const { service, findMany } = buildService([
      { ...base, id: 30, status: 'arriving', arrival_at: new Date('2026-07-18T09:40:00Z') },
      { ...base, id: 31, status: 'arriving', arrival_at: new Date('2026-07-18T09:58:00Z') },
    ]);
    const ranked = await service.computeQueueForStore(1, '2026-07-18');
    expect(findMany.mock.calls[0][0].where.status).toBe('arriving');
    expect(ranked.map((r) => r.booking_id)).toEqual([31, 30]);
  });

  it('persists queue_position in a transaction and notifies the top of the queue', async () => {
    const candidates = [
      {
        id: 10,
        booking_number: 'BKG-1',
        customer_id: 100,
        provider_id: null,
        // 05:00 Bogota (UTC-5) = 10:00Z
        date: new Date('2026-07-18T00:00:00Z'),
        end_date: null,
        start_time: '05:00',
        end_time: '06:00',
        arrival_at: new Date('2026-07-18T09:55:00Z'),
        priority: 0,
      },
      {
        id: 11,
        booking_number: 'BKG-2',
        customer_id: 101,
        provider_id: null,
        // 05:00 Bogota (UTC-5) = 10:00Z
        date: new Date('2026-07-18T00:00:00Z'),
        end_date: null,
        start_time: '05:00',
        end_time: '06:00',
        arrival_at: new Date('2026-07-18T09:30:00Z'),
        priority: 0,
      },
    ];
    const { service, update, updateMany, transaction, notifications } = buildService(
      candidates,
      { transactions: true },
    );

    const result = await service.refreshAndBroadcastQueue(1, '2026-07-18');

    expect(transaction).toHaveBeenCalledTimes(1);
    // Two update calls (one per booking).
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: { queue_position: 0 },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: { queue_position: 1 },
      }),
    );
    // Top of queue notified with appointment_queued.
    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
      1,
      'appointment_queued',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ booking_id: 10, queue_position: 0 }),
    );
    // Las posiciones de quien ya no está en la cola del día se limpian.
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        store_id: 1,
        date: new Date('2026-07-18T00:00:00.000Z'),
        queue_position: { not: null },
        id: { notIn: [10, 11] },
      },
      data: { queue_position: null },
    });
    expect(result).toEqual({ updated: 2, promoted: 10 });
  });

  it('no repite el aviso si el primero ya estaba en la posición 0', async () => {
    const candidate = {
      id: 10,
      booking_number: 'BKG-1',
      customer_id: 100,
      provider_id: null,
      date: new Date('2026-07-18T00:00:00Z'),
      end_date: null,
      start_time: '05:00',
      end_time: '06:00',
      arrival_at: new Date('2026-07-18T09:55:00Z'),
      priority: 0,
    };
    const { service, findFirst, notifications } = buildService([candidate]);
    findFirst.mockResolvedValue({ queue_position: 0 });
    await service.refreshAndBroadcastQueue(1, '2026-07-18');
    // Consulta la posición previa del que quedaría primero, no la de otro.
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { queue_position: true },
    });
    expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('swallows notification errors so the queue refresh never crashes the listener', async () => {
    const candidates = [
      {
        id: 10,
        booking_number: 'BKG-1',
        customer_id: 100,
        provider_id: null,
        // 05:00 Bogota (UTC-5) = 10:00Z
        date: new Date('2026-07-18T00:00:00Z'),
        end_date: null,
        start_time: '05:00',
        end_time: '06:00',
        arrival_at: new Date('2026-07-18T09:55:00Z'),
        priority: 0,
      },
    ];
    const { service, notifications } = buildService(candidates);
    notifications.createAndBroadcast.mockRejectedValue(new Error('boom'));
    await expect(service.refreshAndBroadcastQueue(1, '2026-07-18')).resolves.toEqual({
      updated: 1,
      promoted: 10,
    });
  });
});