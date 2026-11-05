import { RequestContextService } from '@common/context/request-context.service';
import { RentalPrepayHoldExpiryJob } from './rental-prepay-hold-expiry.job';

(RequestContextService.getStoreId as jest.Mock) = jest.fn().mockReturnValue(1);

describe('RentalPrepayHoldExpiryJob', () => {
  function build(rows: any[] = [{ id: 31, purpose: 'service_rental:77', status: 'pending' }]) {
    const tx: any = {
      bookings: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payment_requests: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      payment_requests: { findMany: jest.fn().mockResolvedValue(rows) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const coordinator: any = { releaseBooking: jest.fn().mockResolvedValue(undefined) };
    const emitter: any = { emit: jest.fn() };
    const job = new RentalPrepayHoldExpiryJob(prisma, coordinator, emitter, { runInStoreContext: jest.fn() } as any);
    return { job, prisma, tx, coordinator, emitter };
  }

  it('cancela la reserva pendiente, libera su cupo y vence la solicitud', async () => {
    const { job, tx, coordinator, emitter } = build();
    await expect(job.expireStore()).resolves.toBe(1);
    expect(tx.bookings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 77, status: 'pending' }) }),
    );
    expect(coordinator.releaseBooking).toHaveBeenCalledWith(tx, 1, 77, 'expired');
    expect(tx.payment_requests.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
    );
    expect(emitter.emit).toHaveBeenCalledWith('booking.hold_expired', { store_id: 1, booking_id: 77 });
  });

  it('una reserva que ya no está pendiente se deja intacta (solo se vence la solicitud)', async () => {
    const { job, tx, coordinator } = build();
    tx.bookings.updateMany.mockResolvedValue({ count: 0 });
    await expect(job.expireStore()).resolves.toBe(0);
    expect(coordinator.releaseBooking).not.toHaveBeenCalled();
  });

  it('ignora propósitos que no son de alquiler', async () => {
    const { job, coordinator } = build([{ id: 5, purpose: 'service_deposit', status: 'pending' }]);
    await expect(job.expireStore()).resolves.toBe(0);
    expect(coordinator.releaseBooking).not.toHaveBeenCalled();
  });
});
