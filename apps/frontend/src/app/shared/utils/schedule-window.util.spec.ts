import {
  bookingEndDateFor,
  clipBookingToDay,
  isOvernight,
  validateWeeklyBlocks,
  windowMinutes,
} from './schedule-window.util';

describe('schedule-window.util (frontend)', () => {
  it('keeps daytime blocks as before and detects overnight ones', () => {
    expect(isOvernight({ start_time: '09:00', end_time: '18:00' })).toBeFalse();
    expect(isOvernight({ start_time: '20:00', end_time: '03:00' })).toBeTrue();
    expect(windowMinutes({ start_time: '09:00', end_time: '18:00' })).toBe(540);
    expect(windowMinutes({ start_time: '20:00', end_time: '03:00' })).toBe(420);
    expect(windowMinutes({ start_time: '00:00', end_time: '00:00' })).toBe(1440);
  });

  it('sets end_date to D+1 only when the booking crosses midnight', () => {
    expect(bookingEndDateFor('2026-03-31', '23:00', '01:00')).toBe('2026-04-01');
    expect(bookingEndDateFor('2026-03-31', '10:00', '11:00')).toBeNull();
  });

  it('validates overnight blocks and rejects overlap with the previous day spill', () => {
    expect(
      validateWeeklyBlocks([{ day: 5, start_time: '20:00', end_time: '03:00' }]),
    ).toBeNull();
    expect(
      validateWeeklyBlocks([
        { day: 5, start_time: '20:00', end_time: '03:00' },
        { day: 6, start_time: '02:00', end_time: '05:00' },
      ]),
    ).toEqual({ day: 6, reason: 'overlap' });
    expect(
      validateWeeklyBlocks([{ day: 1, start_time: '9:00', end_time: '18:00' }]),
    ).toEqual({ day: 1, reason: 'format' });
  });

  it('clips an overnight booking on both days (A14)', () => {
    const booking = { date: '2026-03-06', start_time: '23:00', end_time: '01:00' };
    expect(clipBookingToDay(booking, '2026-03-06')).toEqual({ startMin: 1380, endMin: 1440 });
    expect(clipBookingToDay(booking, '2026-03-07')).toEqual({ startMin: 0, endMin: 60 });
    expect(clipBookingToDay(booking, '2026-03-08')).toBeNull();
  });
});
