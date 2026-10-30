/**
 * QUI-966 (S4/S14) — `bookings[]` of the ecommerce checkout under the same
 * global ValidationPipe options as `main.ts` (whitelist +
 * forbidNonWhitelisted): the fields the storefront sends are accepted and
 * the booking-time rules match the booking endpoints.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CheckoutDto } from './checkout.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});

const run = (bookings: unknown[]) =>
  pipe.transform(
    { payment_method_id: 7, bookings },
    { type: 'body', metatype: CheckoutDto },
  );

const storefrontBooking = {
  product_id: 10,
  product_variant_id: 3,
  date: '2026-11-05',
  start_time: '10:00',
  end_time: '11:00',
  provider_id: 5,
  provider_name: 'Ana',
  service_location_type: 'home',
  service_address_id: 44,
  service_address_label: 'Calle 1 # 2-3',
};

describe('CheckoutDto.bookings (QUI-966)', () => {
  it('accepts the exact payload the storefront sends', async () => {
    const dto: CheckoutDto = await run([storefrontBooking]);
    expect(dto.bookings?.[0]).toMatchObject({
      provider_id: 5,
      service_location_type: 'home',
      service_address_id: 44,
    });
  });

  it('accepts a minimal booking without the optional fields', async () => {
    await expect(
      run([{ product_id: 10, date: '2026-11-05', start_time: '10:00', end_time: '11:00' }]),
    ).resolves.toBeDefined();
  });

  it.each([
    ['an impossible date', { date: '2026-02-30' }],
    ['a date with time/offset', { date: '2026-11-05T10:00:00Z' }],
    ['an inverted range', { start_time: '11:00', end_time: '10:00' }],
    ['a zero-length range', { start_time: '10:00', end_time: '10:00' }],
    ['an unknown location type', { service_location_type: 'moon' }],
  ])('rejects %s with 400', async (_l, patch) => {
    await expect(run([{ ...storefrontBooking, ...patch }])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still rejects fields nobody declared', async () => {
    await expect(run([{ ...storefrontBooking, price: 1 }])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
