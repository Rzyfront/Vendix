/**
 * Adversarial QA spec for reservations DTO validation (class-validator).
 * Each case states what the API SHOULD reject or accept; a failing test is a
 * finding.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';
import { RescheduleBookingDto } from './reschedule-booking.dto';
import { BookingQueryDto } from './booking-query.dto';

const base = {
  product_id: 10,
  date: '2026-11-05',
  start_time: '10:00',
  end_time: '11:00',
};

async function errorsFor<T extends object>(cls: new () => T, payload: object) {
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto as object);
  return errors.map((e) => e.property);
}

describe('CreateBookingDto (adversarial)', () => {
  it('accepts a well-formed payload', async () => {
    expect(await errorsFor(CreateBookingDto, base)).toEqual([]);
  });

  it.each(['24:00', '9:00', '10:60', '10:00:00', ' 10:00', '1000'])(
    'rejects malformed start_time %p',
    async (start_time) => {
      expect(await errorsFor(CreateBookingDto, { ...base, start_time })).toContain('start_time');
    },
  );

  it('rejects a missing product_id', async () => {
    const { product_id: _omit, ...rest } = base;
    expect(await errorsFor(CreateBookingDto, rest)).toContain('product_id');
  });

  it.each([0, -1, -999])('rejects non-positive product_id %p', async (product_id) => {
    expect(await errorsFor(CreateBookingDto, { ...base, product_id })).toContain('product_id');
  });

  it.each([-3, 0])('rejects non-positive provider_id %p', async (provider_id) => {
    expect(await errorsFor(CreateBookingDto, { ...base, provider_id })).toContain('provider_id');
  });

  it('rejects ids above Postgres INT4 max', async () => {
    expect(
      await errorsFor(CreateBookingDto, { ...base, product_id: 2 ** 40 }),
    ).toContain('product_id');
  });

  it.each([1.5, '12abc', 'NaN'])('rejects non-integer customer_id %p', async (customer_id) => {
    expect(await errorsFor(CreateBookingDto, { ...base, customer_id })).toContain('customer_id');
  });

  it.each(['not-a-date', '2026-13-01'])('rejects invalid date %p', async (date) => {
    expect(await errorsFor(CreateBookingDto, { ...base, date })).toContain('date');
  });

  it('rejects an impossible calendar date (Feb 30)', async () => {
    expect(await errorsFor(CreateBookingDto, { ...base, date: '2026-02-30' })).toContain('date');
  });

  it('rejects a date carrying a time/offset (civil date only)', async () => {
    expect(
      await errorsFor(CreateBookingDto, { ...base, date: '2026-11-05T20:00:00-05:00' }),
    ).toContain('date');
  });

  it('rejects end_time before start_time', async () => {
    const errs = await errorsFor(CreateBookingDto, { ...base, start_time: '11:00', end_time: '10:00' });
    expect(errs.length).toBeGreaterThan(0);
  });

  it('bounds notes length', async () => {
    expect(
      await errorsFor(CreateBookingDto, { ...base, notes: 'x'.repeat(100_000) }),
    ).toContain('notes');
  });

  it('rejects skip_availability_check sent as string "true" (no implicit coercion)', async () => {
    expect(
      await errorsFor(CreateBookingDto, { ...base, skip_availability_check: 'true' }),
    ).toContain('skip_availability_check');
  });

  it('rejects an unknown service_location_type', async () => {
    expect(
      await errorsFor(CreateBookingDto, { ...base, service_location_type: 'moon' }),
    ).toContain('service_location_type');
  });
});

describe('RescheduleBookingDto (adversarial)', () => {
  it('rejects end_time before start_time', async () => {
    const errs = await errorsFor(RescheduleBookingDto, {
      date: '2026-11-05',
      start_time: '15:00',
      end_time: '14:00',
    });
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('BookingQueryDto (adversarial)', () => {
  it.each(['0', '-1', 'abc'])('rejects page %p', async (page) => {
    expect(await errorsFor(BookingQueryDto, { page })).toContain('page');
  });

  it('caps limit (no unbounded page size)', async () => {
    expect(await errorsFor(BookingQueryDto, { limit: '1000000' })).toContain('limit');
  });

  it('whitelists sort_by to real sortable columns', async () => {
    expect(await errorsFor(BookingQueryDto, { sort_by: 'customer' })).toContain('sort_by');
  });

  it('rejects an unknown status filter', async () => {
    expect(await errorsFor(BookingQueryDto, { status: 'deleted' })).toContain('status');
  });
});
