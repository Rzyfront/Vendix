import {
  ClockWindow,
  addDaysToDateString,
  bookingEndDateFor,
  bookingInterval,
  bookingMinuteSpan,
  coverageForDate,
  intersectSpans,
  coversSpan,
  isOpenAt,
  spansOverlap,
  validateWeeklyBlocks,
  windowSpan,
  windowsForDate,
} from './schedule-window.util';

const week = (entries: Record<number, ClockWindow[]>) =>
  new Map<number, ClockWindow[]>(
    Object.entries(entries).map(([k, v]) => [Number(k), v]),
  );

describe('schedule-window.util', () => {
  describe('windowSpan', () => {
    it('keeps a same-day block as is (previous behavior)', () => {
      expect(windowSpan({ start_time: '09:00', end_time: '18:00' })).toEqual({
        startMin: 540,
        endMin: 1080,
      });
    });

    it('treats end <= start as ending the next day', () => {
      expect(windowSpan({ start_time: '20:00', end_time: '03:00' })).toEqual({
        startMin: 1200,
        endMin: 1620,
      });
    });

    it('treats 00:00-00:00 as 24 hours', () => {
      expect(windowSpan({ start_time: '00:00', end_time: '00:00' })).toEqual({
        startMin: 0,
        endMin: 1440,
      });
    });

    it('treats a close at 00:00 as the end of that same day', () => {
      expect(windowSpan({ start_time: '09:00', end_time: '00:00' })).toEqual({
        startMin: 540,
        endMin: 1440,
      });
    });
  });

  describe('windowsForDate / isOpenAt (A5: a block belongs to the day it starts)', () => {
    const hours = week({ 5: [{ start_time: '20:00', end_time: '03:00' }] });

    it('keeps the own block of the starting day', () => {
      expect(windowsForDate(hours, 5)).toEqual([{ startMin: 1200, endMin: 1620 }]);
    });

    it('adds the previous day overnight spill clipped to the day start', () => {
      expect(windowsForDate(hours, 6)).toEqual([{ startMin: 0, endMin: 180 }]);
    });

    it('wraps Saturday to Sunday', () => {
      const sat = week({ 6: [{ start_time: '22:00', end_time: '02:00' }] });
      expect(windowsForDate(sat, 0)).toEqual([{ startMin: 0, endMin: 120 }]);
    });

    it('is open at 01:00 Saturday thanks to Friday', () => {
      expect(isOpenAt(hours, 6, 60)).toBe(true);
      expect(isOpenAt(hours, 6, 180)).toBe(false);
      expect(isOpenAt(hours, 5, 1300)).toBe(true);
      expect(isOpenAt(hours, 5, 60)).toBe(false);
    });

    it('daytime blocks keep their previous result', () => {
      const day = week({ 1: [{ start_time: '09:00', end_time: '18:00' }] });
      expect(windowsForDate(day, 1)).toEqual([{ startMin: 540, endMin: 1080 }]);
      expect(windowsForDate(day, 2)).toEqual([]);
      expect(isOpenAt(day, 1, 540)).toBe(true);
      expect(isOpenAt(day, 1, 1080)).toBe(false);
    });
  });

  describe('coversSpan', () => {
    const hours = week({ 5: [{ start_time: '20:00', end_time: '03:00' }] });

    it('covers an interval that crosses midnight inside one overnight block', () => {
      expect(coversSpan(hours, 5, 1380, 1500)).toBe(true); // 23:00-01:00
    });

    it('rejects an interval that exceeds the block', () => {
      expect(coversSpan(hours, 5, 1380, 1700)).toBe(false);
    });

    it('covers an interval that starts after midnight on the spill day', () => {
      expect(coversSpan(hours, 6, 30, 150)).toBe(true);
    });

    it('unions contiguous blocks (split shift with no gap)', () => {
      const split = week({
        1: [
          { start_time: '09:00', end_time: '12:00' },
          { start_time: '12:00', end_time: '18:00' },
        ],
      });
      expect(coversSpan(split, 1, 600, 1000)).toBe(true);
    });

    it('does not cross a gap between blocks (previous behavior)', () => {
      const split = week({
        1: [
          { start_time: '09:00', end_time: '12:00' },
          { start_time: '14:00', end_time: '18:00' },
        ],
      });
      expect(coversSpan(split, 1, 660, 900)).toBe(false);
    });

    it('chains into the next day own block when contiguous', () => {
      const chain = week({
        5: [{ start_time: '20:00', end_time: '03:00' }],
        6: [{ start_time: '03:00', end_time: '10:00' }],
      });
      expect(coversSpan(chain, 5, 1380, 1800)).toBe(true);
    });

    it('rejects when nothing is configured', () => {
      expect(coversSpan(new Map(), 1, 600, 660)).toBe(false);
    });
  });

  describe('bookingEndDateFor / bookingInterval', () => {
    it('returns null for a same-day booking', () => {
      expect(bookingEndDateFor('2026-11-13', '10:00', '11:00')).toBeNull();
    });

    it('returns D+1 when the booking crosses midnight', () => {
      expect(bookingEndDateFor('2026-11-13', '23:00', '01:00')).toBe('2026-11-14');
    });

    it('rolls over the month end', () => {
      expect(addDaysToDateString('2026-11-30', 1)).toBe('2026-12-01');
    });

    it('builds UTC instants in the store timezone (same-day)', () => {
      const { startAt, endAt } = bookingInterval(
        { date: new Date('2026-11-13T00:00:00.000Z'), start_time: '10:00', end_time: '11:00' },
        'America/Bogota',
      );
      expect(startAt.toISOString()).toBe('2026-11-13T15:00:00.000Z');
      expect(endAt.toISOString()).toBe('2026-11-13T16:00:00.000Z');
    });

    it('uses end_date when present', () => {
      const { endAt } = bookingInterval(
        {
          date: new Date('2026-11-13T00:00:00.000Z'),
          end_date: new Date('2026-11-14T00:00:00.000Z'),
          start_time: '22:00',
          end_time: '03:00',
        },
        'America/Bogota',
      );
      expect(endAt.toISOString()).toBe('2026-11-14T08:00:00.000Z');
    });

    it('infers D+1 when end_date is null and end <= start', () => {
      const { endAt } = bookingInterval(
        { date: '2026-11-13', end_date: null, start_time: '23:00', end_time: '01:00' },
        'America/Bogota',
      );
      expect(endAt.toISOString()).toBe('2026-11-14T06:00:00.000Z');
    });
  });

  describe('validateWeeklyBlocks', () => {
    it('accepts a daytime block', () => {
      expect(
        validateWeeklyBlocks([{ day: 1, start_time: '09:00', end_time: '18:00' }]),
      ).toBeNull();
    });

    it('accepts a block ending the next day', () => {
      expect(
        validateWeeklyBlocks([{ day: 5, start_time: '18:00', end_time: '03:00' }]),
      ).toBeNull();
    });

    it('rejects overlapping blocks of the same day', () => {
      expect(
        validateWeeklyBlocks([
          { day: 1, start_time: '09:00', end_time: '13:00' },
          { day: 1, start_time: '12:00', end_time: '18:00' },
        ]),
      ).toEqual({ day: 1, reason: 'overlap' });
    });

    it('rejects a block that overlaps the previous day spill', () => {
      expect(
        validateWeeklyBlocks([
          { day: 5, start_time: '20:00', end_time: '03:00' },
          { day: 6, start_time: '02:00', end_time: '10:00' },
        ]),
      ).toEqual({ day: 6, reason: 'overlap' });
    });

    it('accepts the next day starting exactly when the spill ends', () => {
      expect(
        validateWeeklyBlocks([
          { day: 5, start_time: '20:00', end_time: '03:00' },
          { day: 6, start_time: '03:00', end_time: '10:00' },
        ]),
      ).toBeNull();
    });

    it('rejects an invalid format', () => {
      expect(
        validateWeeklyBlocks([{ day: 1, start_time: '9:00', end_time: '18:00' }]),
      ).toEqual({ day: 1, reason: 'format' });
    });
  });

  describe('spansOverlap', () => {
    it('is half open', () => {
      expect(spansOverlap({ startMin: 0, endMin: 60 }, { startMin: 60, endMin: 120 })).toBe(false);
      expect(spansOverlap({ startMin: 0, endMin: 61 }, { startMin: 60, endMin: 120 })).toBe(true);
    });
  });

  describe('coverageForDate', () => {
    it('merges own blocks, the previous day spill and the next day own blocks', () => {
      const chain = week({
        5: [{ start_time: '20:00', end_time: '03:00' }],
        6: [{ start_time: '03:00', end_time: '10:00' }],
      });
      expect(coverageForDate(chain, 5)).toEqual([{ startMin: 1200, endMin: 1440 + 600 }]);
      expect(coverageForDate(chain, 6)).toEqual([{ startMin: 0, endMin: 600 }]);
    });

    it('keeps a daytime day as its own single span (previous behavior)', () => {
      const day = week({ 1: [{ start_time: '09:00', end_time: '18:00' }] });
      expect(coverageForDate(day, 1)).toEqual([{ startMin: 540, endMin: 1080 }]);
      expect(coverageForDate(day, 2)).toEqual([]);
    });
  });

  describe('intersectSpans', () => {
    it('intersects one span with a list', () => {
      expect(
        intersectSpans({ startMin: 600, endMin: 1000 }, [
          { startMin: 0, endMin: 700 },
          { startMin: 900, endMin: 1500 },
          { startMin: 1100, endMin: 1200 },
        ]),
      ).toEqual([
        { startMin: 600, endMin: 700 },
        { startMin: 900, endMin: 1000 },
      ]);
    });
  });

  describe('bookingMinuteSpan', () => {
    it('places a same-day booking on its date', () => {
      expect(
        bookingMinuteSpan({ date: '2026-11-13', start_time: '10:00', end_time: '11:00' }, '2026-11-13'),
      ).toEqual({ startMin: 600, endMin: 660 });
    });

    it('shifts by the distance to the reference date and honors end_date', () => {
      expect(
        bookingMinuteSpan(
          { date: new Date('2026-11-13T00:00:00.000Z'), end_date: new Date('2026-11-14T00:00:00.000Z'), start_time: '22:00', end_time: '03:00' },
          '2026-11-14',
        ),
      ).toEqual({ startMin: -120, endMin: 180 });
    });

    it('infers the next day when end_date is null and end <= start', () => {
      expect(
        bookingMinuteSpan({ date: '2026-11-13', end_date: null, start_time: '23:00', end_time: '01:00' }, '2026-11-13'),
      ).toEqual({ startMin: 1380, endMin: 1500 });
    });
  });
});
