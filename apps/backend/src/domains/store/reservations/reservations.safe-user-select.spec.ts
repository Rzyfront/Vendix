import { ReservationsService } from './reservations.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
  projectUserRow,
} from '../../../testing/user-row-fixture';

/**
 * A repeated customer check-in answers with the booking it already has,
 * customer included: profile columns only for that customer.
 */
describe('ReservationsService.checkIn — customer with minimal user columns', () => {
  const prisma = createPrismaMock({ bookings: ['findUnique', 'update'] });

  it('returns the already checked-in booking without the customer credentials', async () => {
    prisma.bookings.findUnique.mockImplementation(async (args: any) => ({
      id: 70,
      status: 'arriving',
      checked_in_at: new Date('2026-11-23T14:00:00Z'),
      customer: projectUserRow(fullUserRow(5), args.include.customer.select),
    }));
    const service = new ReservationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const booking = await service.checkIn(70, 'customer');

    expectNoSensitiveUserFields(booking.customer);
    expect(booking.customer).toEqual(
      expect.objectContaining({ id: 5, first_name: 'Ana', last_name: 'Pérez' }),
    );
    expect(prisma.bookings.update).not.toHaveBeenCalled();
  });
});
