import { VendixHttpException, ErrorCodes } from '../../../common/errors';
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
  const [tool] = createLodgingTools({ bookingEngine: bookingEngine as any });
  return { tool, bookingEngine };
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
