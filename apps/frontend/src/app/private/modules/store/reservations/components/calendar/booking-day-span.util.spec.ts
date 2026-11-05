import { bookingDaySpan } from './booking-day-span.util';

describe('bookingDaySpan', () => {
  it('keeps a daytime booking unchanged', () => {
    const b = { date: '2026-03-06', start_time: '10:00', end_time: '11:30' };
    expect(bookingDaySpan(b, '2026-03-06')).toEqual({ start: '10:00', end: '11:30' });
  });

  it('clips an overnight booking on both days', () => {
    const b = { date: '2026-03-06T00:00:00.000Z', end_date: '2026-03-07', start_time: '23:00', end_time: '01:00' };
    expect(bookingDaySpan(b, '2026-03-06')).toEqual({ start: '23:00', end: '24:00' });
    expect(bookingDaySpan(b, '2026-03-07')).toEqual({ start: '00:00', end: '01:00' });
  });
});
