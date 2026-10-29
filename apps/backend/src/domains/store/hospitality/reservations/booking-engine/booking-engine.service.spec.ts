import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import {
  LodgingBookingEngineService,
  HOLD_PAYMENT_GRACE_MS,
  WEB_HOLD_EXPIRED_REASON,
  WEB_HOLD_REASON,
} from './booking-engine.service';

const NOW = new Date('2026-11-01T15:00:00.000Z');

const QUOTE = {
  unit_type: { id: 3, name: 'Doble' },
  available: 2,
  rate_plan: { id: 5, name: 'Flexible' },
  total_amount: '750000.00',
  deposit_percent: '30',
  cancellation_policy: null,
  restrictions: [] as string[],
};

const RESERVATION = {
  id: 40,
  reservation_number: 'H-0040',
  total_amount: new Prisma.Decimal(750000),
  rooms: [{ deposit_percent: new Prisma.Decimal(30), unit_type: { name: 'Doble' } }],
};

const HOLD = {
  unit_type_id: 3,
  arrival_date: '2026-11-20',
  departure_date: '2026-11-23',
  adults: 2,
  return_url: 'https://roku-shop.vendix.com/hotel/reserva',
};

function build() {
  const payments: Record<string, any>[] = [];
  const prisma = {
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: { hospitality: { booking_hold_minutes: 20 } } })),
    },
    stores: { findFirst: jest.fn(async () => ({ timezone: 'America/Bogota' })) },
    lodging_rate_plans: { findFirst: jest.fn(async () => ({ id: 5 })) },
    lodging_unit_types: {
      findMany: jest.fn(async () => [
        {
          id: 3,
          name: 'Doble',
          description: null,
          bed_config: null,
          max_adults: 2,
          max_children: 0,
          max_occupancy: 2,
          images: ['rooms/doble.jpg'],
          amenities: [],
        },
      ]),
    },
    lodging_reservations: {
      findMany: jest.fn(async (): Promise<Array<{ id: number }>> => []),
      findFirst: jest.fn(async (): Promise<Record<string, unknown> | null> => ({ status: 'cancelled' })),
    },
    lodging_reservation_events: { create: jest.fn(async () => ({})) },
    lodging_reservation_payments: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: payments.length + 1, ...data };
        payments.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const row = payments.find(
          (p) => p.payment_link_id === where.payment_link_id && where.status.in.includes(p.status),
        );
        return row
          ? {
              id: row.id,
              status: row.status,
              amount: row.amount,
              reservation: { id: row.reservation_id, reservation_number: 'H-0040', customer_id: 272 },
            }
          : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        payments.filter((p) => p.reservation_id === where.reservation_id && p.status === where.status),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: number[] = where.id?.in ?? [where.id];
        const hit = payments.filter((p) => ids.includes(p.id) && p.status === where.status);
        hit.forEach((p) => Object.assign(p, data));
        return { count: hit.length };
      }),
    },
    payment_links: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const reservations = {
    quote: jest.fn(async (): Promise<typeof QUOTE> => QUOTE),
    create: jest.fn(async () => RESERVATION),
    confirmHold: jest.fn(async () => true),
    releaseHold: jest.fn(async () => true),
  };
  const paymentLinks = {
    create: jest.fn(async (): Promise<unknown> => ({
      data: { id: 900, checkout_url: 'https://checkout.wompi.co/l/abc' },
    })),
  };
  const email = { sendEmail: jest.fn(async () => ({ success: true })) };
  const events = { emit: jest.fn() };
  const runner = { runInStoreContext: jest.fn(async (_id: number, fn: () => unknown) => fn()) };
  const s3 = { signUrl: jest.fn(async (key: string) => `https://s3/${key}`) };
  const service = new LodgingBookingEngineService(
    prisma as any,
    reservations as any,
    paymentLinks as any,
    s3 as any,
    email as any,
    events as any,
    runner as any,
  );
  return { service, prisma, reservations, paymentLinks, email, events, payments, s3 };
}

describe('LodgingBookingEngineService (H6.6)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 10 } as any);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('search', () => {
    const STAY = { arrival_date: '2026-11-20', departure_date: '2026-11-23', adults: 2, children: 0 };

    it('la tienda online cotiza sin huésped y con las fotos firmadas', async () => {
      const { service, reservations, s3 } = build();
      const result = await service.search(STAY);
      expect(reservations.quote).toHaveBeenCalledWith(expect.not.objectContaining({ customer_id: expect.anything() }));
      expect(s3.signUrl).toHaveBeenCalledWith('rooms/doble.jpg');
      expect(result.room_types[0].images).toEqual(['https://s3/rooms/doble.jpg']);
    });

    it('recepción (Vexi) cotiza con el cupo del huésped y sin firmar fotos', async () => {
      const { service, reservations, s3 } = build();
      const result = await service.search(STAY, { customer_id: 272, with_images: false });
      expect(reservations.quote).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 272, unit_type_id: 3 }));
      expect(s3.signUrl).not.toHaveBeenCalled();
      expect(result.room_types[0].images).toEqual([]);
    });
  });

  describe('hold', () => {
    it('reserva tentativa por los minutos de la tienda y link Wompi por el depósito que vence con ella', async () => {
      const { service, reservations, paymentLinks, payments } = build();
      const result = await service.hold(272, HOLD);

      const expires_at = new Date('2026-11-01T15:20:00.000Z');
      expect(reservations.create).toHaveBeenCalledWith(
        {
          arrival_date: '2026-11-20',
          departure_date: '2026-11-23',
          customer_id: 272,
          notes: undefined,
          rooms: [{ unit_type_id: 3, adults: 2, children: 0, rate_plan_id: 5 }],
        },
        { expires_at, reason: WEB_HOLD_REASON },
      );
      expect(paymentLinks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          single_use: true,
          amount_in_cents: 22_500_000,
          expires_at: expires_at.toISOString(),
          redirect_url: 'https://roku-shop.vendix.com/hotel/reserva/40',
        }),
      );
      // A direct payment of the reservation, never a deposit (D3).
      expect(payments).toEqual([
        expect.objectContaining({
          store_id: 10,
          reservation_id: 40,
          status: 'pending',
          method: 'wompi_link',
          payment_link_id: 900,
        }),
      ]);
      expect(payments[0].amount.toFixed(2)).toBe('225000.00');
      expect(result).toEqual({
        reservation_id: 40,
        reservation_number: 'H-0040',
        hold_expires_at: expires_at,
        amount_due: '225000.00',
        checkout_url: 'https://checkout.wompi.co/l/abc',
      });
    });

    it('si Wompi no crea el link la reserva se libera y el viajero ve el mensaje', async () => {
      const { service, reservations, paymentLinks, payments } = build();
      paymentLinks.create.mockRejectedValueOnce(new Error('Llave no válida'));
      const error = await service.hold(272, HOLD).catch((e) => e);
      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error.message).toBe('No pudimos iniciar el pago en línea. Intenta de nuevo o contacta al hotel.');
      expect(reservations.releaseHold).toHaveBeenCalledWith(40, 'No se pudo iniciar el pago en línea');
      expect(payments).toHaveLength(0);
    });

    it('un nuevo hold del mismo huésped libera el anterior sin pagar', async () => {
      const { service, prisma, reservations } = build();
      prisma.lodging_reservations.findMany.mockResolvedValueOnce([{ id: 33 }]);
      await service.hold(272, HOLD);
      expect(prisma.lodging_reservations.findMany).toHaveBeenCalledWith({
        where: { customer_id: 272, status: 'tentative', hold_expires_at: { not: null } },
        select: { id: true },
      });
      expect(reservations.releaseHold).toHaveBeenCalledWith(
        33,
        'Reserva web reemplazada por una nueva del mismo huésped',
      );
    });

    it('no reserva noches pasadas', async () => {
      const { service, reservations } = build();
      const error = await service
        .hold(272, { ...HOLD, arrival_date: '2026-10-30', departure_date: '2026-11-02' })
        .catch((e) => e);
      expect(error.message).toBe('La llegada no puede ser una fecha pasada');
      expect(reservations.create).not.toHaveBeenCalled();
    });
  });

  describe('pago', () => {
    it('Wompi confirma: pago completado, asiento DR banco / CR 2805, reserva confirmada y email; repetir no duplica', async () => {
      const { service, prisma, reservations, email, events, payments } = build();
      await service.hold(272, HOLD);
      prisma.lodging_reservations.findFirst.mockResolvedValueOnce({
        reservation_number: 'H-0040',
        arrival_date: new Date('2026-11-20T00:00:00.000Z'),
        departure_date: new Date('2026-11-23T00:00:00.000Z'),
        total_amount: new Prisma.Decimal(750000),
        customer: { email: 'huesped@example.com', first_name: 'Ana' },
        store: { name: 'Hotel Roku' },
        rooms: [{ adults: 2, children: 0, cancellation_policy_snapshot: null, unit_type: { name: 'Doble' } }],
      });

      expect(await service.completePayment(900, 'wompi-tx-1')).toBe(true);
      expect(payments[0]).toMatchObject({ status: 'completed', transaction_id: 'wompi-tx-1', paid_at: NOW });
      expect(events.emit).toHaveBeenCalledWith('lodging.reservation_payment.received', {
        store_id: 10,
        reservation_payment_id: 1,
        reservation_number: 'H-0040',
        amount: 225000,
        customer_id: 272,
      });
      expect(reservations.confirmHold).toHaveBeenCalledWith(
        40,
        expect.stringMatching(/^Pago en línea recibido .*225\.000 \(Wompi\)$/),
      );
      expect(email.sendEmail).toHaveBeenCalledWith(
        'huesped@example.com',
        'Reserva H-0040 confirmada · Hotel Roku',
        expect.any(String),
        expect.stringContaining('Reserva: H-0040'),
      );

      // A repeated webhook finds it completed.
      expect(await service.completePayment(900, 'wompi-tx-1')).toBe(false);
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('si el pago llega con el hold ya vencido queda registrado y el historial pide devolverlo', async () => {
      const { service, prisma, reservations, email, payments } = build();
      await service.hold(272, HOLD);
      reservations.confirmHold.mockResolvedValueOnce(false);
      expect(await service.completePayment(900, null)).toBe(true);
      expect(payments[0].status).toBe('completed');
      expect(prisma.lodging_reservation_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reservation_id: 40,
          from_status: 'cancelled',
          to_status: 'cancelled',
          reason: expect.stringContaining('con la reserva ya vencida: devuélvelo al huésped'),
        }),
      });
      expect(email.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('pago de un hold confirmado a mano', () => {
    it('no pide devolver: registra el pago y envía la confirmación', async () => {
      const { service, prisma, reservations, email } = build();
      await service.hold(272, HOLD);
      reservations.confirmHold.mockResolvedValueOnce(false);
      prisma.lodging_reservations.findFirst
        .mockResolvedValueOnce({ status: 'confirmed' })
        .mockResolvedValueOnce({
          reservation_number: 'H-0040',
          arrival_date: new Date('2026-11-20T00:00:00.000Z'),
          departure_date: new Date('2026-11-23T00:00:00.000Z'),
          total_amount: new Prisma.Decimal(750000),
          customer: { email: 'huesped@example.com', first_name: 'Ana' },
          store: { name: 'Hotel Roku' },
          rooms: [{ adults: 2, children: 0, cancellation_policy_snapshot: null, unit_type: { name: 'Doble' } }],
        });

      expect(await service.completePayment(900, null)).toBe(true);

      const { reason } = (prisma.lodging_reservation_events.create.mock.calls[0] as any)[0].data;
      expect(reason).not.toContain('devuélvelo');
      expect(reason).toContain('Pago en línea recibido');
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('expiración', () => {
    it('el hold vencido sin pago se cancela, su pago queda cancelado y su link se cierra', async () => {
      const { service, prisma, reservations, payments } = build();
      await service.hold(272, HOLD);
      prisma.lodging_reservations.findMany.mockResolvedValueOnce([{ id: 40 }]);

      expect(await service.expireHolds(NOW)).toBe(1);
      expect(prisma.lodging_reservations.findMany).toHaveBeenLastCalledWith({
        where: {
          status: 'tentative',
          // Grace for a webhook of a payment made in the link's last minute.
          hold_expires_at: { lt: new Date(NOW.getTime() - HOLD_PAYMENT_GRACE_MS) },
          online_payments: { none: { status: 'completed' } },
        },
        select: { id: true },
      });
      expect(reservations.releaseHold).toHaveBeenCalledWith(40, WEB_HOLD_EXPIRED_REASON);
      expect(payments[0].status).toBe('cancelled');
      expect(prisma.payment_links.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [900] }, status: 'active' },
        data: { status: 'cancelled', updated_at: NOW },
      });
    });

    it('si Wompi confirma después de vencer el hold, el pago se registra, se contabiliza y el historial pide devolverlo', async () => {
      const { service, prisma, reservations, email, events, payments } = build();
      await service.hold(272, HOLD);
      prisma.lodging_reservations.findMany.mockResolvedValueOnce([{ id: 40 }]);
      await service.expireHolds(NOW);
      expect(payments[0].status).toBe('cancelled');

      reservations.confirmHold.mockResolvedValueOnce(false);
      expect(await service.completePayment(900, 'wompi-tx-late')).toBe(true);
      expect(payments[0]).toMatchObject({ status: 'completed', transaction_id: 'wompi-tx-late' });
      expect(events.emit).toHaveBeenCalledWith(
        'lodging.reservation_payment.received',
        expect.objectContaining({ reservation_payment_id: 1, amount: 225000 }),
      );
      expect(prisma.lodging_reservation_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason: expect.stringContaining('devuélvelo al huésped') }),
      });
      expect(email.sendEmail).not.toHaveBeenCalled();
      // Repeated webhook: counted once.
      expect(await service.completePayment(900, 'wompi-tx-late')).toBe(false);
      expect(events.emit).toHaveBeenCalledTimes(1);
    });

    it('un hold que otro proceso ya resolvió no se toca', async () => {
      const { service, prisma, reservations, payments } = build();
      await service.hold(272, HOLD);
      prisma.lodging_reservations.findMany.mockResolvedValueOnce([{ id: 40 }]);
      reservations.releaseHold.mockResolvedValueOnce(false);
      expect(await service.expireHolds(NOW)).toBe(0);
      expect(payments[0].status).toBe('pending');
    });
  });
});
