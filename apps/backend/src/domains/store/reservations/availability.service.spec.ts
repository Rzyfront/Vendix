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
              { start_time: r.start_time, end_time: r.end_time },
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
        // resolveStoreTimezone → null = default America/Bogota.
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    return {
      service: new AvailabilityService(prisma, businessHoursService),
      prisma,
      businessHoursService,
    };
  }

  // QUI-966 (S4): elapsed slots are never available, so pin "now" before the
  // 2026-08-18 fixtures (2026-08-17 10:00 America/Bogota).
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-08-17T15:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

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

  describe('QUI-966 (S4) time validity', () => {
    const open = () =>
      buildService({
        storeHours: [{ day_of_week: 2, start_time: '09:00', end_time: '18:00' }],
        products: [{ id: 10, store_id: 1, booking_mode: 'provider_specific' }],
        providers: [{ id: 5, display_name: 'Ana' }],
        schedules: [
          { provider_id: 5, day_of_week: 2, start_time: '09:00', end_time: '18:00', is_active: true },
        ],
      });

    it.each([
      ['inverted', '12:00', '11:00'],
      ['zero duration', '11:00', '11:00'],
    ])('a %s range is not available', async (_l, start, end) => {
      const { service } = open();
      await expect(service.isSlotAvailable(10, '2026-08-18', start, end, 5)).resolves.toBe(false);
    });

    it('a slot already elapsed in the store timezone is not available', async () => {
      const { service } = open();
      await expect(service.isSlotAvailable(10, '2026-08-11', '11:00', '12:00', 5)).resolves.toBe(false);
    });

    it('a slot in progress (not yet ended) in the store timezone is still bookable', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      // 2026-08-18 (Tuesday) 10:02 America/Bogota.
      jest.setSystemTime(new Date('2026-08-18T15:02:00.000Z'));
      try {
        const { service } = open();
        await expect(service.isSlotAvailable(10, '2026-08-18', '10:00', '11:00', 5)).resolves.toBe(true);
        await expect(service.isSlotAvailable(10, '2026-08-18', '09:00', '10:00', 5)).resolves.toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('an impossible calendar date is not available', async () => {
      const { service } = open();
      await expect(service.isSlotAvailable(10, '2026-02-30', '11:00', '12:00', 5)).resolves.toBe(false);
    });
  });
});
