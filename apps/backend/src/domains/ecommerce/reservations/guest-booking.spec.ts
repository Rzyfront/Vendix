import { RequestContextService } from '@common/context/request-context.service';
import { EcommerceReservationsController } from './ecommerce-reservations.controller';
import { GuestBookingService } from './guest-booking.service';

const guestDto = (extra: Record<string, unknown> = {}) =>
  ({
    product_id: 9,
    date: '2026-11-10',
    start_time: '10:00',
    end_time: '11:00',
    guest: { name: 'Ana Maria Pérez', email: 'Ana@Mail.com', phone: '300 111 2233' },
    ...extra,
  }) as any;

describe('Reserva en línea sin sesión (allow_guest_booking)', () => {
  let globalPrisma: any;
  let customers: { resolveGuestCustomerForCheckout: jest.Mock };
  let reservations: { create: jest.Mock; hold: jest.Mock };
  let controller: EcommerceReservationsController;
  let settings: Record<string, unknown>;

  const rawBooking = {
    id: 70,
    booking_number: 'BK-70',
    status: 'confirmed',
    date: '2026-11-10',
    start_time: '10:00',
    end_time: '11:00',
    customer_id: 41,
    customer: { id: 41, first_name: 'Dueña', email: 'ana@mail.com', phone: '3001' },
    notes: 'interno',
  };

  beforeEach(() => {
    settings = { ecommerce: { checkout: { allow_guest_booking: true } } };
    globalPrisma = {
      store_settings: {
        findFirst: jest.fn().mockImplementation(async () => ({ settings })),
      },
      users: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    customers = {
      resolveGuestCustomerForCheckout: jest
        .fn()
        .mockResolvedValue({ customer_id: 88, was_created: true, was_updated: false }),
    };
    reservations = {
      create: jest.fn().mockResolvedValue(rawBooking),
      hold: jest.fn().mockResolvedValue({
        ...rawBooking,
        status: 'payment_pending',
        payment_path: '/pagar/tok123',
        prepay_amount: 5000,
        expires_at: '2026-11-10T10:15:00Z',
      }),
    };
    const guestBooking = new GuestBookingService(globalPrisma, customers as any);
    controller = new EcommerceReservationsController(
      { prisma: {} } as any,
      reservations as any,
      {} as any,
      globalPrisma,
      {} as any,
      guestBooking,
    );
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('con sesión de cliente reserva como siempre, sin leer el ajuste ni resolver invitado', async () => {
    const res = await controller.createBooking(
      { user: { id: 12 }, store_id: 5 },
      guestDto({ guest: undefined }),
    );

    expect(reservations.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 12, product_id: 9, channel: 'ecommerce' }),
    );
    expect(res).toEqual({ success: true, data: rawBooking });
    expect(globalPrisma.store_settings.findFirst).not.toHaveBeenCalled();
    expect(customers.resolveGuestCustomerForCheckout).not.toHaveBeenCalled();
  });

  it('invitado con el ajuste apagado: 403 STATION_BOOKING_013 y no reserva', async () => {
    settings = { ecommerce: { checkout: { allow_guest_booking: false } } };

    await expect(controller.createBooking({ store_id: 5 }, guestDto())).rejects.toMatchObject({
      errorCode: 'STATION_BOOKING_013',
      status: 403,
    });
    expect(reservations.create).not.toHaveBeenCalled();
    expect(customers.resolveGuestCustomerForCheckout).not.toHaveBeenCalled();
  });

  it('invitado sin ajuste guardado (ausente) también recibe 403 STATION_BOOKING_013', async () => {
    settings = {};
    await expect(controller.holdBooking({}, guestDto())).rejects.toMatchObject({
      errorCode: 'STATION_BOOKING_013',
    });
    expect(reservations.hold).not.toHaveBeenCalled();
  });

  it('invitado sin contexto de tienda falla cerrado con 403 STATION_BOOKING_013', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({} as any);
    await expect(controller.createBooking({}, guestDto())).rejects.toMatchObject({
      errorCode: 'STATION_BOOKING_013',
    });
  });

  it.each([
    ['sin guest', undefined],
    ['sin nombre', { email: 'a@b.co', phone: '300' }],
    ['sin correo', { name: 'Ana', phone: '300' }],
    ['sin teléfono', { name: 'Ana', email: 'a@b.co' }],
    ['correo inválido', { name: 'Ana', email: 'no-es-correo', phone: '300' }],
  ])('invitado %s: 400 STATION_BOOKING_014 y no reserva', async (_label, guest) => {
    await expect(
      controller.createBooking({ store_id: 5 }, guestDto({ guest })),
    ).rejects.toMatchObject({ errorCode: 'STATION_BOOKING_014', status: 400 });
    expect(reservations.create).not.toHaveBeenCalled();
    expect(customers.resolveGuestCustomerForCheckout).not.toHaveBeenCalled();
  });

  it('invitado con correo de un cliente existente: asocia la reserva a ese cliente sin tocar ni devolver su cuenta', async () => {
    globalPrisma.users.findFirst.mockResolvedValue({ id: 41 });

    const res: any = await controller.createBooking({ store_id: 5 }, guestDto());

    expect(reservations.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 41, channel: 'ecommerce' }),
    );
    // lookup scoped to the domain's store, customers only
    const where = globalPrisma.users.findFirst.mock.calls[0][0].where;
    expect(where.store_users).toEqual({ some: { store_id: 5 } });
    expect(where.user_roles).toEqual({ some: { roles: { name: 'customer' } } });
    // the account is neither rewritten nor created
    expect(customers.resolveGuestCustomerForCheckout).not.toHaveBeenCalled();
    expect(globalPrisma.users.update).not.toHaveBeenCalled();
    // the response carries confirmation fields only
    expect(res.data).toEqual({
      id: 70,
      booking_number: 'BK-70',
      status: 'confirmed',
      date: '2026-11-10',
      start_time: '10:00',
      end_time: '11:00',
    });
    expect(JSON.stringify(res)).not.toMatch(/Dueña|ana@mail|customer/i);
  });

  it('invitado nuevo: crea el cliente invitado con el helper del checkout (sin teléfono en el helper) y le guarda el teléfono', async () => {
    const res: any = await controller.createBooking({ store_id: 5 }, guestDto());

    expect(customers.resolveGuestCustomerForCheckout).toHaveBeenCalledWith(5, {
      first_name: 'Ana',
      last_name: 'Maria Pérez',
      email: 'ana@mail.com',
    });
    expect(globalPrisma.users.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { phone: '3001112233' },
    });
    expect(reservations.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 88 }),
    );
    expect(res.data.booking_number).toBe('BK-70');
  });

  it('ignora el customer_id, store_id y service_address_id que mande el invitado', async () => {
    globalPrisma.users.findFirst.mockResolvedValue(null);

    await controller.createBooking(
      { store_id: 5 },
      guestDto({ customer_id: 999, store_id: 777, service_address_id: 31 }),
    );

    const arg = reservations.create.mock.calls[0][0];
    expect(arg.customer_id).toBe(88);
    expect(arg).not.toHaveProperty('store_id');
    expect(arg.service_address_id).toBeUndefined();
    expect(globalPrisma.store_settings.findFirst.mock.calls[0][0].where).toEqual({ store_id: 5 });
    expect(globalPrisma.users.findFirst.mock.calls[0][0].where.store_users).toEqual({
      some: { store_id: 5 },
    });
  });

  it('invitado no puede pedir servicio a domicilio', async () => {
    await expect(
      controller.createBooking({ store_id: 5 }, guestDto({ service_location_type: 'home' })),
    ).rejects.toMatchObject({ status: 400 });
    expect(reservations.create).not.toHaveBeenCalled();
    // Refused before resolving the guest: no customer is created or updated.
    expect(customers.resolveGuestCustomerForCheckout).not.toHaveBeenCalled();
    expect(globalPrisma.users.findFirst).not.toHaveBeenCalled();
  });

  it('hold de invitado devuelve el enlace /pagar y solo campos de confirmación', async () => {
    const res: any = await controller.holdBooking({}, guestDto());

    expect(reservations.hold).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 88 }),
    );
    expect(res.data).toEqual({
      id: 70,
      booking_number: 'BK-70',
      status: 'payment_pending',
      date: '2026-11-10',
      start_time: '10:00',
      end_time: '11:00',
      expires_at: '2026-11-10T10:15:00Z',
      payment_path: '/pagar/tok123',
      prepay_amount: 5000,
    });
  });

  it('hold con sesión sigue devolviendo la reserva completa', async () => {
    const res: any = await controller.holdBooking({ user: { id: 12 } }, guestDto({ guest: undefined }));

    expect(reservations.hold).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 12 }));
    expect(res.data.customer).toBeDefined();
    expect(globalPrisma.store_settings.findFirst).not.toHaveBeenCalled();
  });
});
