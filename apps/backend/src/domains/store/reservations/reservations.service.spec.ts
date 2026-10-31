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
