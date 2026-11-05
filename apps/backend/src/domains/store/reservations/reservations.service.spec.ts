import { ReservationsService } from './reservations.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Smoke tests covering the appointment-design state-machine additions:
 * markArriving / markAttending + the checkIn re-write.
 *
 * Mocks the StorePrismaService and EventEmitter2 by hand so we exercise
 * the public service API without touching the DB.
 */
// Default context for the create() tests below. RequestContextService is
// mocked statically — production code reads user_id from this context, not
// from a 2nd argument on create(). The original spec passed a 2nd argument
// which caused TS2554 arity errors at compile time.
(RequestContextService.getContext as jest.Mock) = jest.fn().mockReturnValue({
  user_id: 1,
  store_id: 1,
  organization_id: 1,
});

describe('ReservationsService — state machine (appointments redesign)', () => {
  function buildService() {
    const bookings: any[] = [];
    const prisma: any = {
      bookings: {
        findUnique: jest.fn(({ where }: any) => {
          const found = bookings.find((b) => b.id === where.id);
          return Promise.resolve(found ? { ...found } : null);
        }),
        findFirst: jest.fn(({ where }: any) => {
          const found = bookings.find((b) => b.id === where.id);
          return Promise.resolve(found ? { ...found } : null);
        }),
        findMany: jest.fn(),
        update: jest.fn(({ where, data }: any) => {
          const target = bookings.find((b) => b.id === where.id);
          if (!target) throw new Error('not found');
          Object.assign(target, data);
          return Promise.resolve({ ...target });
        }),
        create: jest.fn(),
      },
      products: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const emits: any[] = [];
    const eventEmitter: any = {
      emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })),
    };
    const availabilityService = {} as any;
    const ordersService = {} as any;
    const s3Service = { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any;
    const priceResolverService = {} as any;
    const tablesService = {} as any;
    const tableSessionsService = {} as any;
    // Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
    const orderHistory = { record: jest.fn().mockResolvedValue(null) } as any;

    const service = new ReservationsService(
      prisma,
      availabilityService,
      ordersService,
      s3Service,
      eventEmitter,
      priceResolverService,
      tablesService,
      tableSessionsService,
      orderHistory,
    );

    return { service, prisma, bookings, eventEmitter, emits, orderHistory };
  }

  it('markArriving only allows confirmed → arriving', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'confirmed' });
    await service.markArriving(1);
    expect(bookings[0].status).toBe('arriving');
  });

  it('markArriving rejects pending → arriving (must pass through confirmed first)', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'pending' });
    await expect(service.markArriving(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markAttending only allows arriving → attending', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'arriving' });
    await service.markAttending(1);
    expect(bookings[0].status).toBe('attending');
  });

  it('markAttending rejects confirmed → attending (must go through arriving)', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'confirmed' });
    await expect(service.markAttending(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checkIn from confirmed writes arrival_at, trans to arriving, and emits both events', async () => {
    const { service, bookings, emits } = buildService();
    bookings.push({
      id: 1,
      status: 'confirmed',
      booking_number: 'BKG-1',
      customer: { first_name: 'Juan', last_name: 'Pérez' },
      product: { name: 'Corte' },
      provider: { id: 7 },
      date: new Date('2026-07-18T00:00:00Z'),
    });
    const result = await service.checkIn(1, 'customer');
    expect(result.arrival_at).toBeInstanceOf(Date);
    expect(result.status).toBe('arriving');
    expect(emits.map((e) => e.name).sort()).toEqual([
      'booking.arrival_recorded',
      'booking.checked_in',
    ]);
  });

  it('checkIn from arriving is idempotent (does not re-emit arrival_recorded)', async () => {
    const { service, bookings, emits } = buildService();
    const prevArrival = new Date();
    bookings.push({
      id: 1,
      status: 'arriving',
      booking_number: 'BKG-1',
      arrival_at: prevArrival,
      checked_in_at: prevArrival,
      customer: { first_name: 'A', last_name: 'B' },
      product: { name: 'S' },
      date: new Date('2026-07-18T00:00:00Z'),
    });
    await service.checkIn(1, 'customer');
    // arrival_recorded must NOT be re-emitted on idempotent calls.
    expect(emits.find((e) => e.name === 'booking.arrival_recorded')).toBeUndefined();
  });

  it('checkIn rejects when status is pending', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'pending', customer: {}, product: {}, date: new Date() });
    await expect(service.checkIn(1, 'staff')).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * QUI-649 — the reservation+order creation invariant: a reservation that
 * does not pass `order_id` nor `skip_order_creation` MUST end up linked to
 * a freshly-created order. The two tests below pin the behaviour so a
 * future refactor cannot silently re-introduce the orphan-reservation bug.
 *
 * These tests mock the lower layer (Prisma transaction, OrdersService) by
 * hand, following the same pattern as the state-machine suite above.
 */
describe('ReservationsService — create (QUI-649 atomicity)', () => {
  /**
   * Build a service instance with hand-rolled mocks for the create flow.
   * The transaction callback is executed synchronously by the mocked
   * `prisma.$transaction` so we can assert on its return value. If the
   * callback throws, the in-memory `bookings` array is left empty, which
   * is the visible equivalent of a Prisma rollback.
   */
  function buildServiceForCreate() {
    const bookings: any[] = [];
    const products: any[] = [
      {
        id: 100,
        name: 'Corte de cabello',
        base_price: '25000.00',
        is_on_sale: false,
        sale_price: null,
        track_inventory: false,
        requires_booking: true,
        booking_mode: 'slot',
      },
    ];
    const customers: any[] = [{ id: 1, first_name: 'Lola', last_name: 'Pérez' }];
    const providers: any[] = [];

    const txBookings: any[] = [];

    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => {
        // Run the callback with a `tx` proxy that re-uses the same prisma
        // methods. When the callback throws, we leave `txBookings` empty
        // — that's how we simulate a rollback without a real DB.
        const txProxy = {
          bookings: {
            create: jest.fn(({ data }: any) => {
              const created = {
                id: 999,
                ...data,
                status: 'confirmed',
                product: products.find((p) => p.id === data.product_id) ?? { name: 'Corte de cabello' },
                customer: customers.find((c) => c.id === data.customer_id) ?? { first_name: 'Lola', last_name: 'Pérez' },
              };
              txBookings.push(created);
              bookings.push({ ...created });
              return Promise.resolve(created);
            }),
            update: jest.fn(({ where, data }: any) => {
              const target = bookings.find((b) => b.id === where.id);
              if (!target) throw new Error('not found');
              Object.assign(target, data);
              return Promise.resolve(target);
            }),
            findFirst: jest.fn(({ where }: any = {}) => {
              const found = bookings.find((b) => b.id === (where?.id ?? 999));
              return Promise.resolve(found ? { ...found } : null);
            }),
            findUnique: jest.fn(({ where }: any = {}) => {
              const found = bookings.find((b) => b.id === (where?.id ?? 999));
              return Promise.resolve(found ? { ...found } : null);
            }),
          },
        };
        return callback(txProxy);
      }),
      bookings: {
        create: jest.fn(({ data }: any) => {
          const created = {
            id: 999,
            ...data,
            status: 'confirmed',
            product: products.find((p) => p.id === data.product_id) ?? { name: 'Corte de cabello' },
            customer: customers.find((c) => c.id === data.customer_id) ?? { first_name: 'Lola', last_name: 'Pérez' },
          };
          bookings.push(created);
          return Promise.resolve(created);
        }),
        update: jest.fn(({ where, data }: any) => {
          const target = bookings.find((b) => b.id === where.id);
          if (!target) throw new Error('not found');
          Object.assign(target, data);
          return Promise.resolve(target);
        }),
        findFirst: jest.fn(({ where }: any = {}) => {
          const found = bookings.find((b) => b.id === (where?.id ?? 999));
          return Promise.resolve(found ? { ...found } : null);
        }),
        findUnique: jest.fn(({ where }: any = {}) => {
          const found = bookings.find((b) => b.id === (where?.id ?? 999));
          return Promise.resolve(found ? { ...found } : null);
        }),
      },
      products: {
        findFirst: jest.fn(({ where }: any) => {
          // Honor deletedAt filter: the real service passes a where
          // clause that includes `deletedAt: null`.
          return Promise.resolve(
            products.find((p) => p.id === where.id) ?? null,
          );
        }),
      },
      users: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(customers.find((c) => c.id === where.id) ?? null),
        ),
      },
      providers: {
        findFirst: jest.fn(() =>
          Promise.resolve(providers[0] ?? null),
        ),
      },
      provider_schedules: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      provider_exceptions: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      store_schedules: {
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      bookings_business_hours: {
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      // The auto-create-order path runs `this.prisma.tables.updateMany` to
      // mark the table as reserved when `dto.table_id` is set. We don't
      // pass table_id in these tests, but the prisma client is still
      // accessed for the `bookings.update` that re-loads with the
      // BOOKING_INCLUDE.
      tables: {
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };

    const emits: any[] = [];
    const eventEmitter: any = {
      emit: jest.fn((name: string, payload: any) =>
        emits.push({ name, payload }),
      ),
    };

    // Mock OrdersService.create to return a synthetic order. Tests that
    // want the order creation to FAIL pass a different mock.
    let orderCreateImpl: any = jest.fn(() =>
      Promise.resolve({
        id: 555,
        order_number: 'ORD-TEST-1',
      }),
    );
    const ordersService: any = {
      create: jest.fn((...args: any[]) => orderCreateImpl(...args)),
    };

    const availabilityService = {
      isSlotAvailable: jest.fn(() => Promise.resolve(true)),
      validateNoOverlapForCustomer: jest.fn(() => Promise.resolve(true)),
      validateSlotAvailability: jest.fn(() => Promise.resolve(true)),
    } as any;

    const s3Service = {
      signUrl: jest.fn((u: string) => Promise.resolve(u)),
    } as any;

    const priceResolverService = {
      resolvePrice: jest.fn(() => ({
        unitPrice: 25000,
        finalPrice: 25000,
      })),
    } as any;

    const tablesService = {} as any;
    const tableSessionsService = {} as any;
    // Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
    const orderHistory = { record: jest.fn().mockResolvedValue(null) } as any;

    const service = new ReservationsService(
      prisma,
      availabilityService,
      ordersService,
      s3Service,
      eventEmitter,
      priceResolverService,
      tablesService,
      tableSessionsService,
      orderHistory,
    );

    return {
      service,
      prisma,
      bookings,
      txBookings,
      products,
      customers,
      ordersService,
      eventEmitter,
      emits,
      orderHistory,
      setOrderCreateImpl: (impl: any) => {
        orderCreateImpl = impl;
      },
    };
  }

  /**
   * Minimal DTO shape that the create() method accepts. We only pass the
   * fields the new tests need; the rest of the DTO is optional in the
   * service signature (with `?` markers in TS).
   */
  const baseDto: any = {
    customer_id: 1,
    product_id: 100,
    date: '2026-09-01',
    start_time: '10:00',
    end_time: '11:00',
    channel: 'pos' as const,
  };

  it('QUI-649: a POS reservation without order_id nor skip_order_creation auto-creates the linked order', async () => {
    const ctx = buildServiceForCreate();
    const result = await ctx.service.create(baseDto);

    // The reservation was persisted.
    expect(ctx.bookings.length).toBe(1);
    const created = ctx.bookings[0];
    expect(created.customer_id).toBe(1);
    expect(created.product_id).toBe(100);

    // The auto-create path fired.
    expect(ctx.ordersService.create).toHaveBeenCalledTimes(1);
    const orderCallArgs = ctx.ordersService.create.mock.calls[0];
    expect(orderCallArgs[0].customer_id).toBe(1);
    expect(orderCallArgs[0].items[0].product_id).toBe(100);
    expect(orderCallArgs[1]).toBe(1); // creatingUser

    // The order_id was persisted back onto the booking — this is the
    // invariant the ticket is about.
    expect(created.order_id).toBe(555);

    // The booking.event fired with channel=pos.
    const createdEmits = ctx.emits.filter((e) => e.name === 'booking.created');
    expect(createdEmits).toHaveLength(1);
    expect(createdEmits[0].payload.channel).toBe('pos');
  });

  it('QUI-649: skip_order_creation=true disables the auto-link (legacy callers)', async () => {
    const ctx = buildServiceForCreate();
    const result = await ctx.service.create(
      { ...baseDto, skip_order_creation: true },
    );

    expect(ctx.bookings.length).toBe(1);
    expect(ctx.ordersService.create).not.toHaveBeenCalled();
    expect(ctx.bookings[0].order_id).toBeNull();
  });

  it('QUI-649: a passed order_id attaches the reservation to that order, not a new one', async () => {
    const ctx = buildServiceForCreate();
    await ctx.service.create(
      { ...baseDto, order_id: 777 },
    );

    expect(ctx.bookings.length).toBe(1);
    expect(ctx.ordersService.create).not.toHaveBeenCalled();
    // The order_id is set on the booking, but in a real DB the caller
    // would have to assert the link themselves; the auto-link is skipped
    // because the caller provided their own order_id.
  });

  it('S21: a booking that crosses midnight is stored with end_date = D+1', async () => {
    const ctx = buildServiceForCreate();
    await ctx.service.create({ ...baseDto, start_time: '23:00', end_time: '01:00' });

    expect(ctx.bookings[0].end_time).toBe('01:00');
    expect(ctx.bookings[0].end_date).toEqual(new Date('2026-09-02'));
    expect(ctx.bookings[0].is_open_ended).toBe(false);
  });

  it('S21: a daytime booking keeps end_date null', async () => {
    const ctx = buildServiceForCreate();
    await ctx.service.create(baseDto);

    expect(ctx.bookings[0].end_date).toBeNull();
  });

  it('S21: an open-ended booking on a service without station is rejected', async () => {
    const ctx = buildServiceForCreate();
    await expect(
      ctx.service.create({ ...baseDto, end_time: undefined, is_open_ended: true }),
    ).rejects.toThrow(/sin hora de fin/);
    expect(ctx.bookings.length).toBe(0);
  });

  it('QUI-649: when ordersService.create throws, the reservation is NOT persisted (atomicity)', async () => {
    const ctx = buildServiceForCreate();
    ctx.setOrderCreateImpl(() =>
      Promise.reject(new Error('inventory short for variant X')),
    );

    await expect(
      ctx.service.create(baseDto),
    ).rejects.toThrow(/inventory short/);

    // The reservation was rolled back: nothing in the in-memory store.
    expect(ctx.bookings.length).toBe(0);
    expect(ctx.ordersService.create).toHaveBeenCalledTimes(1);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  /**
   * Hotfix post-PR-576: el plan invierte el orden — la orden se crea
   * ANTES de la transacción (autocommit). Si la transacción falla, la
   * compensación cancela la orden vía OrdersService.update. Esta guarda
   * afirma el invariante "reserva y orden nacen juntas o no nacen" en
   * la dirección contraria del original.
   */
  it('hotfix 576: when the booking tx fails, the pre-created order is cancelled (compensation)', async () => {
    const ctx = buildServiceForCreate();
    // Make $transaction throw AFTER ordersService.create returns successfully.
    ctx.prisma.$transaction = jest.fn(() =>
      Promise.reject(new ConflictException('slot no longer available')),
    );

    const updateSpy = jest.fn(() => Promise.resolve({ id: 555, state: 'cancelled' }));
    ctx.ordersService.update = updateSpy;

    await expect(ctx.service.create(baseDto)).rejects.toThrow(/slot no longer/);

    // The order was created (autocommit succeeded).
    expect(ctx.ordersService.create).toHaveBeenCalledTimes(1);
    // The compensation cancelled the order via update.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(555, expect.objectContaining({ state: 'cancelled' }));
    // No booking persisted.
    expect(ctx.bookings.length).toBe(0);
  });

  it('rechaza reservar un Insumo: 422 PROD_NATURE_NOT_SELLABLE, sin orden ni reserva', async () => {
    const ctx = buildServiceForCreate();
    ctx.products[0].usage_nature = 'supply';

    await expect(ctx.service.create(baseDto)).rejects.toMatchObject({
      errorCode: 'PROD_NATURE_NOT_SELLABLE',
    });
    expect(ctx.ordersService.create).not.toHaveBeenCalled();
    expect(ctx.bookings.length).toBe(0);
  });

  it('acepta reservar un producto de Venta', async () => {
    const ctx = buildServiceForCreate();
    ctx.products[0].usage_nature = 'sale';

    await ctx.service.create(baseDto);

    expect(ctx.bookings.length).toBe(1);
    expect(ctx.bookings[0].product_id).toBe(100);
  });
});
describe('ReservationsService.confirmHold — hold expirado', () => {
  function build(requires_station: boolean) {
    const expired = {
      id: 7,
      store_id: 1,
      product_id: 3,
      status: 'pending',
      expires_at: new Date(Date.now() - 60_000),
    };
    const prisma: any = {
      bookings: {
        findFirst: jest.fn().mockResolvedValue({ ...expired }),
        delete: jest.fn().mockResolvedValue(expired),
        update: jest.fn().mockResolvedValue(expired),
      },
      products: {
        findFirst: jest.fn().mockResolvedValue({ requires_station }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const coordinator: any = { releaseBooking: jest.fn().mockResolvedValue(undefined) };
    const service = new ReservationsService(
      prisma,
      {} as any,
      {} as any,
      { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      coordinator,
    );
    return { service, prisma, coordinator };
  }

  it('producto sin estación: elimina la reserva y lanza BadRequest', async () => {
    const { service, prisma, coordinator } = build(false);
    await expect(service.confirmHold(7)).rejects.toThrow(BadRequestException);
    await expect(service.confirmHold(7)).rejects.toThrow(
      'La reserva temporal ha expirado. Por favor selecciona un horario nuevamente.',
    );
    expect(prisma.bookings.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(prisma.bookings.update).not.toHaveBeenCalled();
    expect(coordinator.releaseBooking).not.toHaveBeenCalled();
  });

  it('producto con estación: libera la asignación, cancela y lanza STATION_011', async () => {
    const { service, prisma, coordinator } = build(true);
    await expect(service.confirmHold(7)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_011' }),
    });
    expect(coordinator.releaseBooking).toHaveBeenCalled();
    expect(prisma.bookings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    );
    expect(prisma.bookings.delete).not.toHaveBeenCalled();
  });
});

describe('ReservationsService.hold — provider_id del técnico', () => {
  function build(providerAssignment: { id: number } | null) {
    const prisma: any = {
      products: {
        findFirst: jest.fn().mockResolvedValue({
          id: 3,
          name: 'Corte',
          requires_booking: true,
          requires_station: false,
          booking_mode: 'free_booking',
        }),
      },
      provider_services: {
        findFirst: jest.fn().mockResolvedValue(providerAssignment),
      },
      bookings: {
        create: jest.fn().mockResolvedValue({ id: 11 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const service = new ReservationsService(
      prisma,
      {} as any,
      {} as any,
      { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'generateBookingNumber').mockResolvedValue('BK-1');
    jest.spyOn(service as any, 'mapBooking').mockImplementation(async (b: any) => b);
    return { service, prisma };
  }

  const dto = {
    customer_id: 1,
    product_id: 3,
    date: '2026-11-02',
    start_time: '09:00',
    end_time: '09:30',
    provider_id: 99,
  };

  it('rechaza un técnico que no es de la tienda (u otro servicio / inactivo) y no crea la reserva', async () => {
    const { service, prisma } = build(null);
    await expect(service.hold(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.provider_services.findFirst).toHaveBeenCalledWith({
      where: {
        provider_id: 99,
        product_id: 3,
        provider: { store_id: 1, is_active: true },
      },
      select: { id: true },
    });
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('guarda el técnico cuando es de la tienda y ofrece el servicio', async () => {
    const { service, prisma } = build({ id: 5 });
    await service.hold(dto);
    expect(prisma.bookings.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider_id: 99, store_id: 1 }) }),
    );
  });
});

/**
 * QUI-972 — reschedule may move the booking to another professional
 * (e.g. the current one has no schedule configured). The new provider
 * must offer the service and be active; availability is validated
 * against the target provider.
 */
describe('ReservationsService.reschedule — provider change (QUI-972)', () => {
  function build(opts: { assignment?: any; slotAvailable?: boolean } = {}) {
    const bookings: any[] = [
      {
        id: 7,
        store_id: 1,
        product_id: 10,
        provider_id: 1,
        customer_id: 3,
        status: 'pending',
        date: new Date('2026-11-02T00:00:00Z'),
        start_time: '08:00',
        end_time: '08:30',
        product: { name: 'Corte' },
        customer: { first_name: 'Ana', last_name: 'Ruiz' },
      },
    ];
    const prisma: any = {
      bookings: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(bookings.find((b) => b.id === where.id) ?? null),
        ),
        update: jest.fn(({ where, data }: any) => {
          const target = bookings.find((b) => b.id === where.id);
          Object.assign(target, data);
          return Promise.resolve({ ...target });
        }),
      },
      products: {
        findFirst: jest.fn().mockResolvedValue({ requires_station: false }),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      provider_services: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'assignment' in opts
              ? opts.assignment
              : { provider: { id: 2, is_active: true } },
          ),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const availabilityService: any = {
      isSlotAvailable: jest
        .fn()
        .mockResolvedValue(opts.slotAvailable ?? true),
      validateNoOverlapForCustomer: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ReservationsService(
      prisma,
      availabilityService,
      {} as any,
      { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { record: jest.fn().mockResolvedValue(null) } as any,
    );
    return { service, prisma, bookings, availabilityService };
  }

  const dto = { date: '2026-11-03', start_time: '09:00', end_time: '09:30' };

  it('keeps the provider when dto has no provider_id', async () => {
    const { service, prisma, availabilityService } = build();
    await service.reschedule(7, dto as any);
    expect(prisma.bookings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ provider_id: expect.anything() }),
      }),
    );
    expect(availabilityService.isSlotAvailable).toHaveBeenCalledWith(
      10,
      '2026-11-03',
      '09:00',
      '09:30',
      1,
      7,
    );
  });

  it('moves the booking to another active provider offering the service', async () => {
    const { service, prisma, availabilityService } = build();
    const result = await service.reschedule(7, { ...dto, provider_id: 2 } as any);
    expect(prisma.bookings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider_id: 2 }),
      }),
    );
    expect(availabilityService.isSlotAvailable).toHaveBeenCalledWith(
      10,
      '2026-11-03',
      '09:00',
      '09:30',
      2,
      7,
    );
    expect(result.provider_id).toBe(2);
  });

  it.each([
    ['not offering the service', null],
    ['inactive', { provider: { id: 2, is_active: false } }],
  ])('rejects with 400 when the provider is %s', async (_label, assignment) => {
    const { service, prisma } = build({ assignment });
    await expect(
      service.reschedule(7, { ...dto, provider_id: 2 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bookings.update).not.toHaveBeenCalled();
  });

  it('propagates slot conflicts for the target provider', async () => {
    const { service } = build({ slotAvailable: false });
    await expect(
      service.reschedule(7, { ...dto, provider_id: 2 } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ReservationsService.getCalendar — overnight bookings (S21 / A14)', () => {
  const build = (rows: any[]) => {
    const prisma: any = { bookings: { findMany: jest.fn().mockResolvedValue(rows) } };
    const service = new ReservationsService(
      prisma,
      {} as any,
      {} as any,
      { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  };
  const query = { date_from: '2026-03-06', date_to: '2026-03-07' } as any;

  it('lists an overnight booking under its start day and its end day', async () => {
    const { service, prisma } = build([
      { id: 1, date: new Date('2026-03-06'), end_date: new Date('2026-03-07'), start_time: '23:00', end_time: '01:00' },
    ]);
    const grouped = await service.getCalendar(query);

    expect(grouped['2026-03-06'].map((b: any) => b.id)).toEqual([1]);
    expect(grouped['2026-03-07'].map((b: any) => b.id)).toEqual([1]);
    expect(prisma.bookings.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
  });

  it('keeps a daytime booking on a single day', async () => {
    const { service } = build([
      { id: 2, date: new Date('2026-03-06'), end_date: null, start_time: '10:00', end_time: '11:00' },
    ]);
    const grouped = await service.getCalendar(query);

    expect(Object.keys(grouped)).toEqual(['2026-03-06']);
  });

  it('does not list a booking under an end day outside the requested range', async () => {
    const { service } = build([
      { id: 3, date: new Date('2026-03-07'), end_date: new Date('2026-03-08'), start_time: '23:00', end_time: '01:00' },
    ]);
    const grouped = await service.getCalendar(query);

    expect(Object.keys(grouped)).toEqual(['2026-03-07']);
  });
});

/**
 * Station deposits (S3, S15, S17, A1, A12). The deposits collaborator is a hand-made
 * double: its own rules live in reservation-deposits.service.spec.ts. Every touched
 * method also proves that a booking without a deposit behaves as before.
 */
describe('ReservationsService — station deposits', () => {
  const stationProduct = {
    id: 100,
    name: 'Cava 3',
    requires_booking: true,
    requires_station: true,
    booking_mode: 'free_booking',
    base_price: '400000',
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
    usage_nature: 'sale',
    is_ingredient: false,
    is_sellable: true,
    service_duration_minutes: 60,
  };

  function build(options: { product?: any; deposits?: any; booking?: any } = {}) {
    const row: any = {
      id: 77,
      store_id: 1,
      customer_id: 1,
      product_id: 100,
      status: 'pending',
      order_id: 555,
      booking_number: 'BKG-1',
      deposit_decision_due_at: null,
      customer: { first_name: 'Lola', last_name: 'Pérez' },
      product: { name: 'Cava 3' },
      ...options.booking,
    };
    const prisma: any = {
      products: { findFirst: jest.fn().mockResolvedValue(options.product ?? stationProduct) },
      bookings: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(where?.booking_number ? null : { ...row })),
        create: jest.fn(({ data }: any) => Promise.resolve({ ...row, ...data })),
        update: jest.fn(({ data }: any) => {
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        }),
      },
      service_allocations: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tables: { updateMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const coordinator: any = {
      allocateBooking: jest.fn().mockResolvedValue({ id: 1, station_id: 5 }),
      releaseBooking: jest.fn().mockResolvedValue(undefined),
    };
    const deposits: any = {
      startInTx: jest.fn().mockResolvedValue(null),
      startHoldInTx: jest.fn().mockResolvedValue(null),
      announceDeposit: jest.fn(),
      summary: jest.fn().mockResolvedValue(null),
      paymentPath: jest.fn((token: string) => `/pagar/${token}`),
      cancelWithDeposit: jest.fn().mockResolvedValue(null),
      deferNoShowIfDeposit: jest.fn().mockResolvedValue(false),
      decide: jest.fn().mockResolvedValue({ action: 'retain' }),
      ...options.deposits,
    };
    const emits: any[] = [];
    const ordersService: any = { create: jest.fn().mockResolvedValue({ id: 555 }) };
    const service = new ReservationsService(
      prisma,
      { isSlotAvailable: jest.fn().mockResolvedValue(true), validateNoOverlapForCustomer: jest.fn() } as any,
      ordersService,
      { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
      { emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })) } as any,
      { resolvePrice: jest.fn(() => ({ unitPrice: 400000 })) } as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      coordinator,
      deposits,
    );
    jest.spyOn(service as any, 'generateBookingNumber').mockResolvedValue('BKG-1');
    return { service, prisma, coordinator, deposits, emits, row, ordersService };
  }

  const createDto: any = {
    customer_id: 1,
    product_id: 100,
    station_id: 5,
    date: '2099-09-01',
    start_time: '10:00',
    end_time: '11:00',
    channel: 'pos',
  };
  const deposit = { amount: 400000, mode: 'link', request_id: 'req-1' };

  it('create: a station booking with a deposit hands the allocated station to the deposits service and answers payment_path', async () => {
    const started = { mode: 'link', publicToken: 'tok', event: null };
    const { service, deposits } = build({
      deposits: {
        startInTx: jest.fn().mockResolvedValue(started),
        summary: jest.fn().mockResolvedValue({ required: 400000, received: 0, balance: 0 }),
      },
    });
    const result: any = await service.create({ ...createDto, deposit });
    expect(deposits.startInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stationId: 5, bookingId: 77, customerId: 1, deposit }),
    );
    expect(deposits.announceDeposit).toHaveBeenCalledWith(started);
    expect(result.payment_path).toBe('/pagar/tok');
    expect(result.deposit).toEqual({ required: 400000, received: 0, balance: 0 });
  });

  it('create: a desk deposit answers no payment_path', async () => {
    const started = { mode: 'desk', publicToken: null, event: { deposit_id: 1 } };
    const { service } = build({ deposits: { startInTx: jest.fn().mockResolvedValue(started) } });
    const result: any = await service.create({ ...createDto, deposit: { ...deposit, mode: 'desk' } });
    expect(result.payment_path).toBeNull();
  });

  it('create: a station booking without deposit behaves as before (no payment_path, no deposit block)', async () => {
    const { service, deposits } = build();
    const result: any = await service.create(createDto);
    expect(result.id).toBe(77);
    expect(result.payment_path).toBeUndefined();
    expect(result.deposit).toBeUndefined();
    expect(deposits.startInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deposit: undefined }));
  });

  it('create: a deposit on a service without station is rejected with STATION_BOOKING_002', async () => {
    const { service, prisma } = build({ product: { ...stationProduct, requires_station: false } });
    await expect(service.create({ ...createDto, deposit })).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_BOOKING_002' }),
    });
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('hold: a station that requires a deposit holds payment_pending and answers payment_path and the new expiry', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const { service, deposits } = build({
      deposits: { startHoldInTx: jest.fn().mockResolvedValue({ publicToken: 'hold-tok', expiresAt, amount: 400000 }) },
    });
    const result: any = await service.hold({
      customer_id: 1,
      product_id: 100,
      date: '2099-09-01',
      start_time: '10:00',
      end_time: '11:00',
      station_id: 5,
    });
    expect(deposits.startHoldInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stationId: 5, customerId: 1 }),
    );
    expect(result.payment_path).toBe('/pagar/hold-tok');
    expect(result.expires_at).toBe(expiresAt);
  });

  it('hold: a station without a mandatory deposit keeps the plain 15 minute hold', async () => {
    const { service } = build();
    const result: any = await service.hold({
      customer_id: 1,
      product_id: 100,
      date: '2099-09-01',
      start_time: '10:00',
      end_time: '11:00',
      station_id: 5,
    });
    expect(result.payment_path).toBeUndefined();
    expect(result.deposit).toBeUndefined();
  });

  it('confirmHold: a hold waiting for its deposit is refused (the payment confirms it)', async () => {
    const { service, prisma } = build({ booking: { expires_at: new Date(Date.now() + 600_000) } });
    prisma.service_allocations.findFirst.mockResolvedValue({ id: 3 });
    await expect(service.confirmHold(77)).rejects.toMatchObject({
      response: expect.objectContaining({
        error_code: 'STATION_011',
        message: expect.stringContaining('espera el pago del anticipo'),
      }),
    });
    expect(prisma.service_allocations.update).not.toHaveBeenCalled();
  });

  it('confirmHold: a plain held allocation is still confirmed as before', async () => {
    const { service, prisma } = build({ booking: { expires_at: new Date(Date.now() + 600_000) } });
    prisma.service_allocations.findFirst
      .mockResolvedValueOnce(null) // no payment_pending waiting
      .mockResolvedValueOnce({ id: 3 }); // the held allocation
    await service.confirmHold(77);
    expect(prisma.service_allocations.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ state: 'confirmed', expires_at: null }),
    });
  });

  it('cancel: without a deposit the booking is cancelled by the state machine as always', async () => {
    const { service, prisma, deposits, emits } = build();
    const result = await service.cancel(77);
    expect(deposits.cancelWithDeposit).toHaveBeenCalledWith(77, {});
    expect(result.status).toBe('cancelled');
    expect(prisma.bookings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    );
    expect(emits.map((e) => e.name)).toContain('booking.cancelled');
  });

  it('cancel: with a deposit already settled by the deposits service no second transition runs', async () => {
    const { service, prisma, deposits, emits, row } = build();
    deposits.cancelWithDeposit.mockImplementation(async () => {
      row.status = 'cancelled';
      return { closed: true };
    });
    const result = await service.cancel(77, { leftover_action: 'refund' });
    expect(deposits.cancelWithDeposit).toHaveBeenCalledWith(77, { leftover_action: 'refund' });
    expect(result.status).toBe('cancelled');
    expect(prisma.bookings.update).not.toHaveBeenCalled();
    expect(emits.map((e) => e.name)).toContain('booking.cancelled');
  });

  it('noShow: a booking with a deposit balance stays as is and no event goes out', async () => {
    const { service, prisma, deposits, emits } = build({ booking: { status: 'confirmed' } });
    deposits.deferNoShowIfDeposit.mockResolvedValue(true);
    const result: any = await service.noShow(77);
    expect(result.status).toBe('confirmed');
    expect(prisma.bookings.update).not.toHaveBeenCalled();
    expect(emits.find((e) => e.name === 'booking.no_show')).toBeUndefined();
  });

  it('noShow: without a deposit it marks no_show and emits the event as before', async () => {
    const { service, emits } = build({ booking: { status: 'confirmed' } });
    const result: any = await service.noShow(77);
    expect(result.status).toBe('no_show');
    expect(emits.map((e) => e.name)).toContain('booking.no_show');
  });

  it('archiveToNoShow: a deposit balance defers it, otherwise it archives', async () => {
    const deferred = build({ booking: { status: 'confirmed' } });
    deferred.deposits.deferNoShowIfDeposit.mockResolvedValue(true);
    await expect(deferred.service.archiveToNoShow(77)).resolves.toBe('deferred');
    expect(deferred.prisma.bookings.update).not.toHaveBeenCalled();

    const plain = build({ booking: { status: 'confirmed' } });
    await expect(plain.service.archiveToNoShow(77)).resolves.toBe('archived');
    expect(plain.row.status).toBe('no_show');
  });

  it('confirm: a pending booking promotes its payment_pending allocation, an unexpired hold only', async () => {
    const { service, prisma } = build();
    prisma.service_allocations.findFirst.mockResolvedValue(null);
    await service.confirm(77);
    expect(prisma.service_allocations.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ state: 'payment_pending', expires_at: { gt: expect.any(Date) } }),
      data: expect.objectContaining({ state: 'confirmed', expires_at: null }),
    });
  });

  it('confirm: without the deposits service nothing is promoted (as before)', async () => {
    const { service, prisma, coordinator } = build();
    const bare = new ReservationsService(
      prisma,
      {} as any,
      {} as any,
      { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      coordinator,
    );
    await bare.confirm(77);
    expect(prisma.service_allocations.updateMany).not.toHaveBeenCalled();
  });

  it('findOneDetail: adds the deposit block with the decision deadline', async () => {
    const due = new Date('2099-01-01T00:00:00Z');
    const block = { required: 400000, received: 400000, balance: 400000 };
    const { service, deposits } = build({
      booking: { deposit_decision_due_at: due },
      deposits: { summary: jest.fn().mockResolvedValue(block) },
    });
    const detail: any = await service.findOneDetail(77);
    expect(deposits.summary).toHaveBeenCalledWith(77, due);
    expect(detail.deposit).toBe(block);
  });

  it('decideDeposit: retain, refund and credit go to the deposits service and answer the detail', async () => {
    const { service, deposits } = build({ booking: { status: 'confirmed' } });
    const dto = { action: 'retain' as const, request_id: 'd1' };
    const detail: any = await service.decideDeposit(77, dto);
    expect(deposits.decide).toHaveBeenCalledWith(77, dto);
    expect(detail.id).toBe(77);
  });

  it('decideDeposit reschedule: asks for the new date and times', async () => {
    const { service } = build({ booking: { status: 'confirmed' } });
    await expect(service.decideDeposit(77, { action: 'reschedule', request_id: 'd2' })).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'STATION_BOOKING_009' }),
    });
  });

  it('decideDeposit reschedule: moves the booking keeping the deposit and clears the decision deadline', async () => {
    const { service, deposits, prisma } = build({
      booking: { status: 'confirmed', deposit_decision_due_at: new Date() },
      deposits: { summary: jest.fn().mockResolvedValue({ balance: 400000 }) },
    });
    const move = jest.spyOn(service as any, 'rescheduleDirectPath').mockResolvedValue({});
    await service.decideDeposit(77, {
      action: 'reschedule',
      request_id: 'd3',
      new_date: '2099-09-08',
      new_start_time: '10:00',
      new_end_time: '11:00',
    });
    expect(move).toHaveBeenCalledWith(77, expect.objectContaining({ id: 77 }), {
      date: '2099-09-08',
      start_time: '10:00',
      end_time: '11:00',
    });
    expect(deposits.decide).not.toHaveBeenCalled();
    expect(prisma.bookings.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: expect.objectContaining({ deposit_decision_due_at: null }),
    });
  });

  it('decideDeposit reschedule: without a deposit balance there is nothing to decide', async () => {
    const { service } = build({
      booking: { status: 'confirmed' },
      deposits: { summary: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.decideDeposit(77, {
        action: 'reschedule',
        request_id: 'd4',
        new_date: '2099-09-08',
        new_start_time: '10:00',
        new_end_time: '11:00',
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ error_code: 'STATION_BOOKING_005' }) });
  });
});
