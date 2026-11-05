import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { EcommerceReservationsController } from './ecommerce-reservations.controller';

describe('EcommerceReservationsController - cotización pública de alquiler', () => {
  const quote = { amount: 12000, cents: 1200000, blocks: 2, pricing_mode: 'station_rate' };
  let rentalQuote: { quote: jest.Mock };
  let availability: any;
  let controller: EcommerceReservationsController;

  beforeEach(() => {
    rentalQuote = { quote: jest.fn().mockResolvedValue(quote) };
    availability = {
      prisma: {
        store_settings: {
          findFirst: jest.fn().mockResolvedValue({
            settings: {},
            stores: { timezone: 'America/Bogota' },
          }),
        },
      },
    };
    controller = new EcommerceReservationsController(
      availability,
      {} as any,
      {} as any,
      {} as any,
      rentalQuote as any,
      {} as any,
    );
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('cotiza la estación con la hora local de la tienda convertida a UTC', async () => {
    const res = await controller.getRentalQuote(9, '3', '2026-11-04', '10:00', '7');

    expect(res).toEqual({ success: true, data: quote });
    const arg = rentalQuote.quote.mock.calls[0][0];
    expect(arg).toMatchObject({ productId: 9, variantId: 7, stationId: 3 });
    // 10:00 Bogotá (UTC-5) = 15:00 UTC
    expect(arg.startAt.toISOString()).toBe('2026-11-04T15:00:00.000Z');
  });

  it('rechaza con 400 si faltan estación, fecha u hora y no cotiza', async () => {
    await expect(
      controller.getRentalQuote(9, undefined, '2026-11-04', '10:00'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getRentalQuote(9, '3', 'mañana', '10:00'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rentalQuote.quote).not.toHaveBeenCalled();
  });
});

describe('EcommerceReservationsController - cancelar desde Mis reservas', () => {
  it('cancela como cliente: las reglas de dinero saben que no decide la tienda', async () => {
    const reservations = {
      findOne: jest.fn().mockResolvedValue({ id: 77, customer_id: 1, status: 'confirmed' }),
      cancel: jest.fn().mockResolvedValue({ id: 77, status: 'cancelled' }),
    };
    const controller = new EcommerceReservationsController(
      {} as any,
      reservations as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const result = await controller.cancelBooking(77, { user: { id: 1 } });
    expect(reservations.cancel).toHaveBeenCalledWith(77, {}, 'customer');
    expect(result).toEqual({ success: true, data: { id: 77, status: 'cancelled' } });
  });
});
