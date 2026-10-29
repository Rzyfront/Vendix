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

function setup() {
  const bookingEngine = { search: jest.fn().mockResolvedValue(SEARCH_RESULT) };
  const reservations = {
    create: jest.fn().mockResolvedValue({ id: 31, reservation_number: 'RES-0031', total_amount: '600000.00' }),
  };
  const findCustomerName = jest.fn().mockResolvedValue('Juan Pérez');
  const tools = createLodgingTools({
    bookingEngine: bookingEngine as any,
    reservations: reservations as any,
    findCustomerName,
  });
  const tool = tools.find((t) => t.name === 'quote_lodging_availability')!;
  const book = tools.find((t) => t.name === 'book_lodging_stay')!;
  return { tool, book, tools, bookingEngine, reservations, findCustomerName };
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
