/**
 * QUI-966 T2 (S4, S16) — the shared booking-time decorators on the DTOs
 * not covered by booking-dtos.adversarial.spec (ecommerce + reschedule
 * requests) and the still-valid query shapes.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEcommerceBookingDto } from '../../../ecommerce/reservations/dto/create-ecommerce-booking.dto';
import { HoldBookingDto } from '../../../ecommerce/reservations/dto/hold-booking.dto';
import { CreateRescheduleRequestDto } from './create-reschedule-request.dto';
import { BookingQueryDto } from './booking-query.dto';

async function errorsFor<T extends object>(cls: new () => T, payload: object) {
  const errors = await validate(plainToInstance(cls, payload) as object);
  return errors.map((e) => e.property);
}

const slot = {
  product_id: 10,
  date: '2026-11-05',
  start_time: '10:00',
  end_time: '11:00',
};

describe.each([
  ['CreateEcommerceBookingDto', CreateEcommerceBookingDto],
  ['HoldBookingDto', HoldBookingDto],
] as const)('%s', (_name, cls) => {
  it('still accepts a well-formed payload', async () => {
    expect(await errorsFor(cls, { ...slot, notes: 'ok' })).toEqual([]);
  });

  it.each(['2026-02-30', '2026-11-05T10:00:00-05:00', '2026-11-5'])(
    'rejects date %p',
    async (date) => {
      expect(await errorsFor(cls, { ...slot, date })).toContain('date');
    },
  );

  it.each([
    ['11:00', '10:00'],
    ['10:00', '10:00'],
    ['23:30', '00:30'],
  ])('rejects range %s → %s', async (start_time, end_time) => {
    expect(await errorsFor(cls, { ...slot, start_time, end_time })).toContain('end_time');
  });

  it.each([0, -1, 2 ** 40])('rejects product_id %p', async (product_id) => {
    expect(await errorsFor(cls, { ...slot, product_id })).toContain('product_id');
  });

  it('bounds notes length', async () => {
    expect(await errorsFor(cls, { ...slot, notes: 'x'.repeat(1001) })).toContain('notes');
  });
});

describe('CreateRescheduleRequestDto', () => {
  const req = { date: '2026-11-05', start_time: '14:00', end_time: '15:00' };

  it('still accepts a valid request with reason', async () => {
    expect(await errorsFor(CreateRescheduleRequestDto, { ...req, reason: 'viaje' })).toEqual([]);
  });

  it('rejects an inverted range and an impossible date', async () => {
    expect(
      await errorsFor(CreateRescheduleRequestDto, { ...req, start_time: '15:00', end_time: '14:00' }),
    ).toContain('end_time');
    expect(await errorsFor(CreateRescheduleRequestDto, { ...req, date: '2026-02-30' })).toContain(
      'date',
    );
  });
});

describe('BookingQueryDto', () => {
  it('still accepts the defaults and a whitelisted sort', async () => {
    expect(await errorsFor(BookingQueryDto, {})).toEqual([]);
    expect(
      await errorsFor(BookingQueryDto, { limit: '100', sort_by: 'created_at', sort_order: 'desc' }),
    ).toEqual([]);
  });

  it('rejects limit above 100 and non-positive id filters', async () => {
    expect(await errorsFor(BookingQueryDto, { limit: '101' })).toContain('limit');
    expect(await errorsFor(BookingQueryDto, { customer_id: '0' })).toContain('customer_id');
  });
});
