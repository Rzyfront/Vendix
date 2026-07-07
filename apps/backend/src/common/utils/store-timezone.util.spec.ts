import {
  DEFAULT_STORE_TIMEZONE,
  assertSafeTimezone,
  resolveStoreTimezone,
  resolveLocalDateRange,
  localPeriodKey,
  enumerateLocalPeriodKeys,
  localPeriodSql,
  zonedWallClockToUtc,
} from './store-timezone.util';

const BOGOTA = 'America/Bogota'; // UTC-5, no DST

describe('store-timezone.util', () => {
  describe('assertSafeTimezone', () => {
    it('accepts a valid IANA timezone', () => {
      expect(assertSafeTimezone('America/Bogota')).toBe('America/Bogota');
      expect(assertSafeTimezone('Europe/Madrid')).toBe('Europe/Madrid');
      expect(assertSafeTimezone('Etc/GMT+5')).toBe('Etc/GMT+5');
    });

    it('falls back to DEFAULT for an injection attempt', () => {
      expect(assertSafeTimezone("'; DROP")).toBe(DEFAULT_STORE_TIMEZONE);
      expect(assertSafeTimezone('America/Bogota; SELECT 1')).toBe(
        DEFAULT_STORE_TIMEZONE,
      );
    });

    it('falls back to DEFAULT for undefined / null / empty', () => {
      expect(assertSafeTimezone(undefined)).toBe(DEFAULT_STORE_TIMEZONE);
      expect(assertSafeTimezone(null)).toBe(DEFAULT_STORE_TIMEZONE);
      expect(assertSafeTimezone('')).toBe(DEFAULT_STORE_TIMEZONE);
    });

    it('DEFAULT is America/Bogota', () => {
      expect(DEFAULT_STORE_TIMEZONE).toBe('America/Bogota');
    });
  });

  describe('resolveStoreTimezone', () => {
    it('reads store_settings.settings.general.timezone', async () => {
      const prisma = {
        store_settings: {
          findFirst: jest.fn().mockResolvedValue({
            settings: { general: { timezone: 'America/New_York' } },
          }),
        },
      } as any;
      await expect(resolveStoreTimezone(prisma, 10)).resolves.toBe(
        'America/New_York',
      );
      expect(prisma.store_settings.findFirst).toHaveBeenCalledWith({
        where: { store_id: 10 },
        select: { settings: true },
      });
    });

    it('falls back to DEFAULT when settings are missing or invalid', async () => {
      const missing = {
        store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;
      await expect(resolveStoreTimezone(missing, 1)).resolves.toBe(
        DEFAULT_STORE_TIMEZONE,
      );

      const invalid = {
        store_settings: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ settings: { general: { timezone: "'; DROP" } } }),
        },
      } as any;
      await expect(resolveStoreTimezone(invalid, 1)).resolves.toBe(
        DEFAULT_STORE_TIMEZONE,
      );
    });
  });

  describe('resolveLocalDateRange (custom range)', () => {
    // Contract test #1 (from the task): the QUI-487 boundary case.
    it('maps a single Bogota calendar day to its exact UTC boundaries', () => {
      const { startDate, endDate } = resolveLocalDateRange(
        { date_from: '2026-06-30', date_to: '2026-06-30' },
        BOGOTA,
      );
      expect(startDate.toISOString()).toBe('2026-06-30T05:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-07-01T04:59:59.999Z');
    });

    it('spans multiple Bogota calendar days inclusively', () => {
      const { startDate, endDate } = resolveLocalDateRange(
        { date_from: '2026-06-30', date_to: '2026-07-01' },
        BOGOTA,
      );
      expect(startDate.toISOString()).toBe('2026-06-30T05:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-07-02T04:59:59.999Z');
    });

    it('falls back to DEFAULT timezone when an unsafe tz is passed', () => {
      const { startDate } = resolveLocalDateRange(
        { date_from: '2026-06-30', date_to: '2026-06-30' },
        "'; DROP",
      );
      // Same as Bogota (the default) → UTC-5 boundary.
      expect(startDate.toISOString()).toBe('2026-06-30T05:00:00.000Z');
    });
  });

  describe('localPeriodKey — the QUI-487 bug', () => {
    // Contract test #2: order POS-2026-0004 at 2026-07-01T04:40:02Z is a
    // June 30 sale in Bogota (23:40 local), NOT a July 1 sale.
    it('buckets a 04:40Z order into the previous LOCAL day for Bogota', () => {
      const order = new Date('2026-07-01T04:40:02Z');
      expect(localPeriodKey(order, 'day', BOGOTA)).toBe('2026-06-30');
    });

    it('a 05:30Z order (00:30 local) belongs to the new LOCAL day', () => {
      const order = new Date('2026-07-01T05:30:00Z');
      expect(localPeriodKey(order, 'day', BOGOTA)).toBe('2026-07-01');
    });

    it('produces UTC bucket only when tz is UTC (documents the old bug)', () => {
      const order = new Date('2026-07-01T04:40:02Z');
      // Under UTC the same order wrongly lands on July 1 — the systemic bug.
      expect(localPeriodKey(order, 'day', 'UTC')).toBe('2026-07-01');
    });

    it('week granularity aligns to the local Monday (matches PG DATE_TRUNC)', () => {
      // 2026-06-30 is a Tuesday → ISO week Monday = 2026-06-29.
      const order = new Date('2026-07-01T04:40:02Z'); // 2026-06-30 local
      expect(localPeriodKey(order, 'week', BOGOTA)).toBe('2026-06-29');
    });

    it('month and year granularity', () => {
      const order = new Date('2026-07-01T04:40:02Z'); // 2026-06-30 local
      expect(localPeriodKey(order, 'month', BOGOTA)).toBe('2026-06');
      expect(localPeriodKey(order, 'year', BOGOTA)).toBe('2026');
    });

    it('hour granularity uses local wall-clock hour', () => {
      const order = new Date('2026-07-01T04:40:02Z'); // 2026-06-30 23:40 local
      expect(localPeriodKey(order, 'hour', BOGOTA)).toBe('2026-06-30T23:00');
    });
  });

  describe('enumerateLocalPeriodKeys — zero-fill / SQL label contract', () => {
    // Contract test #4: for a range crossing local midnight, the fill labels
    // match, key-for-key, what the SQL to_char(DATE_TRUNC(...)) would emit for
    // each order in that range.
    it('day granularity yields exactly the local calendar days in range', () => {
      const { startDate, endDate } = resolveLocalDateRange(
        { date_from: '2026-06-30', date_to: '2026-07-01' },
        BOGOTA,
      );
      const keys = enumerateLocalPeriodKeys(startDate, endDate, 'day', BOGOTA);
      expect(keys).toEqual(['2026-06-30', '2026-07-01']);

      // Key-to-key match: each order's SQL label (== localPeriodKey) is present.
      const orderJun30 = new Date('2026-07-01T04:40:02Z'); // 2026-06-30 local
      const orderJul01 = new Date('2026-07-01T05:30:00Z'); // 2026-07-01 local
      expect(keys).toContain(localPeriodKey(orderJun30, 'day', BOGOTA));
      expect(keys).toContain(localPeriodKey(orderJul01, 'day', BOGOTA));
    });

    it('hour granularity fills every local hour of a single day', () => {
      const { startDate, endDate } = resolveLocalDateRange(
        { date_from: '2026-06-30', date_to: '2026-06-30' },
        BOGOTA,
      );
      const keys = enumerateLocalPeriodKeys(startDate, endDate, 'hour', BOGOTA);
      expect(keys).toHaveLength(24);
      expect(keys[0]).toBe('2026-06-30T00:00');
      expect(keys[23]).toBe('2026-06-30T23:00');
      // The QUI-487 order falls into the 23:00 local bucket, present in the fill.
      const order = new Date('2026-07-01T04:40:02Z');
      expect(keys).toContain(localPeriodKey(order, 'hour', BOGOTA));
    });

    it('week granularity yields Monday-aligned labels', () => {
      const { startDate, endDate } = resolveLocalDateRange(
        { date_from: '2026-06-29', date_to: '2026-07-12' },
        BOGOTA,
      );
      const keys = enumerateLocalPeriodKeys(startDate, endDate, 'week', BOGOTA);
      expect(keys).toEqual(['2026-06-29', '2026-07-06']);
    });

    it('month granularity spans month labels', () => {
      const { startDate, endDate } = resolveLocalDateRange(
        { date_from: '2026-05-15', date_to: '2026-07-10' },
        BOGOTA,
      );
      const keys = enumerateLocalPeriodKeys(startDate, endDate, 'month', BOGOTA);
      expect(keys).toEqual(['2026-05', '2026-06', '2026-07']);
    });
  });

  describe('zonedWallClockToUtc — DST generality (not just Colombia)', () => {
    it('resolves New York winter (EST, UTC-5)', () => {
      const utc = zonedWallClockToUtc(2026, 1, 15, 12, 0, 0, 0, 'America/New_York');
      expect(utc.toISOString()).toBe('2026-01-15T17:00:00.000Z');
    });

    it('resolves New York summer (EDT, UTC-4)', () => {
      const utc = zonedWallClockToUtc(2026, 7, 15, 12, 0, 0, 0, 'America/New_York');
      expect(utc.toISOString()).toBe('2026-07-15T16:00:00.000Z');
    });

    it('day bucketing differs across a DST zone at the same UTC instant', () => {
      // 2026-03-01T04:30Z → New York is 2026-02-28 23:30 (EST) → prev day.
      const order = new Date('2026-03-01T04:30:00Z');
      expect(localPeriodKey(order, 'day', 'America/New_York')).toBe('2026-02-28');
    });
  });

  describe('localPeriodSql — SQL fragment shape', () => {
    it('emits a to_char(DATE_TRUNC(... AT TIME ZONE ...)) fragment', () => {
      const sql = localPeriodSql('o.created_at', BOGOTA, 'day');
      const text = sql.sql;
      expect(text).toContain('to_char');
      expect(text).toContain('DATE_TRUNC');
      expect(text).toContain("AT TIME ZONE 'UTC'");
      expect(text).toContain("AT TIME ZONE 'America/Bogota'");
      expect(text).toContain('o.created_at');
    });

    it('sanitizes an unsafe timezone before inlining', () => {
      const sql = localPeriodSql('o.created_at', "'; DROP TABLE orders; --", 'day');
      expect(sql.sql).not.toContain('DROP');
      expect(sql.sql).toContain("AT TIME ZONE 'America/Bogota'");
    });
  });
});
