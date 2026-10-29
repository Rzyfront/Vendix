import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { AIToolRegistry } from '../ai-tool-registry';
import { buildToolDocument } from '../tool-catalog';
import { TOOL_DISCOVERY_QUERIES_ES } from '../tool-discovery-queries.es';
import { createLodgingTools } from './lodging.tools';

const SEARCH_RESULT = {
  arrival_date: '2026-11-10',
  departure_date: '2026-11-13',
  nights: 3,
  check_in_time: '15:00',
  check_out_time: '12:00',
  hold_minutes: 30,
  currency: 'COP',
  room_types: [
    {
      id: 1,
      name: 'Doble',
      description: null,
      bed_config: null,
      max_adults: 2,
      max_children: 1,
      max_occupancy: 3,
      images: ['https://signed/photo.jpg'],
      amenities: [],
      available: 4,
      bookable: true,
      unavailable_reason: null,
      rate_plan: { id: 9, name: 'Tarifa estándar' },
      total_amount: '600000.00',
      nightly_average: '200000.00',
      amount_due_now: '180000.00',
      deposit_percent: '30',
      cancellation_policy: 'Cancelación gratis hasta 48 horas antes',
    },
    {
      id: 2,
      name: 'Suite',
      description: null,
      bed_config: null,
      max_adults: 4,
      max_children: 2,
      max_occupancy: 5,
      images: [],
      amenities: [],
      available: 2,
      bookable: false,
      unavailable_reason: 'Estancia mínima de 4 noches para llegar el 10 nov',
      rate_plan: null,
      total_amount: '900000.00',
      nightly_average: '300000.00',
      amount_due_now: '900000.00',
      deposit_percent: '100',
      cancellation_policy: null,
    },
  ],
};

const LINK = 'https://checkout.wompi.co/l/abc123';

/** `LodgingDepositsService.summary` of RES-0031: 30 % of $600.000 required. */
function depositSummary(
  links: Array<{ id: number; status: string; amount: number; checkout_url: string | null }> = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    reservation_id: 31,
    reservation_number: 'RES-0031',
    required: { percent: '30', amount: '180000.00' },
    received: 0,
    applied: 0,
    retained: 0,
    balance: 0,
    pending: 180000,
    can_collect: true,
    movements: links.map((row) => ({
      ...row,
      kind: 'received',
      method: 'wompi_link',
      method_label: 'Link Wompi',
      created_at: new Date('2026-10-28T10:00:00Z'),
    })),
    settlement: null,
    ...overrides,
  };
}

/** `LodgingGuestMessagesJob.precheckinArrivals` of tomorrow (2026-10-29). */
function arrivals(overrides: Record<string, unknown> = {}) {
  const arrival = (n: number, over: Record<string, unknown> = {}) => ({
    reservation_id: n,
    reservation_number: `RES-00${n}`,
    guest_name: `Huésped ${n}`,
    email: `h${n}@example.com`,
    precheckin_done: false,
    reminder_sent: false,
    ...over,
  });
  return {
    today: '2026-10-28',
    arrival_date: '2026-10-29',
    has_link: true,
    arrivals: [
      arrival(31),
      arrival(32, { reminder_sent: true }),
      arrival(33, { email: null }),
      arrival(34, { precheckin_done: true }),
    ],
    ...overrides,
  };
}

function setup() {
  const bookingEngine = { search: jest.fn().mockResolvedValue(SEARCH_RESULT) };
  const reservations = {
    create: jest.fn().mockResolvedValue({ id: 31, reservation_number: 'RES-0031', total_amount: '600000.00' }),
  };
  const findCustomerName = jest.fn().mockResolvedValue('Juan Pérez');
  const deposits = {
    summary: jest.fn().mockResolvedValue(depositSummary()),
    createLink: jest
      .fn()
      .mockResolvedValue(depositSummary([{ id: 5, status: 'pending', amount: 180000, checkout_url: LINK }])),
  };
  const findReservation = jest
    .fn()
    .mockResolvedValue({ id: 31, reservation_number: 'RES-0031', guest_name: 'Juan Pérez' });
  const guestMessages = {
    precheckinArrivals: jest.fn().mockResolvedValue(arrivals()),
    sendPrecheckinNow: jest.fn().mockResolvedValue({ sent: ['RES-0031', 'RES-0032'], failed: [] }),
  };
  const tools = createLodgingTools({
    bookingEngine: bookingEngine as any,
    reservations: reservations as any,
    findCustomerName,
    deposits: deposits as any,
    findReservation,
    guestMessages,
  });
  const tool = tools.find((t) => t.name === 'quote_lodging_availability')!;
  const book = tools.find((t) => t.name === 'book_lodging_stay')!;
  const link = tools.find((t) => t.name === 'create_lodging_deposit_link')!;
  const precheckin = tools.find((t) => t.name === 'send_lodging_precheckin')!;
  return {
    tool,
    book,
    link,
    precheckin,
    tools,
    bookingEngine,
    reservations,
    findCustomerName,
    deposits,
    findReservation,
    guestMessages,
  };
}

const CTX = { store_id: 7, user_id: 1 };

describe('quote_lodging_availability (H9.1)', () => {
  it('is a read-only tool behind the reservations read permission', () => {
    const { tool } = setup();
    expect(tool.name).toBe('quote_lodging_availability');
    expect(tool.readOnly).toBe(true);
    expect(tool.requiresConfirmation).toBeUndefined();
    expect(tool.requiredPermissions).toEqual(['store:lodging:reservations:read']);
    expect(TOOL_DISCOVERY_QUERIES_ES.quote_lodging_availability.length).toBeGreaterThan(0);
    expect(() => buildToolDocument(tool)).not.toThrow();
  });

  it('answers availability per type, total and the restriction from the booking search', async () => {
    const { tool, bookingEngine } = setup();
    const raw = await tool.handler!(
      { arrival_date: '2026-11-10', departure_date: '2026-11-13', adults: 2 },
      CTX,
    );
    const result = JSON.parse(raw as string);

    expect(bookingEngine.search).toHaveBeenCalledWith(
      expect.objectContaining({
        arrival_date: '2026-11-10',
        departure_date: '2026-11-13',
        adults: 2,
        children: 0,
      }),
    );
    expect(result.nights).toBe(3);
    expect(result.currency).toBe('COP');
    expect(result.room_types).toEqual([
      {
        name: 'Doble',
        available_rooms: 4,
        can_sell: true,
        reason_not_sellable: null,
        total_amount: '600000.00',
        nightly_average: '200000.00',
        amount_due_now: '180000.00',
        rate_plan: 'Tarifa estándar',
        cancellation_policy: 'Cancelación gratis hasta 48 horas antes',
        max_adults: 2,
        max_children: 1,
      },
      expect.objectContaining({
        name: 'Suite',
        can_sell: false,
        reason_not_sellable: 'Estancia mínima de 4 noches para llegar el 10 nov',
      }),
    ]);
    // Internal ids and signed photo URLs stay out of the answer.
    expect(raw).not.toContain('signed');
    expect(result.room_types[0].id).toBeUndefined();
  });

  it('explains when no room type fits the guests', async () => {
    const { tool, bookingEngine } = setup();
    bookingEngine.search.mockResolvedValue({ ...SEARCH_RESULT, room_types: [] });
    const result = JSON.parse(
      (await tool.handler!(
        { arrival_date: '2026-11-10', departure_date: '2026-11-13', adults: 12 },
        CTX,
      )) as string,
    );
    expect(result.room_types).toEqual([]);
    expect(result.note).toContain('huéspedes');
  });

  it('rejects malformed stays without searching', async () => {
    const { tool, bookingEngine } = setup();
    const result = JSON.parse(
      (await tool.handler!(
        { arrival_date: '10/11/2026', departure_date: '2026-11-13', adults: 0 },
        CTX,
      )) as string,
    );
    expect(result.error).toBe('Datos de la estadía inválidos.');
    expect(bookingEngine.search).not.toHaveBeenCalled();
  });

  it('returns the service message when the stay cannot be quoted', async () => {
    const { tool, bookingEngine } = setup();
    bookingEngine.search.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LODGING_BOOKING_001, 'La llegada no puede ser una fecha pasada'),
    );
    const result = JSON.parse(
      (await tool.handler!(
        { arrival_date: '2026-11-10', departure_date: '2026-11-13', adults: 2 },
        CTX,
      )) as string,
    );
    expect(result.error).toBe('La llegada no puede ser una fecha pasada');
  });

  it('refuses without a store in context', async () => {
    const { tool, bookingEngine } = setup();
    const result = JSON.parse(
      (await tool.handler!(
        { arrival_date: '2026-11-10', departure_date: '2026-11-13', adults: 2 },
        { user_id: 1 },
      )) as string,
    );
    expect(result.error).toContain('Sin tienda');
    expect(bookingEngine.search).not.toHaveBeenCalled();
  });
});

describe('book_lodging_stay (H9.2)', () => {
  const ARGS = {
    customer_id: 42,
    room_type: 'doble',
    arrival_date: '2026-11-10',
    departure_date: '2026-11-13',
    adults: 2,
  };

  it('is a confirmed write behind the reservations write permission', () => {
    const { book } = setup();
    expect(book.requiresConfirmation).toBe(true);
    expect(book.readOnly).toBeUndefined();
    expect(book.requiredPermissions).toEqual(['store:lodging:reservations:write']);
    expect(TOOL_DISCOVERY_QUERIES_ES.book_lodging_stay.length).toBeGreaterThan(0);
    expect(() => buildToolDocument(book)).not.toThrow();
  });

  it('proposes the guest, room, total, deposit and policy without creating anything', async () => {
    const { book, reservations, findCustomerName } = setup();
    const preview = await book.preview!(ARGS, CTX);

    expect(findCustomerName).toHaveBeenCalledWith(42);
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Reserva de Juan Pérez');
    const to = Object.fromEntries(preview.changes.map((c) => [c.field, c.to]));
    expect(to).toEqual({
      room_type: 'Doble',
      stay: '2026-11-10 al 2026-11-13 · 3 noches',
      guests: '2 adultos',
      total_amount: '$600.000',
      amount_due_now: '$180.000',
      cancellation_policy: 'Cancelación gratis hasta 48 horas antes',
    });
    expect(reservations.create).not.toHaveBeenCalled();
  });

  it('flags a room type that cannot be sold with its reason', async () => {
    const { book } = setup();
    const preview = await book.preview!({ ...ARGS, room_type: 'Suite' }, CTX);
    expect(preview.status).toBe('error');
    expect(preview.message).toBe('No se puede reservar: Estancia mínima de 4 noches para llegar el 10 nov.');
  });

  it('refuses a guest from another store and an unknown room type', async () => {
    const { book, findCustomerName } = setup();
    findCustomerName.mockResolvedValueOnce(null);
    expect((await book.preview!(ARGS, CTX)).message).toBe('Ese huésped no es cliente de este hotel.');
    const unknown = await book.preview!({ ...ARGS, room_type: 'Penthouse' }, CTX);
    expect(unknown.message).toContain('Tipos disponibles: Doble, Suite');
  });

  it('books the quoted room with the same rate plan once confirmed', async () => {
    const { book, reservations } = setup();
    const result = JSON.parse((await book.handler!({ ...ARGS, notes: ' Llega tarde ' }, CTX)) as string);

    expect(reservations.create).toHaveBeenCalledWith({
      arrival_date: '2026-11-10',
      departure_date: '2026-11-13',
      customer_id: 42,
      rooms: [{ unit_type_id: 1, adults: 2, children: 0, rate_plan_id: 9 }],
      notes: 'Llega tarde',
    });
    expect(result).toEqual(
      expect.objectContaining({
        reservation_number: 'RES-0031',
        guest: 'Juan Pérez',
        room_type: 'Doble',
        total_amount: '600000.00',
        status: 'Confirmada',
      }),
    );
  });

  it('re-checks on apply and never books a type that stopped being sellable', async () => {
    const { book, reservations } = setup();
    const result = JSON.parse((await book.handler!({ ...ARGS, room_type: 'Suite' }, CTX)) as string);
    expect(result.error).toContain('No se puede reservar Suite');
    expect(reservations.create).not.toHaveBeenCalled();
  });

  it('returns the service message when the sale fails', async () => {
    const { book, reservations } = setup();
    reservations.create.mockRejectedValue(
      new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_AVAILABILITY_001,
        'Sin disponibilidad de Doble para el 10 nov al 13 nov',
      ),
    );
    const result = JSON.parse((await book.handler!(ARGS, CTX)) as string);
    expect(result.error).toBe('Sin disponibilidad de Doble para el 10 nov al 13 nov');
  });

  describe('through the registry', () => {
    let contextSpy: jest.SpyInstance;
    afterEach(() => contextSpy.mockRestore());

    function registryWith(permissions: string[]) {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ ...CTX, permissions, roles: [] } as any);
      const confirmations = { issue: jest.fn().mockResolvedValue('tok-1'), redeem: jest.fn() };
      const { book, reservations } = setup();
      const registry = new AIToolRegistry(confirmations as any);
      registry.register(book);
      return { registry, reservations, confirmations };
    }

    it('without a token returns the proposal to confirm and creates nothing', async () => {
      const { registry, reservations } = registryWith(['store:lodging:reservations:write']);
      const failure: VendixHttpException = await registry
        .executeTool('book_lodging_stay', ARGS)
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_005');
      const body = failure.getResponse() as any;
      expect(body.details.preview.target).toBe('Reserva de Juan Pérez');
      expect(reservations.create).not.toHaveBeenCalled();
    });

    it('refuses a user without the reservations write permission', async () => {
      const { registry, reservations, confirmations } = registryWith(['store:lodging:reservations:read']);
      const failure: VendixHttpException = await registry
        .executeTool('book_lodging_stay', ARGS, { confirmationToken: 'tok-1' })
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_004');
      expect(confirmations.issue).not.toHaveBeenCalled();
      expect(reservations.create).not.toHaveBeenCalled();
    });
  });
});

describe('create_lodging_deposit_link (H9.3)', () => {
  const ARGS = { reservation_number: 'res-0031' };

  it('is a confirmed write behind the deposit permission of the reservation screen', () => {
    const { link } = setup();
    expect(link.requiresConfirmation).toBe(true);
    expect(link.readOnly).toBeUndefined();
    expect(link.requiredPermissions).toEqual(['store:lodging:folio:close']);
    expect(TOOL_DISCOVERY_QUERIES_ES.create_lodging_deposit_link.length).toBeGreaterThan(0);
    expect(() => buildToolDocument(link)).not.toThrow();
  });

  it('proposes the guest, the required deposit and the amount still lacking without creating a link', async () => {
    const { link, deposits, findReservation } = setup();
    const preview = await link.preview!(ARGS, CTX);

    expect(findReservation).toHaveBeenCalledWith('res-0031');
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Depósito de la reserva RES-0031');
    expect(preview.changes).toEqual([
      { field: 'guest', label: 'Huésped', from: null, to: 'Juan Pérez' },
      { field: 'required', label: 'Depósito requerido', from: null, to: '30 % · $180.000' },
      { field: 'received', label: 'Depósito recibido', from: null, to: '$0' },
      { field: 'amount', label: 'Monto del link', from: null, to: '$180.000' },
    ]);
    expect(deposits.createLink).not.toHaveBeenCalled();
  });

  it('creates the link for what the deposit lacks once confirmed and returns its URL', async () => {
    const { link, deposits } = setup();
    deposits.summary.mockResolvedValue(depositSummary([], { received: 80000, pending: 100000 }));
    deposits.createLink.mockResolvedValue(
      depositSummary([{ id: 6, status: 'pending', amount: 100000, checkout_url: LINK }], { received: 80000 }),
    );
    const result = JSON.parse((await link.handler!(ARGS, CTX)) as string);

    expect(deposits.createLink).toHaveBeenCalledWith(31, { amount: 100000, request_id: expect.any(String) });
    expect(result).toEqual({
      reservation_number: 'RES-0031',
      guest: 'Juan Pérez',
      amount: 100000,
      payment_link: LINK,
      note: 'El depósito aparece en la reserva cuando el huésped pague.',
    });
  });

  it('charges the amount the receptionist names', async () => {
    const { link, deposits } = setup();
    await link.handler!({ ...ARGS, amount: 50000 }, CTX);
    expect(deposits.createLink).toHaveBeenCalledWith(31, { amount: 50000, request_id: expect.any(String) });
  });

  it('hands back the unpaid link that already covers the deposit instead of creating another', async () => {
    const { link, deposits } = setup();
    deposits.summary.mockResolvedValue(
      depositSummary([{ id: 5, status: 'pending', amount: 180000, checkout_url: LINK }]),
    );

    const preview = await link.preview!(ARGS, CTX);
    expect(preview.status).toBe('error');
    expect(preview.message).toContain(LINK);

    const result = JSON.parse((await link.handler!(ARGS, CTX)) as string);
    expect(result.payment_link).toBe(LINK);
    expect(deposits.createLink).not.toHaveBeenCalled();
  });

  it('refuses a deposit already covered, a reservation that no longer takes deposits and an unknown number', async () => {
    const { link, deposits, findReservation } = setup();
    deposits.summary.mockResolvedValueOnce(depositSummary([], { received: 180000, pending: 0 }));
    expect(JSON.parse((await link.handler!(ARGS, CTX)) as string).error).toBe(
      'La reserva RES-0031 no tiene depósito pendiente.',
    );

    deposits.summary.mockResolvedValueOnce(depositSummary([], { can_collect: false }));
    expect(JSON.parse((await link.handler!(ARGS, CTX)) as string).error).toBe(
      'La reserva RES-0031 ya no admite depósitos.',
    );

    findReservation.mockResolvedValueOnce(null);
    expect(JSON.parse((await link.handler!(ARGS, CTX)) as string).error).toBe(
      'No encontré la reserva res-0031 en este hotel.',
    );
    expect(deposits.createLink).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount and a missing store without touching the reservation', async () => {
    const { link, findReservation } = setup();
    expect(JSON.parse((await link.handler!({ ...ARGS, amount: -5 }, CTX)) as string).error).toContain(
      'mayor a cero',
    );
    expect(JSON.parse((await link.handler!(ARGS, { user_id: 1 })) as string).error).toContain('Sin tienda');
    expect(findReservation).not.toHaveBeenCalled();
  });

  it('returns the service message when Wompi does not create the link', async () => {
    const { link, deposits } = setup();
    deposits.createLink.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'Wompi no creó el link: llaves inválidas'),
    );
    const result = JSON.parse((await link.handler!(ARGS, CTX)) as string);
    expect(result.error).toBe('Wompi no creó el link: llaves inválidas');
  });

  describe('through the registry', () => {
    let contextSpy: jest.SpyInstance;
    afterEach(() => contextSpy.mockRestore());

    function registryWith(permissions: string[]) {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ ...CTX, permissions, roles: [] } as any);
      const confirmations = { issue: jest.fn().mockResolvedValue('tok-1'), redeem: jest.fn() };
      const { link, deposits } = setup();
      const registry = new AIToolRegistry(confirmations as any);
      registry.register(link);
      return { registry, deposits, confirmations };
    }

    it('without a token returns the proposal to confirm and creates no link', async () => {
      const { registry, deposits } = registryWith(['store:lodging:folio:close']);
      const failure: VendixHttpException = await registry
        .executeTool('create_lodging_deposit_link', ARGS)
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_005');
      const body = failure.getResponse() as any;
      expect(body.details.preview.target).toBe('Depósito de la reserva RES-0031');
      expect(deposits.createLink).not.toHaveBeenCalled();
    });

    it('refuses a user without the deposit permission', async () => {
      const { registry, deposits, confirmations } = registryWith(['store:lodging:reservations:write']);
      const failure: VendixHttpException = await registry
        .executeTool('create_lodging_deposit_link', ARGS, { confirmationToken: 'tok-1' })
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_004');
      expect(confirmations.issue).not.toHaveBeenCalled();
      expect(deposits.createLink).not.toHaveBeenCalled();
    });
  });
});

describe('send_lodging_precheckin (H9.4)', () => {
  it('is a confirmed write behind the front desk permission of the online check-in link', () => {
    const { precheckin } = setup();
    expect(precheckin.requiresConfirmation).toBe(true);
    expect(precheckin.requiredPermissions).toEqual(['store:lodging:front_desk:operate']);
    expect(TOOL_DISCOVERY_QUERIES_ES.send_lodging_precheckin.length).toBeGreaterThan(0);
    expect(() => buildToolDocument(precheckin)).not.toThrow();
  });

  it("proposes tomorrow's arrivals that get the email, naming who has no email and who already completed it", async () => {
    const { precheckin, guestMessages } = setup();
    const preview = await precheckin.preview!({}, CTX);

    expect(guestMessages.precheckinArrivals).toHaveBeenCalledWith(undefined);
    expect(preview.status).toBe('warning');
    expect(preview.target).toBe('Pre check-in de las llegadas del 29-oct');
    expect(preview.changes.map((c) => [c.label, c.to])).toEqual([
      ['RES-0031 · Huésped 31', 'h31@example.com'],
      ['RES-0032 · Huésped 32', 'h32@example.com'],
    ]);
    expect(preview.message).toContain('Se enviarán 2 correo(s)');
    expect(preview.message).toContain('Sin correo, no se envía: RES-0033 (Huésped 33)');
    expect(preview.message).toContain('Ya completaron el pre check-in: 1');
    expect(preview.message).toContain('1 ya habían recibido el recordatorio automático');
    expect(guestMessages.sendPrecheckinNow).not.toHaveBeenCalled();
  });

  it('sends once confirmed and the summary says how many went out', async () => {
    const { precheckin, guestMessages } = setup();
    guestMessages.sendPrecheckinNow.mockResolvedValue({ sent: ['RES-0031'], failed: ['RES-0032'] });
    const result = JSON.parse((await precheckin.handler!({ arrival_date: '2026-10-29' }, CTX)) as string);

    expect(guestMessages.precheckinArrivals).toHaveBeenCalledWith('2026-10-29');
    expect(guestMessages.sendPrecheckinNow).toHaveBeenCalledWith([31, 32]);
    expect(result).toMatchObject({
      sent: 1,
      sent_to: ['RES-0031'],
      not_sent: ['RES-0032'],
      without_email: ['RES-0033'],
      already_completed: 1,
      summary: 'Salieron 1 de 2 correo(s) de pre check-in para las llegadas del 29-oct.',
    });
    expect(result.next_step).toBeDefined();
  });

  it('refuses a past date, a hotel without online store, a day without arrivals and a day with nobody to send', async () => {
    const { precheckin, guestMessages } = setup();
    const error = async (data: Record<string, unknown>) => {
      guestMessages.precheckinArrivals.mockResolvedValueOnce(arrivals(data));
      return JSON.parse((await precheckin.handler!({}, CTX)) as string).error as string;
    };
    expect(await error({ arrival_date: '2026-10-27' })).toContain('ya pasó');
    expect(await error({ has_link: false })).toContain('tienda en línea');
    expect(await error({ arrivals: [] })).toBe('No hay llegadas confirmadas para el 29-oct.');
    expect(
      await error({
        arrivals: [
          { reservation_id: 33, reservation_number: 'RES-0033', guest_name: 'A', email: null, precheckin_done: false, reminder_sent: false },
          { reservation_id: 34, reservation_number: 'RES-0034', guest_name: 'B', email: 'b@x.co', precheckin_done: true, reminder_sent: false },
        ],
      }),
    ).toBe('No hay a quién enviarle el pre check-in del 29-oct (1 ya completaron el pre check-in; sin correo: RES-0033).');
    expect(guestMessages.sendPrecheckinNow).not.toHaveBeenCalled();
  });

  it('rejects a malformed date and a missing store without reading arrivals', async () => {
    const { precheckin, guestMessages } = setup();
    expect(JSON.parse((await precheckin.handler!({ arrival_date: 'mañana' }, CTX)) as string).error).toContain(
      'no es válida',
    );
    expect(JSON.parse((await precheckin.handler!({}, { user_id: 1 })) as string).error).toContain('Sin tienda');
    expect(guestMessages.precheckinArrivals).not.toHaveBeenCalled();
  });

  describe('through the registry', () => {
    let contextSpy: jest.SpyInstance;
    afterEach(() => contextSpy.mockRestore());

    function registryWith(permissions: string[]) {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ ...CTX, permissions, roles: [] } as any);
      const confirmations = { issue: jest.fn().mockResolvedValue('tok-1'), redeem: jest.fn() };
      const { precheckin, guestMessages } = setup();
      const registry = new AIToolRegistry(confirmations as any);
      registry.register(precheckin);
      return { registry, guestMessages, confirmations };
    }

    it('without a token returns the list to confirm and sends nothing', async () => {
      const { registry, guestMessages } = registryWith(['store:lodging:front_desk:operate']);
      const failure: VendixHttpException = await registry
        .executeTool('send_lodging_precheckin', {})
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_005');
      const body = failure.getResponse() as any;
      expect(body.details.preview.target).toBe('Pre check-in de las llegadas del 29-oct');
      expect(guestMessages.sendPrecheckinNow).not.toHaveBeenCalled();
    });

    it('refuses a user without the front desk permission', async () => {
      const { registry, guestMessages, confirmations } = registryWith(['store:lodging:reservations:read']);
      const failure: VendixHttpException = await registry
        .executeTool('send_lodging_precheckin', {}, { confirmationToken: 'tok-1' })
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_004');
      expect(confirmations.issue).not.toHaveBeenCalled();
      expect(guestMessages.sendPrecheckinNow).not.toHaveBeenCalled();
    });
  });
});
