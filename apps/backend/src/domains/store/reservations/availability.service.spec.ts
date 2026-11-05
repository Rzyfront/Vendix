import { AvailabilityService } from './availability.service';
import { BusinessHoursService } from './business-hours/business-hours.service';

describe('AvailabilityService — business hours integration', () => {
  function buildService(opts: {
    storeHours?: Array<{
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_active?: boolean;
    }>;
    products?: any[];
    providers?: any[];
    schedules?: any[];
    bookings?: any[];
    variants?: any[];
    exception?: any;
  }) {
    const storeHours = opts.storeHours ?? [];
    const businessHoursService = {
      loadStoreHours: jest.fn().mockResolvedValue(
        new Map(
          storeHours
            .filter((r) => r.is_active !== false)
            .map((r) => [
              r.day_of_week,
              [{ start_time: r.start_time, end_time: r.end_time }],
            ]),
        ),
      ),
      // Mirror of loadStoreHours but in the multi-window shape consumed
      // by the availability service after the split-shift fix. Tests that
      // only pass a single row per day still work because each day
      // collapses to a single-element array.
      loadStoreWindows: jest.fn().mockResolvedValue(
        (() => {
          const out = new Map<
            number,
            Array<{ start_time: string; end_time: string }>
          >();
          for (const r of storeHours) {
            if (r.is_active === false) continue;
            const list = out.get(r.day_of_week) ?? [];
            list.push({ start_time: r.start_time, end_time: r.end_time });
            out.set(r.day_of_week, list);
          }
          return out;
        })(),
      ),
    } as any;

    const prisma: any = {
      products: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.products?.find((p) => p.id === where.id) ?? null,
          ),
        ),
      },
      product_variants: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.variants?.find((v) => v.id === where.id && v.product_id === where.product_id) ?? null,
          ),
        ),
      },
      service_providers: {
        findMany: jest.fn().mockResolvedValue(opts.providers ?? []),
      },
      provider_schedules: {
        findMany: jest.fn().mockResolvedValue(opts.schedules ?? []),
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.schedules?.find(
              (s) =>
                s.provider_id === where.provider_id &&
                s.day_of_week === where.day_of_week,
            ) ?? null,
          ),
        ),
      },
      provider_exceptions: {
        findMany: jest.fn().mockResolvedValue(opts.exception ? [opts.exception] : []),
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.exception?.provider_id === where.provider_id &&
              new Date(opts.exception?.date).toISOString().split('T')[0] ===
                where.date.toISOString().split('T')[0]
              ? opts.exception
              : null,
          ),
        ),
      },
      bookings: {
        findMany: jest.fn().mockResolvedValue(opts.bookings ?? []),
        count: jest.fn().mockResolvedValue(0),
      },
      provider_services: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    return {
      service: new AvailabilityService(prisma, businessHoursService),
      prisma,
      businessHoursService,
    };
  }

  it('isSlotAvailable returns false when the store has no business hours row for the day', async () => {
    // Store configured hours only on Monday; Tuesday is closed.
    // (Previously this test inadvertently included `day_of_week: 2` in
    // storeHours, which contradicted the "Tuesday is closed" comment and
    // made the slot overlap with the configured window. After the
    // multi-window refactor, the test data matches the intent.)
    const { service } = buildService({
      storeHours: [
        { day_of_week: 1, start_time: '09:00', end_time: '18:00' },
      ],
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific' }],
      providers: [{ id: 5, display_name: 'Ana', avatar_url: null }],
      schedules: [
        // Tuesday is configured for the provider (10:00-14:00) but the
        // store is "closed" Tuesday because there's no business_hours row.
        { provider_id: 5, day_of_week: 2, start_time: '10:00', end_time: '14:00', is_active: true },
      ],
    });
    const tuesday = '2026-08-18'; // 2026-08-18 is a Tuesday.
    const available = await service.isSlotAvailable(
      10,
      tuesday,
      '11:00',
      '12:00',
      5,
    );
    expect(available).toBe(false);
  });

  it('isSlotAvailable returns true when provider and store windows overlap', async () => {
    const { service } = buildService({
      storeHours: [
        { day_of_week: 2, start_time: '09:00', end_time: '18:00' },
      ],
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific' }],
      providers: [{ id: 5, display_name: 'Ana' }],
      schedules: [
        { provider_id: 5, day_of_week: 2, start_time: '10:00', end_time: '14:00', is_active: true },
      ],
    });
    const tuesday = '2026-08-18';
    const available = await service.isSlotAvailable(
      10,
      tuesday,
      '11:00',
      '12:00',
      5,
    );
    expect(available).toBe(true);
  });

  it('isSlotAvailable rejects slots outside the store window even when provider is free', async () => {
    const { service } = buildService({
      storeHours: [
        { day_of_week: 2, start_time: '09:00', end_time: '13:00' }, // store closes at 13
      ],
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific' }],
      providers: [{ id: 5, display_name: 'Ana' }],
      schedules: [
        { provider_id: 5, day_of_week: 2, start_time: '09:00', end_time: '18:00', is_active: true },
      ],
    });
    const tuesday = '2026-08-18';
    // The provider says they're free until 18, but the store closes at 13 → reject.
    const available = await service.isSlotAvailable(
      10,
      tuesday,
      '14:00',
      '15:00',
      5,
    );
    expect(available).toBe(false);
  });

  it('un producto sin estación acepta un rango de 90 días', async () => {
    const { service } = buildService({
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific', requires_station: false }],
    });
    await expect(service.getAvailableSlots(10, '2026-08-01', '2026-10-30')).resolves.toBeDefined();
  });

  it('un producto con estación rechaza un rango mayor a 62 días', async () => {
    const { service } = buildService({
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific', requires_station: true }],
    });
    await expect(service.getAvailableSlots(10, '2026-08-01', '2026-10-30')).rejects.toThrow(/62/);
  });

  it('variante inválida: 400 solo con estación; sin estación se ignora (contrato anterior)', async () => {
    const station = buildService({
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific', requires_station: true }],
      variants: [],
    });
    await expect(
      station.service.getAvailableSlots(10, '2026-08-01', '2026-08-10', { product_variant_id: 99 }),
    ).rejects.toThrow(/variante/);

    const open = buildService({
      products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific', requires_station: false }],
      variants: [],
    });
    await expect(
      open.service.getAvailableSlots(10, '2026-08-01', '2026-08-10', { product_variant_id: 99 }),
    ).resolves.toBeDefined();
  });
});

describe('AvailabilityService — provider_required never returns generic slots (QUI-969)', () => {
  function buildService(opts: {
    products?: any[];
    providers?: any[];
    schedules?: any[];
    bookings?: any[];
  }) {
    const businessHoursService = {
      // Store open all day Monday so the provider window is the only bound.
      loadStoreHours: jest.fn().mockResolvedValue(
        new Map([[1, [{ start_time: '00:00', end_time: '23:59' }]]]),
      ),
      loadStoreWindows: jest.fn().mockResolvedValue(
        new Map([[1, [{ start_time: '00:00', end_time: '23:59' }]]]),
      ),
    } as any;
    const prisma: any = {
      products: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.products?.find((p) => p.id === where.id) ?? null,
          ),
        ),
      },
      service_providers: {
        findMany: jest.fn().mockResolvedValue(opts.providers ?? []),
      },
      provider_schedules: {
        findMany: jest.fn().mockResolvedValue(opts.schedules ?? []),
      },
      provider_exceptions: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      bookings: {
        findMany: jest.fn().mockResolvedValue(opts.bookings ?? []),
        count: jest.fn().mockResolvedValue(0),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    return {
      service: new AvailabilityService(prisma, businessHoursService),
      prisma,
    };
  }

  const REQUIRED = {
    id: 10,
    store_id: 1,
    booking_mode: 'provider_required',
    requires_station: false,
    service_duration_minutes: 60,
    buffer_minutes: 0,
  };

  it('returns [] when providers have no schedules (no phantom store-hour slots)', async () => {
    const { service } = buildService({
      products: [REQUIRED],
      providers: [{ id: 5, display_name: 'Ana', avatar_url: null }],
      schedules: [],
    });
    // Monday — inside default working days, so the old generic
    // fallback would have emitted store-hour slots here.
    const slots = await service.getAvailableSlots(10, '2026-08-17', '2026-08-17');
    expect(slots).toEqual([]);
  });

  it('returns [] when no active provider offers the service', async () => {
    const { service } = buildService({
      products: [REQUIRED],
      providers: [],
    });
    const slots = await service.getAvailableSlots(10, '2026-08-17', '2026-08-17');
    expect(slots).toEqual([]);
  });

  it('keeps generic slots for free_booking (10 fixed capacity)', async () => {
    const { service } = buildService({
      products: [{ ...REQUIRED, booking_mode: 'free_booking' }],
      providers: [],
    });
    const slots = await service.getAvailableSlots(10, '2026-08-17', '2026-08-17');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].available_providers).toEqual([]);
    expect(slots[0].total_available).toBe(10);
  });

  it('still returns provider slots when a schedule covers the day', async () => {
    const { service } = buildService({
      products: [REQUIRED],
      providers: [{ id: 5, display_name: 'Ana', avatar_url: null }],
      schedules: [
        { provider_id: 5, day_of_week: 1, start_time: '08:00', end_time: '12:00', is_active: true },
      ],
    });
    const slots = await service.getAvailableSlots(10, '2026-08-17', '2026-08-17');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].available_providers).toEqual([
      { id: 5, display_name: 'Ana', avatar_url: null },
    ]);
  });
});

describe('AvailabilityService — horarios nocturnos (S21)', () => {
  // 2026-11-13 is a Friday, 2026-11-14 a Saturday.
  const FRIDAY = '2026-11-13';
  const SATURDAY = '2026-11-14';

  function buildService(opts: {
    product?: any;
    storeHours?: Array<{ day_of_week: number; start_time: string; end_time: string }>;
    providers?: any[];
    schedules?: any[];
    bookings?: any[];
    stations?: any[];
    stationProviders?: Array<{ station_id: number; provider_id: number }>;
    stationSchedules?: any[];
    allocations?: any[];
  }) {
    const hours = new Map<number, Array<{ start_time: string; end_time: string }>>();
    for (const r of opts.storeHours ?? []) {
      const list = hours.get(r.day_of_week) ?? [];
      list.push({ start_time: r.start_time, end_time: r.end_time });
      hours.set(r.day_of_week, list);
    }
    const businessHoursService = {
      loadStoreHours: jest.fn().mockResolvedValue(hours),
      loadStoreWindows: jest.fn().mockResolvedValue(hours),
    } as any;
    const product = {
      id: 10,
      store_id: 1,
      booking_mode: 'provider_required',
      requires_station: false,
      service_duration_minutes: 60,
      buffer_minutes: 0,
      ...opts.product,
    };
    const prisma: any = {
      products: { findFirst: jest.fn().mockResolvedValue(product) },
      product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
      service_providers: { findMany: jest.fn().mockResolvedValue(opts.providers ?? []) },
      provider_schedules: { findMany: jest.fn().mockResolvedValue(opts.schedules ?? []) },
      provider_exceptions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      bookings: { findMany: jest.fn().mockResolvedValue(opts.bookings ?? []), count: jest.fn() },
      provider_services: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          settings: { availability: { working_days: [0, 1, 2, 3, 4, 5, 6] } },
        }),
      },
      service_station_services: {
        findMany: jest.fn().mockResolvedValue((opts.stations ?? []).map((s) => ({ station_id: s.id }))),
      },
      service_stations: { findMany: jest.fn().mockResolvedValue(opts.stations ?? []) },
      service_station_providers: { findMany: jest.fn().mockResolvedValue(opts.stationProviders ?? []) },
      service_station_schedules: { findMany: jest.fn().mockResolvedValue(opts.stationSchedules ?? []) },
      service_station_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
      service_allocations: { findMany: jest.fn().mockResolvedValue(opts.allocations ?? []) },
    };
    return { service: new AvailabilityService(prisma, businessHoursService), prisma };
  }

  const nightStore = [{ day_of_week: 5, start_time: '18:00', end_time: '03:00' }];
  const nightProvider = [
    { provider_id: 5, day_of_week: 5, start_time: '20:00', end_time: '03:00', is_active: true },
  ];
  const ana = [{ id: 5, display_name: 'Ana', avatar_url: null }];

  it('offers slots that cross midnight, dated by the day they start, with end_date', async () => {
    const { service } = buildService({ storeHours: nightStore, providers: ana, schedules: nightProvider });
    const slots = await service.getAvailableSlots(10, FRIDAY, SATURDAY);
    const by = (date: string, start: string) => slots.find((s) => s.date === date && s.start_time === start);

    expect(by(FRIDAY, '20:00')).toMatchObject({ end_time: '21:00', total_available: 1 });
    expect(by(FRIDAY, '20:00')?.end_date).toBeUndefined();
    expect(by(FRIDAY, '23:00')).toMatchObject({ end_time: '00:00', end_date: SATURDAY });
    expect(by(SATURDAY, '00:00')).toMatchObject({ end_time: '01:00', total_available: 1 });
    expect(by(SATURDAY, '02:00')).toMatchObject({ end_time: '03:00' });
    expect(by(SATURDAY, '03:00')).toBeUndefined();
  });

  it('emits the post-midnight spill slots of the Friday block on the requested Saturday', async () => {
    const { service } = buildService({ storeHours: nightStore, providers: ana, schedules: nightProvider });
    const slots = await service.getAvailableSlots(10, SATURDAY, SATURDAY);
    // Friday's block still produces its Saturday-morning slots (A5 spill).
    expect(slots.map((s) => s.start_time)).toEqual(['00:00', '01:00', '02:00']);
    expect(slots.every((s) => s.date === SATURDAY)).toBe(true);
  });

  it('marks an overnight booking as busy on both sides of midnight', async () => {
    const { service } = buildService({
      storeHours: nightStore,
      providers: ana,
      schedules: nightProvider,
      bookings: [
        { provider_id: 5, date: new Date(`${FRIDAY}T00:00:00.000Z`), end_date: new Date(`${SATURDAY}T00:00:00.000Z`), start_time: '23:00', end_time: '01:00' },
      ],
    });
    const slots = await service.getAvailableSlots(10, FRIDAY, SATURDAY);
    const by = (date: string, start: string) => slots.find((s) => s.date === date && s.start_time === start);
    expect(by(FRIDAY, '22:00')?.is_booked).toBe(false);
    expect(by(FRIDAY, '23:00')?.is_booked).toBe(true);
    expect(by(SATURDAY, '00:00')?.is_booked).toBe(true);
    expect(by(SATURDAY, '01:00')?.is_booked).toBe(false);
  });

  it('keeps the daytime grid exactly as before (no end_date)', async () => {
    const { service } = buildService({
      storeHours: [{ day_of_week: 1, start_time: '08:00', end_time: '18:00' }],
      providers: ana,
      schedules: [{ provider_id: 5, day_of_week: 1, start_time: '08:00', end_time: '12:00', is_active: true }],
    });
    const slots = await service.getAvailableSlots(10, '2026-11-16', '2026-11-16');
    expect(slots.map((s) => [s.start_time, s.end_time])).toEqual([
      ['08:00', '09:00'],
      ['09:00', '10:00'],
      ['10:00', '11:00'],
      ['11:00', '12:00'],
    ]);
    expect(slots.some((s) => s.end_date)).toBe(false);
  });

  describe('isSlotAvailable', () => {
    const build = () => buildService({ storeHours: nightStore, providers: ana, schedules: nightProvider });

    it('accepts 23:00-01:00 on Friday', async () => {
      await expect(build().service.isSlotAvailable(10, FRIDAY, '23:00', '01:00', 5)).resolves.toBe(true);
    });

    it('accepts 01:00-02:00 on Saturday through the Friday spill (A5)', async () => {
      await expect(build().service.isSlotAvailable(10, SATURDAY, '01:00', '02:00', 5)).resolves.toBe(true);
    });

    it('rejects a slot that runs past the block end', async () => {
      await expect(build().service.isSlotAvailable(10, FRIDAY, '23:00', '04:00', 5)).resolves.toBe(false);
    });

    it('rejects 01:00 Saturday when Friday has only a daytime block', async () => {
      const { service } = buildService({
        storeHours: [{ day_of_week: 5, start_time: '09:00', end_time: '18:00' }, { day_of_week: 6, start_time: '00:00', end_time: '10:00' }],
        providers: ana,
        schedules: [{ provider_id: 5, day_of_week: 5, start_time: '09:00', end_time: '18:00', is_active: true }],
      });
      await expect(service.isSlotAvailable(10, SATURDAY, '01:00', '02:00', 5)).resolves.toBe(false);
    });

    it('rejects when an overnight booking overlaps the slot after midnight', async () => {
      const { service } = buildService({
        storeHours: nightStore,
        providers: ana,
        schedules: nightProvider,
        bookings: [
          { provider_id: 5, date: new Date(`${FRIDAY}T00:00:00.000Z`), end_date: new Date(`${SATURDAY}T00:00:00.000Z`), start_time: '23:00', end_time: '01:00' },
        ],
      });
      await expect(service.isSlotAvailable(10, SATURDAY, '00:00', '01:00', 5)).resolves.toBe(false);
      await expect(service.isSlotAvailable(10, SATURDAY, '01:00', '02:00', 5)).resolves.toBe(true);
    });
  });

  describe('estaciones sin especialistas (A13)', () => {
    const station = { id: 3, name: 'Cava 3', capacity: 1 };
    const stationNight = [
      { station_id: 3, weekday: 5, start_time: '20:00', end_time: '03:00', is_active: true },
    ];
    const stationProduct = { requires_station: true, booking_mode: 'free_booking' };

    it('gives a cava its own online slots, crossing midnight', async () => {
      const { service } = buildService({
        product: stationProduct,
        storeHours: nightStore,
        stations: [station],
        stationSchedules: stationNight,
      });
      const slots = await service.getAvailableSlots(10, FRIDAY, FRIDAY);
      const late = slots.find((s) => s.start_time === '23:00');
      expect(late).toMatchObject({
        station_id: 3,
        date: FRIDAY,
        end_time: '00:00',
        end_date: SATURDAY,
        total_available: 1,
        available_providers: [],
        is_booked: false,
      });
    });

    it.each([
      ['a required deposit', { deposit_policy: 'required', booking_prepay_mode: 'none' }, true],
      ['a charge to book', { deposit_policy: 'optional', booking_prepay_mode: 'full' }, true],
      ['no online charge', { deposit_policy: 'optional', booking_prepay_mode: 'none' }, false],
    ])('tells the online booking whether the station charges to book (%s)', async (_label, rules, charges) => {
      const { service } = buildService({
        product: stationProduct,
        storeHours: nightStore,
        stations: [{ ...station, ...rules }],
        stationSchedules: stationNight,
      });
      const slots = await service.getAvailableSlots(10, FRIDAY, FRIDAY);
      expect(slots.find((s) => s.start_time === '23:00')?.charges_online).toBe(charges);
    });

    it('marks a slot busy from the station allocation and drops it when include_booked is false', async () => {
      const allocation = {
        station_id: 3,
        provider_id: null,
        start_at: new Date('2026-11-14T04:00:00.000Z'), // 23:00 Bogota Friday
        end_at: new Date('2026-11-14T05:00:00.000Z'),
      };
      const { service } = buildService({
        product: stationProduct,
        storeHours: nightStore,
        stations: [station],
        stationSchedules: stationNight,
        allocations: [allocation],
      });
      const all = await service.getAvailableSlots(10, FRIDAY, FRIDAY);
      expect(all.find((s) => s.start_time === '23:00')).toMatchObject({ is_booked: true, total_available: 0 });
      const free = await service.getAvailableSlots(10, FRIDAY, FRIDAY, { include_booked: false });
      expect(free.find((s) => s.start_time === '23:00')).toBeUndefined();
    });

    it('opens a weekend cava when the store hours cover it, even with the Mon-Fri working_days default', async () => {
      const { service, prisma } = buildService({
        product: stationProduct,
        storeHours: [{ day_of_week: 6, start_time: '18:00', end_time: '03:00' }],
        stations: [station],
        stationSchedules: [{ station_id: 3, weekday: 6, start_time: '20:00', end_time: '03:00', is_active: true }],
      });
      prisma.store_settings.findUnique.mockResolvedValue({ settings: { availability: { working_days: [1, 2, 3, 4, 5] } } });
      const slots = await service.getAvailableSlots(10, SATURDAY, SATURDAY);
      expect(slots.find((s) => s.start_time === '22:00')).toMatchObject({ station_id: 3, date: SATURDAY, total_available: 1 });
    });

    describe('el horario propio de la estación manda (S8, D2)', () => {
      const SUNDAY = '2026-11-15';
      // Store closes Saturday 23:59; the station is open Saturday 22:00 -> Sunday 02:00.
      const storeSat = [{ day_of_week: 6, start_time: '08:00', end_time: '23:59' }];
      const stationSat = [{ station_id: 3, weekday: 6, start_time: '22:00', end_time: '02:00', is_active: true }];

      it('offers the Saturday late and the Sunday 00:00-02:00 slots although the store closes 23:59', async () => {
        const { service } = buildService({
          product: stationProduct,
          storeHours: storeSat,
          stations: [station],
          stationSchedules: stationSat,
        });
        const slots = await service.getAvailableSlots(10, SATURDAY, SUNDAY);
        const key = (s: any) => `${s.date} ${s.start_time}-${s.end_time}`;
        expect(slots.map(key)).toEqual([
          `${SATURDAY} 22:00-23:00`,
          `${SATURDAY} 23:00-00:00`,
          `${SUNDAY} 00:00-01:00`,
          `${SUNDAY} 01:00-02:00`,
        ]);
        expect(slots.find((s) => s.start_time === '23:00')).toMatchObject({ end_date: SUNDAY, total_available: 1 });
      });

      it('the Sunday-only query still gets the spill of the Saturday schedule', async () => {
        const { service } = buildService({
          product: stationProduct,
          storeHours: storeSat,
          stations: [station],
          stationSchedules: stationSat,
        });
        const slots = await service.getAvailableSlots(10, SUNDAY, SUNDAY);
        expect(slots.map((s) => s.start_time)).toEqual(['00:00', '01:00']);
      });

      it('a station without its own schedule offers nothing outside what its rows allow (unchanged)', async () => {
        const { service } = buildService({
          product: stationProduct,
          storeHours: storeSat,
          stations: [station],
          stationSchedules: [],
        });
        await expect(service.getAvailableSlots(10, SATURDAY, SUNDAY)).resolves.toEqual([]);
      });

      it('station exceptions still subtract', async () => {
        const { service, prisma } = buildService({
          product: stationProduct,
          storeHours: storeSat,
          stations: [station],
          stationSchedules: stationSat,
        });
        prisma.service_station_exceptions.findMany.mockResolvedValue([
          { station_id: 3, start_at: new Date('2026-11-15T05:00:00.000Z'), end_at: new Date('2026-11-15T06:00:00.000Z') }, // Sunday 00:00-01:00 Bogota
        ]);
        const slots = await service.getAvailableSlots(10, SATURDAY, SUNDAY);
        expect(slots.map((s) => s.start_time)).toEqual(['22:00', '23:00', '01:00']);
      });

      it('a normal daytime grid inside the store hours is unchanged', async () => {
        const { service } = buildService({
          product: stationProduct,
          storeHours: storeSat,
          stations: [station],
          stationSchedules: [{ station_id: 3, weekday: 6, start_time: '09:00', end_time: '11:00', is_active: true }],
        });
        const slots = await service.getAvailableSlots(10, SATURDAY, SATURDAY);
        expect(slots.map((s) => s.start_time)).toEqual(['09:00', '10:00']);
      });
    });

    it('lets the station own schedule govern even when the store never configured its hours (D2)', async () => {
      const { service, prisma } = buildService({
        product: stationProduct,
        storeHours: [],
        stations: [station],
        stationSchedules: [{ station_id: 3, weekday: 6, start_time: '08:00', end_time: '12:00', is_active: true }],
      });
      prisma.store_settings.findUnique.mockResolvedValue({ settings: { availability: { working_days: [1, 2, 3, 4, 5] } } });
      const slots = await service.getAvailableSlots(10, SATURDAY, SATURDAY);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].start_time).toBe('08:00');
      expect(slots.every((s) => s.start_time >= '08:00' && s.start_time < '12:00')).toBe(true);
    });

    it('still returns [] for a station without providers when the service requires a provider', async () => {
      const { service } = buildService({
        product: { requires_station: true, booking_mode: 'provider_required' },
        storeHours: nightStore,
        stations: [station],
        stationSchedules: stationNight,
      });
      await expect(service.getAvailableSlots(10, FRIDAY, FRIDAY)).resolves.toEqual([]);
    });
  });
});
